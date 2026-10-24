const { expect } = require('chai');
const { todayInZone, planReport, buildCohorts, summarize, createRetentionHandler } = require('../controllers/retention');

const row = (name, offset, users, size) => ({
  dimensionValues: [{ value: name }, { value: String(offset).padStart(4, '0') }],
  metricValues: [{ value: String(users) }, { value: String(size) }],
});
const properties = [{ id: '123', site: 'Example', timeZone: 'America/Los_Angeles' }];
const fixedNow = () => new Date('2026-10-22T01:30:00Z');
function handler(overrides = {}) {
  return createRetentionHandler({
    loadProperties: async () => ({ properties }), read: async () => null, write: async () => true,
    now: fixedNow,
    dataClient: () => ({ runReport: async () => [{ rows: [] }] }),
    ...overrides,
  });
}
async function invoke(handle, query = {}, propertyId = '123') {
  const result = { status: 200 };
  await handle({ query, params: { propertyId } }, {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return this; },
  });
  return result;
}

describe('GA4 retention cohorts', () => {
  it('uses the property calendar across time zones and daylight saving changes', () => {
    expect(todayInZone(fixedNow(), 'America/Los_Angeles')).to.equal('2026-10-21');
    expect(todayInZone(fixedNow(), 'Asia/Shanghai')).to.equal('2026-10-22');
    const plan = planReport({ bucket: 'day', range: '7d' }, '2026-11-03');
    expect(plan.cohorts.map(c => c.startDate)).to.deep.equal(['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03']);
  });

  it('uses exactly 30 inclusive dates, disjoint comparison dates and Sunday weeks', () => {
    const plan = planReport({}, '2026-10-22');
    expect(plan).to.include({ startDate: '2026-09-23', endDate: '2026-10-22', previousStartDate: '2026-08-24', previousEndDate: '2026-09-22' });
    expect(plan.cohorts[0]).to.include({ periodStart: '2026-09-20', startDate: '2026-09-23', endDate: '2026-09-26' });
    expect(plan.cohorts.at(-1)).to.include({ periodStart: '2026-10-18', endDate: '2026-10-22' });
    expect(plan.cohorts).to.have.length(5);
  });

  it('distinguishes zero returns, in-progress periods and future periods', () => {
    const plan = planReport({ bucket: 'day', range: '7d' }, '2026-10-22');
    const first = plan.cohorts[0], last = plan.cohorts.at(-1);
    const cohorts = buildCohorts(plan.cohorts, [row(first.name, 0, 100, 100), row(first.name, 2, 15, 100), row(first.name, 6, 2, 100), row(last.name, 0, 10, 10)], plan, plan.endDate);
    expect(cohorts[0].cells[0]).to.include({ users: 0, rate: 0, status: 'complete' });
    expect(cohorts[0].cells[1]).to.include({ users: 15, rate: .15, status: 'complete' });
    expect(cohorts[0].cells[5]).to.include({ users: 2, rate: .02, status: 'partial' });
    expect(cohorts.at(-1).cells[0]).to.include({ users: null, rate: null, status: 'future' });
    expect(cohorts[1].size).to.equal(0);
    expect(cohorts[1].cells[0].rate).to.equal(null);
  });

  it('weights averages by cohort size, excludes partial cells and allows nonconsecutive returns', () => {
    const plan = planReport({ bucket: 'day', range: '7d' }, '2026-10-22');
    const [a, b] = plan.cohorts;
    const cohorts = buildCohorts([a, b], [row(a.name, 0, 10, 10), row(a.name, 1, 5, 10), row(a.name, 3, 3, 10), row(b.name, 0, 90, 90), row(b.name, 1, 9, 90)], plan, plan.endDate);
    const summary = summarize(cohorts, plan.periods);
    expect(summary.cells[0]).to.include({ users: 14, size: 100, rate: .14 });
    expect(summary.totalUsers).to.equal(100); // cohortTotalUsers repeats; never sum it across offsets.
    expect(summary.averageSize).to.equal(50);
    expect(summary.bestCohort).to.equal(a.name);
    expect(cohorts[0].cells[2].rate).to.equal(.3);
    expect(summary.cells[5].rate).to.equal(null);
  });

  it('never leaks subsequent activity into a historical partial return week', () => {
    const plan = planReport({ end: '2026-10-15' }, '2026-10-22');
    const c = plan.cohorts.find(c => c.periodStart === '2026-10-04');
    const [cohort] = buildCohorts([c], [row(c.name, 0, 10, 10), row(c.name, 1, 8, 10)], plan, plan.endDate);
    expect(cohort.cells[0]).to.include({ startDate: '2026-10-11', endDate: '2026-10-17', users: null, status: 'future' });
  });

  it('rejects invalid input before loading properties or making any GA4 requests', async () => {
    const handle = handler({ loadProperties: async () => { throw new Error('must not load'); } });
    for (const query of [{ bucket: 'month' }, { bucket: ['day'] }, { range: 'toString' }, { range: '__proto__' }, { range: '365d' }, { end: '2026-02-30' }, { end: '2099-01-01' }, { end: ['2026-01-01'] }]) {
      expect((await invoke(handle, query)).status).to.equal(400);
    }
    expect((await invoke(handle, {}, '../bad')).status).to.equal(400);
  });

  it('validates property access before querying report data', async () => {
    expect((await invoke(handler(), {}, '999')).status).to.equal(404);
  });

  it('creates native cohort requests without dateRanges, bounded sequentially to 12 cohorts', async () => {
    const calls = [];
    let active = 0, peak = 0;
    const result = await invoke(handler({ dataClient: () => ({ runReport: async request => {
      calls.push(request); active++; peak = Math.max(peak, active);
      await new Promise(resolve => setImmediate(resolve)); active--;
      return [{ rows: request.cohortSpec.cohorts.map(c => row(c.name, 0, 100, 100)) }];
    } }) }), { bucket: 'day', range: '30d' });
    expect(result.status).to.equal(200);
    expect(result.body).to.include({ startDate: '2026-09-22', endDate: '2026-10-21', timeZone: 'America/Los_Angeles' });
    expect(result.body.summary.totalUsers).to.equal(3000);
    expect(calls).to.have.length(5);
    expect(peak).to.equal(1);
    expect(calls.every(c => c.cohortSpec.cohorts.length <= 12 && !('dateRanges' in c))).to.equal(true);
    expect(calls[0].dimensions).to.deep.equal([{ name: 'cohort' }, { name: 'cohortNthDay' }]);
    expect(calls[0].metrics).to.deep.equal([{ name: 'cohortActiveUsers' }, { name: 'cohortTotalUsers' }]);
    expect(calls[0].cohortSpec.cohortsRange).to.deep.equal({ granularity: 'DAILY', startOffset: 0, endOffset: 29 });
    expect(calls[0].returnPropertyQuota).to.equal(true);
  });

  it('reuses cached results and deduplicates concurrent viewers', async () => {
    const cache = new Map(); let calls = 0;
    const handle = handler({ read: async (ns, key) => cache.get(`${ns}:${key}`), write: async (ns, key, value) => cache.set(`${ns}:${key}`, value), dataClient: () => ({ runReport: async () => { calls++; await new Promise(resolve => setImmediate(resolve)); return [{ rows: [] }]; } }) });
    const results = await Promise.all([invoke(handle), invoke(handle)]);
    expect(results.every(r => r.body.ok)).to.equal(true);
    expect(calls).to.equal(1);
    expect((await invoke(handle)).body.cached).to.equal(true);
    expect(calls).to.equal(1);
  });

  it('caches missing property time zone metadata', async () => {
    const cache = new Map(); let metaCalls = 0;
    const handle = handler({
      loadProperties: async () => ({ properties: [{ id: '123', site: 'Example' }] }),
      read: async (ns, key) => cache.get(`${ns}:${key}`), write: async (ns, key, value) => cache.set(`${ns}:${key}`, value),
      adminClient: () => ({ getProperty: async () => { metaCalls++; return [{ timeZone: 'Asia/Shanghai' }]; } }),
    });
    expect((await invoke(handle)).body.timeZone).to.equal('Asia/Shanghai');
    await invoke(handle);
    expect(metaCalls).to.equal(1);
  });

  it('reports quota and permission failures, and never caches a failed or truncated report', async () => {
    let writes = 0;
    for (const code of [7, 8, 14]) {
      const result = await invoke(handler({ write: async () => { writes++; }, dataClient: () => ({ runReport: async () => { throw Object.assign(new Error('GA4 unavailable'), { code }); } }) }));
      expect(result.status).to.equal(code === 7 ? 403 : code === 8 ? 429 : 502);
      expect(result.body.ok).to.equal(false);
    }
    const truncated = await invoke(handler({ write: async () => { writes++; }, dataClient: () => ({ runReport: async () => [{ rows: [], rowCount: 1 }] }) }));
    expect(truncated.status).to.equal(502);
    expect(writes).to.equal(0);
  });

  it('propagates GA4 threshold and sampling disclosures', async () => {
    const result = await invoke(handler({ dataClient: () => ({ runReport: async () => [{ rows: [], metadata: { subjectToThresholding: true, samplingMetadatas: [{}] } }] }) }));
    expect(result.body).to.include({ thresholded: true, sampled: true });
  });
});
