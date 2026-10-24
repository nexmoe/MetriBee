const { expect } = require("chai");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

function fixture({ age = 10 * 60_000, fail = false, waitForAdmin, empty = false } = {}) {
  const filename = path.resolve(__dirname, "../controllers/apiController.js");
  const local = Module.createRequire(filename);
  let disk = {
    properties: [
      {
        id: "123",
        site: "Old name",
        accountId: "10",
        accountName: "Old account",
      },
    ],
    lastUpdated: new Date(Date.now() - age).toISOString(),
  };
  let calls = 0;
  if (empty) disk.properties = [];
  const admin = {
    listAccounts: async () => {
      calls++;
      if (waitForAdmin) await waitForAdmin;
      if (fail) throw new Error("Admin unavailable");
      return [[{ name: "accounts/10", displayName: "Renamed account" }]];
    },
    listProperties: async () => [
      [{ name: "properties/123", displayName: "Renamed property" }],
    ],
    listDataStreams: async () => [
      [
        {
          type: "WEB_DATA_STREAM",
          webStreamData: { defaultUri: "https://example.com" },
        },
      ],
    ],
  };
  const dependencies = (id) =>
    id === "fs/promises"
      ? {
          readFile: async () => JSON.stringify(disk),
          mkdir: async () => {},
          writeFile: async (_file, value) => {
            disk = JSON.parse(value);
          },
        }
      : id === "./ga4Service"
      ? { getGA4AdminClient: () => admin }
      : local(id);
  const mod = { exports: {} };
  new Function(
    "require",
    "module",
    "exports",
    "__dirname",
    "console",
    fs.readFileSync(filename, "utf8")
  )(dependencies, mod, mod.exports, path.dirname(filename), {
    ...console,
    error() {},
  });
  return { api: mod.exports, calls: () => calls };
}

describe("property metadata synchronization", () => {
  it("still waits for real metadata on a cold start or an explicit manual sync", async () => {
    for (const empty of [false, true]) {
      let release, result;
      const waitForAdmin = new Promise(resolve => { release = resolve; });
      const f = fixture({ empty, waitForAdmin });
      const request = f.api.ensureProperties(empty ? {} : { force: true }).then(value => { result = value; });
      try {
        await new Promise(setImmediate);
        expect(result).to.equal(undefined);
      } finally { release(); await request; }
      expect(result.source).to.equal("fetched");
      expect(result.properties[0].site).to.equal("Renamed property");
    }
  });
  it("serves cached metadata immediately while a slow Admin refresh is in flight", async () => {
    let release;
    const waitForAdmin = new Promise(resolve => { release = resolve; });
    const f = fixture({ waitForAdmin });
    let result;
    const request = f.api.ensureProperties().then(value => { result = value; });
    try {
      await new Promise(setImmediate);
      expect(result?.source).to.equal("stale");
      expect(result.revalidateUntil).to.be.greaterThan(Date.now());
      expect(result.properties[0].site).to.equal("Old name");
      const concurrent = await f.api.ensureProperties();
      expect(concurrent.source).to.equal("stale");
      expect(f.calls()).to.equal(1);
    } finally {
      release();
      await request;
    }
    await new Promise(setImmediate);
    expect((await f.api.ensureProperties()).properties[0].site).to.equal("Renamed property");
    expect(f.calls()).to.equal(1);
  });
  it("refreshes renamed properties automatically when normal page/API callers read an expired cache", async () => {
    const f = fixture();
    const cached = await f.api.ensureProperties();
    expect(cached.source).to.equal("stale");
    expect(cached.properties[0].site).to.equal("Old name");
    await new Promise(setImmediate);
    const result = await f.api.ensureProperties();
    expect(result.properties[0]).to.include({
      site: "Renamed property",
      accountName: "Renamed account",
    });
    expect(f.calls()).to.equal(1);
  });
  it("keeps fresh metadata cached and coalesces concurrent expired reads", async () => {
    const fresh = fixture({ age: 60_000 });
    expect((await fresh.api.ensureProperties()).source).to.equal("cached");
    expect(fresh.calls()).to.equal(0);
    const stale = fixture();
    const results = await Promise.all([
      stale.api.ensureProperties(),
      stale.api.ensureProperties(),
    ]);
    expect(
      results.every(
        (result) => result.properties[0].site === "Old name"
      )
    ).to.equal(true);
    await new Promise(setImmediate);
    expect((await stale.api.ensureProperties()).properties[0].site).to.equal("Renamed property");
    expect(stale.calls()).to.equal(1);
  });
  it("keeps the last known names on failure and backs off automatic refresh retries", async () => {
    const f = fixture({ fail: true });
    expect((await f.api.ensureProperties()).source).to.equal("stale");
    await new Promise(setImmediate);
    expect((await f.api.ensureProperties()).properties[0].site).to.equal(
      "Old name"
    );
    expect(f.calls()).to.equal(1);
  });
  it("lets manual sync bypass a fresh cache and returns the updated property list", async () => {
    const f = fixture({ age: 0 });
    let body;
    await f.api.refreshCache(
      {},
      {
        json(value) {
          body = value;
        },
      }
    );
    expect(body.ok).to.equal(true);
    expect(body.properties[0].site).to.equal("Renamed property");
    expect(f.calls()).to.equal(1);
  });
  it("does not report a successful manual sync when GA4 Admin is unavailable", async () => {
    const f = fixture({ fail: true });
    const result = {};
    await f.api.refreshCache(
      {},
      {
        status(value) {
          result.status = value;
          return this;
        },
        json(value) {
          result.body = value;
        },
      }
    );
    expect(result.status).to.equal(502);
    expect(result.body.ok).to.equal(false);
    expect((await f.api.ensureProperties()).properties[0].site).to.equal(
      "Old name"
    );
  });
});
