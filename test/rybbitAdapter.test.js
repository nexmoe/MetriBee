const { expect } = require("chai");
const {
  createRybbitHandler,
  windowFor,
  filtersFor,
  timeValue,
} = require("../controllers/rybbit");
const { scoreRealtime } = require("../controllers/dashboardModels");
const row = (dims, metrics) => ({
  dimensionValues: dims.map((value) => ({ value })),
  metricValues: metrics.map((value) => ({ value: String(value) })),
});
const reports = (rows) => ({ ok: true, rows, rowCount: rows.length });
function handler(overrides = {}) {
  return createRybbitHandler({
    properties: async () => ({
      properties: [{ id: "123", site: "Test", domain: "example.com" }],
    }),
    read: async () => null,
    write: async () => {},
    now: () => new Date("2026-10-22T10:00:00Z"),
    run: async () => reports([row([], [7, 20, 5, 2.85, 0.2, 30])]),
    ...overrides,
  });
}
async function invoke(h, path, query = {}, method = "GET", body = {}, headers = {}) {
  const out = { status: 200 };
  await h(
    { path, query, method, body, headers },
    {
      status(code) {
        out.status = code;
        return this;
      },
      send(value) {
        out.body = value;
        return this;
      },
    }
  );
  return out;
}
const dates = { start_date: "2026-10-01", end_date: "2026-10-22" };
describe("ordered-session Journey adapter", () => {
  let originalDemo;
  beforeEach(() => { originalDemo = process.env.DEMO; delete process.env.DEMO; });
  afterEach(() => { if (originalDemo === undefined) delete process.env.DEMO; else process.env.DEMO = originalDemo; });
  const noGA4 = {
    run: async () => { throw new Error("Session journeys must not query GA4 aggregates"); },
    read: async () => { throw new Error("Session journeys must not read live report caches"); },
    write: async () => { throw new Error("Session journeys must not write live report caches"); },
    admin: () => { throw new Error("Session journeys must not resolve GA4 metadata"); },
  };
  const sourceRecords = [{ session_id: "session-a", user_id: "visitor-a", hostname: "example.com", country: "US",
    events: ["/", "/docs", "/pricing", "/signup", "/done"].map((pathname, index) => ({ type: "pageview", pathname, timestamp: `2026-10-20 10:00:0${index}` })) }];
  it("reports source capabilities without GA4 calls and keeps missing data distinct from an empty population", async () => {
    const h = handler(noGA4);
    const capability = await invoke(h, "/sites/123/journeys/capabilities");
    expect(capability.body.data).to.deep.equal({ available: false, source: null, minSteps: 2, maxSteps: 10, transitionsAvailable: true });
    for (const action of ["journeys", "journeys/summary", "journeys/sessions", "journeys/context"]) {
      const result = await invoke(h, `/sites/123/${action}`, { ...dates, mode: "sessions", steps: "4" });
      expect(result.status).to.equal(422);
      expect(result.body.code).to.equal("journey_source_required");
    }
  });
  it("serves native paths, summary, context and drawer membership from one property-scoped ordered source", async () => {
    const calls = [];
    const h = handler({ ...noGA4, properties: async () => ({ properties: [{ id: "123", domain: "example.com", timeZone: "UTC" }] }),
      journeySessions: async args => { calls.push(args); return sourceRecords; } });
    const params = { ...dates, mode: "sessions", steps: "4" };
    const paths = await invoke(h, "/sites/123/journeys", params);
    expect(paths.status).to.equal(200);
    expect(paths.body).to.include({ source: "ordered-sessions", totalSessions: 1 });
    expect(paths.body.journeys[0]).to.deep.equal({ path: ["/", "/docs", "/pricing", "/signup"], count: 1, percentage: 100 });
    const summary = await invoke(h, "/sites/123/journeys/summary", params);
    expect(summary.body.data).to.include({ sessions: 1, avgPathLength: 5 });
    expect(summary.body.data.topExit).to.deep.equal({ page: "/done", sessions: 1 });
    const context = await invoke(h, "/sites/123/journeys/context", params);
    expect(context.body.data.sessions).to.equal(1);
    const drawer = await invoke(h, "/sites/123/journeys/sessions", { ...params, path: JSON.stringify(paths.body.journeys[0].path) });
    expect(drawer.body.data.map(session => session.session_id)).to.deep.equal(["session-a"]);
    expect(calls.every(args => args.property.id === "123" && JSON.stringify(args.dateRange) === JSON.stringify({ startDate: dates.start_date, endDate: dates.end_date }))).to.equal(true);
  });
  it("validates property ownership and private-link scope before touching ordered events", async () => {
    let calls = 0;
    const h = handler({ ...noGA4, journeySessions: async () => { calls++; return sourceRecords; },
      embeds: { store: { validate: async () => true } } });
    expect((await invoke(h, "/sites/999/journeys/capabilities")).status).to.equal(404);
    const shared = { "x-private-site": "123", "x-private-key": "valid" };
    expect((await invoke(h, "/sites/999/journeys", { ...dates, mode: "sessions" }, "GET", {}, shared)).status).to.equal(403);
    expect(calls).to.equal(0);
  });
  it("isolates demo session events and expands exactly the sessions counted by the diagram", async () => {
    process.env.DEMO = "1";
    const properties = [{ id: "311000101", domain: "northwind-store.example" }, { id: "311000102", domain: "lumen-notes.example" }];
    const h = handler({ ...noGA4, properties: async () => ({ properties }) });
    const base = "/sites/311000101", params = { ...dates, mode: "sessions", steps: "4" };
    expect((await invoke(h, `${base}/journeys/capabilities`)).body.data.source).to.equal("demo-sessions");
    const paths = await invoke(h, `${base}/journeys`, params);
    expect(paths.status).to.equal(200);
    expect(paths.body.source).to.equal("demo-sessions");
    const path = paths.body.journeys[0];
    const drawer = await invoke(h, `${base}/journeys/sessions`, { ...params, path: JSON.stringify(path.path), limit: "100" });
    expect(drawer.body.data.length).to.equal(path.count);
    const first = drawer.body.data[0];
    const detail = await invoke(h, `${base}/sessions/${first.session_id}`);
    expect(detail.status).to.equal(200);
    expect(detail.body.data.session.session_id).to.equal(first.session_id);
    const rawPages = detail.body.data.events.map(event => event.pathname);
    expect(rawPages.filter((page, index) => index === 0 || page !== rawPages[index - 1]).slice(0, 4)).to.deep.equal(path.path);
    expect((await invoke(h, `/sites/311000102/sessions/${first.session_id}`)).status).to.equal(404);
    const summary = await invoke(h, `${base}/journeys/summary`, { ...params, goalId: "1" });
    expect(summary.body.data.sessions).to.equal(paths.body.totalSessions);
    expect(summary.body.data.avgPathLength).to.be.greaterThan(4);
    const goals = await invoke(h, `${base}/goals`, { ...dates, filters: JSON.stringify([{ parameter: "country", type: "equals", value: ["missing"] }]) });
    expect(goals.body.data[0]).to.include({ total_sessions: 0, total_conversions: 0 });
  });
});
describe("GA4 live user drawer", () => {
  function liveHandler(overrides = {}) {
    const calls = [];
    const cache = new Map();
    const h = handler({
      run: async () => { throw new Error("Live users must not query historical reports"); },
      admin: () => { throw new Error("Live users do not require a property timezone"); },
      readEntry: async (namespace, key) => cache.get(`${namespace}:${key}`),
      write: async (namespace, key, data, meta) => cache.set(`${namespace}:${key}`, { data, cachedAt: meta.cachedAt }),
      client: () => ({ runRealtimeReport: async query => {
        calls.push(query);
        const dimension = query.dimensions[0]?.name;
        const rows = dimension === "country" ? [row(["United States", "US"], [4, 8]), row(["China", "CN"], [3, 6])]
          : dimension === "deviceCategory" ? [row(["desktop"], [5, 9]), row(["mobile"], [2, 5])]
          : dimension === "unifiedScreenName" ? [row(["Home"], [6, 10]), row(["Docs"], [4, 4])]
          : [row([], [7, 14])];
        return [{ rows, rowCount: rows.length }];
      } }),
      ...overrides,
    });
    return { h, calls };
  }
  it("loads five-minute aggregates instead of unsupported individual sessions", async () => {
    const { h, calls } = liveHandler();
    const result = await invoke(h, "/sites/123/ga4/live-users", { start_date: "invalid", filters: "invalid" });
    expect(result.status).to.equal(200);
    expect(result.body.data).to.include({ activeUsers: 7, pageviews: 14 });
    expect(result.body.data.countries.rows[0]).to.deep.equal({ name: "United States", countryCode: "US", users: 4 });
    expect(result.body.data.devices.rows[0]).to.deep.equal({ name: "desktop", users: 5 });
    expect(result.body.data.pages.rows.map(item => item.users)).to.deep.equal([6, 4]);
    // A user can visit multiple pages: page groups are never summed into the total.
    expect(result.body.data.activeUsers).not.to.equal(10);
    expect(calls).to.have.length(4);
    expect(calls.every(query => query.property === "properties/123" && query.returnPropertyQuota)).to.equal(true);
    expect(calls.every(query => JSON.stringify(query.minuteRanges) === JSON.stringify([{ startMinutesAgo: 4, endMinutesAgo: 0 }]))).to.equal(true);
    expect(result.body.reportStatus).to.deep.equal({ fetchedAt: "2026-10-22T10:00:00.000Z", cacheStatus: "fresh" });
  });
  it("shares the exact live total with the toolbar and caches repeated openings", async () => {
    let now = new Date("2026-10-22T10:00:00Z");
    const { h, calls } = liveHandler({ now: () => now });
    const count = await invoke(h, "/sites/123/live-user-count", { minutes: "5" });
    const first = await invoke(h, "/sites/123/ga4/live-users");
    const second = await invoke(h, "/sites/123/ga4/live-users");
    expect(first.status).to.equal(200);
    expect(first.body.data.activeUsers).to.equal(count.body.count);
    expect(second.body.reportStatus.cacheStatus).to.equal("cached");
    expect(calls).to.have.length(4);
    now = new Date("2026-10-22T10:01:00Z");
    await invoke(h, "/sites/123/ga4/live-users");
    expect(calls).to.have.length(8);
  });
  it("returns a real empty state when nobody is online", async () => {
    const { h } = liveHandler({ client: () => ({ runRealtimeReport: async () => [{ rows: [], rowCount: 0 }] }) });
    const result = await invoke(h, "/sites/123/ga4/live-users");
    expect(result.status).to.equal(200);
    expect(result.body.data).to.include({ activeUsers: 0, pageviews: 0 });
    expect(result.body.data.countries).to.deep.equal({ rows: [], totalCount: 0, truncated: false });
  });
  it("marks top-row truncation and asks GA4 for the largest groups first", async () => {
    const calls = [];
    const { h } = liveHandler({ client: () => ({ runRealtimeReport: async query => {
      calls.push(query);
      return [{ rows: query.dimensions.length ? [row(["Home", "US"], [5])] : [row([], [7, 14])], rowCount: query.dimensions.length ? 80 : 1 }];
    } }) });
    const result = await invoke(h, "/sites/123/ga4/live-users");
    expect(result.status).to.equal(200);
    expect(result.body.data.pages).to.include({ totalCount: 80, truncated: true });
    expect(calls.filter(query => query.dimensions.length).every(query => query.limit === 50 && query.orderBys[0].metric.metricName === "activeUsers" && query.orderBys[0].desc)).to.equal(true);
  });
  it("preserves quota and API errors instead of replacing them with zero users", async () => {
    for (const [code, status] of [[8, 429], [7, 403], [14, 502]]) {
      const { h } = liveHandler({ client: () => ({ runRealtimeReport: async () => { throw Object.assign(new Error("Realtime unavailable"), { code }); } }) });
      const result = await invoke(h, "/sites/123/ga4/live-users");
      expect(result.status).to.equal(status);
      expect(result.body).to.deep.equal({ error: "Realtime unavailable" });
    }
  });
  it("rejects unknown properties before calling GA4", async () => {
    const { h, calls } = liveHandler();
    expect((await invoke(h, "/sites/999/ga4/live-users")).status).to.equal(404);
    expect(calls).to.have.length(0);
  });
  it("keeps live details inside the property authorized by a private link", async () => {
    const { h, calls } = liveHandler({ embeds: { store: { validate: async (site, key) => site === "123" && key === "valid" } } });
    const shared = { "x-private-site": "123", "x-private-key": "valid" };
    expect((await invoke(h, "/sites/999/ga4/live-users", {}, "GET", {}, shared)).status).to.equal(403);
    expect((await invoke(h, "/sites/123/ga4/live-users", {}, "GET", {}, { ...shared, "x-private-key": "revoked" })).status).to.equal(403);
    expect(calls).to.have.length(0);
    expect((await invoke(h, "/sites/123/ga4/live-users", {}, "GET", {}, shared)).status).to.equal(200);
    expect(calls.every(query => query.property === "properties/123")).to.equal(true);
  });
});
describe('analytics change and spike summaries', () => {
  it('compares equal calendar windows, retains filters, and includes sources that disappeared', async () => {
    const calls = [];
    const h = handler({ run: async q => {
      calls.push(q);
      if (q.dimensions[0]?.name !== 'sessionSource') return reports([]);
      return reports(q.dateRange.startDate === dates.start_date
        ? [row(['google', 'organic'], [110, 90]), row(['new.example', 'referral'], [40, 30]), row(['steady', 'referral'], [105, 80])]
        : [row(['google', 'organic'], [100, 90]), row(['lost.example', 'referral'], [70, 60]), row(['steady', 'referral'], [100, 80])]);
    } });
    const r = await invoke(h, '/sites/123/ga4/what-changed', { ...dates, filters: JSON.stringify([{ parameter: 'device_type', type: 'equals', value: ['desktop'] }]) });
    expect(r.status).to.equal(200);
    expect(r.body.data.days).to.equal(22);
    expect(r.body.data.previousRange).to.deep.equal({ startDate: '2026-09-09', endDate: '2026-09-30' });
    expect(r.body.data.changes.map(c => [c.name, c.difference, c.percent])).to.deep.equal([
      ['lost.example / referral', -70, -100], ['new.example / referral', 40, null], ['google / organic', 10, 10],
    ]);
    expect(calls).to.have.length(9);
    expect(calls.every(q => q.propertyId === '123' && q.dimensionFilter.filter.fieldName === 'deviceCategory')).to.equal(true);
    expect(calls.filter(q => q.dateRange.startDate === '2026-09-09')).to.have.length(4);
  });
  it('includes suspected bot totals and country IDs for valid filters', async () => {
    const h = handler({ run: async q => {
      if (q.dimensions[1]?.name === 'countryId') return reports([row(['United States', 'US'], [q.dateRange.startDate === dates.start_date ? 30 : 20, 10])]);
      if (q.dimensions[1]?.name === 'city') return { ...reports([row(['United States', 'Ashburn', 'bot.example', 'desktop'], [15, 0, 0, 15])]), totals: [row([], [100])] };
      return reports([]);
    } });
    const r = await invoke(h, '/sites/123/ga4/what-changed', dates);
    expect(r.body.data.bots).to.deep.equal({ sessions: 15, segments: 1 });
    expect(r.body.data.changes[0]).to.include({ name: 'United States', parameter: 'country', filterValue: 'US', difference: 10 });
  });
  it('reports a failed comparison instead of inventing zero previous traffic', async () => {
    const h = handler({ run: async q => q.dateRange.startDate === dates.start_date ? reports([]) : { ok: false, error: 'History unavailable' } });
    const r = await invoke(h, '/sites/123/ga4/what-changed', dates);
    expect(r.status).to.equal(502);
    expect(r.body.error).to.equal('History unavailable');
  });
  it('uses the connected property currency when GA4 omits it from revenue report metadata', async () => {
    const h = handler({ properties: async () => ({ properties: [{ id: '123', currencyCode: 'CNY' }] }),
      run: async q => reports(q.dimensions.length ? [row(['purchase'], [2, 88])] : [row([], [0, 0, 0, 88, 2, 88])]),
    });
    const r = await invoke(h, '/sites/123/ga4/revenue-key-events', dates);
    expect(r.body.data.currencyCode).to.equal('CNY');
    expect(r.body.data.summary).to.include({ purchaseRevenue: 88, keyEvents: 2, eventValue: 88 });
    expect(r.body.data.rows[0]).to.deep.equal({ dims: ['purchase'], metrics: [2, 88] });
  });
  it('shows notable and dominant sources with landing pages, referrers and search links', async () => {
    const calls = [];
    const h = handler({ run: async q => {
      calls.push(q);
      if (q.dimensions[1]?.name === 'sessionMedium') return reports([
        row(['google', 'organic'], [50, 40]), row(['reddit.com', 'referral'], [45, 30]), row(['chatgpt.com', 'referral'], [5, 4]),
      ]);
      if (q.dimensions[1]?.name === 'landingPagePlusQueryString') return reports([row(['reddit.com', '/post'], [40])]);
      return reports([row(['https://reddit.com/r/web/comments/1'], [20])]);
    } });
    const r = await invoke(h, '/sites/123/ga4/spikes', { ...dates, filters: JSON.stringify([{ parameter: 'country', type: 'equals', value: ['US'] }]) });
    expect(r.status).to.equal(200);
    expect(r.body.data.sources).to.have.length(2);
    expect(r.body.data.sources[0]).to.include({ name: 'Reddit', notable: true, dominant: true, share: 45 });
    expect(r.body.data.sources[0].landingPages).to.deep.equal([{ path: '/post', sessions: 40 }]);
    expect(r.body.data.sources[0].referrers[0].url).to.include('reddit.com/r/');
    expect(r.body.data.sources[0].searchUrl).to.equal('https://www.reddit.com/search/?q=site%3Aexample.com');
    expect(calls.every(q => q.dateRange.startDate === dates.start_date && q.dimensionFilter.filter.fieldName === 'countryId')).to.equal(true);
  });
  it('scopes live spikes to one property and the last 30 minutes independently of historical filters', async () => {
    const calls = [];
    const h = handler({ baseline: async prop => { expect(prop.id).to.equal('123'); return { baseline: 10, sd: 1 }; },
      realtime: async q => { calls.push(q); return reports(q.dimensions.length ? [row(['/post'], [40])] : [row([], [50])]); },
    });
    const r = await invoke(h, '/sites/123/ga4/live-spike', { start_date: 'invalid', filters: 'invalid' });
    expect(r.status).to.equal(200);
    expect(r.body.data.spike).to.deep.equal({ activeUsers: 50, baselineUsers: 10, ratio: 5, topPage: '/post' });
    expect(calls[0]).to.include({ propertyId: '123' });
    expect(calls[0].minuteRanges).to.deep.equal([{ startMinutesAgo: 29, endMinutesAgo: 0 }]);
    expect(r.body.reportStatus.fetchedAt).to.equal('2026-10-22T10:00:00.000Z');
  });
  it('avoids the page lookup when live traffic is normal and reuses the spike cache across date changes', async () => {
    const cache = new Map(); let calls = 0;
    const h = handler({ baseline: async () => ({ baseline: 10, sd: 1 }),
      realtime: async () => { calls++; return reports([row([], [11])]); },
      readEntry: async (ns, key) => cache.get(`${ns}:${key}`),
      write: async (ns, key, data, meta) => { expect(ns).to.equal('spike'); cache.set(`${ns}:${key}`, { data, cachedAt: meta.cachedAt }); },
    });
    const first = await invoke(h, '/sites/123/ga4/live-spike', dates);
    const second = await invoke(h, '/sites/123/ga4/live-spike', { start_date: '2026-09-01' });
    expect(first.body.data.spike).to.equal(null);
    expect(second.body.reportStatus.cacheStatus).to.equal('cached');
    expect(calls).to.equal(1);
  });
  it('exposes live quota and baseline failures instead of reporting no spikes', async () => {
    const baseline = async () => ({ baseline: 10, sd: 1 });
    const quota = await invoke(handler({ baseline, realtime: async () => ({ ok: false, error: 'Quota exhausted', errorCode: 8 }) }), '/sites/123/ga4/live-spike');
    expect(quota.status).to.equal(429);
    const missing = await invoke(handler({ baseline: async () => null, realtime: async () => reports([row([], [100])]) }), '/sites/123/ga4/live-spike');
    expect(missing.status).to.equal(502);
    expect(missing.body.error).to.include('baseline unavailable');
  });
});
describe("Rybbit GA4 data adapter", () => {
  it("signals a background metadata refresh so Home can update names as soon as it finishes", async () => {
    const until = Date.now() + 60_000;
    const h = handler({ properties: async () => ({
      properties: [{ id: "123", site: "Cached name", timeZone: "Asia/Shanghai" }], revalidateUntil: until,
    }), admin: () => { throw new Error("Do not fetch known property metadata again"); } });
    const sites = await invoke(h, "/organizations/ga4/sites");
    expect(sites.body.metadataRevalidateUntil).to.equal(until);
    expect(sites.body.sites[0].name).to.equal("Cached name");
    const site = await invoke(h, "/sites/123");
    expect(site.status).to.equal(200);
    expect(site.body.timeZone).to.equal("Asia/Shanghai");
  });
  it("preserves fetch times and mixed cache use through homepage card batches", async () => {
    let reads = 0;
    const h = handler({ readEntry: async () => ++reads === 1 ? { data: reports([row([], [7, 20, 5])]), cachedAt: "2026-10-22T09:40:00Z" } : null });
    const result = await invoke(h, "/organizations/ga4/site-cards", dates, "POST", { siteIds: [123] });
    expect(result.body.data[123].error).to.equal(undefined);
    expect(result.body.reportStatus).to.deep.equal({ fetchedAt: "2026-10-22T09:40:00.000Z", cacheStatus: "mixed" });
  });
  it("preserves report metadata for journeys returned without a data wrapper", async () => {
    const result = await invoke(handler({ run: async () => reports([row(["example.com", "https://example.com/one", "/two"], [7])]) }), "/sites/123/journeys", dates);
    expect(result.body.journeys).to.have.length(1);
    expect(result.body.reportStatus).to.deep.equal({ fetchedAt: "2026-10-22T10:00:00.000Z", cacheStatus: "fresh" });
  });
  it("summarizes the actual referring and destination pages for GA4 transitions", async () => {
    const result = await invoke(handler({ run: async () => reports([
      row(["example.com", "https://example.com/start", "/docs"], [8]),
      row(["example.com", "https://example.com/start", "/pricing"], [5]),
      row(["example.com", "https://example.com/docs", "/pricing"], [4]),
    ]) }), "/sites/123/journeys/summary", dates);
    expect(result.body.data.sessions).to.equal(17);
    expect(result.body.data.topReferrer).to.deep.equal({ page: "/start", pageviews: 13 });
    expect(result.body.data.topDestination).to.deep.equal({ page: "/pricing", pageviews: 9 });
    const empty = await invoke(handler({ run: async () => reports([]) }), "/sites/123/journeys/summary", dates);
    expect(empty.body.data.topReferrer).to.equal(null);
    expect(empty.body.data.topDestination).to.equal(null);
  });
  it("explores adjacent pages from cached pairs without inventing a session sequence", async () => {
    const cache = new Map();
    let calls = 0;
    const h = handler({
      read: async (namespace, key) => cache.get(`${namespace}:${key}`),
      write: async (namespace, key, data) => cache.set(`${namespace}:${key}`, data),
      run: async () => {
        calls++;
        return reports([
          row(["example.com", "https://example.com/start", "/docs"], [8]),
          row(["example.com", "https://example.com/start", "/pricing"], [5]),
          row(["example.com", "https://example.com/docs", "/pricing"], [12]),
        ]);
      },
    });
    const initial = await invoke(h, "/sites/123/journeys", { ...dates, limit: 1 });
    const next = await invoke(h, "/sites/123/journeys", { ...dates, stepFilters: JSON.stringify({ 0: "/docs" }) });
    const previous = await invoke(h, "/sites/123/journeys", { ...dates, endsAt: "/docs" });
    expect(initial.body.journeys).to.have.length(1);
    expect(next.body.journeys).to.deep.equal([{ path: ["/docs", "/pricing"], count: 12, percentage: 48 }]);
    expect(previous.body.journeys).to.deep.equal([{ path: ["/start", "/docs"], count: 8, percentage: 32 }]);
    expect(next.body.totalSessions).to.equal(25);
    expect(calls).to.equal(1);
  });
  it("uses Rybbit section names and the same per-step wildcard grammar", async () => {
    const h = handler({ run: async () => reports([
      row(["example.com", "https://example.com/docs/start", "/blog/one"], [8]),
      row(["example.com", "https://example.com/docs/deep/start", "/blog/deep/two"], [5]),
      row(["example.com", "https://example.com/docs", "/blog/three"], [3]),
    ]) });
    const section = await invoke(h, "/sites/123/journeys", { ...dates, groupBy: "section", stepFilters: JSON.stringify({ 0: "/docs/**" }) });
    expect(section.body.journeys).to.deep.equal([{ path: ["/docs/**", "/blog/**"], count: 13, percentage: 81.25 }]);
    const singleSegment = await invoke(h, "/sites/123/journeys", { ...dates, stepFilters: JSON.stringify({ 0: "/docs/*" }) });
    expect(singleSegment.body.journeys.map(item => item.count)).to.deep.equal([8]);
    const nested = await invoke(h, "/sites/123/journeys", { ...dates, stepFilters: JSON.stringify({ 0: "/docs/**" }) });
    expect(nested.body.journeys.map(item => item.count)).to.deep.equal([8, 5]);
  });
  it("does not silently replace native multi-step journeys or session details with aggregate pairs", async () => {
    let calls = 0;
    const h = handler({ run: async () => { calls++; return reports([]); } });
    for (const [path, query] of [
      ["/sites/123/journeys", { ...dates, steps: "4" }],
      ["/sites/123/journeys/sessions", { ...dates, path: JSON.stringify(["/", "/docs"]) }],
    ]) {
      const result = await invoke(h, path, query);
      expect(result.status).to.equal(422);
      expect(result.body.error).to.include("ordered event-level data");
    }
    expect(calls).to.equal(0);
  });
  it("uses the original cohort fetch time and cache state for retention", async () => {
    const result = await invoke(handler({ retention: async (_req, res) => res.send({ cohorts: [], periods: 4, bucket: "week", fetchedAt: "2026-10-22T09:00:00Z", cached: true }) }), "/sites/123/retention", dates);
    expect(result.body.reportStatus).to.deep.equal({ fetchedAt: "2026-10-22T09:00:00.000Z", cacheStatus: "cached" });
  });
  it("preserves Express query getters when forwarding funnel requests", async () => {
    const query = { start_date: "2026-10-01", end_date: "2026-10-22", filters: '[]' };
    const request = Object.assign(Object.create({ get query() { return query; } }), {
      method: "POST", path: "/sites/123/funnels/analyze", body: { steps: [] },
    });
    let forwarded;
    await handler({ funnels: async (req, res) => { forwarded = req; return res.send({ ok: true }); } })(request, { send() {} });
    expect(forwarded.query).to.equal(query);
    expect(forwarded.body).to.equal(request.body);
    expect(forwarded.params).to.deep.equal({ propertyId: "123", action: "analyze" });
  });
  it("routes local funnel definitions separately from read-only GA4 operations", async () => {
    const requests = [];
    const h = handler({ funnels: async (req, res) => { requests.push(req); return res.send({ ok: true }); } });
    expect((await invoke(h, "/sites/123/funnels", {}, "POST", { name: "Tools", steps: [] })).status).to.equal(200);
    expect((await invoke(h, "/sites/123/funnels", {}, "GET")).status).to.equal(200);
    expect((await invoke(h, "/sites/123/funnels/summary", {}, "GET")).status).to.equal(200);
    expect((await invoke(h, "/sites/123/funnels/2", {}, "DELETE")).status).to.equal(200);
    expect(requests.map(req => req.params.action)).to.deep.equal(["definitions", "definitions", "summary", "2"]);
    expect((await invoke(h, "/sites/999/funnels", {}, "POST")).status).to.equal(404);
    expect((await invoke(h, "/sites/123/overview", {}, "DELETE")).status).to.equal(405);
    expect((await invoke(h, "/sites/123/funnels/2", {}, "POST")).status).to.equal(405);
  });
  it("preserves the actual fetch time across cache hits and server restarts", async () => {
    const entries = new Map();
    let calls = 0;
    const dependencies = {
      readEntry: async (_namespace, key) => entries.get(key) || null,
      write: async (_namespace, key, data, { cachedAt }) => entries.set(key, { data, cachedAt }),
      run: async () => { calls++; return reports([row([], [7, 20, 5, 2.85, 0.2, 30])]); },
    };
    const first = await invoke(handler(dependencies), "/sites/123/overview", dates);
    expect(first.body.reportStatus).to.deep.equal({ fetchedAt: "2026-10-22T10:00:00.000Z", cacheStatus: "fresh" });
    const second = await invoke(handler({ ...dependencies, now: () => new Date("2026-10-22T10:30:00Z") }), "/sites/123/overview", dates);
    expect(second.body.data).to.deep.equal(first.body.data);
    expect(second.body.reportStatus).to.deep.equal({ ...first.body.reportStatus, cacheStatus: "cached" });
    expect(calls).to.equal(1);
  });
  it("reports the oldest timestamp and mixed cache use for a composite report", async () => {
    let reads = 0;
    const result = await invoke(handler({
      readEntry: async () => ++reads === 1 ? { data: reports([row(["Chrome"], [5, 10, 0.2, 20, 4])]), cachedAt: "2026-10-22T09:40:00Z" } : null,
      run: async () => reports([row([], [20, 30])]),
    }), "/sites/123/metric", { ...dates, parameter: "browser" });
    expect(result.status).to.equal(200);
    expect(result.body.reportStatus).to.deep.equal({ fetchedAt: "2026-10-22T09:40:00.000Z", cacheStatus: "mixed" });
  });
  it("does not invent a timestamp for a legacy cache without known metadata", async () => {
    const result = await invoke(handler({ read: async () => reports([]) }), "/sites/123/overview", dates);
    expect(result.body.reportStatus).to.deep.equal({ fetchedAt: null, cacheStatus: "cached" });
  });
  it("resolves source favicons without requiring a connected GA4 property", async () => {
    const domains = [];
    const h = handler({ favicon: async (req, res) => {
      domains.push(req.query.domain);
      return res.send({ image: true });
    } });
    const result = await invoke(h, "/favicon", { domain: "chatgpt.com" });
    expect(result.status).to.equal(200);
    expect(result.body).to.deep.equal({ image: true });
    expect(domains).to.deep.equal(["chatgpt.com"]);
  });
  it("does not call GA4 when loading a favicon", async () => {
    const h = handler({
      properties: async () => { throw new Error("GA4 is unavailable"); },
      favicon: async (_req, res) => res.send({ image: true }),
    });
    const result = await invoke(h, "/favicon", { domain: "vidbee.org" });
    expect(result.status).to.equal(200);
    expect(result.body).to.deep.equal({ image: true });
  });
  it("maps overview from dimensionless GA4 totals without adding bucket users", async () => {
    const result = await invoke(handler({ run: async () => ({ ...reports([row([], [7, 20, 5, 2.85, 0.2, 30, 3, 12.5, 2, 4])]), metadata: { currencyCode: 'CNY' } }) }), "/sites/123/overview", dates);
    expect(result.body.data).to.deep.equal({
      sessions: 7,
      pageviews: 20,
      users: 5,
      pages_per_session: 2.85,
      bounce_rate: 20,
      session_duration: 30,
      new_users: 3,
      revenue: 12.5,
      key_events: 2,
      active_users: 4,
      currency_code: 'CNY',
    });
  });
  it("validates connected properties before any data query", async () => {
    let calls = 0;
    const h = handler({
      run: async () => {
        calls++;
        return reports([]);
      },
    });
    expect((await invoke(h, "/sites/999/overview", dates)).status).to.equal(
      404
    );
    expect(calls).to.equal(0);
  });
  it("rejects writes while allowing read-only site card batches", async () => {
    expect(
      (await invoke(handler(), "/sites/123/overview", dates, "POST")).status
    ).to.equal(405);
    expect(
      (
        await invoke(
          handler(),
          "/organizations/ga4/site-cards",
          dates,
          "POST",
          { siteIds: ["999"] }
        )
      ).status
    ).to.equal(400);
  });
  it("deduplicates concurrent identical queries and limits GA4 fan-out to three", async () => {
    let active = 0,
      peak = 0,
      calls = 0;
    const h = handler({
      run: async () => {
        calls++;
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 8));
        active--;
        return reports([row([], [7, 20, 5, 2.85, 0.2, 30])]);
      },
    });
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        invoke(h, "/sites/123/overview", {
          ...dates,
          filters: JSON.stringify([
            {
              parameter: "country",
              type: "equals",
              value: [String(Math.floor(i / 2))],
            },
          ]),
        })
      )
    );
    expect(calls).to.equal(6);
    expect(peak).to.equal(3);
  });
  it("does not cache failed GA4 reports as zero traffic", async () => {
    let calls = 0;
    const h = handler({
      run: async () =>
        ++calls === 1
          ? { ok: false, error: "Quota exhausted", errorCode: 8 }
          : reports([]),
    });
    expect((await invoke(h, "/sites/123/overview", dates)).status).to.equal(
      429
    );
    expect((await invoke(h, "/sites/123/overview", dates)).status).to.equal(
      200
    );
    expect(calls).to.equal(2);
  });
  it("counts section sessions with a filtered aggregate instead of summing distinct sessions", async () => {
    const calls = [];
    const h = handler({
      run: async (q) => {
        calls.push(q);
        const dims = q.dimensions.map((d) => d.name);
        if (dims.join() === "pagePath")
          return reports([
            row(["/blog/a"], [8, 6, 0.2, 80]),
            row(["/blog/b"], [7, 5, 0.3, 70]),
          ]);
        if (dims.join() === "landingPage")
          return reports([row(["/blog/a"], [4])]);
        if (dims.join() === "pagePath,pageTitle")
          return reports([
            row(["/blog/a", "A"], [8]),
            row(["/blog/b", "B"], [7]),
          ]);
        return reports([row([], [15, 7, 0.2, 150])]);
      },
    });
    const result = await invoke(h, "/sites/123/pages", {
      ...dates,
      group: "section",
    });
    expect(result.body.data.data[0]).to.include({
      kind: "section",
      pageviews: 15,
      sessions: 7,
    });
    expect(
      calls.find((q) => !q.dimensions.length).dimensionFilter.filter
        .inListFilter.values
    ).to.deep.equal(["/blog/a", "/blog/b"]);
  });
  it("keeps successful homepage cards when another property report fails", async () => {
    const h = handler({
      properties: async () => ({ properties: [{ id: "123" }, { id: "456" }] }),
      run: async (q) =>
        q.propertyId === "456"
          ? { ok: false, error: "No access" }
          : reports([row([], [7, 20, 5, 2.85, 0.2, 30])]),
    });
    const r = await invoke(h, "/organizations/ga4/site-cards", dates, "POST", {
      siteIds: ["123", "456"],
    });
    expect(r.status).to.equal(200);
    expect(r.body.data["123"].current.sessions).to.equal(7);
    expect(r.body.data["456"]).to.deep.equal({ error: "No access" });
  });
  it("uses session counts for native tables labelled Sessions", async () => {
    const calls = [];
    const h = handler({
      run: async (q) => {
        calls.push(q);
        return reports([
          row(
            q.dimensions.length ? ["Chrome"] : [],
            q.dimensions.length ? [7, 20, 0.2, 80] : [10, 30]
          ),
        ]);
      },
    });
    const result = await invoke(h, "/sites/123/metric", {
      ...dates,
      parameter: "browser",
    });
    expect(calls[0].metrics[0].name).to.equal("sessions");
    expect(result.body.data.data[0]).to.include({ count: 7, percentage: 70 });
  });
  it("reports unavailable event parameters explicitly", async () => {
    const r = await invoke(
      handler({ run: async () => reports([]) }),
      "/sites/123/events/properties",
      dates
    );
    expect(r.status).to.equal(422);
    expect(r.body.error).to.include("registered custom dimensions");
  });
  it("applies the overview window and filters to extra engagement reports", async () => {
    const calls = [];
    const h = handler({ run: async q => { calls.push(q); return reports([row(['chatgpt.com', 'referral'], [10, 8, 200, 5, 2])]); } });
    const r = await invoke(h, '/sites/123/ga4/source-engagement', { ...dates, filters: JSON.stringify([{ parameter: 'channel', type: 'equals', value: ['AI Assistant'] }]) });
    expect(r.status).to.equal(200);
    expect(r.body.data.rows[0].metrics).to.deep.equal([10, 80, 40, 2]);
    expect(calls[0].dateRange).to.deep.equal({ startDate: dates.start_date, endDate: dates.end_date });
    expect(calls[0].dimensionFilter.filter).to.include({ fieldName: 'sessionDefaultChannelGroup' });
    expect(calls[0].dimensionFilter.filter.stringFilter.value).to.equal('AI Assistant');
  });
  it("combines a referring URL report's own-host exclusion with dashboard filters", async () => {
    const calls = [];
    const h = handler({ run: async q => { calls.push(q); return reports([row(['https://chatgpt.com/search'], [4, 3, 60, 2, 1])]); } });
    const r = await invoke(h, '/sites/123/ga4/referrers', { ...dates, filters: JSON.stringify([{ parameter: 'device_type', type: 'equals', value: ['desktop'] }]) });
    expect(r.status).to.equal(200);
    expect(calls[0].dimensionFilter.andGroup.expressions).to.have.length(2);
    expect(calls[0].dimensionFilter.andGroup.expressions[0].filter.fieldName).to.equal('deviceCategory');
    expect(calls[0].dimensionFilter.andGroup.expressions[1].notExpression.filter.fieldName).to.equal('pageReferrer');
    expect(r.body.data.groups[0].rows[0].url).to.equal('https://chatgpt.com/search');
  });
  it("preserves revenue currency and key-event filtering within the selected audience", async () => {
    const calls = [];
    const h = handler({ run: async q => {
      calls.push(q);
      return { ...reports(q.dimensions.length ? [row(['checkout'], [2, 8])] : [row([], [5, 100, 10, 1, 2, 8])]), metadata: { currencyCode: 'USD' } };
    } });
    const r = await invoke(h, '/sites/123/ga4/revenue-key-events', { ...dates, filters: JSON.stringify([{ parameter: 'country', type: 'equals', value: ['US'] }]) });
    expect(r.status).to.equal(200);
    expect(r.body.data.currencyCode).to.equal('USD');
    expect(r.body.data.rows[0]).to.deep.equal({ dims: ['checkout'], metrics: [2, 8] });
    expect(calls[1].dimensionFilter.andGroup.expressions.map(e => e.filter.fieldName)).to.deep.equal(['countryId', 'isKeyEvent']);
  });
  it("validates supplemental reports and exposes GA4 failures instead of empty data", async () => {
    const h = handler({ run: async () => ({ ok: false, error: 'Quota exhausted', errorCode: 8 }) });
    expect((await invoke(h, '/sites/123/ga4/unknown', dates)).status).to.equal(404);
    const r = await invoke(h, '/sites/123/ga4/revenue-key-events', dates);
    expect(r.status).to.equal(429);
    expect(r.body.error).to.equal('Quota exhausted');
  });
  it("keeps native real week buckets aligned to ISO weeks", () => {
    expect(timeValue("202601", "week")).to.equal("2025-12-29 00:00:00");
    expect(timeValue("202610", "month")).to.equal("2026-10-01 00:00:00");
  });
});
describe("native date and filter safeguards", () => {
  it("uses the property calendar and clamps future end dates", () => {
    expect(
      windowFor(
        { start_date: "2026-10-01", end_date: "2026-11-01" },
        "Asia/Shanghai",
        new Date("2026-10-21T18:00:00Z")
      )
    ).to.deep.equal({ startDate: "2026-10-01", endDate: "2026-10-22" });
  });
  it("rejects invalid dates and incomplete subday windows", () => {
    for (const q of [
      { start_date: "2026-02-30", end_date: "2026-03-01" },
      { past_minutes_start: -30 },
      { start_datetime: "2026-10-01T00:00:00Z" },
      { start_date: "2026-10-23", end_date: "2026-10-24" },
    ])
      expect(() => windowFor(q, "UTC", new Date("2026-10-22"))).to.throw();
  });
  it("rejects malformed and unsupported filters before a GA4 call", () => {
    for (const raw of [
      "{",
      {},
      [{ parameter: "user_id", type: "equals", value: ["a"] }],
      [{ parameter: "country", type: "equals", value: [] }],
    ])
      expect(() => filtersFor(raw)).to.throw();
  });
  it("translates native subdivision and city filter IDs into GA4 names with country scope", () => {
    const f = filtersFor([
      { parameter: "city", type: "equals", value: ["US-CA-San Jose"] },
    ]);
    expect(
      f.andGroup.expressions.map((e) => [
        e.filter.fieldName,
        e.filter.stringFilter.value,
      ])
    ).to.deep.equal([
      ["city", "San Jose"],
      ["countryId", "US"],
      ["region", "California"],
    ]);
  });
  it("keeps negative multi-value filters grouped correctly", () => {
    const f = filtersFor([
      { parameter: "country", type: "not_equals", value: ["US", "IN"] },
    ]);
    expect(
      f.notExpression.orGroup.expressions.map(
        (x) => x.filter.stringFilter.value
      )
    ).to.deep.equal(["US", "IN"]);
  });
});
describe("restored homepage anomaly model", () => {
  it("clamps viewer rules and retains all quiet and failed properties", () => {
    const r = scoreRealtime(
      [
        { propertyId: "1", activeUsers: 30, baseline: 10, baselineSd: 2 },
        { propertyId: "2", activeUsers: 0 },
        { propertyId: "3", errorMessage: "No access" },
      ],
      { z: 99, lift: 0 }
    );
    expect(r.rule).to.deep.equal({ z: 6, lift: 1 });
    expect(r.data).to.have.length(3);
    expect(r.data[0].spike.isSpike).to.equal(true);
    expect(r.data[1].spike.isSpike).to.equal(false);
    expect(r.data[2].spike).to.equal(null);
  });
});
