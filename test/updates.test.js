const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

function loadUpdates() {
  const filename = path.resolve(__dirname, "../frontend/adapter/updates.ts");
  const compiled = new Module(filename, module);
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  compiled._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
  return compiled.exports;
}

describe("GitHub release update checks", () => {
  let originalWindow, originalFetch, storage, updates, calls;
  const release = tag_name => ({ tag_name, draft: false, prerelease: false });
  beforeEach(() => {
    originalWindow = Object.getOwnPropertyDescriptor(global, "window");
    originalFetch = global.fetch;
    storage = new Map();
    Object.defineProperty(global, "window", { configurable: true, value: { sessionStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    } } });
    updates = loadUpdates();
    calls = [];
    global.fetch = async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify(release("v2.2.0"))); };
  });
  afterEach(() => {
    if (originalWindow) Object.defineProperty(global, "window", originalWindow);
    else delete global.window;
    global.fetch = originalFetch;
  });

  it("compares numeric versions, v-prefixed tags and an installed prerelease correctly", () => {
    for (const [latest, current] of [["2.2.0", "2.1.9"], ["v2.10.0", "2.9.9"], ["3.0.0", "2.99.99"], ["2.1.1", "2.1.0"], ["2.1.0", "2.1.0-beta.1"]]) {
      assert(updates.isNewer(latest, current), `${latest} should be newer than ${current}`);
    }
    for (const [latest, current] of [["2.1.0", "2.1.0"], ["2.1.0", "2.2.0"], ["2.1.0+build.2", "2.1.0+build.1"], ["latest", "2.1.0"], ["2.2.0", "development"], ["2.2.0-beta.1", "2.1.0"]]) {
      assert(!updates.isNewer(latest, current), `${latest} should not trigger an update for ${current}`);
    }
  });
  it("uses a validated release tag for the displayed version and repository release link", () => {
    assert.deepEqual(updates.parseRelease({ ...release("v2.2.0"), name: "Launch", html_url: "https://other.example/" }), {
      version: "2.2.0", url: "https://github.com/nexmoe/MetriBee/releases/tag/v2.2.0",
    });
    assert.equal(updates.parseRelease(release("2.2.0+build.1")).url, "https://github.com/nexmoe/MetriBee/releases/tag/2.2.0%2Bbuild.1");
  });
  it("ignores draft, preview, malformed and missing releases", () => {
    for (const input of [null, [], {}, { ...release("v2.2.0"), draft: true }, { ...release("v2.2.0"), prerelease: true }, release("v2.2.0-rc.1"), release("latest"), release("v2.2"), release("v2.2.0/elsewhere"), release(22)]) {
      assert.equal(updates.parseRelease(input), null);
    }
  });
  it("fetches the public latest release once without credentials and marks the session before sending", async () => {
    global.fetch = async (url, options) => {
      assert.equal(storage.get(updates.VERSION_CHECK_DONE_KEY), "1");
      calls.push({ url, options });
      return new Response(JSON.stringify(release("v2.2.0")));
    };
    const result = await updates.fetchLatestRelease();
    assert.equal(result.version, "2.2.0");
    assert.equal(calls[0].url, "https://api.github.com/repos/nexmoe/MetriBee/releases/latest");
    assert.equal(calls[0].options.credentials, "omit");
    assert.equal(calls[0].options.headers.Accept, "application/vnd.github+json");
    assert(calls[0].options.signal instanceof AbortSignal);
    assert.equal(updates.shouldCheckVersion(), false);
    assert.equal(await updates.fetchLatestRelease(), null);
    assert.equal(calls.length, 1);
  });
  it("does not check again after a reload or a parallel caller in the same page", async () => {
    const first = updates.fetchLatestRelease();
    const second = updates.fetchLatestRelease();
    assert.equal(await second, null);
    assert((await first).version);
    const reloaded = loadUpdates();
    assert.equal(reloaded.shouldCheckVersion(), false);
    assert.equal(await reloaded.fetchLatestRelease(), null);
    assert.equal(calls.length, 1);
  });
  it("fails silently on rate limits, no releases, server errors and invalid JSON without retrying", async () => {
    for (const response of [new Response(null, { status: 403 }), new Response(null, { status: 404 }), new Response(null, { status: 429 }), new Response(null, { status: 503 }), new Response("not JSON")]) {
      storage.clear();
      const check = loadUpdates();
      let count = 0;
      global.fetch = async () => { count++; return response; };
      assert.equal(await check.fetchLatestRelease(), null);
      assert.equal(await check.fetchLatestRelease(), null);
      assert.equal(count, 1);
    }
  });
  it("keeps offline and aborted checks optional and remembers the failed attempt", async () => {
    global.fetch = async () => { calls.push(1); throw new DOMException("Timed out", "TimeoutError"); };
    assert.equal(await updates.fetchLatestRelease(), null);
    assert.equal(updates.shouldCheckVersion(), false);
    assert.equal(await loadUpdates().fetchLatestRelease(), null);
    assert.equal(calls.length, 1);
  });
  it("still attempts once per page when browser storage is blocked", async () => {
    Object.defineProperty(window, "sessionStorage", { get() { throw new Error("Storage blocked"); } });
    assert.equal(updates.shouldCheckVersion(), true);
    assert((await updates.fetchLatestRelease()).version);
    assert.equal(updates.shouldCheckVersion(), false);
    assert.equal(await updates.fetchLatestRelease(), null);
    assert.equal(calls.length, 1);
  });
  it("does not run during server rendering", async () => {
    delete global.window;
    assert.equal(updates.shouldCheckVersion(), false);
    assert.equal(await updates.fetchLatestRelease(), null);
    assert.equal(calls.length, 0);
  });
});
