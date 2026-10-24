const { expect } = require('chai');
const { createSearchConsole, matchProperty, rangeFor, searchFilters, SCOPE } = require('../controllers/searchConsole');
const { createRybbitHandler } = require('../controllers/rybbit');

const now = () => new Date('2026-10-22T10:00:00Z');
const property = { id: '123', url: 'https://example.com/', domain: 'example.com' };
const sites = [{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteFullUser' }];
const dates = { start_date: '2026-10-01', end_date: '2026-10-20' };
function service(overrides = {}) {
  const cache = new Map(), calls = [];
  const api = createSearchConsole({ now, isDemo: () => false,
    credentials: () => ({ email: 'test@example.com', key: 'test', fingerprint: 'test' }),
    readEntry: async (namespace, key) => cache.get(namespace + key),
    write: async (namespace, key, data, { cachedAt }) => cache.set(namespace + key, { data, cachedAt }),
    request: async (path, body) => { calls.push({ path, body }); return path === 'sites' ? { siteEntry: sites }
      : { rows: [{ keys: body.dimensions.length ? ['a'] : [], clicks: 20, impressions: 100, ctr: .2, position: 4.5 }] }; },
    ...overrides });
  return { ...api, calls };
}
describe('Search Console integration', () => {
  it('uses read-only scope and matches authorized host boundaries without selecting path-only properties', () => {
    expect(SCOPE).to.equal('https://www.googleapis.com/auth/webmasters.readonly');
    expect(matchProperty(property, [...sites, { siteUrl: 'https://example.com/blog/', permissionLevel: 'siteFullUser' }]).siteUrl).to.equal('sc-domain:example.com');
    expect(matchProperty(property, [...sites, { siteUrl: 'https://example.com/', permissionLevel: 'siteFullUser' }]).siteUrl).to.equal('https://example.com/');
    expect(matchProperty({ domain: 'otherexample.com' }, sites)).to.equal(null);
    expect(matchProperty(property, [{ ...sites[0], permissionLevel: 'siteUnverifiedUser' }])).to.equal(null);
    const match = matchProperty({ domain: 'docs.example.com' }, sites);
    expect(new RegExp(match.hostFilter.expression).test('https://docs.example.com/page')).to.equal(true);
    expect(new RegExp(match.hostFilter.expression).test('https://example.com/page')).to.equal(false);
    expect(matchProperty({ id: '123', domain: null }, sites)).to.equal(null);
    expect(matchProperty({ id: '123', domain: null }, sites, { 123: 'https://example.com/' }).siteUrl).to.equal('sc-domain:example.com');
    expect(matchProperty({ id: '123', url: 'https://other.com/' }, sites, { 123: 'https://example.com/' })).to.equal(null);
  });
  it('shares cached reports, keeps property totals independent of top keywords, and uses final Pacific dates', async () => {
    const api = service();
    const totals = await api.report(property, 'summary', dates);
    const cached = await api.report(property, 'summary', dates);
    const rows = await api.report(property, 'data', { ...dates, dimensions: 'query' });
    expect(totals.data).to.deep.equal({ clicks: 20, impressions: 100, ctr: .2, position: 4.5 });
    expect(rows.data[0]).to.include({ query: 'a', clicks: 20 });
    expect(cached.reportStatus).to.deep.equal({ fetchedAt: now().toISOString(), cacheStatus: 'cached' });
    expect(api.calls).to.have.length(3);
    expect(api.calls[1].body).to.include({ startDate: dates.start_date, endDate: dates.end_date, dataState: 'final', type: 'web' });
    expect(api.calls[1].body.dimensions).to.deep.equal([]);
    expect(totals.timeZone).to.equal('America/Los_Angeles');
    expect(api.calls[1].body.dimensionFilterGroups[0].filters[0].dimension).to.equal('page');
  });
  it('translates supported filters and refuses incompatible audience segmentation', () => {
    const match = matchProperty(property, sites);
    const filters = searchFilters([{ parameter: 'pathname', type: 'equals', value: ['/pricing'] }, { parameter: 'device_type', type: 'equals', value: ['mobile'] }], match);
    const page = new RegExp(filters[1].expression);
    expect(page.test('https://example.com/pricing?source=gsc')).to.equal(true);
    expect(page.test('https://example.com/pricing-old')).to.equal(false);
    expect(filters[2]).to.include({ dimension: 'device', expression: '(?:^MOBILE$)' });
    expect(() => searchFilters([{ parameter: 'utm_source', type: 'equals', value: ['google'] }], match)).to.throw('unavailable in Search Console');
  });
  it('does not mint tokens in Demo mode or for an unconfigured connection', async () => {
    const demo = service({ isDemo: () => true, request: () => { throw new Error('must not call'); } });
    expect((await demo.connection(property)).reason).to.equal('demo');
    const missing = service({ credentials: () => null });
    expect((await missing.connection(property)).reason).to.equal('not_configured');
    expect((await missing.report(property, 'summary', dates)).data).to.equal(null);
  });
  it('does not turn missing measurements into ranks, and reports truncated keyword tables', async () => {
    const api = service({ request: async path => path === 'sites' ? { siteEntry: sites } : { rows: Array.from({ length: 501 }, (_, i) => ({ keys: [String(i)], clicks: 0, impressions: 0 })) } });
    const result = await api.report(property, 'data', dates);
    expect(result.data).to.have.length(500);
    expect(result.truncated).to.equal(true);
    expect(result.data[0]).to.include({ position: null, ctr: null });
  });
  it('translates GSC three-letter countries for native names and flags without changing the source keys', async () => {
    const api = service({ request: async path => path === 'sites' ? { siteEntry: sites } : { rows: [{ keys: ['usa'], clicks: 1, impressions: 10, ctr: .1, position: 3 }] } });
    expect((await api.report(property, 'data', { ...dates, dimensions: 'country' })).data[0]).to.include({ country: 'usa', countryCode: 'US' });
  });
  it('sanitizes Google failures, does not cache failures, and applies cooldowns', async () => {
    let calls = 0;
    const api = service({ request: async path => { if (path === 'sites') return { siteEntry: sites }; calls++; throw { response: { status: 429, data: 'SECRET_TOKEN' } }; } });
    for (let i = 0; i < 2; i++) {
      try { await api.report(property, 'summary', dates); throw new Error('Expected refusal'); }
      catch (error) { expect(error.status).to.equal(429); expect(error.message).not.to.include('SECRET_TOKEN'); }
    }
    expect(calls).to.equal(1);
  });
  it('clips history safely and represents an out-of-history window as empty', () => {
    const range = rangeFor({ start_date: '2015-01-01', end_date: '2026-10-23' }, now());
    expect(range).to.include({ startDate: '2025-06-22', endDate: '2026-10-22', clipped: true });
    expect(rangeFor({ start_date: '2020-01-01', end_date: '2020-02-01' }, now()).empty).to.equal(true);
  });
  it('does not show zero clicks for a period outside retained GSC history', async () => {
    const api = service();
    const result = await api.report(property, 'summary', { start_date: '2020-01-01', end_date: '2020-02-01' });
    expect(result.data).to.equal(null);
    expect(result.range.empty).to.equal(true);
    expect(api.calls).to.have.length(1);
  });
  it('routes GSC before GA4-specific filters and never asks GA4 for search reports', async () => {
    let captured;
    const gateway = createRybbitHandler({ properties: async () => ({ properties: [property] }),
      run: () => { throw new Error('GA4 must not run'); },
      gsc: { report: async (p, action, q) => { captured = { p, action, q }; return { source: 'gsc', data: [] }; } } });
    let result;
    await gateway({ path: '/sites/123/gsc/data', method: 'GET', query: { ...dates, dimensions: 'page' } }, { json(value) { result = value; }, status() { return this; } });
    expect(result.source).to.equal('gsc');
    expect(captured).to.include({ action: 'data' });
    expect(captured.q.dimensions).to.equal('page');
  });
  it('exposes the same bounded reports over MCP without spending GA4 quota', async () => {
    const { createDashboardService, capabilities } = require('../mcp-server/lib/dashboard');
    let captured;
    const dashboard = createDashboardService({ now, isDemo: () => false,
      properties: async () => ({ properties: [property] }),
      adminClient: () => { throw new Error('GA4 must not run'); },
      gsc: { report: async (p, action, query) => { captured = { action, query }; return { source: 'gsc', data: [{ query: 'one' }, { query: 'two' }], truncated: false }; } } });
    const result = await dashboard.execute('get_search_console_report', { propertyId: '123', report: 'data', dimension: 'query', limit: 1, range: '7d' });
    expect(result).to.include({ source: 'gsc', ga4ApiCalls: 0, quotaSource: 'gsc', truncated: true });
    expect(result.data).to.have.length(1);
    expect(captured.action).to.equal('data');
    expect(captured.query.dimensions).to.equal('query');
    expect(capabilities().searchConsole.tool).to.equal('get_search_console_report');
  });
});
