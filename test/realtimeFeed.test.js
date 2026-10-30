const { expect } = require("chai");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

// Exercise the actual route/cache code with an isolated GA4 client and disk.
function fixture(run, ids = ["1", "2"]) {
  const filename = path.resolve(__dirname, "../controllers/apiController.js");
  const local = Module.createRequire(filename);
  const properties = ids.map(id => ({ id, site: `Site ${id}`, accountId: "10", accountName: "Sites" }));
  const writes = [];
  let clock = Date.now();
  class Clock extends Date { static now() { return clock; } }
  const dependencies = id => {
    if (id === "fs/promises") return {
      readFile: async file => {
        if (file.endsWith("properties.json")) return JSON.stringify({ properties, lastUpdated: new Date().toISOString() });
        throw new Error("ENOENT");
      },
      mkdir: async () => {},
      writeFile: async (file, value) => { writes.push({ file, value: JSON.parse(value) }); },
    };
    if (id === "./ga4Service") return { getGA4DataClient: () => ({ runRealtimeReport: run }) };
    return local(id);
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", "__dirname", "Date", "console", fs.readFileSync(filename, "utf8"))(
    dependencies, mod, mod.exports, path.dirname(filename), Clock, { ...console, error() {}, warn() {} }
  );
  return {
    writes,
    advance: ms => { clock += ms; },
    async request() {
      const result = { status: 200, headers: {} };
      const res = {
        status(code) { result.status = code; return this; },
        headers(values) { for (const [key, value] of Object.entries(values)) this.header(key, value); return this; },
        header(name, value) { result.headers[name] = value; return this; },
        send(body) { result.body = body; return this; },
      };
      await mod.exports.realtimeAllApi({ query: {} }, res);
      return result;
    },
  };
}
const disconnected = () => Object.assign(new Error("Client network socket disconnected before secure TLS connection was established"), { code: "ECONNRESET" });

describe("Realtime feed failures and recovery", () => {
  it("returns unavailable instead of successful zero traffic when every GA4 request fails", async () => {
    const feed = fixture(async () => { throw disconnected(); });
    const result = await feed.request();
    expect(result.status).to.equal(503);
    expect(result.headers["Cache-Control"]).to.equal("no-store");
    expect(result.body).to.include({ ok: false, code: "ga4_unavailable", fetchedAt: null });
    expect(result.body.error).to.match(/connect.*GA4/i);
    expect(result.body.data).to.have.length(2);
    expect(result.body.data.every(row => row.error && row.activeUsers == null)).to.equal(true);
    expect(feed.writes).to.have.length(0);
  });

  it("keeps successful zero traffic distinct from unavailable data", async () => {
    let calls = 0;
    const feed = fixture(async () => { calls++; return [{ rows: [] }]; });
    const result = await feed.request();
    expect(result.status).to.equal(200);
    expect(result.body.ok).to.equal(true);
    expect(result.body.data.map(row => row.activeUsers)).to.deep.equal([0, 0]);
    expect((await feed.request()).body.cached).to.equal(true);
    expect(calls).to.equal(2);
  });

  it("preserves the last successful disk snapshot and rechecks an outage after ten seconds", async () => {
    let failed = false, calls = 0;
    const feed = fixture(async () => { calls++; if (failed) throw disconnected(); return [{ rows: [] }]; });
    await feed.request();
    await new Promise(resolve => setImmediate(resolve));
    const successfulWrite = feed.writes.at(-1);
    failed = true;
    feed.advance(120_001);
    expect((await feed.request()).status).to.equal(503);
    await new Promise(resolve => setImmediate(resolve));
    expect(feed.writes.at(-1)).to.equal(successfulWrite);
    const afterFailure = calls;
    expect((await feed.request()).status).to.equal(503);
    expect(calls).to.equal(afterFailure); // No request storm during the short cooldown.
    failed = false;
    feed.advance(10_001);
    expect((await feed.request()).status).to.equal(200);
    expect(calls).to.equal(afterFailure + 2);
  });

  it("shares one refresh between simultaneous requests", async () => {
    let release, calls = 0;
    const gate = new Promise(resolve => { release = resolve; });
    const feed = fixture(async () => { calls++; await gate; return [{ rows: [] }]; });
    const first = feed.request(), second = feed.request();
    await new Promise(resolve => setImmediate(resolve));
    release();
    const results = await Promise.all([first, second]);
    expect(results.map(result => result.status)).to.deep.equal([200, 200]);
    expect(calls).to.equal(2);
  });

  it("retries a local connection reset once and recovers from that first failure", async () => {
    let calls = 0;
    const feed = fixture(async () => { if (++calls === 1) throw disconnected(); return [{ rows: [] }]; }, ["1"]);
    expect((await feed.request()).status).to.equal(200);
    expect(calls).to.equal(2);
  });

  it("retains permission failures and never retries quota or permission errors", async () => {
    for (const code of [7, 8]) {
      let calls = 0;
      const feed = fixture(async () => { calls++; throw Object.assign(new Error("GA4 request denied"), { code }); });
      const result = await feed.request();
      expect(result.status).to.equal(503);
      expect(result.body.data).to.have.length(2);
      expect(calls).to.equal(2);
    }
  });

  it("retains the available subset when another property fails", async () => {
    const feed = fixture(async request => {
      if (request.property === "properties/2") throw Object.assign(new Error("Permission denied"), { code: 7 });
      return [{ rows: [] }];
    });
    const result = await feed.request();
    expect(result.status).to.equal(200);
    expect(result.body.status).to.equal("partial");
    expect(result.body.data).to.have.length(2);
    expect(result.body.data.find(row => row.propertyId === "1").activeUsers).to.equal(0);
    expect(result.body.data.find(row => row.propertyId === "2").error).to.equal(true);
  });
});
