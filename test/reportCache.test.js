const { expect } = require("chai");
const { shouldBypass, FRESH_GAP_MS } = require("../controllers/reportCache");
const { cacheGet, cacheGetEntry, cacheSet, cacheDel, CACHE_ROOT } = require("../controllers/reportCache");
const fs = require("node:fs/promises");
const path = require("node:path");

describe("report cache timestamps", () => {
  const key = `test-report-status-${process.pid}`;
  afterEach(() => cacheDel("report", key));

  it("returns the saved fetch time without changing the existing cacheGet data contract", async () => {
    const cachedAt = "2026-10-22T09:40:00.000Z";
    const value = { rows: [], data: { sessions: 5 } };
    expect(await cacheSet("report", key, value, { cachedAt })).to.equal(true);
    expect(await cacheGetEntry("report", key)).to.deep.equal({ data: value, cachedAt });
    expect(await cacheGet("report", key)).to.deep.equal(value);
  });

  it("retains expired reports for an explicit stale read instead of deleting the last success", async () => {
    const cachedAt = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
    const value = { rows: [{ sessions: 7 }] };
    await cacheSet("report", key, value, { cachedAt });
    const file = path.join(CACHE_ROOT, "report", key + ".json");
    const expired = new Date(Date.now() - 2 * 60 * 60_000);
    await fs.utimes(file, expired, expired);
    expect(await cacheGetEntry("report", key)).to.equal(null);
    expect(await cacheGetEntry("report", key, { allowStale: true })).to.deep.equal({ data: value, cachedAt, stale: true });
  });

  it("never restores reports beyond the seven-day retention even for explicit stale reads", async () => {
    await cacheSet("report", key, { sessions: 7 });
    const expired = new Date(Date.now() - 8 * 24 * 60 * 60_000);
    await fs.utimes(path.join(CACHE_ROOT, "report", key + ".json"), expired, expired);
    expect(await cacheGetEntry("report", key, { allowStale: true })).to.equal(null);
  });
});

describe("reportCache shouldBypass", () => {
  it("allows one fresh bypass per key per window", () => {
    const t = 1_000_000;
    expect(shouldBypass("test:a", t)).to.equal(true);
    expect(shouldBypass("test:a", t + 1000)).to.equal(false);
    expect(shouldBypass("test:b", t + 1000)).to.equal(true);
    expect(shouldBypass("test:a", t + FRESH_GAP_MS)).to.equal(true);
  });
});
