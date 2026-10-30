const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../lib/database');
const { publicPageSite, publicApiSite } = require('../lib/publicDashboard');

function integrationTests() {
describe('Public dashboards / Fastify authorization', function () {
  this.timeout(30000);
  let app, runtime, db, directory, previousDemo, owner, viewer, outsider, organizationId, first, second;
  const call = (actor, method, url, payload, headers = {}) => app.inject({
    method, url, payload,
    headers: { origin: 'http://localhost:5483', ...(actor ? { cookie: actor.cookie } : {}), ...headers },
  });
  const site = (id = first) => `/api/rybbit/sites/${id}`;
  async function register(email) {
    const response = await call(null, 'POST', '/api/auth/sign-up/email', { email, name: email, password: 'initial-password' });
    assert.equal(response.statusCode, 200, response.body);
    return { ...response.json().user, cookie: response.headers['set-cookie'][0].split(';')[0] };
  }
  async function configure(enabled) {
    const response = await call(owner, 'PUT', `${site()}/config`, { public: enabled });
    assert.equal(response.statusCode, 200, response.body);
  }
  const bootstrap = response => JSON.parse(response.body.match(/window\.__GA4_CONTEXT__=(.*?);<\/script>/)[1]);
  before(async () => {
    previousDemo = process.env.DEMO;
    process.env.DEMO = '1';
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'metribee-public-'));
    db = openDatabase(path.join(directory, 'app.sqlite'));
    runtime = await (await import('../lib/auth.mjs')).createAuthentication({
      db, env: { PORT: '5483' }, mailer: { configured: false, send: async () => {} },
    });
    app = await require('../app').createApp({ authRuntime: runtime });
    runtime.access.syncProperties((await require('../controllers/apiController').ensureProperties({ force: true })).properties);
    owner = await register('public-owner@example.com');
    organizationId = db.prepare('SELECT id FROM organization').get().id;
    [first, second] = db.prepare('SELECT propertyId FROM property_access ORDER BY propertyId LIMIT 2').all().map(p => p.propertyId);
    viewer = await register('public-viewer@example.com');
    outsider = await register('public-outsider@example.com');
    const member = await call(owner, 'POST', `/api/rybbit/organizations/${organizationId}/members`, { email: viewer.email, role: 'viewer' });
    assert.equal(member.statusCode, 200, member.body);
  });
  after(async () => {
    await app?.close();
    db?.close();
    await fs.rm(directory, { recursive: true, force: true });
    if (previousDemo === undefined) delete process.env.DEMO;
    else process.env.DEMO = previousDemo;
  });

  it('keeps private properties closed and restricts public configuration to authorized users', async () => {
    assert.equal((await call(null, 'GET', `${site()}/overview`)).statusCode, 401);
    assert.equal((await call(null, 'GET', `/${first}/main`)).headers.location, '/login');
    assert.equal((await call(viewer, 'PUT', `${site()}/config`, { public: true })).statusCode, 403);
    assert.equal((await call(outsider, 'PUT', `${site()}/config`, { public: true })).statusCode, 403);
    for (const body of [{ public: 'true' }, { public: true, embedEnabled: true }, { public: true, tags: [] }]) {
      assert.equal((await call(owner, 'PUT', `${site()}/config`, body)).statusCode, 400);
    }
    assert.equal((await call(owner, 'GET', site())).json().public, false);
    await configure(true);
    assert.equal((await call(owner, 'GET', `${site()}/is-public`)).json().isPublic, true);
  });

  it('opens native and adapted report URLs with only one property in the HTML bootstrap', async () => {
    for (const url of [`/${first}`, `/${first}/main`, `/zh/${first}/pages`, `/analytics?prop=${first}`, `/events?prop=${first}`, `/${first}/goals`]) {
      const response = await call(null, 'GET', url);
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.headers['cache-control'], 'no-store');
      const context = bootstrap(response);
      assert.equal(context.publicSiteId, first);
      assert.deepEqual(context.properties.map(p => String(p.id)), [first]);
      assert.equal(context.properties[0].accountName, undefined);
      assert.equal(context.authScope, null);
    }
    const response = await call(outsider, 'GET', `/${first}/main`);
    assert.equal(response.statusCode, 200);
    assert.equal(bootstrap(response).publicSiteId, first);
    assert.equal(bootstrap(await call(owner, 'GET', `/${first}/main`)).publicSiteId, undefined);
    for (const url of [`/analytics?prop=${second}`, `/${second}/main`, `/${first}/main?prop=${second}`, `/analytics?prop=${first}&prop=${second}`]) {
      assert.equal((await call(null, 'GET', url)).statusCode, 302, url);
    }
  });

  it('serves anonymous reports with no workspace permissions or account metadata', async () => {
    const metadata = await call(null, 'GET', site());
    assert.equal(metadata.statusCode, 200, metadata.body);
    assert.equal(metadata.json().public, true);
    assert.deepEqual(metadata.json().permissions, []);
    for (const key of ['role', 'organizationId', 'accountId', 'accountName']) assert.equal(metadata.json()[key], null);
    assert.equal(metadata.json().embedEnabled, undefined);
    for (const action of ['overview', 'overview/time-series', 'metric?parameter=country', 'pages', 'events/overview', 'goals/summary', 'funnels', 'journeys/capabilities', 'live-user-count']) {
      const response = await call(null, 'GET', `${site()}/${action}`);
      assert.equal(response.statusCode, 200, `${action}: ${response.body}`);
      assert.equal(response.headers['cache-control'], 'no-store');
    }
    const gsc = await call(null, 'GET', `${site()}/gsc/connection`);
    assert.equal(gsc.statusCode, 200);
    assert.equal(gsc.json().connected, false);
    const analyze = await call(null, 'POST', `${site()}/funnels/analyze`, { steps: [] });
    assert.ok([400, 422].includes(analyze.statusCode), analyze.body);
  });

  it('does not expose management, other properties, aggregate APIs or write operations', async () => {
    for (const url of [`${site()}/config`, `${site()}/private-link-config`, `${site()}/widgets`, `${site()}/dashboards`, `${site()}/export/pdf`, `${site()}/gsc/data`, `${site(second)}/overview`, '/api/nav-index', '/api/realtime-all', '/api/globe-users', '/api/sites-snapshot', '/api/quota', `/api/rybbit/organizations/${organizationId}/sites`, '/api/rybbit/admin/sites', `/api/pages-report/${first}`]) {
      assert.equal((await call(null, 'GET', url)).statusCode, 401, url);
    }
    for (const [method, action, payload] of [['PUT', 'config', { public: false }], ['POST', 'goals', {}], ['POST', 'funnels', {}], ['DELETE', 'funnels/1', undefined], ['POST', 'segments', {}]]) {
      assert.equal((await call(null, method, `${site()}/${action}`, payload)).statusCode, 401, action);
    }
    assert.equal((await call(null, 'GET', `${site(second)}/overview`, undefined, { 'x-public-site': first })).statusCode, 401);
    assert.equal((await call(null, 'GET', `${site()}/overview`, undefined, { authorization: 'Bearer invalid' })).statusCode, 401);
    assert.equal((await call(null, 'GET', `${site()}/overview`, undefined, { 'x-private-site': first, 'x-private-key': '0'.repeat(12) })).statusCode, 403);
    assert.equal(publicPageSite('/analytics', { prop: [first, second] }), null);
    assert.equal(publicApiSite(`${site()}/config`, 'GET'), null);
  });

  it('only exposes public saved segments and annotations', async () => {
    const filters = [{ parameter: 'country', type: 'equals', value: ['US'] }];
    const publicSegment = await call(owner, 'POST', `${site()}/segments`, { name: 'Public segment', filters, isPublic: true });
    const privateSegment = await call(owner, 'POST', `${site()}/segments`, { name: 'Private segment', filters, isPublic: false });
    assert.equal(publicSegment.statusCode, 200, publicSegment.body);
    assert.equal(privateSegment.statusCode, 200, privateSegment.body);
    const result = await call(null, 'GET', `${site()}/segments`);
    assert.equal(result.statusCode, 200, result.body);
    assert.ok(!JSON.stringify(result.json()).includes('Private segment'));
    assert.ok(JSON.stringify(result.json()).includes('Public segment'));
    const id = privateSegment.json().segmentId;
    assert.equal((await call(null, 'GET', `${site()}/segments/${id}`)).statusCode, 404);
    assert.equal((await call(null, 'GET', `${site()}/overview?segment_id=${id}`)).statusCode, 404);
    for (const isPublic of [false, true]) {
      const saved = await call(owner, 'POST', `${site()}/annotations`, { title: isPublic ? 'Public launch' : 'Private launch', date: '2026-10-10T10:00:00Z', isPublic });
      assert.equal(saved.statusCode, 200, saved.body);
    }
    const annotations = await call(null, 'GET', `${site()}/annotations`);
    assert.equal(annotations.statusCode, 200, annotations.body);
    assert.ok(annotations.body.includes('Public launch'));
    assert.ok(!annotations.body.includes('Private launch'));
    assert.ok(!annotations.body.includes(owner.id));
    assert.ok(!annotations.body.includes(organizationId));
  });

  it('revokes anonymous access before cached reports and preserves independent private links/widgets', async () => {
    const generated = await call(owner, 'POST', `${site()}/private-link-config`, { action: 'generate_private_link_key' });
    const key = generated.json().data.privateLinkKey;
    assert.equal(generated.statusCode, 200, generated.body);
    assert.equal((await call(owner, 'PUT', `${site()}/config`, { embedEnabled: true })).statusCode, 200);
    await configure(false);
    assert.equal((await call(null, 'GET', `${site()}/overview`)).statusCode, 401);
    assert.equal((await call(null, 'GET', `/${first}/main`)).headers.location, '/login');
    const headers = { 'x-private-site': first, 'x-private-key': key };
    assert.equal((await call(null, 'GET', `${site()}/overview`, undefined, headers)).statusCode, 200);
    assert.equal((await call(null, 'GET', `/${first}/${key}/main`)).statusCode, 200);
    assert.equal((await call(null, 'GET', `/widget/${first}`)).statusCode, 200);
    assert.equal((await call(owner, 'GET', `${site()}/private-link-config`)).json().data.privateLinkKey, key);
    await configure(true);
    await call(owner, 'POST', `${site()}/private-link-config`, { action: 'revoke_private_link_key' });
    assert.equal((await call(null, 'GET', `${site()}/overview`, undefined, headers)).statusCode, 403);
    assert.equal((await call(null, 'GET', `${site()}/overview`)).statusCode, 200);
  });
});

}
if (process.env.METRIBEE_PUBLIC_TEST_CHILD === '1') integrationTests();
else describe('Public dashboards (isolated demo runtime)', function () {
  this.timeout(30000);
  it('enforces anonymous dashboard boundaries without sharing live property caches', async () => {
    await require('node:util').promisify(require('node:child_process').execFile)(process.execPath,
      [require.resolve('mocha/bin/mocha.js'), '--require', 'ts-node/register/transpile-only', __filename, '--reporter', 'dot'],
      { cwd: path.resolve(__dirname, '..'), env: { ...process.env, DEMO: '1', METRIBEE_PUBLIC_TEST_CHILD: '1' } })
      .catch(error => { throw new Error(error.stdout + '\n' + error.stderr); });
  });
});
