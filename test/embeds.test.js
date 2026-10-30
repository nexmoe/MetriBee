const { expect } = require('chai');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createEmbedStore } = require('../lib/embedStore');
const { createEmbedHandlers } = require('../controllers/embeds');
const { createRybbitHandler } = require('../controllers/rybbit');

const row = (value, users) => ({ dimensionValues: value == null ? [] : [{ value }], metricValues: [{ value: String(users) }] });
const date = new Date('2026-10-22T10:00:00Z');
const properties = async () => ({ properties: [
  { id: '123', site: 'Example', domain: 'example.com', timeZone: 'Asia/Shanghai' },
  { id: '456', site: 'Other', domain: 'other.example', timeZone: 'UTC' },
] });
async function invoke(handler, overrides = {}) {
  const out = { status: 200, headers: {} };
  const res = {
    headers(values) { for (const [key, value] of Object.entries(values)) this.header(key, value); return this; },
    header(name, value) { Object.assign(out.headers, typeof name === 'string' ? { [name]: value } : name); return this; },
    status(code) { out.status = code; return this; },
    type(value) { out.type = value; return this; },
    send(value) { out.body = value; return this; },
  };
  await handler({ method: 'GET', params: { siteId: '123' }, query: {}, headers: {}, ...overrides }, res);
  return out;
}

describe('Rybbit embed settings', () => {
  let directory, store;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ga4-embeds-'));
    store = createEmbedStore({ directory });
  });
  afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

  it('defaults to disabled and preserves both settings across concurrent store instances and restarts', async () => {
    expect(await store.get('123')).to.deep.equal({ embedEnabled: false, privateLinkKey: null });
    const other = createEmbedStore({ directory });
    const [, generated] = await Promise.all([store.setEnabled('123', true), other.privateLink('123', 'generate_private_link_key')]);
    const restarted = createEmbedStore({ directory });
    expect(await restarted.get('123')).to.deep.equal({ embedEnabled: true, ...generated });
    expect(await restarted.validate('123', generated.privateLinkKey)).to.equal(true);
    expect(await restarted.validate('456', generated.privateLinkKey)).to.equal(false);
    expect((await fs.stat(path.join(directory, 'store.sqlite'))).mode & 0o777).to.equal(0o600);
  });
  it('rotates private links and immediately revokes the previous key', async () => {
    const first = await store.privateLink('123', 'generate_private_link_key');
    const second = await store.privateLink('123', 'generate_private_link_key');
    expect(await store.validate('123', first.privateLinkKey)).to.equal(false);
    expect(await store.validate('123', second.privateLinkKey)).to.equal(true);
    await store.privateLink('123', 'revoke_private_link_key');
    expect(await store.validate('123', second.privateLinkKey)).to.equal(false);
  });
  it('persists public access independently of widgets and private links', async () => {
    expect(await store.isPublic('123')).to.equal(false);
    await store.setPublic('123', true);
    const key = await store.privateLink('123', 'generate_private_link_key');
    await store.setEnabled('123', true);
    const restarted = createEmbedStore({ directory });
    expect(await restarted.isPublic('123')).to.equal(true);
    await restarted.setPublic('123', false);
    expect(await restarted.get('123')).to.deep.equal({ embedEnabled: true, ...key });
    expect(await restarted.validate('123', key.privateLinkKey)).to.equal(true);
  });
  it('preserves corrupt settings instead of silently replacing private keys', async () => {
    const file = path.join(directory, '123.json');
    await fs.writeFile(file, '{broken');
    try { await store.setEnabled('123', true); throw new Error('Expected a storage failure.'); }
    catch (error) { expect(error.status).to.equal(503); }
    expect(await fs.readFile(file, 'utf8')).to.equal('{broken');
  });
  it('limits local changes to connected properties and embed settings', async () => {
    const handlers = createEmbedHandlers({ properties, store });
    const result = await invoke(handlers.config, { method: 'PUT', body: { embedEnabled: true } });
    expect(result.status).to.equal(200);
    expect((await store.get('123')).embedEnabled).to.equal(true);
    expect((await invoke(handlers.config, { method: 'PUT', body: { embedEnabled: false, name: 'Renamed' } })).status).to.equal(400);
    expect((await invoke(handlers.config, { method: 'PUT', body: { embedEnabled: 'true' } })).status).to.equal(400);
    expect((await invoke(handlers.config, { method: 'PUT', params: { siteId: '789' }, body: { embedEnabled: true } })).status).to.equal(404);
    expect((await invoke(handlers.config, { method: 'PUT', params: { siteId: '../123' }, body: { embedEnabled: true } })).status).to.equal(400);
  });
  it('never discloses or changes private-link settings to shared visitors', async () => {
    const handlers = createEmbedHandlers({ properties, store });
    const generated = await invoke(handlers.privateLink, { method: 'POST', body: { action: 'generate_private_link_key' } });
    const key = generated.body.data.privateLinkKey;
    expect(key).to.match(/^[a-f0-9]{12}$/);
    expect((await invoke(handlers.privateLink)).body.data.privateLinkKey).to.equal(key);
    const headers = { 'x-private-key': key, 'x-private-site': '123' };
    expect((await invoke(handlers.privateLink, { headers })).status).to.equal(403);
    expect((await invoke(handlers.privateLink, { method: 'POST', headers, body: { action: 'revoke_private_link_key' } })).status).to.equal(403);
    expect((await invoke(handlers.config, { method: 'PUT', headers, body: { embedEnabled: true } })).status).to.equal(403);
    expect((await invoke(handlers.privateLink, { method: 'POST', body: { action: 'unknown' } })).status).to.equal(400);
  });
});

describe('GA4 visitor widgets', () => {
  function setup(overrides = {}) {
    const calls = [], cache = new Map();
    const handlers = createEmbedHandlers({
      properties, now: () => date,
      store: { get: async () => ({ embedEnabled: true }) },
      read: async (namespace, key) => cache.get(`${namespace}:${key}`),
      write: async (namespace, key, value) => { cache.set(`${namespace}:${key}`, value); },
      client: () => ({ runRealtimeReport: async request => {
        calls.push(request);
        const name = request.dimensions[0]?.name;
        return [{ rows: name === 'minutesAgo' ? [row('0', 3), row('29', 9)]
          : name === 'countryId' ? [row('US', 6), row('CN', 12), row('(not set)', 100)] : [row(null, 17)] }];
      } }),
      ...overrides,
    });
    return { handlers, calls };
  }

  it('uses a deduplicated realtime total, pads all 30 minute buckets, and sorts valid countries', async () => {
    const { handlers, calls } = setup();
    const result = await invoke(handlers.stats, { query: { chart: 'true', countries: 'true' } });
    expect(result.status).to.equal(200);
    expect(result.body.count).to.equal(17);
    expect(result.body.series).to.have.length(30);
    expect(result.body.series[0]).to.deep.equal({ time: '2026-10-22 09:31:00', users: 9 });
    expect(result.body.series[1].users).to.equal(0);
    expect(result.body.series[29]).to.deep.equal({ time: '2026-10-22 10:00:00', users: 3 });
    expect(result.body.topCountries).to.deep.equal([{ country: 'CN', users: 12 }, { country: 'US', users: 6 }]);
    expect(calls.find(call => !call.dimensions.length).minuteRanges).to.deep.equal([{ startMinutesAgo: 29, endMinutesAgo: 0 }]);
    expect(result.headers['Cache-Control']).to.equal('public, max-age=60');
  });
  it('coalesces simultaneous iframes and reuses totals across card and inline options', async () => {
    const { handlers, calls } = setup();
    await Promise.all(Array.from({ length: 12 }, () => invoke(handlers.stats, { query: { chart: 'true', countries: 'true' } })));
    await invoke(handlers.stats);
    expect(calls).to.have.length(3);
  });
  it('uses a rolling historical minute filter in the property timezone for both longer windows', async () => {
    for (const minutes of [1440, 10080]) {
      const calls = [];
      const { handlers } = setup({ run: async request => {
        calls.push(request);
        const name = request.dimensions[0]?.name;
        return { ok: true, rows: name === 'dateHour' ? [row('2026102217', 8)]
          : name === 'date' ? [row('20261022', 8)] : name === 'countryId' ? [row('US', 5)] : [row(null, 21)] };
      } });
      const result = await invoke(handlers.stats, { query: { minutes: String(minutes), chart: 'true', countries: 'true' } });
      expect(result.status).to.equal(200);
      expect(result.body.count).to.equal(21);
      expect(result.body.series).to.have.length(minutes === 1440 ? 25 : 8);
      expect(result.body.series.some(point => point.users === 8)).to.equal(true);
      expect(calls).to.have.length(3);
      expect(calls[0].dateRange).to.deep.equal({ startDate: minutes === 1440 ? '2026-10-21' : '2026-10-15', endDate: '2026-10-22' });
      expect(calls[0].dimensionFilter.filter).to.deep.equal({ fieldName: 'dateHourMinute', betweenFilter: {
        fromValue: { int64Value: minutes === 1440 ? '202610211800' : '202610151800' }, toValue: { int64Value: '202610221800' },
      } });
    }
  });
  it('does not call GA4 for disabled widgets or unsupported time windows', async () => {
    const { handlers, calls } = setup({ store: { get: async () => ({ embedEnabled: false }) } });
    expect((await invoke(handlers.stats)).status).to.equal(403);
    expect((await invoke(handlers.widget)).status).to.equal(403);
    expect((await invoke(handlers.stats, { query: { minutes: '31' } })).status).to.equal(400);
    expect(calls).to.have.length(0);
  });
  it('does not cache quota failures or present errors as zero visitors', async () => {
    let attempts = 0;
    const { handlers } = setup({ client: () => ({ runRealtimeReport: async () => {
      attempts++;
      throw Object.assign(new Error('Quota exhausted.'), { code: 8 });
    } }) });
    for (let i = 0; i < 2; i++) {
      const result = await invoke(handlers.stats);
      expect(result.status).to.equal(429);
      expect(result.body).not.to.have.property('count');
      expect(result.headers['Cache-Control']).to.equal('no-store');
    }
    expect(attempts).to.equal(2);
  });
  it('serves the native card and inline markup with safe parameters and frame headers', async () => {
    const { handlers } = setup();
    const card = await invoke(handlers.widget, { query: { chart: 'true', countries: 'true', theme: 'light', accent: '112233' } });
    expect(card.body).to.include('class="w card"').and.include('background: #112233').and.include('background: #ffffff');
    expect(card.body).to.include('id="chart"').and.include('id="countries"').and.include('Powered by');
    expect(card.headers['Content-Security-Policy']).to.equal('frame-ancestors *');
    const inline = await invoke(handlers.widget, { query: { variant: 'inline', minutes: '10080', chart: 'true', countries: 'true', accent: '</style><script>alert(1)</script>' } });
    expect(inline.body).to.include('class="w inline"').and.include('"minutes":30').and.include('"chart":false');
    expect(inline.body).not.to.include('alert(1)');
    expect(inline.body).not.to.include('id="countries"');
  });
});

describe('private dashboard GA4 scope', () => {
  function gateway() {
    return createRybbitHandler({ properties, now: () => date,
      read: async namespace => namespace === 'retention-meta' ? { timeZone: 'UTC' } : null,
      write: async () => {},
      embeds: { store: { isPublic: async () => false, validate: async (id, key) => id === '123' && key === 'abcdef123456' } },
    });
  }
  const headers = { 'x-private-key': 'abcdef123456', 'x-private-site': '123' };
  it('limits organization metadata and permissions to the shared property', async () => {
    const result = await invoke(gateway(), { path: '/organizations/ga4/sites', headers });
    expect(result.body.sites.map(site => site.siteId)).to.deep.equal([123]);
    expect(result.body.sites[0].permissions).to.deep.equal([]);
    const site = await invoke(gateway(), { path: '/sites/123', headers });
    expect(site.body.permissions).to.deep.equal([]);
    expect(site.body).not.to.have.property('privateLinkKey');
  });
  it('rejects mismatched properties, invalid keys, and funnel mutations', async () => {
    expect((await invoke(gateway(), { path: '/sites/456', headers })).status).to.equal(403);
    expect((await invoke(gateway(), { path: '/sites/123', headers: { ...headers, 'x-private-key': '000000000000' } })).status).to.equal(403);
    expect((await invoke(gateway(), { path: '/sites/123/funnels', method: 'POST', headers, body: {} })).status).to.equal(403);
    expect((await invoke(gateway(), { path: '/sites/123/funnels/1', method: 'DELETE', headers })).status).to.equal(403);
  });
});
