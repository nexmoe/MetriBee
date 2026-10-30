const assert = require('assert/strict');
const { dateRange, buildTransitions, fetchJourneys, createJourneysHandler, ROW_LIMIT } = require('../controllers/journeys');
const { groupRows, matchesPage, selectRows, layoutGraph, pageKey } = require('../public/js/journeys');

const row = (host, from, to, views) => ({ dimensionValues: [host, from, to].map(value => ({ value })), metricValues: [{ value: String(views) }] });
const report = rows => ({ ok: true, rows, rowCount: rows.length, metadata: { timeZone: 'Asia/Shanghai' } });
const summary = { ok: true, rows: [{ metricValues: [{ value: '100' }, { value: '240' }] }] };
const request = (query = {}, propertyId = '123') => ({ params: { propertyId }, query });
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, send(body) { this.body = body; return this; } });

describe('GA4 page journeys', () => {
  it('uses inclusive equal-length date ranges with no overlap', () => {
    assert.deepEqual(dateRange('30d'), { startDate: '29daysAgo', endDate: 'today' });
    assert.deepEqual(dateRange('30d', true), { startDate: '59daysAgo', endDate: '30daysAgo' });
    assert.deepEqual(dateRange('7d'), { startDate: '6daysAgo', endDate: 'today' });
    assert.deepEqual(dateRange('7d', true), { startDate: '13daysAgo', endDate: '7daysAgo' });
    assert.deepEqual(dateRange('today', true), { startDate: 'yesterday', endDate: 'yesterday' });
  });

  it('counts only same-host pairs, strips queries, retains repeats and keeps hostnames separate', () => {
    const result = buildTransitions(report([
      row('site.example', 'https://site.example/docs?token=secret#top', '/pricing?secret=x', 12),
      row('www.site.example', 'https://site.example/docs', '/pricing', 8),
      row('site.example', 'https://site.example/pricing', '/pricing', 3),
      row('second.example', 'https://second.example/docs', '/pricing', 2),
      row('site.example', 'https://site.example.evil.test/docs', '/pricing', 70),
      row('site.example', 'https://sub.site.example/docs', '/pricing', 10),
      row('site.example', '', '/', 4),
      row('site.example', '(not set)', '/', 5),
      row('site.example', 'javascript:alert(1)', '/', 6),
    ]));
    assert.equal(result.internalViews, 25);
    assert.equal(result.rows.length, 3);
    assert.deepEqual(result.rows[0], { host: 'site.example', from: '/docs', to: '/pricing', views: 20 });
    assert.equal(result.topReferrer.path, '/docs');
    assert.equal(result.topDestination.views, 23);
    assert(!JSON.stringify(result).includes('secret'));
    assert.equal(result.unavailableViews, 9);
  });

  it('preserves truncation and GA4 data-quality flags', () => {
    const result = buildTransitions({ ...report([row('x.test', 'https://x.test/', '/a', 2)]), rowCount: 20000, metadata: { subjectToThresholding: true, dataLossFromOtherRow: true, samplingMetadatas: [{}] } });
    assert(result.truncated);
    assert.deepEqual(result.quality, { dataLossFromOtherRow: true, subjectToThresholding: true, sampled: true });
    assert.equal(result.rowCount, 20000);
  });

  it('requests page_view pairs with view counts, never generates session sequences', async () => {
    const queries = [];
    const result = await fetchJourneys({ propertyId: '123', range: '30d', compare: false, run: async q => { queries.push(q); return q.dimensions.length ? report([row('x.test', 'https://x.test/', '/a', 9)]) : summary; } });
    assert.equal(queries.length, 2);
    assert.equal(queries[0].limit, ROW_LIMIT);
    assert.equal(queries[0].dimensionFilter.filter.stringFilter.value, 'page_view');
    assert.deepEqual(queries[0].metrics, [{ name: 'screenPageViews' }]);
    assert.equal(result.steps, 2);
    assert.equal(result.mode, 'referrer-transitions');
    assert.equal(result.internalViews, 9);
    assert.equal(result.viewsPerSession, 2.4);
    assert.equal(result.previous, null);
  });

  it('provides usable internal transitions in demo mode without a Google account', () => {
    const demo = require('../controllers/demoData');
    const property = demo.PROPERTIES[0];
    const report = demo._internal.runReport({
      property: `properties/${property.id}`,
      dimensions: ['hostName', 'pageReferrer', 'pagePath'].map(name => ({ name })),
      metrics: [{ name: 'screenPageViews' }],
      dateRanges: [{ startDate: '29daysAgo', endDate: 'today' }], limit: ROW_LIMIT,
    });
    const result = buildTransitions(report);
    assert(result.rows.length > 5);
    assert(result.internalViews > 0);
    assert.equal(result.rows[0].host, property.domain);
  });

  it('keeps successful current data when previous-period data fails', async () => {
    const result = await fetchJourneys({ propertyId: '123', range: '30d', compare: true, run: async q => {
      if (q.dateRange.endDate !== 'today') return { ok: false, error: 'quota', errorCode: 8 };
      return q.dimensions.length ? report([row('x.test', 'https://x.test/', '/a', 2)]) : summary;
    } });
    assert.equal(result.comparisonUnavailable, true);
    assert.equal(result.internalViews, 2);
    assert.equal(result.previous, null);
  });

  it('does not turn failed summary metrics into zero', async () => {
    const result = await fetchJourneys({ propertyId: '123', range: '7d', compare: false, run: async q => q.dimensions.length ? report([]) : { ok: false } });
    assert.equal(result.sessions, null);
    assert.equal(result.totalViews, null);
    assert.equal(result.viewsPerSession, null);
  });

  it('rejects invalid ranges and unknown properties without querying GA4', async () => {
    let calls = 0;
    const handler = createJourneysHandler({ run: () => { calls++; }, getProperties: async () => ({ properties: [{ id: '123' }] }) });
    for (const [req, code] of [[request({}, 'bad'), 400], [request({ range: 'forever' }), 400], [request({}, '124'), 404]]) {
      const res = response(); await handler(req, res); assert.equal(res.statusCode, code);
    }
    assert.equal(calls, 0);
  });

  it('serves cached data without spending tokens', async () => {
    const handler = createJourneysHandler({ run: () => { throw Error('must not query'); }, getProperties: async () => ({ properties: [{ id: '123' }] }), readCache: async () => ({ ok: true, internalViews: 10 }) });
    const res = response(); await handler(request(), res);
    assert.equal(res.body.cached, true); assert.equal(res.body.internalViews, 10);
  });

  it('coalesces concurrent requests and caches successful reports', async () => {
    let calls = 0, writes = 0;
    const handler = createJourneysHandler({ getProperties: async () => ({ properties: [{ id: '123' }] }), readCache: async () => null, writeCache: async () => { writes++; }, run: async q => { calls++; await new Promise(resolve => setImmediate(resolve)); return q.dimensions.length ? report([]) : summary; } });
    const a = response(), b = response();
    await Promise.all([handler(request({ compare: 'none' }), a), handler(request({ compare: 'none' }), b)]);
    assert.equal(calls, 2); assert.equal(writes, 1); assert.deepEqual(a.body, b.body);
  });

  it('returns a quota error without caching failed reports', async () => {
    let wrote = false;
    const handler = createJourneysHandler({ getProperties: async () => ({ properties: [{ id: '123' }] }), readCache: async () => null, writeCache: async () => { wrote = true; }, run: async () => ({ ok: false, error: 'quota', errorCode: 8 }) });
    const res = response(); await handler(request(), res);
    assert.equal(res.statusCode, 429); assert.equal(res.body.rateLimited, true); assert.equal(wrote, false);
  });
});

describe('Journey grouping, filtering and Sankey data', () => {
  const rows = [
    { host: 'x.test', from: '/', to: '/docs/a', views: 10 },
    { host: 'x.test', from: '/', to: '/docs/b', views: 5 },
    { host: 'x.test', from: '/docs/a', to: '/pricing', views: 2 },
    { host: 'y.test', from: '/', to: '/docs/a', views: 3 },
  ];
  it('groups first folders without merging different hosts or changing totals', () => {
    const grouped = groupRows(rows, 'folder');
    assert.equal(grouped.length, 3);
    assert.deepEqual(grouped[0], { host: 'x.test', from: '/', to: '/docs/**', views: 15 });
    assert.equal(grouped.reduce((sum, r) => sum + r.views, 0), 20);
  });

  it('supports literal search and simple wildcards without regex injection', () => {
    assert(matchesPage('/docs/a', '/docs/**'));
    assert(matchesPage('/DOCS/a', 'docs'));
    assert(!matchesPage('/docs/a', '[a-z]'));
    assert(matchesPage('/a+b', '/a+b'));
    assert(matchesPage('/(pricing)', '/(pricing)'));
  });

  it('applies source, destination and search filters before the display limit', () => {
    const result = selectRows(rows, { from: pageKey('x.test', '/'), search: '/docs/**', limit: 1 });
    assert.equal(result.matched.length, 2); assert.equal(result.shown.length, 1);
    assert.equal(selectRows(rows, { to: pageKey('y.test', '/docs/a') }).matched.length, 1);
  });

  it('conserves flow totals at every node and never adds a third step', () => {
    const graph = layoutGraph(rows, 1000);
    assert.equal(graph.columns.length, 2); assert.equal(graph.links.length, rows.length);
    for (const [col, nodes] of graph.columns.entries()) {
      for (const node of nodes) {
        const links = graph.links.filter(l => (col ? l.target : l.source).key === node.key);
        assert.equal(links.reduce((sum, l) => sum + l.views, 0), node.views);
        assert(Math.abs(links.reduce((sum, l) => sum + l.h, 0) - node.h) < 1e-7);
        assert(node.y + node.h <= graph.height);
      }
    }
    assert(graph.links.every(link => !/NaN|Infinity/.test(link.path)));
    assert.equal(layoutGraph([], 720).total, 0);
  });
});
