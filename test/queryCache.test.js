const { expect } = require("chai");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const { QueryObserver } = require("../frontend/node_modules/@tanstack/react-query");
const { persistQueryClientSave, persistQueryClientRestore } = require("../frontend/node_modules/@tanstack/react-query-persist-client");

const filename = path.resolve(__dirname, "../frontend/adapter/queryClient.ts");
const compiled = new Module(filename, module);
compiled.paths = Module._nodeModulePaths(path.dirname(filename));
compiled._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
const { createQueryClient, createQueryPersistence, queryCacheScope, QUERY_CACHE_TIME } = compiled.exports;

function memoryStorage() {
  const values = new Map();
  let saved;
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); saved?.(); },
    removeItem: key => values.delete(key),
    nextWrite: () => new Promise(resolve => { saved = resolve; }),
  };
}

const key = (site = 123, start = "2026-10-01", filters = []) =>
  ["overview", site, "overview", { start_date: start, filters }];

describe("workspace stale-while-revalidate cache", function () {
  this.timeout(5000);
  let clients, subscriptions;
  beforeEach(() => { clients = []; subscriptions = []; });
  afterEach(() => { subscriptions.forEach(stop => stop()); clients.forEach(client => client.clear()); });
  const client = () => { const value = createQueryClient(); clients.push(value); return value; };
  function observe(cache, options) {
    const observer = new QueryObserver(cache, options);
    subscriptions.push(observer.subscribe(() => {}));
    return observer;
  }
  async function save(cache, storage, scope = "live:123") {
    const options = createQueryPersistence(cache, storage, scope);
    const written = storage.nextWrite();
    await persistQueryClientSave({ queryClient: cache, ...options });
    await written;
    return options;
  }
  function seed(cache, queryKey, data, age = 0, persist = true) {
    cache.setQueryDefaults(queryKey, { meta: { persist } });
    cache.setQueryData(queryKey, data, { updatedAt: Date.now() - age });
  }

  it("immediately shows stale data and deduplicates background requests", async () => {
    const cache = client();
    let complete, calls = 0;
    const request = new Promise(resolve => { complete = resolve; });
    seed(cache, key(), { sessions: 12 }, 6 * 60_000);
    const options = { queryKey: key(), queryFn: () => { calls++; return request; } };
    const first = observe(cache, options);
    const second = observe(cache, options);
    expect(first.getCurrentResult()).to.include({ isPending: false, isFetching: true });
    expect(second.getCurrentResult().data).to.deep.equal({ sessions: 12 });
    expect(calls).to.equal(1);
    complete({ sessions: 24 });
    await cache.fetchQuery(options);
    expect(first.getCurrentResult().data).to.deep.equal({ sessions: 24 });
  });

  it("reuses fresh data without requesting it again", () => {
    const cache = client();
    let calls = 0;
    seed(cache, key(), [], 30_000);
    const query = observe(cache, { queryKey: key(), queryFn: async () => { calls++; return [1]; } });
    expect(query.getCurrentResult()).to.include({ isPending: false, isFetching: false });
    expect(query.getCurrentResult().data).to.deep.equal([]);
    expect(calls).to.equal(0);
  });

  it("retains the last success on background errors and permits an explicit retry", async () => {
    const cache = client();
    seed(cache, key(), { sessions: 12 }, 6 * 60_000);
    let fail = true;
    const options = { queryKey: key(), queryFn: async () => {
      if (fail) throw new Error("GA4 unavailable");
      return { sessions: 24 };
    } };
    const query = observe(cache, options);
    await query.refetch();
    expect(query.getCurrentResult()).to.include({ isError: true, isPending: false });
    expect(query.getCurrentResult().data).to.deep.equal({ sessions: 12 });
    fail = false;
    await query.refetch();
    expect(query.getCurrentResult().data).to.deep.equal({ sessions: 24 });
  });

  it("does not substitute another property's dates or filters on a cache miss", () => {
    const cache = client();
    seed(cache, key(), { sessions: 12 });
    for (const queryKey of [key(456), key(123, "2026-09-01"), key(123, "2026-10-01", [{ country: "IN" }])]) {
      const query = observe(cache, { queryKey, enabled: false });
      expect(query.getCurrentResult().data).to.equal(undefined);
      expect(query.getCurrentResult().isPending).to.equal(true);
    }
  });

  it("restores historical reports, infinite pages and original fetch timestamps only", async () => {
    const source = client(), storage = memoryStorage();
    const reportKey = key();
    const pagesKey = ["pathname", 123, "metric", { start_date: "2026-10-01" }, undefined, "infinite"];
    const statusKey = ["ga4-report-status", reportKey];
    seed(source, reportKey, { sessions: 12 }, 90_000);
    seed(source, pagesKey, { pages: [{ data: [{ value: "/", count: 12 }] }], pageParams: [1] });
    source.setQueryData(statusKey, { single: { fetchedAt: "2026-10-01T00:00:00Z", cacheStatus: "cached" } });
    seed(source, ["get-site", 123], { privateKey: "must not persist", permissions: ["sites:configure"] }, 0, false);
    seed(source, ["live-user-count", 123], { count: 12 }, 0, false);
    seed(source, ["setup-status"], { configured: true }, 0, false);
    const options = await save(source, storage);
    const restored = client();
    await persistQueryClientRestore({ queryClient: restored, ...options });
    expect(restored.getQueryData(reportKey)).to.deep.equal({ sessions: 12 });
    expect(restored.getQueryState(reportKey).dataUpdatedAt).to.equal(source.getQueryState(reportKey).dataUpdatedAt);
    expect(restored.getQueryData(pagesKey)).to.deep.equal(source.getQueryData(pagesKey));
    expect(restored.getQueryData(statusKey)).to.deep.equal(source.getQueryData(statusKey));
    expect(restored.getQueryData(["get-site", 123])).to.equal(undefined);
    expect(restored.getQueryData(["live-user-count", 123])).to.equal(undefined);
    expect(storage.getItem("metribee.query-cache")).not.to.include("must not persist");
  });

  it("restores the last successful result after a failed background refresh", async () => {
    const source = client(), storage = memoryStorage();
    seed(source, key(), { sessions: 12 }, 6 * 60_000);
    const query = observe(source, { queryKey: key(), queryFn: async () => { throw new Error("Offline"); } });
    await query.refetch();
    const options = await save(source, storage);
    const restored = client();
    await persistQueryClientRestore({ queryClient: restored, ...options });
    expect(restored.getQueryState(key())).to.include({ status: "success", error: null, fetchStatus: "idle" });
    expect(restored.getQueryData(key())).to.deep.equal({ sessions: 12 });
  });

  it("expires old reports independently of newer writes in the same session", async () => {
    const source = client(), storage = memoryStorage();
    seed(source, key(), { sessions: 12 });
    seed(source, key(456), { sessions: 24 });
    const options = await save(source, storage);
    const snapshot = JSON.parse(storage.getItem("metribee.query-cache"));
    snapshot.clientState.queries[0].state.dataUpdatedAt = Date.now() - QUERY_CACHE_TIME - 1;
    storage.setItem("metribee.query-cache", JSON.stringify(snapshot));
    const restored = client();
    await persistQueryClientRestore({ queryClient: restored, ...options });
    expect(restored.getQueryData(key())).to.equal(undefined);
    expect(restored.getQueryData(key(456))).to.deep.equal({ sessions: 24 });
  });

  it("busts persisted reports when the connected property scope changes", async () => {
    const source = client(), storage = memoryStorage();
    seed(source, key(), { sessions: 12 });
    await save(source, storage);
    const restored = client();
    await persistQueryClientRestore({ queryClient: restored, ...createQueryPersistence(restored, storage, "live:456") });
    expect(restored.getQueryData(key())).to.equal(undefined);
    expect(storage.getItem("metribee.query-cache")).to.equal(null);
  });

  it("separates demo and live data and disables persistence in restricted contexts", () => {
    const live = queryCacheScope({ properties: [{ id: "123" }, { id: "456" }] });
    expect(queryCacheScope({ properties: [{ id: "456" }, { id: 123 }, { id: "123" }] })).to.equal(live);
    expect(queryCacheScope({ properties: [{ id: "123" }, { id: "456" }], demo: true })).not.to.equal(live);
    expect(queryCacheScope({ properties: [{ id: "123" }] }, true)).to.equal(null);
    expect(queryCacheScope({ properties: [{ id: "123" }], publicSiteId: "123" })).to.equal(null);
    expect(queryCacheScope({ properties: [] })).to.equal(null);
    expect(createQueryPersistence(client(), memoryStorage(), null)).to.equal(undefined);
    expect(createQueryPersistence(client(), undefined, live)).to.equal(undefined);
  });
});
