const { expect } = require('chai');
const { createRybbitHandler } = require('../controllers/rybbit');
const dims = (values, metrics) => ({ dimensionValues: values.map(value => ({ value })), metricValues: metrics.map(value => ({ value: String(value) })) });

function fixture({ fail = false, truncated = false } = {}) {
  const calls = [];
  const gateway = createRybbitHandler({ properties: async () => ({ properties: [{ id: '123', domain: 'example.com' }] }),
    read: async () => null, write: async () => {},
    gsc: { report: async (_, action, query) => {
      calls.push({ action, query });
      if (fail) throw Object.assign(new Error('This GA4 audience filter is unavailable in Search Console.'), { status: 422 });
      return { connection: { connected: true, gscPropertyUrl: 'sc-domain:example.com' }, truncated, source: 'gsc', timeZone: 'America/Los_Angeles',
        data: action === 'summary' ? { clicks: 100, impressions: 1000 } : [
          { page: 'https://example.com/docs/a', clicks: 10, impressions: 100, ctr: .1, position: 2 },
          { page: 'https://example.com/docs/b', clicks: 30, impressions: 300, ctr: .1, position: 6 }] };
    } },
    run: async q => {
      const names = q.dimensions.map(d => d.name).join(',');
      const rows = names === 'pagePath' ? [dims(['/docs/a'], [100, 80, .2, 30]), dims(['/docs/b'], [50, 40, .3, 20]), dims(['/other'], [30, 20, .1, 10])]
        : names === 'landingPage' ? [dims(['/docs/a'], [20])] : names === 'pagePath,pageTitle' ? [] : [dims([], [150, 90, .2, 50])];
      return { ok: true, rows, rowCount: rows.length };
    } });
  const request = async query => {
    let result, status = 200;
    await gateway({ path: '/sites/123/pages', method: 'GET', query: { start_date: '2026-10-01', end_date: '2026-10-19', ...query } },
      { send(value) { result = value; }, status(value) { status = value; return this; } });
    expect(status).to.equal(200);
    return result.data;
  };
  return { request, calls };
}

describe('Pages with Search Console', () => {
  it('sorts search metrics before pagination while keeping the whole-period denominator', async () => {
    const api = fixture();
    const first = await api.request({ include_gsc: 1, sort: 'search_clicks', order: 'desc', limit: 1 });
    const next = await api.request({ include_gsc: 1, sort: 'search_clicks', order: 'desc', limit: 1, page: 2 });
    expect(first.data[0].key).to.equal('/docs/b');
    expect(first.data[0].search).to.include({ clicks: 30, clickSharePct: 30, impressionSharePct: 30 });
    expect(next.data[0].key).to.equal('/docs/a');
    expect(next.data[0].search.clickSharePct).to.equal(10);
    const continued = await api.request({ include_gsc: 1, sort: 'search_clicks', order: 'desc', limit: 2, offset: 1 });
    expect(continued.data.map(row => row.key)).to.deep.equal(['/docs/a', '/other']);
    expect(api.calls.every(call => call.action === 'summary' || call.query.dimensions === 'page')).to.equal(true);
    const ascending = await api.request({ include_gsc: 1, sort: 'search_clicks', order: 'asc' });
    expect(ascending.data.map(row => row.key)).to.deep.equal(['/docs/a', '/docs/b', '/other']);
    expect(ascending.data[2].search).to.equal(undefined);
  });
  it('enriches sections and their child pages consistently, with partial section counts marked', async () => {
    const api = fixture({ truncated: true });
    const sections = await api.request({ include_gsc: 1, group: 'section' });
    expect(sections.data.find(row => row.kind === 'section').search).to.include({ clicks: 40, ctr: .1, position: 5, partial: true, clickSharePct: 40 });
    const children = await api.request({ include_gsc: 1, section: '/docs' });
    expect(children.data).to.have.length(2);
    expect(children.data.every(row => row.search.partial === false)).to.equal(true);
  });
  it('preserves GA4 pages when GSC cannot represent the selected audience', async () => {
    const api = fixture({ fail: true });
    const data = await api.request({ include_gsc: 1 });
    expect(data.data).to.have.length(3);
    expect(data.searchConsole.available).to.equal(false);
    expect(data.searchConsole.error).to.include('unavailable in Search Console');
    expect(data.data[0].pageviews).to.equal(100);
  });
  it('does not contact GSC when the feature is not requested', async () => {
    const api = fixture();
    const data = await api.request({});
    expect(api.calls).to.have.length(0);
    expect(data).not.to.have.property('searchConsole');
  });
});
