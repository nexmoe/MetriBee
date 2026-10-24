require('ts-node').register({ transpileOnly: true, files: true });
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const dns = require('node:dns/promises');
const https = require('node:https');
const dnsAdapter = require('../controllers/faviconDns');
const { fetchPublicHttp, isPublicHttpAddress } = require('../controllers/publicHttpFetch');

describe('Rybbit favicon public HTTP transport', () => {
  let originalLookup, originalRequest, requests, response;
  beforeEach(() => {
    originalLookup = dnsAdapter.lookup;
    originalRequest = https.request;
    dnsAdapter.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
    requests = [];
    response = { status: 200, headers: {}, chunks: [Buffer.from('icon')] };
    https.request = (url, options, callback) => {
      requests.push({ url, options });
      const res = Object.assign(Readable.from(response.chunks), { statusCode: response.status, headers: response.headers });
      return Object.assign(new EventEmitter(), { end: () => callback(res) });
    };
  });
  afterEach(() => { dnsAdapter.lookup = originalLookup; https.request = originalRequest; });
  const get = (url = 'https://example.com/') => fetchPublicHttp(new URL(url), { signal: AbortSignal.timeout(1000), maxBytes: 32 });

  it('pins validated DNS answers to the connection and supports large Google headers', async () => {
    assert.equal((await get()).body.toString(), 'icon');
    const options = requests[0].options;
    options.lookup('example.com', {}, (_err, address, family) => { assert.equal(address, '93.184.216.34'); assert.equal(family, 4); });
    assert.equal(options.agent, false);
    assert.equal(options.maxHeaderSize, 65536);
    assert.equal(options.headers['Cache-Control'], 'no-cache');
  });
  it('blocks internal addresses, schemes, nonstandard ports and credentials', async () => {
    for (const url of ['http://127.0.0.1/', 'http://169.254.169.254/', 'http://[::1]/', 'http://[::ffff:7f00:1]/', 'file:///etc/passwd', 'https://example.com:8080/', 'https://user:pass@example.com/', 'https://service.local/']) await assert.rejects(get(url));
    assert.equal(requests.length, 0);
  });
  it('blocks mixed public/private DNS results', async () => {
    dnsAdapter.lookup = async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }];
    await assert.rejects(get(), /Non-public/);
    assert.equal(requests.length, 0);
  });
  it('revalidates redirected addresses', async () => {
    response = { status: 302, headers: { location: 'http://169.254.169.254/latest/' }, chunks: [] };
    await assert.rejects(get(), /Non-public/);
    assert.equal(requests.length, 1);
  });
  it('bounds redirects and response sizes', async () => {
    response = { status: 302, headers: { location: '/next' }, chunks: [] };
    await assert.rejects(get(), /Too many redirects/);
    assert.equal(requests.length, 4);
    response = { status: 200, headers: {}, chunks: [Buffer.alloc(20), Buffer.alloc(20)] };
    await assert.rejects(get(), /Response too large/);
  });
  it('blocks reserved IPv4 and IPv6 ranges without weakening the upstream policy', () => {
    for (const address of ['10.0.0.1', '100.64.0.1', '198.18.0.1', '192.0.2.1', '224.0.0.1', '::1', 'fd00::1', '::ffff:a00:1', '64:ff9b::a00:1', '2001:db8::1', '2002:a00:1']) assert.equal(isPublicHttpAddress(address), false, address);
    for (const address of ['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111']) assert.equal(isPublicHttpAddress(address), true, address);
  });
});

describe('favicon proxy DNS compatibility', () => {
  let originalLookup, originalFetch;
  beforeEach(() => { originalLookup = dns.lookup; originalFetch = global.fetch; });
  afterEach(() => { dns.lookup = originalLookup; global.fetch = originalFetch; });
  it('re-resolves synthetic proxy addresses through a fixed HTTPS DNS endpoint', async () => {
    dns.lookup = async () => [{ address: '198.18.0.67', family: 4 }];
    let requested;
    global.fetch = async (url, options) => { requested = url; assert.equal(options.redirect, 'error'); return { ok: true, json: async () => ({ Status: 0, Answer: [{ type: 1, data: '104.18.32.47' }] }) }; };
    assert.deepEqual(await dnsAdapter.lookup('chatgpt.com', { all: true }), [{ address: '104.18.32.47', family: 4 }]);
    assert.equal(requested.origin, 'https://cloudflare-dns.com');
    assert.equal(requested.searchParams.get('name'), 'chatgpt.com');
  });
  it('does not re-resolve private or already-public DNS answers', async () => {
    global.fetch = async () => { throw new Error('must not use fallback'); };
    for (const address of ['127.0.0.1', '10.0.0.1', '93.184.216.34']) {
      dns.lookup = async () => [{ address, family: 4 }];
      assert.deepEqual(await dnsAdapter.lookup('example.com', { all: true }), [{ address, family: 4 }]);
    }
  });
});
