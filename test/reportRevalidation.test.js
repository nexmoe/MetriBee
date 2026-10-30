const { expect } = require("chai");
const { createRybbitHandler } = require("../controllers/rybbit");

const tick = () => new Promise(setImmediate);
const dates = { start_date: "2026-10-01", end_date: "2026-10-22", bucket: "day" };
function report(sessions, dimensions = []) {
  return { ok: true, rows: [{
    dimensionValues: dimensions.map(() => ({ value: "20261001" })),
    metricValues: [sessions, 20, 5, 2.85, 0.2, 30, 2, 0, 0, 5].map(value => ({ value: String(value) })),
  }] };
}
async function invoke(handler, path = "/sites/123/overview", body) {
  const result = { status: 200 };
  await handler({ path, query: dates, method: body ? "POST" : "GET", body }, {
    status(value) { result.status = value; return this; },
    send(value) { result.body = value; return this; },
  });
  return result;
}
function fixture(options = {}) {
  const entries = new Map();
  let asOf = new Date("2026-10-24T10:00:00Z"), calls = 0;
  let load = async query => report(7, query.dimensions);
  const handler = createRybbitHandler({
    properties: async () => ({ properties: [{ id: "123", site: "Example", domain: "example.com" }] }),
    readEntry: async (namespace, key) => entries.get(namespace + key) ?? null,
    write: async (namespace, key, data, { cachedAt }) => entries.set(namespace + key, { data, cachedAt }),
    now: () => asOf,
    run: async query => { calls++; return load(query); },
    ...options,
  });
  return { handler, calls: () => calls,
    expire: () => { for (const entry of entries.values()) entry.stale = true; },
    load: value => { load = value; },
    advance: ms => { asOf = new Date(asOf.getTime() + ms); },
  };
}

describe("server report stale-while-revalidate", () => {
  it("returns an expired report immediately to concurrent visitors while refreshing it once", async () => {
    const f = fixture();
    const original = await invoke(f.handler);
    f.expire();
    f.advance(2 * 60 * 60_000);
    let release;
    const slow = new Promise(resolve => { release = resolve; });
    f.load(async () => { await slow; return report(42); });
    const responses = [];
    const requests = [1, 2].map(() => invoke(f.handler).then(value => responses.push(value)));
    try {
      await tick();
      expect(responses).to.have.length(2);
      expect(responses.every(value => value.body.data.sessions === 7)).to.equal(true);
      expect(responses[0].body.reportStatus).to.include({ fetchedAt: original.body.reportStatus.fetchedAt, cacheStatus: "cached", revalidating: true });
      expect(f.calls()).to.equal(2);
    } finally { release(); await Promise.all(requests); }
    await tick();
    const refreshed = await invoke(f.handler);
    expect(refreshed.body.data.sessions).to.equal(42);
    expect(refreshed.body.reportStatus.fetchedAt).not.to.equal(original.body.reportStatus.fetchedAt);
    expect(refreshed.body.reportStatus.revalidating).not.to.equal(true);
  });

  it("preserves stale reports on refresh failure and backs off further attempts", async () => {
    const f = fixture();
    await invoke(f.handler);
    f.expire();
    f.load(async () => { throw new Error("GA4 connection interrupted"); });
    const first = await invoke(f.handler);
    expect(first.body.data.sessions).to.equal(7);
    await tick();
    const next = await invoke(f.handler);
    expect(next.body.data.sessions).to.equal(7);
    expect(next.body.reportStatus.revalidating).not.to.equal(true);
    expect(f.calls()).to.equal(2);
    f.advance(60_001);
    f.load(async () => report(42));
    await invoke(f.handler);
    await tick();
    expect((await invoke(f.handler)).body.data.sessions).to.equal(42);
    expect(f.calls()).to.equal(3);
  });

  it("keeps cold requests deduplicated and waits when there is no cached result", async () => {
    const f = fixture();
    let release;
    const slow = new Promise(resolve => { release = resolve; });
    f.load(async () => { await slow; return report(42); });
    const responses = [];
    const requests = [1, 2].map(() => invoke(f.handler).then(value => responses.push(value)));
    await tick();
    expect(responses).to.have.length(0);
    expect(f.calls()).to.equal(1);
    release();
    await Promise.all(requests);
    expect(responses.every(value => value.body.data.sessions === 42)).to.equal(true);
  });

  it("serves homepage totals, comparisons and charts without waiting for their background reports", async () => {
    const f = fixture();
    const path = "/organizations/ga4/site-cards";
    const body = { siteIds: [123], comparison: { start_date: "2026-09-09", end_date: "2026-09-30" } };
    await invoke(f.handler, path, body);
    f.expire();
    let release, response;
    const slow = new Promise(resolve => { release = resolve; });
    f.load(async query => { await slow; return report(42, query.dimensions); });
    const request = invoke(f.handler, path, body).then(value => { response = value; });
    try {
      await tick();
      expect(response?.body.data[123].current.sessions).to.equal(7);
      expect(response.body.data[123].previous.sessions).to.equal(7);
      expect(response.body.reportStatus.revalidating).to.equal(true);
      expect(f.calls()).to.equal(6);
    } finally { release(); await request; await tick(); }
  });

  it("allows MCP analyses to disable detached refreshes and await their bounded GA4 calls", async () => {
    const f = fixture({ backgroundRefresh: false });
    await invoke(f.handler);
    f.expire();
    let release, response;
    const slow = new Promise(resolve => { release = resolve; });
    f.load(async () => { await slow; return report(42); });
    const request = invoke(f.handler).then(value => { response = value; });
    try {
      await tick();
      expect(response).to.equal(undefined);
    } finally { release(); await request; }
    expect(response.body.data.sessions).to.equal(42);
    expect(response.body.reportStatus.cacheStatus).to.equal("fresh");
  });
});
