const { expect } = require('chai');
const { createSearchConsole } = require('../controllers/searchConsole');
const { createSearchConsoleUsage } = require('../lib/searchConsoleQuota');
const { createDashboardService, capabilities } = require('../mcp-server/lib/dashboard');

const property = { id: '123', domain: 'example.com' };
const dates = { start_date: '2026-10-01', end_date: '2026-10-20' };
function setup(overrides = {}) {
  const cache = new Map(), calls = [];
  let at = Date.parse('2026-10-22T10:00:00Z'), fingerprint = 'first';
  const service = createSearchConsole({
    now: () => new Date(at), isDemo: () => false,
    credentials: () => ({ email: 'test@example.com', key: 'test', fingerprint }),
    readEntry: async (namespace, key) => cache.get(namespace + key),
    write: async (namespace, key, data, { cachedAt }) => cache.set(namespace + key, { data, cachedAt }),
    request: async (path, body) => {
      calls.push({ path, body });
      if (path === 'sites') return { siteEntry: [
        { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteFullUser' },
        { siteUrl: 'sc-domain:private.com', permissionLevel: 'siteFullUser' },
      ] };
      if (overrides.error) throw overrides.error;
      return { rows: [] };
    }, ...overrides,
  });
  return { service, calls, advance: ms => { at += ms; }, changeCredentials: () => { fingerprint = 'second'; } };
}

describe('Search Console quota observations', () => {
  it('reads quota without calling Google or claiming a remaining balance', async () => {
    const { service, calls } = setup();
    const result = await service.quota([property]);
    expect(calls).to.have.length(0);
    expect(result).to.include({ configured: true, scope: 'process', remaining: null, loadQuota: null });
    expect(result.today).to.deep.equal({ queries: 0, siteLists: 0, cacheHits: 0, errors: 0, rateLimited: 0 });
    expect(result.limits.searchAnalytics).to.deep.equal({ siteMinute: 1200, userMinute: 1200, projectMinute: 40000, projectDay: 30000000 });
  });
  it('distinguishes Search Analytics, sites.list, report cache hits and deduplicated loads', async () => {
    const { service, calls } = setup();
    await Promise.all([service.report(property, 'summary', dates), service.report(property, 'summary', dates)]);
    await service.report(property, 'summary', dates);
    const result = await service.quota([property]);
    expect(calls).to.have.length(2);
    expect(result.today).to.include({ queries: 1, siteLists: 1, cacheHits: 1, errors: 0 });
    expect(result.sites).to.have.length(1);
    expect(result.sites[0].siteUrl).to.equal('sc-domain:example.com');
    expect(result.sites[0].today).to.include({ queries: 1, siteLists: 0, cacheHits: 1 });
    expect((await service.quota([{ id: '456', domain: 'private.com' }])).sites[0].today.queries).to.equal(0);
    expect((await service.quota([])).sites).to.deep.equal([]);
    expect(calls).to.have.length(2);
  });
  it('counts a Google quota error once and excludes locally refused attempts', async () => {
    const { service, calls } = setup({ error: { response: { status: 429, data: 'SECRET' } } });
    for (let i = 0; i < 3; i++) {
      try { await service.report(property, 'summary', dates); throw new Error('Expected refusal'); }
      catch (err) { expect(err.status).to.equal(429); expect(err.message).not.to.include('SECRET'); }
    }
    const result = await service.quota([property]);
    expect(calls).to.have.length(2);
    expect(result.today).to.include({ queries: 1, errors: 1, rateLimited: 1 });
    expect(result.cooldownUntil).to.equal('2026-10-22T10:01:00.000Z');
    expect(result.activeRequests).to.equal(0);
  });
  it('recognizes structured 403 quota errors while keeping permission failures distinct', async () => {
    for (const [reason, expected] of [['quotaExceeded', 429], ['rateLimitExceeded', 429], ['userRateLimitExceeded', 429], ['forbidden', 502]]) {
      const { service } = setup({ error: { response: { status: 403, data: { error: { errors: [{ reason }] } } } } });
      try { await service.report(property, 'summary', dates); throw new Error('Expected refusal'); }
      catch (err) { expect(err.status).to.equal(expected); }
      const result = await service.quota([property]);
      expect(result.today.errors).to.equal(1);
      expect(result.today.rateLimited).to.equal(expected === 429 ? 1 : 0);
    }
  });
  it('expires minute counts, preserves daily counts, and isolates credential changes', async () => {
    const { service, advance, changeCredentials } = setup();
    await service.report(property, 'summary', dates);
    advance(61000);
    let result = await service.quota([property]);
    expect(result.minute.queries).to.equal(0);
    expect(result.today.queries).to.equal(1);
    changeCredentials();
    result = await service.quota([property]);
    expect(result.today.queries).to.equal(0);
    expect(result.sites).to.deep.equal([]);
    expect(result.observedSince).to.equal('2026-10-22T10:01:01.000Z');
  });
  it('resets daily counts at Pacific midnight while retaining the last-minute window', () => {
    let at = new Date('2026-10-23T06:59:50Z');
    const usage = createSearchConsoleUsage(() => at);
    usage.record('queries', 'sc-domain:example.com');
    at = new Date('2026-10-23T07:00:10Z');
    const result = usage.snapshot(['sc-domain:example.com']);
    expect(result.day).to.equal('2026-10-23');
    expect(result.today.queries).to.equal(0);
    expect(result.minute.queries).to.equal(1);
    expect(result.sites[0].today.queries).to.equal(0);
    expect(result.sites[0].minute.queries).to.equal(1);
  });
  it('hides live observations in demo mode and when credentials are absent', async () => {
    const { service } = setup();
    await service.report(property, 'summary', dates);
    const demo = await service.quota([property], { demo: true });
    expect(demo).to.include({ reason: 'demo', configured: false });
    expect(demo).not.to.have.property('today');
    expect(demo).not.to.have.property('sites');
    const missing = await setup({ credentials: () => null }).service.quota([property]);
    expect(missing).to.include({ reason: 'not_configured', configured: false });
    expect(missing).not.to.have.property('today');
  });
  it('exposes read-only observations through MCP without touching GA4 or GSC reports', async () => {
    let passed;
    const dashboard = createDashboardService({ properties: async () => ({ properties: [property] }), isDemo: () => false,
      adminClient: () => { throw new Error('GA4 must not run'); },
      gsc: { quota: async properties => { passed = properties; return { configured: true, scope: 'process', remaining: null }; } } });
    const result = await dashboard.execute('get_search_console_quota', { propertyId: '123' });
    expect(passed).to.deep.equal([property]);
    expect(result).to.include({ ga4ApiCalls: 0, quotaSource: 'gsc', remaining: null });
    expect(capabilities().searchConsole.quotaTool).to.equal('get_search_console_quota');
  });
});
