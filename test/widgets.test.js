const { expect } = require('chai');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { defaultWidgetConfig, normalizeWidgetConfig, resolveWidgetPeriod, widgetIframeCode } = require('../controllers/widgetConfig');
const { createEmbedStore } = require('../lib/embedStore');
const { createWidgetHandlers } = require('../controllers/widgets');

const fixed = new Date('2026-10-22T10:00:00Z');
const property = { id: '123', timeZone: 'Asia/Shanghai', currencyCode: 'USD' };
const row = (dimension, values) => ({ dimensionValues: dimension == null ? [] : [{ value: dimension }], metricValues: values.map(value => ({ value: String(value) })) });
async function invoke(handler, overrides = {}) {
  const result = { status: 200, headers: {} };
  const res = {
    set(key, value) { Object.assign(result.headers, typeof key === 'string' ? { [key]: value } : key); return this; },
    status(code) { result.status = code; return this; },
    json(value) { result.body = value; return this; },
    render(view, data) { result.view = view; result.body = data; return this; },
  };
  await handler({ method: 'POST', params: { siteId: '123' }, headers: {}, query: {}, body: { config: defaultWidgetConfig() }, path: '/widget/123/abcdef123456', ...overrides }, res);
  return result;
}
function setup(overrides = {}) {
  const calls = [], cache = new Map();
  const handlers = createWidgetHandlers({
    propertyFor: async id => { if (id !== '123') throw Object.assign(new Error('Property not found.'), { status: 404 }); return property; },
    timeZoneFor: async () => property.timeZone, now: () => fixed,
    read: async (namespace, key) => cache.get(key), write: async (namespace, key, data, options) => cache.set(key, { data, cachedAt: options.cachedAt }),
    run: async request => {
      calls.push(request);
      return { ok: true, rows: request.dimensions.length ? [row(request.dimensions[0].name === 'yearMonth' ? '202610' : '20261022', [2, 6, 0.5])]
        : [row(null, request.dateRange.startDate === '2026-10-01' ? [81, 456, 0.123] : [50, 300, 0.2])], metadata: { currencyCode: 'USD' } };
    },
    ...overrides,
  });
  return { handlers, calls, cache };
}

describe('generic widget configuration', () => {
  it('starts with monthly active users, pageviews and bounce rate, with independent labels and formats', () => {
    const config = normalizeWidgetConfig(defaultWidgetConfig());
    expect(config.metrics.map(item => item.metric)).to.deep.equal(['activeUsers', 'screenPageViews', 'bounceRate']);
    expect(config.period).to.deep.equal({ preset: 'thisMonth' });
    config.metrics[0] = { metric: 'totalRevenue', label: 'Sales', format: 'currency', decimals: 2 };
    expect(normalizeWidgetConfig(config).metrics[0].label).to.equal('Sales');
  });
  it('validates the generic schema before accepting arbitrary metrics, expressions or CSS', () => {
    for (const patch of [
      { metrics: [] }, { metrics: [{ metric: 'SELECT *' }] },
      { metrics: Array.from({ length: 7 }, () => ({ metric: 'activeUsers' })) },
      { metrics: [{ metric: 'activeUsers' }, { metric: 'activeUsers' }] },
      { metrics: [{ metric: 'activeUsers', format: 'percent' }] },
      { accent: '</style><script>bad()</script>' }, { width: 10 }, { comparison: 'true' },
      { sql: 'SELECT * FROM users' }, { filters: { pagePath: 'https://example.com' } },
    ]) expect(() => normalizeWidgetConfig({ ...defaultWidgetConfig(), ...patch })).to.throw();
  });
  it('resolves natural months and month-to-date comparisons in the property timezone', () => {
    expect(resolveWidgetPeriod({ preset: 'thisMonth' }, 'America/Los_Angeles', new Date('2026-03-01T02:00:00Z'))).to.deep.equal({
      range: { startDate: '2026-02-01', endDate: '2026-02-28' }, previous: { startDate: '2026-01-01', endDate: '2026-01-28' },
    });
    expect(resolveWidgetPeriod({ preset: 'lastMonth' }, 'UTC', new Date('2024-03-15T00:00:00Z'))).to.deep.equal({
      range: { startDate: '2024-02-01', endDate: '2024-02-29' }, previous: { startDate: '2024-01-01', endDate: '2024-01-31' },
    });
    const lastYear = resolveWidgetPeriod({ preset: 'thisMonth' }, 'UTC', new Date('2026-01-02T00:00:00Z'));
    expect(lastYear.previous).to.deep.equal({ startDate: '2025-12-01', endDate: '2025-12-02' });
  });
  it('bounds custom report work and rejects future-only or invalid ranges', () => {
    for (const period of [
      { preset: 'custom', startDate: '2026-02-30', endDate: '2026-03-02' },
      { preset: 'custom', startDate: '2024-01-01', endDate: '2026-10-01' },
      { preset: 'custom', startDate: '2027-01-01', endDate: '2027-02-01' },
    ]) expect(() => resolveWidgetPeriod(period, 'UTC', fixed)).to.throw();
  });
  it('generates escaped, responsive iframe code that validates resize messages and supports repeated embeds', () => {
    const config = { ...defaultWidgetConfig(), title: '<script>test</script>"' };
    const code = widgetIframeCode('https://stats.example', '123', { id: 'abcdef123456', config });
    expect(code).to.include('https://stats.example/widget/123/abcdef123456');
    expect(code).to.include('&lt;script&gt;test&lt;/script&gt;&quot;');
    expect(code).to.include('document.currentScript.previousElementSibling');
    expect(code).to.include('event.source !== frame.contentWindow').and.include('event.origin !== "https://stats.example"');
    expect(code).to.include('Math.min(3000, data.height)');
  });
  it('sizes inline iframes to their content without resizing neighbouring or untrusted embeds', () => {
    const config = { ...defaultWidgetConfig(), layout: 'inline', width: 760 };
    const code = widgetIframeCode('https://stats.example', '123', { id: 'abcdef123456', config });
    const script = code.split('<script>')[1].split('</script>')[0];
    const frames = Array.from({ length: 2 }, () => ({ contentWindow: {}, style: { width: '760px', height: '48px' } }));
    const listeners = [];
    for (const frame of frames) vm.runInNewContext(script, {
      document: { currentScript: { previousElementSibling: frame } },
      window: { addEventListener: (name, listener) => listeners.push(listener) },
    });
    const send = (overrides = {}) => listeners.forEach(listener => listener({ source: frames[0].contentWindow, origin: 'https://stats.example', data: { type: 'ga4:widget-size', width: 212, height: 38 }, ...overrides }));
    send({ origin: 'https://untrusted.example' });
    send({ source: {} });
    expect(frames[0].style).to.deep.equal({ width: '760px', height: '48px' });
    send();
    expect(frames[0].style).to.deep.equal({ width: '212px', height: '38px' });
    expect(frames[1].style).to.deep.equal({ width: '760px', height: '48px' });
    send({ data: { type: 'ga4:widget-size', width: 9000, height: 9000 } });
    expect(frames[0].style).to.deep.equal({ width: '1200px', height: '3000px' });
    send({ data: { type: 'ga4:widget-size', width: NaN, height: Infinity } });
    expect(frames[0].style).to.deep.equal({ width: '1200px', height: '3000px' });
  });
});

describe('saved generic widgets', () => {
  let directory, store;
  beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ga4-custom-widgets-')); store = createEmbedStore({ directory, now: () => fixed }); });
  afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });
  it('reuses funnel-style durable definitions, keeps iframe IDs on edit, and scopes each property', async () => {
    const saved = await store.saveWidget('123', defaultWidgetConfig());
    const reopened = createEmbedStore({ directory, now: () => new Date('2026-10-23T00:00:00Z') });
    const edited = await reopened.saveWidget('123', { ...saved.config, title: 'Updated' }, saved.id);
    expect(edited.id).to.equal(saved.id);
    expect(edited.createdAt).to.equal(saved.createdAt);
    expect(edited.updatedAt).not.to.equal(saved.updatedAt);
    expect((await reopened.getWidget('123', saved.id)).config.title).to.equal('Updated');
    expect(await reopened.listWidgets('456')).to.deep.equal([]);
    await reopened.removeWidget('123', saved.id);
    expect(await reopened.getWidget('123', saved.id)).to.equal(null);
  });
  it('preserves widgets, private links and global enablement during concurrent edits', async () => {
    const other = createEmbedStore({ directory, now: () => fixed });
    const results = await Promise.all([
      store.saveWidget('123', defaultWidgetConfig()), other.saveWidget('123', { ...defaultWidgetConfig(), name: 'Second widget' }),
      store.setEnabled('123', true), other.privateLink('123', 'generate_private_link_key'),
    ]);
    expect(await store.listWidgets('123')).to.have.length(2);
    expect((await store.get('123')).privateLinkKey).to.equal(results[3].privateLinkKey);
    expect((await store.get('123')).embedEnabled).to.equal(true);
    const handlers = setup({ store }).handlers;
    const shared = await invoke(handlers.save, { headers: { 'x-private-key': results[3].privateLinkKey } });
    expect(shared.status).to.equal(403);
    expect(await store.listWidgets('123')).to.have.length(2);
  });
  it('reads legacy settings and preserves corrupt definitions rather than overwriting them', async () => {
    await fs.writeFile(path.join(directory, '123.json'), JSON.stringify({ embedEnabled: true, privateLinkKey: null }));
    expect(await store.listWidgets('123')).to.deep.equal([]);
    const raw = JSON.stringify({ embedEnabled: true, privateLinkKey: null, widgets: [{ id: 'abcdef123456', createdAt: 'date', updatedAt: 'date', config: { metrics: [] } }] });
    await fs.writeFile(path.join(directory, '123.json'), raw);
    try { await store.saveWidget('123', defaultWidgetConfig()); throw new Error('Expected failure.'); } catch (error) { expect(error.status).to.equal(503); }
    expect(await fs.readFile(path.join(directory, '123.json'), 'utf8')).to.equal(raw);
  });
});

describe('generic GA4 widget reports', () => {
  it('requests distinct whole-period active users and GA4 rates separately from chart buckets', async () => {
    const { handlers, calls } = setup();
    const result = await invoke(handlers.preview);
    expect(result.status).to.equal(200);
    expect(result.body.data.values).to.deep.equal({ activeUsers: 81, screenPageViews: 456, bounceRate: 12.3 });
    expect(result.body.data.series).to.have.length(22);
    expect(result.body.data.series[21].values).to.deep.equal({ activeUsers: 2, screenPageViews: 6, bounceRate: 50 });
    expect(result.body.data.series[0].values.bounceRate).to.equal(null);
    expect(result.body.data.previous.bounceRate).to.equal(20);
    expect(calls).to.have.length(3);
    expect(calls[0].dimensions).to.deep.equal([]);
    expect(calls[0].metrics.map(metric => metric.name)).to.deep.equal(['activeUsers', 'screenPageViews', 'bounceRate']);
    expect(result.body.data.fetchedAt).to.equal(fixed.toISOString());
  });
  it('uses native monthly active-user buckets for month-by-month trends', async () => {
    const { handlers, calls } = setup();
    const config = { ...defaultWidgetConfig(), bucket: 'month', period: { preset: 'last12Months' } };
    const result = await invoke(handlers.preview, { body: { config } });
    expect(result.body.data.series).to.have.length(12);
    expect(calls.find(call => call.dimensions.length).dimensions).to.deep.equal([{ name: 'yearMonth' }]);
  });
  it('applies exact audience filters to summaries, comparisons and trends', async () => {
    const { handlers, calls } = setup();
    const config = { ...defaultWidgetConfig(), filters: { pagePath: '/pricing', country: 'US', device: 'mobile' } };
    await invoke(handlers.preview, { body: { config } });
    expect(calls.every(call => call.dimensionFilter.andGroup.expressions.map(expression => expression.filter.fieldName).join(',') === 'pagePath,countryId,deviceCategory')).to.equal(true);
  });
  it('shares reports across concurrent iframes and appearance-only changes while preserving fetch times', async () => {
    const { handlers, calls } = setup();
    await Promise.all(Array.from({ length: 12 }, () => invoke(handlers.preview)));
    const result = await invoke(handlers.preview, { body: { config: { ...defaultWidgetConfig(), title: 'Other title', accent: '#112233', theme: 'light' } } });
    expect(calls).to.have.length(3);
    expect(result.body.data.fetchedAt).to.equal(fixed.toISOString());
  });
  it('keeps successful current values when comparison data is unavailable', async () => {
    const { handlers } = setup({ run: async request => request.dateRange.startDate === '2026-09-01'
      ? { ok: false, error: 'Comparison unavailable.' } : { ok: true, rows: [row(null, [1, 2, 0.4])] } });
    const result = await invoke(handlers.preview, { body: { config: { ...defaultWidgetConfig(), showChart: false } } });
    expect(result.body.data.values.activeUsers).to.equal(1);
    expect(result.body.data.previous).to.equal(null);
    expect(result.body.data.comparisonUnavailable).to.equal(true);
  });
  it('retries failed reports and does not turn quota errors into zero metrics', async () => {
    let attempts = 0;
    const { handlers } = setup({ run: async () => { attempts++; return { ok: false, error: 'Quota exhausted.', errorCode: 8 }; } });
    const request = { body: { config: { ...defaultWidgetConfig(), comparison: false, showChart: false } } };
    expect((await invoke(handlers.preview, request)).status).to.equal(429);
    expect((await invoke(handlers.preview, request)).status).to.equal(429);
    expect(attempts).to.equal(2);
  });
  it('blocks shared management requests before reports or definitions are accessed', async () => {
    const { handlers, calls } = setup();
    for (const name of ['list', 'save', 'remove', 'preview']) {
      expect((await invoke(handlers[name], { headers: { 'x-private-site': '123' } })).status).to.equal(403);
    }
    expect(calls).to.have.length(0);
  });
  it('public iframes use only saved metrics and enforce global, per-widget and deletion controls before cached reports', async () => {
    let enabled = true, widget = { id: 'abcdef123456', config: defaultWidgetConfig() };
    const { handlers, calls } = setup({ store: { get: async () => ({ embedEnabled: enabled }), getWidget: async () => widget } });
    const request = { method: 'GET', params: { siteId: '123', widgetId: 'abcdef123456' }, query: { metrics: 'totalRevenue', period: 'all-time' } };
    expect((await invoke(handlers.data, request)).body.config.metrics[0].metric).to.equal('activeUsers');
    enabled = false;
    expect((await invoke(handlers.data, request)).status).to.equal(403);
    enabled = true; widget.config.enabled = false;
    expect((await invoke(handlers.data, request)).status).to.equal(403);
    widget = null;
    expect((await invoke(handlers.data, request)).status).to.equal(404);
    expect(calls).to.have.length(3);
  });
});
