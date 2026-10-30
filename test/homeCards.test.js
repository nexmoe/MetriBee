const { expect } = require("chai");
const { createHomeCardsHandler } = require("../controllers/homeCards");

const row = (bucket, users, views) => ({
  dimensionValues: [{ value: String(bucket) }],
  metricValues: [{ value: String(users) }, { value: String(views) }],
});
const response = () => ({
  ok: true,
  rows: [row("0000", 4, 7), row("0002", 4, 8)],
  totals: [{ metricValues: [{ value: "5" }, { value: "15" }] }],
});
const properties = [{ id: "123456789", site: "Example", domain: "example.com", accountId: "10", accountName: "Example account" }];
const handler = overrides => createHomeCardsHandler({
  loadProperties: async () => ({ properties }),
  run: async () => response(),
  read: async () => null,
  write: async () => true,
  ...overrides,
});
async function invoke(handle, range) {
  const result = { status: 200 };
  const res = {
    status(code) { result.status = code; return this; },
    send(body) { result.body = body; return this; },
  };
  await handle({ query: { range } }, res);
  return result;
}

describe("homepage card time ranges", () => {
  for (const [range, startDate, dimension, points] of [
    ["today", "today", "hour", 24],
    ["7d", "6daysAgo", "nthDay", 7],
    ["28d", "27daysAgo", "nthDay", 28],
  ]) {
    it(`fetches ${range} with exact inclusive dates, GA4 totals and zero-filled buckets`, async () => {
      const calls = [];
      const result = await invoke(handler({ run: async query => { calls.push(query); return response(); } }), range);
      expect(result.status).to.equal(200);
      expect(calls).to.have.length(1);
      expect(calls[0].dateRange).to.deep.equal({ startDate, endDate: "today" });
      expect(calls[0].dimensions).to.deep.equal([{ name: dimension }]);
      expect(calls[0].metricAggregations).to.deep.equal(["TOTAL"]);
      const data = result.body.data[0];
      expect(data).to.include({ accountId: "10", accountName: "Example account" });
      // The same users may appear in both buckets; 4 + 4 is not the period total.
      expect(data.activeUsers).to.equal(5);
      expect(data.pageViews).to.equal(15);
      expect(data.series).to.have.length(points);
      expect(data.series.slice(0, 4)).to.deep.equal([4, 0, 4, 0]);
      expect(data.series.at(-1)).to.equal(0);
      expect(result.body.fetchedAt).to.equal(data.fetchedAt);
    });
  }

  it("uses a dimensionless summary when GA4 omits totals instead of summing users", async () => {
    const calls = [];
    const result = await invoke(handler({ run: async query => {
      calls.push(query);
      return query.dimensions.length
        ? { ok: true, rows: response().rows, totals: [] }
        : { ok: true, rows: [row("", 5, 15)] };
    } }), "7d");
    expect(calls).to.have.length(2);
    expect(calls[1].dimensions).to.deep.equal([]);
    expect(result.body.data[0].activeUsers).to.equal(5);
  });

  it("handles an empty report as zero traffic", async () => {
    const result = await invoke(handler({ run: async () => ({ ok: true, rows: [], totals: [] }) }), "7d");
    expect(result.body.data[0]).to.include({ activeUsers: 0, pageViews: 0 });
    expect(result.body.data[0].series).to.deep.equal(Array(7).fill(0));
  });

  it("reports a failed range as unavailable so the page offers retry", async () => {
    const result = await invoke(handler({ run: async () => ({ ok: false, error: "No connection established" }) }), "7d");
    expect(result.status).to.equal(502);
    expect(result.body.ok).to.equal(false);
    expect(result.body.data[0].error).to.equal("No connection established");
  });

  it("rejects invalid ranges before loading properties or querying GA4", async () => {
    const handle = handler({ loadProperties: async () => { throw new Error("must not run"); } });
    for (const range of [undefined, "30m", "90d", "toString", "__proto__", ["today"]]) {
      expect((await invoke(handle, range)).status).to.equal(400);
    }
  });

  it("caches by property and range and reuses reports for concurrent viewers", async () => {
    const cache = new Map();
    const calls = [];
    const handle = handler({
      read: async (ns, key) => cache.get(`${ns}:${key}`),
      write: async (ns, key, data) => cache.set(`${ns}:${key}`, data),
      run: async query => { calls.push(query); await new Promise(resolve => setImmediate(resolve)); return response(); },
    });
    const [first, second] = await Promise.all([invoke(handle, "7d"), invoke(handle, "7d")]);
    expect(calls).to.have.length(1);
    expect(first.body.data).to.deep.equal(second.body.data);
    const cached = (await invoke(handle, "7d")).body;
    expect(first.body.cacheStatus).to.equal("fresh");
    expect(cached.cacheStatus).to.equal("cached");
    expect(cached.fetchedAt).to.equal(first.body.fetchedAt);
    expect(cached.data).to.deep.equal(first.body.data.map(row => ({ ...row, cached: true })));
    expect(calls).to.have.length(1);
    await invoke(handle, "28d");
    expect(calls).to.have.length(2);
    expect(cache.size).to.equal(2);
  });

  it("limits fan-out, preserves healthy properties and retries failed reports", async () => {
    let active = 0;
    let peak = 0;
    let failed = true;
    const saved = [];
    const sites = Array.from({ length: 8 }, (_, i) => ({ id: String(i), site: `Site ${i}` }));
    const handle = handler({
      loadProperties: async () => ({ properties: sites }),
      run: async query => {
        active++;
        peak = Math.max(peak, active);
        await new Promise(resolve => setImmediate(resolve));
        active--;
        return failed && query.propertyId === "1" ? { ok: false, error: "No access" } : response();
      },
      write: async (ns, key) => saved.push(key),
    });
    const result = await invoke(handle, "7d");
    expect(peak).to.equal(3);
    expect(result.body.data.map(p => p.propertyId)).to.deep.equal(sites.map(p => p.id));
    expect(result.body.data[1].error).to.equal("No access");
    expect(result.body.data[2].activeUsers).to.equal(5);
    expect(saved).not.to.include("1:7d");
    failed = false;
    expect((await invoke(handle, "7d")).body.data[1].activeUsers).to.equal(5);
  });

  it("reports mixed cache use and the original oldest fetch when only one property is cached", async () => {
    const result = await invoke(handler({
      loadProperties: async () => ({ properties: [...properties, { id: "987654321", site: "Second" }] }),
      read: async (_ns, key) => key.startsWith(properties[0].id + ":") ? { activeUsers: 5, pageViews: 15, series: [], fetchedAt: 1000 } : null,
    }), "7d");
    expect(result.body.cacheStatus).to.equal("mixed");
    expect(result.body.fetchedAt).to.equal(1000);
    expect(result.body.data.map(row => row.cached)).to.deep.equal([true, false]);
  });

  it("updates account names even when historical metrics are cached", async () => {
    const list = [{ ...properties[0] }];
    const cache = new Map();
    let calls = 0;
    const handle = handler({
      loadProperties: async () => ({ properties: list }),
      read: async (ns, key) => cache.get(key),
      write: async (ns, key, data) => cache.set(key, data),
      run: async () => { calls++; return response(); },
    });
    const first = await invoke(handle, "7d");
    list[0].accountName = "Renamed account";
    const next = await invoke(handle, "7d");
    expect(calls).to.equal(1);
    expect(next.body.data[0].accountName).to.equal("Renamed account");
    expect(next.body.fetchedAt).to.equal(first.body.fetchedAt);
  });
});
