const { expect } = require('chai');
const { createPagesReportHandler, createSectionReportHandler, parsePeriod, resolvedPeriod } = require('../controllers/pagesReport');
const model = require('../public/js/pages-model');

const row = (dims, metrics) => ({ dimensionValues: dims.map(value => ({ value: String(value) })), metricValues: metrics.map(value => ({ value: String(value) })) });
const currentRows = [row(['/docs/a'], [20, 5, 4, 100, .2]), row(['/docs/b'], [10, 7, 6, 80, .4])];
const previousRows = [row(['/docs/a'], [20, 5, 4, 100, .2]), row(['/docs/b'], [5, 2, 2, 20, .5]), row(['/docs/removed'], [5, 2, 1, 10, .5])];
const requests = [];
function report(request) {
  requests.push(request);
  const dimensions = request.dimensions.map(d => d.name);
  const previous = request.dateRanges[0].endDate === '30daysAgo';
  let rows;
  if (!dimensions.length) rows = [row([], [30, 10, 8, 180, .3])];
  else if (dimensions.includes('pageTitle')) rows = [row(['/docs/a', 'Docs A'], [15]), row(['/docs/a', 'Old title'], [5])];
  else if (dimensions.includes('nthDay')) rows = [row(['/docs/a', '0002'], [4])];
  else if (dimensions[0] === 'landingPage' && request.metrics.length === 1) rows = [row(['/docs/a'], [3])];
  else rows = previous ? previousRows : currentRows;
  return [{ rows, rowCount: rows.length, metadata: { timeZone: 'Asia/Shanghai' } }];
}
function handler(overrides = {}) {
  return createPagesReportHandler({ read: async () => null, write: async () => true,
    loadProperties: async () => ({ properties: [{ id: '123' }] }),
    getClient: () => ({ runReport: async request => report(request) }), ...overrides });
}
async function invoke(handle, query = {}, propertyId = '123') {
  const result = { status: 200 };
  const res = { status(code) { result.status = code; return this; }, json(body) { result.body = body; return this; } };
  await handle({ params: { propertyId }, query }, res);
  return result;
}

describe('Pages report', () => {
  beforeEach(() => { requests.length = 0; });
  it('uses exactly 30 inclusive days and the preceding, non-overlapping 30 days', () => {
    const period = parsePeriod({ range: '30d' });
    expect(period.current).to.deep.equal({ startDate: '29daysAgo', endDate: 'today' });
    expect(period.previous).to.deep.equal({ startDate: '59daysAgo', endDate: '30daysAgo' });
    expect(resolvedPeriod(period, 'Asia/Shanghai', new Date('2026-10-21T20:00:00Z')).current)
      .to.deep.equal({ startDate: '2026-09-23', endDate: '2026-10-22' });
  });
  it('validates custom dates, leap days and the 90-day bound', () => {
    expect(parsePeriod({ start: '2024-02-29', end: '2024-03-01' }).previous)
      .to.deep.equal({ startDate: '2024-02-27', endDate: '2024-02-28' });
    for (const query of [{ start: '2026-02-29', end: '2026-03-01' }, { start: '2026-01-01', end: '2026-05-01' }, { start: '2026-03-02', end: '2026-03-01' }, { range: [] }]) {
      expect(() => parsePeriod(query)).to.throw();
    }
  });
  it('keeps GA4 period users and sessions; title changes do not split page metrics', async () => {
    const { status, body } = await invoke(handler());
    expect(status).to.equal(200);
    expect(body.summary).to.include({ users: 8, sessions: 10, views: 30, viewsPerSession: 3, avgEngagement: 6 });
    expect(body.rows[0]).to.include({ title: 'Docs A', users: 4, sessions: 5, entries: 3 });
    expect(body.rows[0].series).to.have.length(30);
    expect(body.rows[0].series.slice(0, 4)).to.deep.equal([0, 0, 4, 0]);
    expect(body.rows[1].entries).to.equal(0);
    expect(requests).to.have.length(7);
    expect(requests.every(r => r.limit <= 10000)).to.equal(true);
  });
  it('includes pages that lost all traffic in directory comparisons and never sums overlapping users', async () => {
    const { body } = await invoke(handler());
    const [group] = model.group(body.rows, 'section', 'all', body.previousRows);
    expect(group).to.include({ views: 30, previousViews: 30, sessions: null, users: null, bounce: null, avgEngagement: 6 });
    expect(model.change(group.views, group.previousViews)).to.equal(0);
    const [entry] = model.group(body.rows, 'section', 'entry', body.previousRows);
    expect(entry.sessions).to.equal(12);
    expect(entry.users).to.equal(null);
    expect(entry.bounce).to.be.closeTo((.2 * 5 + .4 * 7) / 12, .00001);
  });
  it('uses landingPage scope for entry reports and skips the redundant entry query', async () => {
    const { body } = await invoke(handler(), { view: 'entry' });
    expect(body.rows[0].entries).to.equal(body.rows[0].sessions);
    expect(requests.filter(r => r.dimensions.length === 1).every(r => r.dimensions[0].name === 'landingPage')).to.equal(true);
    expect(requests).to.have.length(6);
  });
  it('serves cache and coalesces concurrent visitors into one bounded set of GA4 requests', async () => {
    const handle = handler();
    await Promise.all([invoke(handle), invoke(handle)]);
    expect(requests).to.have.length(7);
    requests.length = 0;
    const cached = await invoke(handler({ read: async () => ({ ok: true, fetchedAt: 42 }) }));
    expect(cached.body).to.include({ cached: true, fetchedAt: 42 });
    expect(requests).to.have.length(0);
  });
  it('preserves current data when comparison fails and exposes missing values rather than zeroes', async () => {
    const { body } = await invoke(handler({ getClient: () => ({ runReport: async request => {
      if (request.dateRanges[0].endDate === '30daysAgo') throw new Error('Quota unavailable');
      return report(request);
    } }) }));
    expect(body.ok).to.equal(true);
    expect(body.previousSummary).to.equal(null);
    expect(body.rows[0].previousViews).to.equal(null);
    expect(body.warnings).to.have.length(2);
  });
  it('returns unavailable on GA4 failure and rejects unsupported scopes and properties before querying', async () => {
    const failed = await invoke(handler({ getClient: () => ({ runReport: async () => { throw new Error('Offline'); } }) }));
    expect(failed.status).to.equal(502);
    expect(failed.body).to.deep.equal({ ok: false, error: 'Offline' });
    expect((await invoke(handler(), { view: 'exit' })).status).to.equal(400);
    expect((await invoke(handler(), {}, '../123')).status).to.equal(400);
    expect((await invoke(handler(), {}, '456')).status).to.equal(404);
    expect(requests).to.have.length(0);
  });
  it('escapes CSV quotes, preserves numbers and neutralizes spreadsheet formulas', () => {
    expect(model.csv([['=HYPERLINK("x")', '/docs/a', -2, 'a,b']]))
      .to.equal('"\'=HYPERLINK(""x"")","/docs/a","-2","a,b"');
  });
  it('uses native directory TOTALs instead of summing daily users, and separates current and prior trends', async () => {
    const handle = createSectionReportHandler({ read: async () => null, write: async () => true,
      loadProperties: async () => ({ properties: [{ id: '123' }] }),
      getClient: () => ({ runReport: async request => {
        expect(request.dateRanges.map(r => r.name)).to.deep.equal(['current', 'previous']);
        expect(request.dimensionFilter.filter.stringFilter).to.include({ value: '/docs/', caseSensitive: true });
        return [{ dimensionHeaders: [{ name: 'date' }, { name: 'dateRange' }], metadata: { timeZone: 'Asia/Shanghai' },
          totals: [row(['RESERVED_TOTAL', 'current'], [30, 10, 8, 180, .3]), row(['RESERVED_TOTAL', 'previous'], [20, 9, 7, 100, .2])],
          rows: [row(['20261022', 'current'], [30, 10, 8, 180, .3]), row(['20261021', 'previous'], [20, 9, 7, 100, .2])] }];
      } }) });
    const result = { status: 200 };
    await handle({ params: { propertyId: '123' }, query: { start: '2026-10-22', end: '2026-10-22', section: '/docs/' } },
      { status(code) { result.status = code; return this; }, json(body) { result.body = body; } });
    expect(result.body.summary).to.include({ users: 8, sessions: 10 });
    expect(result.body.previousSummary).to.include({ users: 7, views: 20 });
    expect(result.body.series).to.deep.equal([30]);
  });
  it('rejects multi-level section filters before making a GA4 call', async () => {
    const handle = createSectionReportHandler({ getClient: () => { throw new Error('must not run'); } });
    const result = {};
    await handle({ params: { propertyId: '123' }, query: { section: '/docs/nested/' } },
      { status(code) { result.status = code; return this; }, json(body) { result.body = body; } });
    expect(result.status).to.equal(400);
  });
});
