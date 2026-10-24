const { expect } = require("chai");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const { QueryClient, QueryObserver } = require("../frontend/node_modules/@tanstack/react-query");
const file = path.resolve(__dirname, "../frontend/rybbit/src/api/analytics/reportStatus.ts");
const compiled = new Module(file, module);
compiled._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, file);
const { recordReportStatus, reportStatusSnapshot } = compiled.exports;

describe("visible report freshness", () => {
  let client, subscriptions;
  beforeEach(() => { client = new QueryClient(); subscriptions = []; });
  afterEach(() => { subscriptions.forEach(stop => stop()); client.clear(); });
  const key = (site, start) => ["overview", site, "overview", { start_date: start }];
  function observe(queryKey, status, page) {
    client.setQueryData(queryKey, { sessions: 5 });
    subscriptions.push(new QueryObserver(client, { queryKey, staleTime: Infinity }).subscribe(() => {}));
    recordReportStatus(client, queryKey, status, page);
  }
  it("combines loaded reports using their oldest fetch and mixed cache status", () => {
    const queryKey = key("123", "2026-10-01");
    observe(queryKey, { fetchedAt: "2026-10-22T09:40:00Z", cacheStatus: "cached" }, "1");
    recordReportStatus(client, queryKey, { fetchedAt: "2026-10-22T10:00:00Z", cacheStatus: "fresh" }, "2");
    expect(JSON.parse(reportStatusSnapshot(client, "123"))).to.deep.equal({ fetchedAt: "2026-10-22T09:40:00.000Z", cacheStatus: "mixed", updating: false });
  });
  it("ignores a different site and a previous date or filter query once it is inactive", () => {
    observe(key("123", "2026-09-01"), { fetchedAt: "2026-10-22T08:00:00Z", cacheStatus: "cached" });
    subscriptions.pop()();
    observe(key("456", "2026-10-01"), { fetchedAt: "2026-10-22T09:00:00Z", cacheStatus: "cached" });
    observe(key("123", "2026-10-01"), { fetchedAt: "2026-10-22T10:00:00Z", cacheStatus: "fresh" });
    expect(JSON.parse(reportStatusSnapshot(client, "123"))).to.include({ fetchedAt: "2026-10-22T10:00:00.000Z", cacheStatus: "fresh" });
  });
  it("keeps timestamps unknown when unavailable and removes metadata with its report", () => {
    const queryKey = key("123", "2026-10-01");
    observe(queryKey, { fetchedAt: null, cacheStatus: "cached" });
    expect(JSON.parse(reportStatusSnapshot(client, "123")).fetchedAt).to.equal(null);
    client.removeQueries({ queryKey, exact: true });
    expect(client.getQueryData(["ga4-report-status", queryKey])).to.equal(undefined);
    expect(reportStatusSnapshot(client, "123")).to.equal("null");
  });
  it("scopes homepage freshness to the active organization card queries", () => {
    observe(["site-cards", "organization:ga4", "site-cards", {}], { fetchedAt: "2026-10-22T09:00:00Z", cacheStatus: "cached" });
    observe(key("123", "2026-10-01"), { fetchedAt: "2026-10-22T08:00:00Z", cacheStatus: "fresh" });
    expect(JSON.parse(reportStatusSnapshot(client, "organization:ga4"))).to.include({ fetchedAt: "2026-10-22T09:00:00.000Z", cacheStatus: "cached" });
  });
});
