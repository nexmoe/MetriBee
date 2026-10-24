const { expect } = require("chai");
const { shouldBypass, FRESH_GAP_MS } = require("../controllers/reportCache");
const { cacheGet, cacheGetEntry, cacheSet, cacheDel } = require("../controllers/reportCache");

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
