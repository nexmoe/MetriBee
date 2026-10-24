require('ts-node').register({ transpileOnly: true, files: true });
const assert = require('node:assert/strict');
const http = require('../controllers/publicHttpFetch');
const { FaviconService, normalizeFaviconDomain } = require('../controllers/rybbitFavicon');
const { createFaviconHandler } = require('../controllers/favicons');
const png = Buffer.from('89504e470d0a1a0a', 'hex');

function reply() {
  return { headers: {}, statusCode: 200,
    set(k, v) { this.headers[k] = v; return this; },
    status(v) { this.statusCode = v; return this; },
    type(v) { this.headers['Content-Type'] = v; return this; },
    send(v) { this.body = v; return this; }, json(v) { this.body = v; return this; } };
}

describe('Rybbit native favicon service', () => {
  let originalFetch, originalNow, time, calls;
  beforeEach(() => {
    originalFetch = http.fetchPublicHttp;
    originalNow = Date.now;
    time = originalNow();
    Date.now = () => time;
    calls = [];
    http.fetchPublicHttp = async url => {
      calls.push(url.href);
      return { url, status: 200, headers: {}, body: url.pathname === '/' ? Buffer.from('<link rel="icon" href="/icon.png">') : png };
    };
  });
  afterEach(() => { http.fetchPublicHttp = originalFetch; Date.now = originalNow; });

  it('discovers the actual site icon and shares requests/cache across callers', async () => {
    const service = new FaviconService();
    const [a, b] = await Promise.all([service.get('example.com'), service.get('example.com')]);
    assert.equal(a, b);
    assert.deepEqual(a.icon.body, png);
    assert.equal(a.icon.contentType, 'image/png');
    assert.deepEqual(calls, ['https://example.com/', 'https://example.com/icon.png']);
    await service.get('example.com');
    assert.equal(calls.length, 2);
    time += 3600000;
    await service.get('example.com');
    assert.equal(calls.length, 4);
  });

  it('uses the final homepage URL, HTML base, and decoded query attributes', async () => {
    http.fetchPublicHttp = async url => {
      calls.push(url.href);
      return calls.length === 1 ? { url: new URL('https://www.example.com/app/'), status: 200,
        body: Buffer.from('<base href="/assets/"><link href="icon.png?a=1&amp;b=2" rel="shortcut icon">') }
        : { url, status: 200, body: png };
    };
    await new FaviconService().get('example.com');
    assert.equal(calls[1], 'https://www.example.com/assets/icon.png?a=1&b=2');
  });

  it('accepts a real 16px favicon instead of discarding small icons', async () => {
    const ico = Buffer.from([0, 0, 1, 0, 1, 0, 16]);
    http.fetchPublicHttp = async url => ({ url, status: 200, body: ico });
    assert.equal((await new FaviconService().get('example.com')).icon.contentType, 'image/x-icon');
  });

  it('falls back for bot-blocked sites without serving their HTML error pages', async () => {
    http.fetchPublicHttp = async url => {
      calls.push(url.href);
      return { url, status: 200, body: url.hostname === 'www.google.com' ? png : Buffer.from('<html>Access denied</html>') };
    };
    const result = await new FaviconService().get('chatgpt.com');
    assert.deepEqual(result.icon.body, png);
    assert.ok(calls.at(-1).startsWith('https://www.google.com/s2/favicons?domain=chatgpt.com'));
  });

  it('keeps a subdomain icon when one is available', async () => {
    const result = await new FaviconService().get('desktop.vidbee.org');
    assert.deepEqual(result.icon.body, png);
    assert.deepEqual(calls, ['https://desktop.vidbee.org/', 'https://desktop.vidbee.org/icon.png']);
  });

  it('falls back to the main domain and shares its requests and cached icon across subdomains', async () => {
    http.fetchPublicHttp = async url => {
      calls.push(url.href);
      return { url, status: url.hostname === 'vidbee.org' ? 200 : 404,
        body: url.pathname === '/favicon.ico' ? png : Buffer.from('<html></html>') };
    };
    const service = new FaviconService();
    const [desktop, app] = await Promise.all([service.get('desktop.vidbee.org'), service.get('app.vidbee.org')]);
    assert.deepEqual(desktop.icon.body, png);
    assert.equal(desktop, app);
    assert.equal(await service.get('vidbee.org'), desktop);
    assert.equal(calls.filter(url => url === 'https://vidbee.org/').length, 1);
    assert.equal(calls.filter(url => url === 'https://vidbee.org/favicon.ico').length, 1);
    const count = calls.length;
    assert.equal(await service.get('desktop.vidbee.org'), desktop);
    assert.equal(calls.length, count);

    time += 1800000;
    assert.equal((await service.get('mobile.vidbee.org')).expiresAt, desktop.expiresAt);
    time = desktop.expiresAt;
    assert.ok((await service.get('mobile.vidbee.org')).expiresAt > desktop.expiresAt);
    assert.equal(calls.filter(url => url === 'https://vidbee.org/').length, 2);
  });

  for (const [subdomain, mainDomain] of [
    ['desktop.example.co.uk', 'example.co.uk'],
    ['static.team.github.io', 'team.github.io'],
  ]) {
    it(`respects the public suffix boundary when falling back from ${subdomain}`, async () => {
      http.fetchPublicHttp = async url => {
        calls.push(url.href);
        return { url, status: url.hostname === mainDomain ? 200 : 404,
          body: url.pathname === '/favicon.ico' ? png : Buffer.from('<html></html>') };
      };
      assert.deepEqual((await new FaviconService().get(subdomain)).icon.body, png);
      assert.ok(calls.includes(`https://${mainDomain}/favicon.ico`));
      assert.ok(calls.every(value => {
        const url = new URL(value);
        return [subdomain, mainDomain].includes(url.searchParams.get('domain') || url.hostname);
      }));
    });
  }

  it('stops at the main domain when neither domain has an icon and retries after five minutes', async () => {
    let valid = false;
    http.fetchPublicHttp = async url => {
      calls.push(url.href);
      return { url, status: valid && url.hostname === 'vidbee.org' ? 200 : 404,
        body: url.pathname === '/favicon.ico' ? png : Buffer.from('<html></html>') };
    };
    const service = new FaviconService();
    assert.equal((await service.get('desktop.vidbee.org')).icon, null);
    assert.ok(calls.includes('https://vidbee.org/'));
    assert.equal(calls.length, 6);
    const count = calls.length;
    valid = true;
    assert.equal((await service.get('desktop.vidbee.org')).icon, null);
    assert.equal(calls.length, count);
    time += 300000;
    assert.deepEqual((await service.get('desktop.vidbee.org')).icon.body, png);
  });

  it('retries missing icons after five minutes, without caching HTML as an image', async () => {
    let valid = false;
    http.fetchPublicHttp = async url => { calls.push(url.href); return { url, status: 200, body: valid ? png : Buffer.from('<html>blocked</html>') }; };
    const service = new FaviconService();
    assert.equal((await service.get('example.com')).icon, null);
    const count = calls.length;
    valid = true;
    assert.equal((await service.get('example.com')).icon, null);
    assert.equal(calls.length, count);
    time += 300000;
    assert.deepEqual((await service.get('example.com')).icon.body, png);
  });

  it('still tries the cached favicon when native discovery exhausts its deadline', async () => {
    const originalTimeout = AbortSignal.timeout;
    const controller = new AbortController();
    let timeouts = 0;
    AbortSignal.timeout = ms => ++timeouts === 1 ? controller.signal : originalTimeout(ms);
    http.fetchPublicHttp = async (url, { signal }) => {
      if (url.hostname === 'www.google.com') {
        signal.throwIfAborted();
        return { url, status: 200, body: png };
      }
      controller.abort(new Error('Homepage timed out'));
      signal.throwIfAborted();
    };
    try {
      assert.deepEqual((await new FaviconService().get('example.com')).icon.body, png);
    } finally { AbortSignal.timeout = originalTimeout; }
  });

  it('queues site lists beyond the concurrency limit instead of dropping icons', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let active = 0, peak = 0;
    http.fetchPublicHttp = async url => {
      if (url.pathname === '/') { active++; peak = Math.max(peak, active); await gate; active--; }
      return { url, status: 200, body: url.pathname === '/' ? Buffer.from('<link rel="icon" href="/icon.png">') : png };
    };
    const service = new FaviconService();
    const pending = Array.from({ length: 25 }, (_, i) => service.get(`site${i}.example.com`));
    assert.equal(peak, 20);
    release();
    assert.ok((await Promise.all(pending)).every(entry => entry.icon));
  });

  it('releases concurrency slots before sharing a main-domain fallback for a large site list', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let active = 0, peak = 0;
    http.fetchPublicHttp = async url => {
      calls.push(url.href);
      if (url.pathname === '/') { active++; peak = Math.max(peak, active); await gate; active--; }
      return { url, status: url.hostname === 'vidbee.org' ? 200 : 404,
        body: url.pathname === '/favicon.ico' ? png : Buffer.from('<html></html>') };
    };
    const service = new FaviconService();
    const pending = Array.from({ length: 25 }, (_, i) => service.get(`site${i}.vidbee.org`));
    assert.equal(peak, 20);
    release();
    assert.ok((await Promise.all(pending)).every(entry => entry.icon));
    assert.equal(calls.filter(url => url === 'https://vidbee.org/').length, 1);
    assert.equal(peak, 20);
  });

  it('normalizes domain names and rejects URL, path, port and credential input', () => {
    assert.equal(normalizeFaviconDomain(' Example.com. '), 'example.com');
    for (const value of [undefined, ['example.com'], 'gemini', 'https://example.com', 'example.com/path', 'user@example.com', 'example.com:8080']) assert.equal(normalizeFaviconDomain(value), null);
  });

  it('serves image bytes with remaining cache lifetime and SVG isolation', async () => {
    let requested;
    const handler = createFaviconHandler({ get: async domain => { requested = domain; return { icon: { body: png, contentType: 'image/png' }, expiresAt: time + 60000 }; } });
    const res = reply();
    await handler({ query: { domain: 'Example.com.' } }, res);
    assert.equal(requested, 'example.com');
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, png);
    assert.equal(res.headers['Cache-Control'], 'public, max-age=60, must-revalidate');
    assert.equal(res.headers['Content-Security-Policy'], "default-src 'none'; sandbox");
    assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  });

  it('does not fetch malformed domains or browser-cache missing icons', async () => {
    let calls = 0;
    const handler = createFaviconHandler({ get: async () => { calls++; return { icon: null }; } });
    const invalid = reply();
    await handler({ query: { domain: 'https://example.com' } }, invalid);
    assert.equal(invalid.statusCode, 400);
    assert.equal(calls, 0);
    const missing = reply();
    await handler({ query: { domain: 'example.com' } }, missing);
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.headers['Cache-Control'], 'no-store');
  });
});
