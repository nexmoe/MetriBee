const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { createBigQuery, sourceFor, settings } = require('../lib/bigquery');
const { createBigQueryJourneys, compile, period, glob } = require('../controllers/bigqueryJourneys');
const { createRybbitHandler } = require('../controllers/rybbit');
const { storage } = require('../lib/requestContext');
const env = { GA4_BIGQUERY_SOURCES: '{"123":{"projectId":"test-project","location":"US","billingProjectId":"billing-project"}}', BIGQUERY_MAX_BYTES_BILLED: '100', BIGQUERY_DAILY_BYTES: '200', BIGQUERY_DAILY_QUERIES: '2' };
const fields = ['event_timestamp', 'event_name', 'event_params', 'user_pseudo_id', 'stream_id', 'geo', 'device', 'batch_page_id', 'batch_ordering_id', 'batch_event_index', 'event_bundle_sequence_id', 'collected_traffic_source'];
const schema = new Set(fields);
const property = { id: '123', domain: 'example.com', timeZone: 'America/Los_Angeles' };
const dateRange = { startDate: '2026-10-20', endDate: '2026-10-21' };
const bundle = { paths: { journeys: [{ path: ['/', '/docs', '/pricing', '/done'], count: 2, percentage: 50 }], totalSessions: 4 }, summary: { sessions: 4, avgPathLength: 4, conversions: null, topExit: { page: '/done', sessions: 2 } }, context: { sessions: 5, topEntry: { value: '/', count: 3, percentage: 60 } } };
const window = period(dateRange, property.timeZone);
const source = sourceFor('123', env);
const build = overrides => compile({ source, window, schema, suffixes: ['20261020', '20261021'], ...overrides });
function fakeProvider(overrides = {}) {
  const calls = [], jobs = [];
  const client = {
    async call(method, path, data, params) {
      calls.push({ method, path, data, params });
      if (overrides.call) return overrides.call(method, path, data, params);
      if (path.endsWith('/tables')) return { tables: ['events_20261020', 'events_20261021', 'events_intraday_20261021', 'events_intraday_20261022'].map((tableId, i) => ({ tableReference: { tableId }, creationTime: String(i) })) };
      if (path.includes('/tables/')) return { schema: { fields: fields.map(name => ({ name })) } };
      return { location: 'US' };
    },
    async query(source, sql, params) {
      jobs.push({ source, sql, params });
      if (overrides.query) return overrides.query(source, sql, params);
      return { data: bundle, fetchedAt: '2026-10-22T12:00:00Z', bytesBilled: 20, cacheHit: false };
    },
  };
  return { provider: createBigQueryJourneys({ env, client, ...overrides.options }), calls, jobs };
}
async function invoke(handler, action, query = {}, headers = {}) {
  const result = { status: 200 };
  await handler({ path: `/api/rybbit/sites/123/${action}`, method: 'GET', query, headers }, { status(n) { result.status = n; return this; }, send(body) { result.body = body; return this; } });
  return result;
}
describe('GA4 BigQuery Journeys', () => {
  let previousDemo;
  beforeEach(() => { previousDemo = process.env.DEMO; delete process.env.DEMO; });
  afterEach(() => { if (previousDemo === undefined) delete process.env.DEMO; else process.env.DEMO = previousDemo; });
  it('requires explicit property mapping, validates identifiers and keeps query budgets bounded', () => {
    assert.equal(sourceFor('456', env), null);
    assert.equal(source.datasetId, 'analytics_123');
    for (const value of ['not json', '[]', '{"123":{"projectId":"x`; DROP TABLE x","location":"US"}}', '{"123":{"projectId":"test-project","location":"US","datasetId":"other"}}'])
      assert.throws(() => settings({ GA4_BIGQUERY_SOURCES: value }));
    assert.throws(() => settings({ BIGQUERY_MAX_BYTES_BILLED: '-1' }));
    assert.throws(() => settings({ BIGQUERY_DAILY_QUERIES: '10001' }));
    assert.equal(sourceFor('123', env).billingProjectId, 'billing-project');
  });
  it('prunes tables and binds patterns, filters and exact timestamps without interpolating input', () => {
    const evil = "/'; SELECT secret FROM x; --", query = { steps: 10, endsAt: evil, stepFilters: JSON.stringify({ 0: evil, 9: '/done' }), filters: JSON.stringify([{ parameter: 'country', type: 'equals', value: ['US'] }]) };
    const compiled = build({ query });
    assert(!compiled.sql.includes(evil));
    assert(Object.values(compiled.params).includes(glob(evil)));
    assert.equal(compiled.params.start_us, Date.parse('2026-10-20T07:00:00Z') * 1000);
    assert.equal(compiled.params.end_us, Date.parse('2026-10-22T07:00:00Z') * 1000);
    assert.match(compiled.sql, /_TABLE_SUFFIX IN \('20261020','20261021'\)/);
    assert.match(compiled.sql, /ORDER BY event_timestamp, batch_page_id, batch_ordering_id, batch_event_index, event_bundle_sequence_id/);
    assert.match(compiled.sql, /TO_JSON_STRING\(STRUCT\(stream_id, user_pseudo_id,/);
    assert.match(compiled.sql, /LAG\(pathname\)/);
    assert.match(compiled.sql, /FROM multi\)\) AS percentage/);
    assert(!compiled.sql.includes('page_referrer AS session_key'));
  });
  it('handles older export schemas, section compaction, end truncation and bound goal parameters', () => {
    const goal = { goalType: 'event', config: { eventName: 'purchase', eventPropertyKey: 'currency', eventPropertyValue: 'USD' } };
    const compiled = build({ schema: new Set(fields.filter(name => !name.startsWith('batch_') && name !== 'collected_traffic_source')), query: { groupBy: 'section', endsAt: '/checkout/**', stepFilters: '{"0":"/docs/**"}' }, goal });
    assert(!compiled.sql.includes('batch_page_id'));
    assert(!compiled.sql.includes('collected_traffic_source.'));
    assert.match(compiled.sql, /LAG\(grouped_page\)/);
    assert.match(compiled.sql, /SELECT MIN\(j\)/);
    assert(Object.values(compiled.params).includes('purchase'));
    assert(Object.values(compiled.params).includes('currency'));
    assert(Object.values(compiled.params).includes('USD'));
    assert.throws(() => build({ query: { steps: 11 } }));
    assert.throws(() => build({ query: { filters: '[{"parameter":"lat","type":"equals","value":[0]}]' } }), /does not support/);
    assert.throws(() => build({ query: { filters: '[{"parameter":"country","type":"regex","value":[".*"]}]' } }));
  });
  it('supports native subdivision/city IDs and groups negative alternatives', () => {
    const compiled = build({ query: { filters: JSON.stringify([{ parameter: 'city', type: 'not_equals', value: ['US-CA-San Francisco', 'US--New York'] }]) } });
    for (const value of ['US', 'California', 'San Francisco', 'New York']) assert(Object.values(compiled.params).includes(value));
    assert.match(compiled.sql, /WHERE NOT \(/);
  });
  it('shares a single default report across paths/summary/context and excludes duplicate intraday data', async () => {
    const { provider, calls, jobs } = fakeProvider();
    const args = { property, timeZone: property.timeZone, dateRange, query: { mode: 'sessions', steps: 4 } };
    const [paths, summary, context] = await Promise.all(['paths', 'summary', 'context'].map(action => provider.report({ ...args, action })));
    assert.deepEqual(paths.data, bundle.paths);
    assert.deepEqual(summary.data, bundle.summary);
    assert.deepEqual(context.data, bundle.context);
    assert.equal(jobs.length, 1);
    assert.equal(calls.length, 3);
    assert.match(jobs[0].sql, /IN \('20261020','20261021'\)/);
    assert(!jobs[0].sql.includes("'intraday_20261021'"));
    const cached = await provider.report({ ...args, action: 'paths', query: { ...args.query, limit: 1 } });
    assert.equal(jobs.length, 1);
    assert.equal(cached.reportStatus.cacheStatus, 'cached');
    assert.equal(paths.coverage.partial, false);
  });
  it('reports export coverage and intraday freshness without inventing historical data', async () => {
    const { provider, jobs } = fakeProvider();
    const args = { property, timeZone: property.timeZone };
    const cap = await provider.capabilities('123');
    assert.equal(cap.source, 'bigquery'); assert.equal(cap.availableFrom, '2026-10-20');
    assert.equal(cap.availableThrough, '2026-10-22');
    await assert.rejects(provider.report({ ...args, dateRange: { startDate: '2026-10-01', endDate: '2026-10-21' } }), /exports start/);
    await assert.rejects(provider.report({ ...args, dateRange: { startDate: '2026-09-01', endDate: '2026-10-21' } }), /31 days/);
    assert.equal(jobs.length, 0);
    const result = await provider.report({ ...args, dateRange: { startDate: '2026-10-21', endDate: '2026-10-23' } });
    assert.equal(result.coverage.partial, true); assert.equal(result.coverage.intraday, true);
    assert.match(jobs[0].sql, /'intraday_20261022'/);
  });
  it('returns unavailable capabilities for empty exports and schema/IAM failures without querying', async () => {
    const empty = fakeProvider({ call: async (_, path) => path.endsWith('/tables') ? {} : { location: 'US' } });
    assert.equal((await empty.provider.capabilities('123')).reason, 'export_pending');
    const denied = fakeProvider({ call: async () => { throw new Error('BigQuery access denied.'); } });
    assert.equal((await denied.provider.capabilities('123')).available, false);
    assert.equal(denied.jobs.length, 0);
    assert.deepEqual(await denied.provider.capabilities('456'), { available: false, source: null, reason: 'not_configured' });
  });
  it('bounds exact-path pagination and prevents session IDs from changing property or date scope', async () => {
    const compiled = build({ action: 'sessions', query: { steps: 4, path: JSON.stringify(['/', '/docs']), offset: 25, limit: 25 } });
    assert.match(compiled.sql, /LIMIT 25 OFFSET 25/);
    assert(Object.values(compiled.params).includes('["/","/docs"]'));
    assert.throws(() => build({ action: 'sessions', query: { path: '[]' } }));
    assert.throws(() => build({ action: 'sessions', query: { path: '["/"]', limit: 101 } }));
    const { provider, jobs } = fakeProvider({ query: async () => ({ data: { session: null, events: [], pagination: {} } }) });
    const id = `bq-456-${window.start}-${window.end}-${'A'.repeat(64)}`;
    await assert.rejects(provider.report({ property, timeZone: property.timeZone, action: 'details', sessionId: id }), /not found/);
    assert.equal(jobs.length, 0);
    await assert.rejects(provider.report({ property, timeZone: property.timeZone, action: 'details', sessionId: id.replace('456', '123') }), /not found/);
    assert(Object.values(jobs[0].params).includes('A'.repeat(64)));
  });
  it('enforces private workspace and sessions scope before invoking the source, including cached reports', async () => {
    let touched = 0;
    const bigQueryJourneys = { configured: () => { touched++; return true; }, capabilities: async () => ({ available: true, source: 'bigquery' }), report: async () => { touched++; return { data: bundle.paths, source: 'bigquery' }; } };
    const handler = createRybbitHandler({ properties: async () => ({ properties: [property] }), bigQueryJourneys, now: () => new Date('2026-10-22'), embeds: { store: { isPublic: async () => true, validate: async () => true } } });
    const query = { mode: 'sessions', start_date: '2026-10-20', end_date: '2026-10-21' };
    const shared = await invoke(handler, 'journeys', query, { 'x-private-site': '123', 'x-private-key': 'abc' });
    assert.equal(shared.status, 422); assert.equal(touched, 0);
    const publicResult = await storage.run({ publicSiteId: '123' }, () => invoke(handler, 'journeys/capabilities'));
    assert.equal(publicResult.body.data.available, false); assert.equal(touched, 0);
    const scopes = [];
    const access = { requireSite: (_, id, permission) => { scopes.push(permission); if (permission === 'sessions:read') throw Object.assign(new Error('Denied'), { status: 403 }); } };
    const denied = await storage.run({ access, identity: { userId: 'viewer', bearer: true } }, () => invoke(handler, 'journeys/sessions', query));
    assert.equal(denied.status, 403); assert.equal(touched, 0); assert.deepEqual(scopes, ['sessions:read']);
    const paths = await invoke(handler, 'journeys', query);
    assert.equal(paths.body.source, 'bigquery'); assert.deepEqual(paths.body.journeys, bundle.paths.journeys);
  });
  it('keeps demo sessions isolated even with a configured BigQuery provider', async () => {
    process.env.DEMO = '1';
    const handler = createRybbitHandler({ properties: async () => ({ properties: [property] }), bigQueryJourneys: { configured: () => { throw new Error('Must not inspect BigQuery'); } } });
    assert.equal((await invoke(handler, 'journeys/capabilities')).body.data.source, 'demo-sessions');
    let calls = 0;
    const client = createBigQuery({ env, request: async () => { calls++; } });
    await assert.rejects(client.call('GET', 'projects/test-project'), /Demo never calls/);
    assert.equal(calls, 0);
  });
});

describe('BigQuery jobs and persistent scan budgets', () => {
  let db, previousDemo, calls;
  beforeEach(() => {
    previousDemo = process.env.DEMO; delete process.env.DEMO; calls = [];
    db = new Database(':memory:'); db.exec('CREATE TABLE app_document(kind TEXT, propertyId TEXT, payload TEXT, updatedAt TEXT, PRIMARY KEY(kind,propertyId))');
  });
  afterEach(() => { db.close(); if (previousDemo === undefined) delete process.env.DEMO; else process.env.DEMO = previousDemo; });
  function client(overrides = {}) {
    return createBigQuery({ env, db, now: () => new Date('2026-10-22T10:00:00Z'), sleep: async () => {}, request: async req => {
      calls.push(req);
      if (overrides.request) return overrides.request(req);
      if (req.data?.configuration?.dryRun) return { statistics: { query: { totalBytesProcessed: overrides.estimate || '20' } } };
      if (req.method === 'POST') return {};
      if (req.path.includes('/queries/')) return overrides.incomplete ? { jobComplete: false } : { jobComplete: true, totalRows: '1', rows: [{ f: [{ v: '{"ok":true}' }] }] };
      return { statistics: { query: { totalBytesBilled: '20', cacheHit: false } } };
    } });
  }
  it('dry-runs first, enforces a hard billing cap, uses unique jobs and reconciles actual bytes', async () => {
    const api = client();
    assert.deepEqual((await api.query(source, 'SELECT @value', { value: 'safe' })).data, { ok: true });
    assert(calls[0].data.configuration.dryRun);
    const job = calls[1];
    assert.equal(job.path, 'projects/billing-project/jobs');
    assert.equal(job.data.configuration.query.maximumBytesBilled, '100');
    assert.equal(job.data.configuration.jobTimeoutMs, '30000');
    assert.equal(job.data.jobReference.location, 'US');
    assert.equal(job.data.configuration.query.useLegacySql, false);
    assert.equal(job.data.configuration.query.queryParameters[0].parameterValue.value, 'safe');
    const ledger = JSON.parse(db.prepare('SELECT payload FROM app_document').get().payload);
    assert.equal(ledger.bytes, 20);
    await api.query(source, 'SELECT 2', {});
    const live = calls.filter(call => call.method === 'POST' && !call.data.configuration?.dryRun);
    assert.notEqual(live[0].data.jobReference.jobId, live[1].data.jobReference.jobId);
  });
  it('rejects an oversized dry run before a paid job or budget write', async () => {
    await assert.rejects(client({ estimate: '101' }).query(source, 'SELECT 1', {}), /scan limit/);
    assert.equal(calls.length, 1); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM app_document').get().n, 0);
  });
  it('keeps daily query limits across client instances and does not resubmit jobs', async () => {
    await client().query(source, 'SELECT 1', {});
    await client().query(source, 'SELECT 2', {});
    await assert.rejects(client().query(source, 'SELECT 3', {}), error => error.code === 'bigquery_budget_exhausted');
    assert.equal(calls.filter(call => call.method === 'POST' && !call.data.configuration?.dryRun).length, 2);
  });
  it('cancels timed-out jobs and retains a conservative reservation for ambiguous billing', async () => {
    await assert.rejects(client({ incomplete: true }).query(source, 'SELECT 1', {}), /timed out/);
    assert(calls.at(-1).path.endsWith('/cancel'));
    const ledger = JSON.parse(db.prepare('SELECT payload FROM app_document').get().payload);
    assert.equal(ledger.bytes, 100);
    assert.equal(calls.filter(call => call.data?.configuration && !call.data.configuration.dryRun).length, 1);
  });
  it('sanitizes Google errors and never returns their request data or credentials', async () => {
    const api = client({ request: async () => { throw Object.assign(new Error('private key / raw SQL secret'), { status: 403, response: { status: 403 } }); } });
    await assert.rejects(api.query(source, 'SELECT 1', {}), error => error.status === 502 && error.message.includes('access denied') && !error.message.includes('secret'));
    assert.equal(calls.length, 1);
  });
});
