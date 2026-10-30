const { expect } = require("chai");
const baseLedger = require("../lib/quotaLedger");
const { createQuotaHandlers } = require("../controllers/quota");

const at = Date.parse("2026-10-22T10:00:00Z");
const quota = (remaining = 1000) => ({
  tokensPerDay: { consumed: 1, remaining: remaining * 10 },
  tokensPerHour: { consumed: 1, remaining },
  tokensPerProjectPerHour: { consumed: 1, remaining },
});
const response = () => ({
  corePropertyQuota: quota(5000),
  realtimePropertyQuota: quota(6000),
  funnelPropertyQuota: quota(7000),
});
function setup(overrides = {}) {
  const records = new Map();
  const ledger = {
    POOLS: baseLedger.POOLS,
    STANDARD: baseLedger.STANDARD,
    RESERVE: baseLedger.RESERVE,
    nextDailyReset: baseLedger.nextDailyReset,
    summarize: baseLedger.summarize,
    get: (id, pool) => records.get(`${id}:${pool}`),
    list: (now) =>
      [...records.values()].map((entry) => ({
        propertyId: entry.propertyId,
        pool: entry.pool,
        source: entry.source,
        ...baseLedger.summarize(entry, now),
      })),
    record: (id, pool, data, source) =>
      records.set(`${id}:${pool}`, {
        propertyId: id,
        pool,
        quota: data,
        source,
        at,
      }),
    cooldowns: () => [],
    block() {},
    ...overrides.ledger,
  };
  const calls = [];
  const handlers = createQuotaHandlers({
    properties: async () => ({ properties: [{ id: "123" }, { id: "456" }] }),
    client: () => ({
      getPropertyQuotasSnapshot: async (request, options) => {
        calls.push({ request, options });
        return [response()];
      },
    }),
    isDemo: () => false,
    now: () => at,
    addSpent() {},
    ...overrides,
    ledger,
  });
  return { ...handlers, records, calls };
}
async function invoke(handler) {
  const result = { status: 200, headers: {} };
  await handler(
    {},
    {
      headers(values) { for (const [key, value] of Object.entries(values)) this.header(key, value); return this; },
      header(name, value) {
        result.headers[name] = value;
        return this;
      },
      status(code) {
        result.status = code;
        return this;
      },
      send(body) {
        result.body = body;
        return this;
      },
    }
  );
  return result;
}

describe("quota hard refresh", () => {
  it("includes GSC observations without refreshing Google quotas", async () => {
    let selected;
    const h = setup({ gsc: () => ({ quota: async (properties, options) => {
      selected = { properties, options };
      return { configured: true, scope: 'process', remaining: null };
    } }) });
    const result = await invoke(h.status);
    expect(result.body.searchConsole).to.include({ scope: 'process', remaining: null });
    expect(selected).to.deep.equal({ properties: [{ id: '123' }, { id: '456' }], options: { demo: false } });
    expect(h.calls).to.deep.equal([]);
  });
  it("only shows connected properties while preserving their expired observations", async () => {
    const h = setup({
      properties: async () => ({ properties: [{ id: 123 }, { id: "456" }] }),
    });
    h.records.set("123:core", {
      propertyId: "123",
      pool: "core",
      at: at - 2 * 86400000,
      quota: quota(25),
      source: "dashboard",
    });
    const orphan = {
      propertyId: "318829529",
      pool: "realtime",
      at,
      quota: quota(9000),
      source: "dashboard",
    };
    h.records.set("318829529:realtime", orphan);

    const result = await invoke(h.status);
    expect(result.body.entries.map((entry) => entry.propertyId)).to.deep.equal([
      "123",
    ]);
    expect(result.body.entries[0]).to.include({
      status: "unknown",
      hourLeft: null,
    });
    expect(h.records.get("318829529:realtime")).to.equal(orphan);
    expect(h.calls).to.deep.equal([]);
  });
  it("excludes disconnected properties from refresh results without deleting shared observations", async () => {
    const h = setup();
    const orphan = {
      propertyId: "471188525",
      pool: "core",
      at,
      quota: quota(9000),
      source: "dashboard",
    };
    h.records.set("471188525:core", orphan);

    const result = await invoke(h.refresh);
    expect(result.body.entries).to.have.length(6);
    expect(
      new Set(result.body.entries.map((entry) => entry.propertyId))
    ).to.deep.equal(new Set(["123", "456"]));
    expect(h.records.get("471188525:core")).to.equal(orphan);
  });
  it("shows no ledger observations when no properties are connected", async () => {
    const h = setup({ properties: async () => ({ properties: [] }) });
    h.records.set("123:core", {
      propertyId: "123",
      pool: "core",
      at,
      quota: quota(),
    });
    expect((await invoke(h.status)).body.entries).to.deep.equal([]);
    expect(h.calls).to.deep.equal([]);
  });
  it("hides disconnected property cooldowns and keeps project-wide cooldowns", async () => {
    const cooldowns = [
      { scope: "123:core", propertyId: "123" },
      { scope: "318829529:core", propertyId: "318829529" },
      { scope: "project", propertyId: "318829529" },
    ];
    const h = setup({ ledger: { cooldowns: () => cooldowns } });
    expect((await invoke(h.status)).body.cooldowns).to.deep.equal([
      cooldowns[0],
      cooldowns[2],
    ]);
  });
  it("queries each connected property once and updates all three pools", async () => {
    const h = setup();
    const result = await invoke(h.refresh);
    expect(result.status).to.equal(200);
    expect(result.headers["Cache-Control"]).to.equal("no-store");
    expect(h.calls.map((call) => call.request)).to.deep.equal([
      { name: "properties/123/propertyQuotasSnapshot" },
      { name: "properties/456/propertyQuotasSnapshot" },
    ]);
    expect(
      h.calls.every(
        (call) => call.options.timeout === 15000 && call.options.retry === null
      )
    ).to.equal(true);
    expect(result.body.entries).to.have.length(6);
    expect(result.body.refresh).to.deep.equal({
      total: 2,
      refreshed: 2,
      errors: [],
    });
    expect(
      result.body.entries.find(
        (entry) => entry.propertyId === "123" && entry.pool === "funnel"
      )
    ).to.include({ at, hourLeft: 7000, source: "quota-refresh" });
    expect((await invoke(h.status)).body.entries).to.deep.equal(
      result.body.entries
    );
    expect(h.calls).to.have.length(2); // Status polling only reads observations.
  });
  it("shares an in-flight lookup while a later click performs new GA4 requests", async () => {
    let calls = 0;
    const h = setup({
      client: () => ({
        getPropertyQuotasSnapshot: async () => {
          calls++;
          await new Promise((resolve) => setImmediate(resolve));
          return [response()];
        },
      }),
    });
    const results = await Promise.all([invoke(h.refresh), invoke(h.refresh)]);
    expect(calls).to.equal(2);
    expect(results[0].body).to.deep.equal(results[1].body);
    await invoke(h.refresh);
    expect(calls).to.equal(4);
  });
  it("bounds concurrency, keeps healthy results and preserves failed properties old observations", async () => {
    let active = 0,
      peak = 0;
    const h = setup({
      properties: async () => ({
        properties: Array.from({ length: 8 }, (_, id) => ({ id })),
      }),
      client: () => ({
        getPropertyQuotasSnapshot: async ({ name }) => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setImmediate(resolve));
          active--;
          if (name === "properties/2/propertyQuotasSnapshot")
            throw Object.assign(new Error("private SDK request URL"), {
              code: 7,
            });
          return [response()];
        },
      }),
    });
    const old = {
      propertyId: "2",
      pool: "core",
      at: at - 60000,
      quota: quota(25),
      source: "dashboard",
    };
    h.records.set("2:core", old);
    const result = await invoke(h.refresh);
    expect(peak).to.equal(3);
    expect(result.status).to.equal(200);
    expect(result.body.refresh).to.deep.equal({
      total: 8,
      refreshed: 7,
      errors: [{ propertyId: "2", code: "permission" }],
    });
    expect(h.records.get("2:core")).to.equal(old);
    expect(JSON.stringify(result.body)).not.to.include(
      "private SDK request URL"
    );
  });
  it("returns a failure without marking incomplete data as fresh", async () => {
    const h = setup({
      client: () => ({
        getPropertyQuotasSnapshot: async () => [{ corePropertyQuota: quota() }],
      }),
    });
    const result = await invoke(h.refresh);
    expect(result.status).to.equal(502);
    expect(result.body.entries).to.deep.equal([]);
    expect(result.body.refresh.refreshed).to.equal(0);
    expect(result.body.refresh.errors.map((error) => error.code)).to.deep.equal(
      ["incomplete", "incomplete"]
    );
  });
  it("honors a project cooldown without calling GA4", async () => {
    const h = setup({
      ledger: {
        cooldowns: () => [{ scope: "project", until: "2026-10-22T11:00:00Z" }],
      },
    });
    const result = await invoke(h.refresh);
    expect(h.calls).to.deep.equal([]);
    expect(result.status).to.equal(502);
    expect(
      result.body.refresh.errors.every((error) => error.code === "paused")
    ).to.equal(true);
  });
  it("rejects an empty property list without contacting GA4", async () => {
    const h = setup({ properties: async () => ({ properties: [] }) });
    expect((await invoke(h.refresh)).status).to.equal(502);
    expect(h.calls).to.deep.equal([]);
  });
  it("keeps demo snapshots isolated from the private ledger", async () => {
    const forbidden = () => {
      throw new Error("Private ledger must not be used");
    };
    const h = setup({
      isDemo: () => true,
      ledger: {
        get: forbidden,
        list: forbidden,
        record: forbidden,
        cooldowns: forbidden,
      },
    });
    expect((await invoke(h.status)).body.entries).to.deep.equal([]);
    expect((await invoke(h.refresh)).body.entries).to.have.length(6);
    expect((await invoke(h.status)).body.entries).to.have.length(6);
    expect(h.records.size).to.equal(0);
  });
});
