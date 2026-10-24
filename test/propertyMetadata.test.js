const { expect } = require("chai");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

function fixture({ age = 10 * 60_000, fail = false } = {}) {
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
  const admin = {
    listAccounts: async () => {
      calls++;
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
  it("refreshes renamed properties automatically when normal page/API callers read an expired cache", async () => {
    const f = fixture();
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
        (result) => result.properties[0].site === "Renamed property"
      )
    ).to.equal(true);
    expect(stale.calls()).to.equal(1);
  });
  it("keeps the last known names on failure and backs off automatic refresh retries", async () => {
    const f = fixture({ fail: true });
    expect((await f.api.ensureProperties()).source).to.equal("stale");
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
