const { expect } = require("chai");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const filename = path.resolve(__dirname, "../frontend/adapter/home/cardMetrics.ts");
const compiled = new Module(filename, module);
compiled._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
const { homeCardQueries, mergeCardMetrics, sortSitesBySessions } = compiled.exports;
const { QueryClient, QueriesObserver } = require("../frontend/node_modules/@tanstack/react-query");

describe("homepage Sessions ordering", () => {
  it("ranks the full list before pagination while retaining bounded property requests", async () => {
    const sites = Array.from({ length: 47 }, (_, index) => ({ siteId: index + 1 }));
    const options = homeCardQueries([...sites.map(site => site.siteId), 47], id => ["site-cards", id], async id => ({ [id]: { current: { sessions: id, users: 1 } } }));
    expect(options).to.have.length(47);
    const metrics = Object.assign({}, ...await Promise.all(options.map(option => option.queryFn({ signal: new AbortController().signal }))));
    expect(sortSitesBySessions(sites, metrics).slice(0, 20).map(site => site.siteId))
      .to.deep.equal(Array.from({ length: 20 }, (_, index) => 47 - index));
    expect(sites[0].siteId).to.equal(1); // Do not reorder the cached property list.
  });

  it("shows a cached site immediately while another site's GA4 request is still pending", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let release;
    const slow = new Promise(resolve => { release = resolve; });
    const cached = { 1: { current: { sessions: 30, users: 10 } } };
    const options = homeCardQueries([1, 2], id => ["site-cards", id], async id => {
      await slow;
      return { [id]: { current: { sessions: 60, users: 20 } } };
    });
    client.setQueryData(options[0].queryKey, cached);
    const observer = new QueriesObserver(client, options);
    const stop = observer.subscribe(() => {});
    try {
      const state = mergeCardMetrics([1, 2], observer.getCurrentResult());
      expect(state.data).to.deep.equal(cached);
      expect(state.isFetching).to.equal(true);
      expect(state.isError).to.equal(false);
      release();
      await Promise.all(options.map(option => client.fetchQuery(option)));
      expect(mergeCardMetrics([1, 2], observer.getCurrentResult()).data[2].current.sessions).to.equal(60);
    } finally { release(); stop(); client.clear(); }
  });

  it("reuses a visited period after one minute without starting another request", async () => {
    const client = new QueryClient();
    let calls = 0;
    const options = homeCardQueries([1], id => ["site-cards", "2026-10-01", id], async () => { calls++; return {}; });
    const value = { 1: { current: { sessions: 20, users: 10 } } };
    client.setQueryData(options[0].queryKey, value, { updatedAt: Date.now() - 90_000 });
    try {
      expect(await client.fetchQuery(options[0])).to.deep.equal(value);
      expect(calls).to.equal(0);
    } finally { client.clear(); }
  });

  it("keeps successful cards when another site fails, without substituting zero sessions", () => {
    const error = new Error("GA4 connection interrupted");
    const failed = { isError: true, isFetching: false, error };
    const ready = { data: { 1: { current: { sessions: 30, users: 10 } } }, isError: false, isFetching: false, error: null };
    const partial = mergeCardMetrics([1, 2], [ready, failed]);
    expect(partial.isError).to.equal(false);
    expect(partial.data[1].current.sessions).to.equal(30);
    expect(partial.data[2]).to.deep.equal({ error: error.message });
    expect(mergeCardMetrics([1, 2], [failed, failed])).to.include({ data: undefined, isError: true, error });
  });

  it("sorts the selected period numerically, preserving ties and placing unknown reports after valid zeros", () => {
    const sites = [1, 2, 3, 4, 5, 6].map(siteId => ({ siteId }));
    const metric = (sessions, previous = 0) => ({ current: { sessions, users: 1 }, previous: { sessions: previous, users: 1 } });
    const metrics = { 1: metric(9, 999), 2: metric(100), 3: metric(0), 4: metric(9), 5: { ...metric(1000), error: "Unavailable" } };
    expect(sortSitesBySessions(sites, metrics).map(site => site.siteId)).to.deep.equal([2, 1, 4, 3, 5, 6]);
    expect(sortSitesBySessions(sites, undefined)).to.deep.equal(sites);
  });
});
