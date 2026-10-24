const { expect } = require('chai');
const { windowFor, createRybbitHandler } = require('../controllers/rybbit');
const { windowFilter, previousWindow, decimalPattern } = require('../lib/reportWindow');
const { DateTime } = require('luxon');
const now = new Date('2026-10-23T04:37:45Z');
const rolling = { past_minutes_start: '1440', past_minutes_end: '0' };

describe('Rybbit rolling time windows', () => {
  it('resolves Last 24 Hours to a rolling minute window in the GA4 property timezone', () => {
    expect(windowFor(rolling, 'Asia/Shanghai', now)).to.deep.equal({
      startDate: '2026-10-22', endDate: '2026-10-23',
      startDateTime: '2026-10-22T04:37:00.000Z', endDateTime: '2026-10-23T04:37:00.000Z', timeZone: 'Asia/Shanghai',
    });
  });

  it('keeps the prior 24 hours distinct from the selected 24 hours', () => {
    const previous = windowFor({ past_minutes_start: 2880, past_minutes_end: 1440 }, 'Asia/Shanghai', now);
    expect(previous.startDateTime).to.equal('2026-10-21T04:37:00.000Z');
    expect(previous.endDateTime).to.equal('2026-10-22T04:37:00.000Z');
    expect(previousWindow(windowFor(rolling, 'Asia/Shanghai', now))).to.deep.equal(previous);
  });

  it('filters exactly the selected property-local minutes with an exclusive end', () => {
    const range = windowFor(rolling, 'Asia/Shanghai', now);
    const filter = windowFilter(range).filter;
    expect(filter.fieldName).to.equal('dateHourMinute');
    expect(filter.stringFilter.matchType).to.equal('FULL_REGEXP');
    const regex = new RegExp(`^(?:${filter.stringFilter.value})$`);
    const start = DateTime.fromISO(range.startDateTime), end = DateTime.fromISO(range.endDateTime);
    for (let minute = start.minus({ minutes: 5 }); minute < end.plus({ minutes: 5 }); minute = minute.plus({ minutes: 1 })) {
      expect(regex.test(minute.setZone('Asia/Shanghai').toFormat('yyyyMMddHHmm'))).to.equal(minute >= start && minute < end);
    }
    expect(filter.stringFilter.value.length).to.be.lessThan(256);
    expect(windowFilter({ startDate: '2026-10-01', endDate: '2026-10-23' })).to.equal(null);
  });

  it('compresses decimal intervals correctly across days, months and years', () => {
    for (const [a, b] of [[202610221237, 202610231236], [202612312000, 202701011959], [1000, 9999], [15, 15], [10998, 11001]]) {
      const regex = new RegExp(`^(?:${decimalPattern(String(a), String(b))})$`);
      for (const value of [a - 1, a, a + 1, Math.floor((a + b) / 2), b - 1, b, b + 1]) expect(regex.test(String(value)), `${a}–${b}: ${value}`).to.equal(value >= a && value <= b);
    }
  });

  it('accepts native UTC datetime ranges and keeps 24 elapsed hours over daylight saving', () => {
    const range = windowFor({ start_datetime: '2026-10-21 04:37:00', end_datetime: '2026-10-22 04:37:00' }, 'America/Los_Angeles', now);
    expect(range.startDate).to.equal('2026-10-20');
    expect(range.endDate).to.equal('2026-10-21');
    const dst = windowFor(rolling, 'America/New_York', new Date('2026-11-01T17:00:00Z'));
    expect(Date.parse(dst.endDateTime) - Date.parse(dst.startDateTime)).to.equal(86400000);
    expect(DateTime.fromISO(dst.startDateTime).setZone(dst.timeZone).hour).to.equal(13);
    expect(DateTime.fromISO(dst.endDateTime).setZone(dst.timeZone).hour).to.equal(12);
  });

  it('rejects malformed, reversed, future and ambiguous minute windows', () => {
    for (const query of [{ past_minutes_start: -1 }, { past_minutes_start: '1.5' }, { past_minutes_start: 0 }, { past_minutes_start: 30, past_minutes_end: 30 }, { past_minutes_end: 0 }, { start_datetime: '2026-10-22T00:00:00Z' }, { start_datetime: '2026-10-22T00:00:30Z', end_datetime: '2026-10-22T01:00:00Z' }, { start_datetime: '2027-01-01T00:00:00Z', end_datetime: '2027-01-02T00:00:00Z' }]) expect(() => windowFor(query, 'UTC', now)).to.throw();
    expect(() => windowFor(rolling, 'America/New_York', new Date('2026-11-01T06:30:00Z'))).to.throw('repeated daylight-saving');
  });
});

const row = (dims, values) => ({ dimensionValues: dims.map(value => ({ value })), metricValues: values.map(value => ({ value: String(value) })) });
async function invoke(handler, path, query, body) {
  const output = { status: 200 };
  await handler({ path, query, body, method: body ? 'POST' : 'GET' }, { status(value) { output.status = value; return this; }, json(value) { output.body = value; return this; } });
  return output;
}
function setup(overrides = {}) {
  const calls = [], cache = new Map();
  const handler = createRybbitHandler({
    properties: async () => ({ properties: [{ id: '123', site: 'Test', timeZone: 'Asia/Shanghai' }] }),
    now: () => now, read: async (_ns, key) => cache.get(key), write: async (_ns, key, value) => cache.set(key, value),
    snapshot: async () => ({}),
    run: async request => { calls.push(request); return { ok: true, rows: [row(request.dimensions.map(d => d.name === 'dateHour' ? '2026102312' : '202610231236'), [20, 50, 7])], rowCount: 1 }; },
    ...overrides,
  });
  return { handler, calls };
}

describe('rolling-window GA4 requests', () => {
  it('keeps filters on dimensionless totals, deduplicates cache hits and separates adjacent periods', async () => {
    const { handler, calls } = setup();
    const query = { ...rolling, filters: JSON.stringify([{ parameter: 'country', type: 'equals', value: ['US'] }]) };
    const current = await invoke(handler, '/sites/123/overview', query);
    await invoke(handler, '/sites/123/overview', query);
    await invoke(handler, '/sites/123/overview', { ...query, past_minutes_start: 2880, past_minutes_end: 1440 });
    expect(current.status).to.equal(200);
    expect(current.body.data).to.include({ sessions: 20, users: 7 });
    expect(calls).to.have.length(2);
    expect(calls[0].dimensions).to.deep.equal([]);
    expect(calls[0].dateRange).to.deep.equal({ startDate: '2026-10-22', endDate: '2026-10-23' });
    expect(calls[0].dimensionFilter.andGroup.expressions.map(f => f.filter.fieldName)).to.deep.equal(['countryId', 'dateHourMinute']);
    expect(calls[1].dimensionFilter).not.to.deep.equal(calls[0].dimensionFilter);
  });

  it('converts hourly/minute chart points from the property clock to UTC', async () => {
    const { handler, calls } = setup();
    const hourly = await invoke(handler, '/sites/123/overview/time-series', { ...rolling, bucket: 'hour' });
    const minute = await invoke(handler, '/sites/123/overview/time-series', { ...rolling, bucket: 'minute' });
    expect(hourly.body.data[0].time).to.equal('2026-10-23 04:00:00');
    expect(minute.body.data[0].time).to.equal('2026-10-23 04:36:00');
    expect(calls[1].dimensions).to.deep.equal([{ name: 'dateHourMinute' }]);
  });

  it('loads the actual GA4 property timezone instead of assuming UTC', async () => {
    let adminCalls = 0;
    const { handler, calls } = setup({ properties: async () => ({ properties: [{ id: '123' }] }), admin: () => ({ getProperty: async () => { adminCalls++; return [{ timeZone: 'Asia/Shanghai' }]; } }) });
    await invoke(handler, '/sites/123/overview', rolling);
    await invoke(handler, '/sites/123/overview', rolling);
    expect(adminCalls).to.equal(1);
    expect(new RegExp(`^(?:${calls[0].dimensionFilter.filter.stringFilter.value})$`).test('202610231236')).to.equal(true);
  });

  it('builds only the selected hours in Home heatmaps and leaves daily AdSense unknown', async () => {
    const { handler, calls } = setup();
    const result = await invoke(handler, '/organizations/ga4/site-status', { ...rolling, time_zone: 'Asia/Shanghai', bucket: 'hour' }, { siteIds: [123], comparison: { past_minutes_start: 2880, past_minutes_end: 1440 } });
    expect(result.status).to.equal(200);
    expect(result.body.data.days).to.have.length(25);
    expect(result.body.data.days[0]).to.equal('2026-10-22 04:00:00');
    expect(result.body.data.days.at(-1)).to.equal('2026-10-23 04:00:00');
    expect(result.body.data.sites[0]).to.include({ last: 20, prev: 20, earnLast: null });
    expect(calls).to.have.length(3);
  });

  it('does not silently turn a rolling retention window into whole days', async () => {
    let cohortCalls = 0;
    const { handler } = setup({ retention: () => { cohortCalls++; } });
    const result = await invoke(handler, '/sites/123/retention', rolling);
    expect(result.status).to.equal(422);
    expect(result.body.error).to.include('whole calendar days');
    expect(cohortCalls).to.equal(0);
  });

  it('accepts Express next as its third argument without mistaking it for the clock', async () => {
    const { handler } = setup();
    let response;
    await handler({ path: '/sites/123/overview', query: rolling, method: 'GET' }, { json(value) { response = value; } }, () => {});
    expect(response.data.sessions).to.equal(20);
  });
});
