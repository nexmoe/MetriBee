const assert = require('node:assert/strict');
const { journeyReport, journeySessionDetails, demoJourneySessions, demoJourneySession, patternOf } = require('../controllers/sessionJourneys');

const session = (id, pages, extra = {}) => ({
  session_id: id, user_id: `user-${id}`, country: 'US', hostname: 'test.example',
  events: pages.map((pathname, i) => ({ type: 'pageview', pathname, timestamp: `2026-10-25 10:00:${String(i).padStart(2, '0')}` })),
  ...extra,
});
const sessions = [
  session('a', ['/', '/', '/docs/a', '/docs/b', '/signup', '/done'], { goal_ids: [1] }),
  session('b', ['/', '/docs/a', '/signup'], { has_replay: 1 }),
  session('c', ['/', '/pricing']),
  session('d', ['/', '/']),
];

describe('Rybbit session journey semantics', () => {
  it('matches literal paths and native wildcards without exponential regex backtracking', () => {
    assert(patternOf('/docs/*').test('/docs/a'));
    assert(!patternOf('/docs/*').test('/docs/'));
    assert(!patternOf('/docs/*').test('/docs/a/b'));
    assert(patternOf('/docs/**').test('/docs/a/b'));
    assert(patternOf('/docs/**').test('/docs/'));
    assert(patternOf('/a.b+(c)').test('/a.b+(c)'));
    assert(!patternOf('/a.b+(c)').test('/axbccc'));
    assert(!patternOf('/' + '*a'.repeat(300) + 'b').test('/' + 'a'.repeat(1000)));
  });
  it('orders page views, removes consecutive repeats, and counts multi-page sessions rather than pairs', () => {
    const report = journeyReport([...sessions, session('e', [])], { steps: '4' });
    assert.equal(report.totalSessions, 3);
    assert(report.journeys.some(row => JSON.stringify(row.path) === JSON.stringify(['/', '/docs/a', '/docs/b', '/signup'])));
    const outOfOrder = session('ordered', []);
    outOfOrder.events = [
      { type: 'pageview', pathname: '/b', timestamp: '2026-10-25 10:00:02' },
      { type: 'pageview', pathname: '/a', timestamp: '2026-10-25 10:00:01' },
    ];
    assert.deepEqual(journeyReport([outOfOrder], {}).journeys[0].path, ['/a', '/b']);
  });
  it('aggregates exact prefixes and keeps shares relative to all multi-page sessions before filters and limits', () => {
    const report = journeyReport(sessions, { steps: '2', limit: '1', stepFilters: JSON.stringify({ 1: '/docs/*' }) });
    assert.equal(report.totalSessions, 3);
    assert.deepEqual(report.journeys, [{ path: ['/', '/docs/a'], count: 2, percentage: 200 / 3 }]);
  });
  it('uses native section patterns and compacts consecutive sections after selecting multi-page sessions', () => {
    const report = journeyReport([session('a', ['/docs/a', '/docs/b', '/pricing']), session('b', ['/docs/a', '/docs/b'])], { groupBy: 'section', steps: '4' });
    assert.equal(report.totalSessions, 2);
    assert(report.journeys.some(row => JSON.stringify(row.path) === JSON.stringify(['/docs/**'])));
    assert(report.journeys.some(row => JSON.stringify(row.path) === JSON.stringify(['/docs/**', '/pricing'])));
  });
  it('cuts at the first matching end page after the entry, within the selected depth', () => {
    const report = journeyReport(sessions, { steps: '4', endsAt: '/signup' });
    assert.deepEqual(report.journeys.map(row => row.path), [['/', '/docs/a', '/docs/b', '/signup'], ['/', '/docs/a', '/signup']]);
    const tooShort = journeyReport(sessions, { steps: '2', endsAt: '/signup' });
    assert.equal(tooShort.totalSessions, 3);
    assert.deepEqual(tooShort.journeys, []);
    assert.deepEqual(journeyReport([session('a', ['/signup', '/', '/signup', '/done'])], { endsAt: '/signup', steps: '4' }).journeys[0].path, ['/signup', '/', '/signup']);
  });
  it('uses the same shaped paths for drawer membership, replay filters and pagination', () => {
    const query = { steps: '2', path: JSON.stringify(['/', '/docs/a']) };
    assert.deepEqual(journeyReport(sessions, query, 'sessions').map(row => row.session_id), ['a', 'b']);
    assert.deepEqual(journeyReport(sessions, { ...query, replays_only: 'true' }, 'sessions').map(row => row.session_id), ['b']);
    assert.deepEqual(journeyReport(sessions, { ...query, offset: '1', limit: '1' }, 'sessions').map(row => row.session_id), ['b']);
  });
  it('derives full path length, actual exits and goal reach from the same multi-page session population', () => {
    const summary = journeyReport(sessions, { goalId: '1' }, 'summary');
    assert.deepEqual(summary, { sessions: 3, avgPathLength: 10 / 3, conversions: 1, topExit: { page: '/done', sessions: 1 } });
    const report = journeyReport(sessions, { steps: '2', goalId: '1' });
    assert.equal(report.journeys[0].count, 2);
    assert.equal(report.journeys[0].conversions, 1);
    const context = journeyReport(sessions, {}, 'context');
    assert.equal(context.sessions, 4);
    assert.deepEqual(context.topEntry, { value: '/', count: 4, percentage: 100 });
  });
  it('applies shared audience filters to whole sessions and rejects malformed controls', () => {
    assert.equal(journeyReport(sessions, { filters: JSON.stringify([{ parameter: 'country', type: 'equals', value: ['CN'] }]) }).totalSessions, 0);
    for (const query of [{ steps: '11' }, { steps: '1' }, { stepFilters: '[]' }, { groupBy: 'folder' }, { limit: '501' }]) {
      assert.throws(() => journeyReport(sessions, query), error => error.status === 400);
    }
  });
  it('keeps repeated views in session details, with native event counts and pagination', () => {
    const record = session('detail', ['/', '/', '/docs']);
    record.events.push({ type: 'custom_event', event_name: 'signup', pathname: '/docs', timestamp: '2026-10-25 10:00:05' });
    record.events.push({ type: 'error', pathname: '/docs', timestamp: '2026-10-25 10:00:06' });
    const detail = journeySessionDetails(record, { limit: '2', offset: '1' });
    assert.deepEqual(detail.events.map(event => event.pathname), ['/', '/docs']);
    assert.deepEqual(detail.pagination, { total: 5, limit: 2, offset: 1, hasMore: true });
    assert.equal(detail.session.pageviews, 3);
    assert.equal(detail.session.events, 1);
    assert.equal(detail.session.errors, 1);
    assert.equal(detail.session.session_duration, 6);
  });
  it('keeps deterministic demo sessions scoped to the chosen property and period, without using GA4 clients', () => {
    const property = { id: '311000101', domain: 'northwind-store.example' };
    const range = { startDate: '2026-10-25', endDate: '2026-10-25' };
    const records = demoJourneySessions(property, range, 'UTC');
    assert.deepEqual(records, demoJourneySessions(property, range, 'UTC'));
    assert(records.length > 25);
    assert(records.every(row => row.hostname === property.domain));
    assert(journeyReport(records, { steps: '10' }).journeys.some(row => row.path.length > 4));
    assert.deepEqual(demoJourneySession(property, records[0].session_id), records[0]);
    assert.equal(demoJourneySession({ ...property, id: '311000102' }, records[0].session_id), null);
    const rolling = demoJourneySessions(property, { startDateTime: '2026-10-25T08:00:00Z', endDateTime: '2026-10-25T09:00:00Z' });
    assert.deepEqual(demoJourneySession(property, rolling[0].session_id), rolling[0]);
    assert(rolling.every(row => row.events.every(event => event.timestamp >= '2026-10-25 08:00:00' && event.timestamp < '2026-10-25 09:00:00')));
    assert.notDeepEqual(records.map(row => row.session_id), demoJourneySessions({ ...property, id: '311000102' }, range, 'UTC').map(row => row.session_id));
  });
});
