const { expect } = require('chai');
const { createEventsHandlers, parseQuery, datesFor } = require('../controllers/eventsController');

const row = (dims, metrics) => ({ dimensionValues: dims.map(value => ({ value })), metricValues: metrics.map(value => ({ value: String(value) })) });
const clock = () => new Date('2026-10-22T02:00:00Z');
const request = (query = {}) => ({ params: { propertyId: '123' }, query: { range: '30d', ...query } });
const properties = [{ id: '123', site: 'Example' }];
const make = (overrides = {}) => createEventsHandlers({
  loadProperties: async () => ({ properties }), read: async () => null, write: async () => true, now: clock, ...overrides,
});
async function invoke(handler, req = request()) {
  const result = { status: 200 };
  await handler(req, { status(n) { result.status = n; return this; }, send(body) { result.body = body; return this; } });
  return result;
}

function report(query) {
  const previous = query.dateRange.endDate === '30daysAgo';
  let rows;
  if (!query.dimensions.length) rows = [row([], previous ? [60, 3, 8, 2, 7.5] : [100, 5, 10, 4, 10])];
  else if (query.dimensions[0].name === 'dateHour') rows = [row(['2026102114', 'click', '/pricing', 'mobile'], [4, 2])];
  else if (query.dimensions[0].name === 'date') rows = [row(['20261020', 'click'], [12]), row(['20261022', 'click'], [8]), row(['20261022', 'sign_up'], [10]), row(['20261021', 'page_view'], [70])];
  else rows = previous ? [row(['click'], [10, 3]), row(['page_view'], [50, 3])] : [row(['click'], [20, 4]), row(['page_view'], [70, 5]), row(['sign_up'], [10, 2])];
  return { ok: true, rows, rowCount: rows.length, metadata: { timeZone: 'America/Los_Angeles' } };
}

describe('GA4 events workspace', () => {
  it('uses exact inclusive periods and the property time zone at a UTC day boundary', () => {
    const q = parseQuery(request());
    expect(q.current).to.deep.equal({ startDate: '29daysAgo', endDate: 'today' });
    expect(q.previous).to.deep.equal({ startDate: '59daysAgo', endDate: '30daysAgo' });
    const dates = datesFor(q, 'America/Los_Angeles', clock());
    expect(dates).to.have.length(30);
    expect(dates[0]).to.equal('2026-09-22');
    expect(dates.at(-1)).to.equal('2026-10-21');
    const shifted = parseQuery(request({ range: '7d', offset: '7' }));
    expect(shifted.current).to.deep.equal({ startDate: '13daysAgo', endDate: '7daysAgo' });
    expect(shifted.previous).to.deep.equal({ startDate: '20daysAgo', endDate: '14daysAgo' });
    expect(parseQuery(request({ range: 'today' })).current).to.deep.equal({ startDate: 'today', endDate: 'today' });
  });

  it('keeps true period users distinct and fills missing dates with zeros', async () => {
    const calls = [];
    const { body, status } = await invoke(make({ run: async q => { calls.push(q); const r = report(q); r.metadata.timeZone = 'Asia/Shanghai'; return r; } }).overview);
    expect(status).to.equal(200);
    expect(calls).to.have.length(5);
    // Event-level user counts overlap: 4 + 5 + 2 must never become the period total.
    expect(body.totals).to.deep.equal({ events: 100, users: 5, sessions: 10, keyEvents: 4, perSession: 10 });
    const click = body.events.find(e => e.name === 'click');
    expect(click).to.include({ events: 20, users: 4, previous: 10, latestDay: '2026-10-22', type: 'outbound' });
    expect(click.series).to.have.length(30);
    expect(click.series.slice(-3)).to.deep.equal([12, 0, 8]);
    expect(body.newNames).to.equal(1);
    expect(body.types.find(t => t.id === 'outbound')).to.include({ events: 20, previous: 10, names: 1 });
    expect(body.types.reduce((sum, t) => sum + t.events, 0)).to.equal(100);
    expect(body.fetchedAt).to.equal(clock().getTime());
  });

  it('validates inputs and property access before making any GA4 calls', async () => {
    let calls = 0;
    const handle = make({ run: async () => { calls++; throw new Error('must not query'); } }).overview;
    const bad = [request({ range: '__proto__' }), request({ range: ['30d'] }), request({ offset: '-1' }), request({ offset: '366' }), request({ event: ['click'] }), request({ event: '' }), { params: { propertyId: '../123' }, query: {} }];
    for (const req of bad) expect((await invoke(handle, req)).status).to.equal(400);
    expect((await invoke(handle, { params: { propertyId: '999' }, query: {} })).status).to.equal(404);
    expect(calls).to.equal(0);
  });

  it('shares concurrent reports, limits GA4 concurrency and caches results', async () => {
    const cache = new Map(); let active = 0, peak = 0, calls = 0;
    const handle = make({
      read: async (ns, key) => cache.get(key), write: async (ns, key, data) => cache.set(key, data),
      run: async q => { active++; peak = Math.max(peak, active); calls++; await new Promise(resolve => setImmediate(resolve)); active--; return report(q); },
    }).overview;
    const [first, second] = await Promise.all([invoke(handle), invoke(handle)]);
    expect(first.body).to.deep.equal(second.body);
    expect(calls).to.equal(5); expect(peak).to.equal(3);
    expect((await invoke(handle)).body.cached).to.equal(true);
    expect(calls).to.equal(5);
    await invoke(handle, request({ offset: '30' }));
    expect(calls).to.equal(10);
  });

  it('returns failures without caching fake zero reports and allows retry', async () => {
    let failed = true, writes = 0;
    const handle = make({ run: async q => failed ? { ok: false, error: 'GA4 quota exhausted' } : report(q), write: async () => { writes++; } }).overview;
    const result = await invoke(handle);
    expect(result.status).to.equal(502); expect(result.body.error).to.equal('GA4 quota exhausted'); expect(writes).to.equal(0);
    failed = false;
    expect((await invoke(handle)).status).to.equal(200); expect(writes).to.equal(1);
  });

  it('handles empty ranges and preserves threshold, sampling and truncation signals', async () => {
    const empty = await invoke(make({ run: async () => ({ ok: true, rows: [], rowCount: 0 }) }).overview);
    expect(empty.body.events).to.deep.equal([]); expect(empty.body.totals.users).to.equal(0); expect(empty.body.eventNames).to.equal(0);
    const limited = await invoke(make({ run: async q => ({ ...report(q), rowCount: 100001, metadata: { timeZone: 'UTC', subjectToThresholding: true, samplingMetadatas: [{}] } }) }).overview);
    expect(limited.body).to.include({ limited: true, thresholded: true, sampled: true, eventNames: 100001 });
  });

  it('returns bounded hourly aggregates and exact case-sensitive event drilldowns', async () => {
    let query;
    const result = await invoke(make({ run: async q => { query = q; return { ...report(q), rowCount: 450 }; } }).activity, request({ event: 'click' }));
    expect(query.limit).to.equal(100);
    expect(query.dimensionFilter.filter.stringFilter).to.deep.equal({ matchType: 'EXACT', value: 'click', caseSensitive: true });
    expect(result.body.rows[0]).to.deep.equal({ hour: '2026102114', name: 'click', type: 'outbound', page: '/pricing', device: 'mobile', events: 4, users: 2 });
    expect(result.body.rowCount).to.equal(450);
    expect(result.body.rows[0]).not.to.have.property('userId');
  });

  it('isolates event cache keys even when event names contain filename punctuation', async () => {
    const keys = [];
    const handler = make({ run: async q => report(q), write: async (ns, key) => keys.push(key) }).activity;
    await invoke(handler, request({ event: 'a/b' })); await invoke(handler, request({ event: 'a_b' }));
    expect(keys[0]).not.to.equal(keys[1]);
  });

  it('respects the shared refresh cooldown', async () => {
    let calls = 0;
    const cached = { ok: true, fetchedAt: 123 };
    const handler = make({ run: async q => { calls++; return report(q); }, read: async () => cached, bypass: () => false }).overview;
    expect((await invoke(handler, request({ fresh: '1' }))).body).to.include({ cached: true, fetchedAt: 123 });
    expect(calls).to.equal(0);
  });
});
