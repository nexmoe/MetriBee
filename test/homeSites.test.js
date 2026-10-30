const { expect } = require("chai");
const { createRybbitHandler } = require("../controllers/rybbit");
const { buildHomeSites } = require("../controllers/homeSites");
const range = { startDate: "2026-10-12", endDate: "2026-10-14" };
const comparison = { startDate: "2026-10-09", endDate: "2026-10-11" };
const query = (value) => ({
  start_date: value.startDate,
  end_date: value.endDate,
  bucket: "day",
});
const property = { id: "123", site: "Test - GA4", domain: "example.com" };
const now = new Date("2026-10-22T12:00:00Z");
const row = (date, sessions) => ({
  dimensionValues: date ? [{ value: date }] : [],
  metricValues: [sessions, 0, 0, 0, 0, 0, 0, 0, 0, 0].map((value) => ({
    value: String(value),
  })),
});
const report = (rows) => ({ ok: true, rows, rowCount: rows.length });

async function invoke(
  handler,
  dates = range,
  previous = comparison,
  path = "site-status",
  ids = [123]
) {
  const result = { status: 200 };
  await handler(
    {
      method: "POST",
      path: `/organizations/ga4/${path}`,
      query: query(dates),
      body: { siteIds: ids, comparison: previous ? query(previous) : null },
    },
    {
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

describe("homepage date-filtered site views", () => {
  function setup(overrides = {}) {
    const calls = [],
      cache = new Map();
    const handler = createRybbitHandler({
      properties: async () => ({ properties: [property] }),
      now: () => now,
      snapshot: async () => ({ snapshot: null, adsense: null }),
      readEntry: async (namespace, key) => cache.get(`${namespace}:${key}`),
      write: async (namespace, key, data, options) =>
        cache.set(`${namespace}:${key}`, { data, cachedAt: options.cachedAt }),
      run: async (request) => {
        calls.push(request);
        return report(
          request.dimensions.length
            ? [
                row(request.dateRange.startDate.replaceAll("-", ""), 100),
                row(request.dateRange.endDate.replaceAll("-", ""), 200),
              ]
            : [
                row(
                  null,
                  request.dateRange.startDate === comparison.startDate
                    ? 100
                    : 300
                ),
              ]
        );
      },
      ...overrides,
    });
    return { handler, calls };
  }

  it("uses the cards date and comparison queries, fills missing heatmap buckets and reuses their cache", async () => {
    const { handler, calls } = setup();
    const cards = await invoke(handler, range, comparison, "site-cards");
    const result = await invoke(handler);
    expect(result.status).to.equal(200);
    expect(result.body.data.range).to.deep.equal(range);
    expect(result.body.data.comparison).to.deep.equal(comparison);
    expect(result.body.data.days).to.deep.equal([
      "2026-10-12 00:00:00",
      "2026-10-13 00:00:00",
      "2026-10-14 00:00:00",
    ]);
    expect(result.body.data.sites[0].vals).to.deep.equal([100, 0, 200]);
    expect(result.body.data.sites[0].last).to.equal(
      cards.body.data[123].current.sessions
    );
    expect(result.body.data.sites[0].prev).to.equal(
      cards.body.data[123].previous.sessions
    );
    expect(calls).to.have.length(3);
    expect(result.body.reportStatus).to.deep.equal({
      fetchedAt: now.toISOString(),
      cacheStatus: "cached",
    });
  });

  it("fetches the newly selected dates rather than returning the old period", async () => {
    const { handler, calls } = setup();
    await invoke(handler);
    const changed = await invoke(
      handler,
      { startDate: "2026-10-01", endDate: "2026-10-07" },
      null
    );
    expect(changed.body.data.days).to.have.length(7);
    expect(changed.body.data.range.startDate).to.equal("2026-10-01");
    expect(
      calls.slice(-2).every((call) => call.dateRange.startDate === "2026-10-01")
    ).to.equal(true);
    expect(changed.body.data.sites[0].prev).to.equal(null);
    expect(changed.body.data.sites[0].change).to.equal(null);
  });

  it("does not classify failed property reports as zero traffic", async () => {
    const { handler } = setup({
      run: async () => ({ ok: false, error: "Quota exhausted", errorCode: 8 }),
    });
    const result = await invoke(handler);
    expect(result.body.data.sites[0]).to.include({
      last: null,
      prev: null,
      error: "Quota exhausted",
    });
    expect(result.body.data.sites[0].st.k).to.equal("error");
    expect(result.body.data.sites[0].vals).to.deep.equal([null, null, null]);
  });

  it("keeps current data when only the comparison is unavailable", async () => {
    const { handler } = setup({
      run: async (request) =>
        request.dateRange.startDate === comparison.startDate
          ? { ok: false, error: "Comparison unavailable" }
          : report(
              request.dimensions.length
                ? [
                    row("20261012", 100),
                    row("20261013", 100),
                    row("20261014", 100),
                  ]
                : [row(null, 300)]
            ),
    });
    const result = await invoke(handler);
    expect(result.body.data.sites[0]).to.include({
      last: 300,
      prev: null,
      change: null,
      comparisonUnavailable: true,
    });
    expect(result.body.data.sites[0].st.label).to.equal("No comparison");
  });

  it("rejects inaccessible properties and invalid dates before fetching analytics", async () => {
    const { handler, calls } = setup();
    expect(
      (await invoke(handler, range, comparison, "site-status", [999])).status
    ).to.equal(400);
    expect(
      (await invoke(handler, { startDate: "invalid", endDate: range.endDate }))
        .status
    ).to.equal(400);
    expect(calls).to.have.length(0);
  });
});

describe("selected-period site summaries", () => {
  const model = (overrides) =>
    buildHomeSites({
      range,
      comparison,
      bucket: "day",
      properties: [property],
      metrics: {
        123: {
          current: { sessions: 300 },
          previous: { sessions: 100 },
          series: ["12", "13", "14"].map((day) => ({
            time: `2026-10-${day} 00:00:00`,
            sessions: 100,
          })),
        },
      },
      now,
      ...overrides,
    });

  it("scales the low-traffic threshold with the selected duration", () => {
    expect(model({}).lowThreshold).to.equal(22);
    expect(
      model({ range: { startDate: "2026-10-01", endDate: "2026-10-14" } })
        .lowThreshold
    ).to.equal(100);
  });

  it("never interprets unelapsed buckets as tracking gaps", () => {
    const result = model({
      range: { startDate: "2026-10-22", endDate: "2026-10-22" },
      bucket: "hour",
      metrics: {
        123: {
          current: { sessions: 300 },
          previous: null,
          series: [{ time: "2026-10-22 11:00:00", sessions: 300 }],
        },
      },
      comparison: null,
    });
    expect(result.days).to.have.length(24);
    expect(result.sites[0].st.k).to.not.equal("gap");
  });

  it("sums AdSense only inside the selected and comparison periods and marks incomplete coverage unknown", () => {
    const ads = Object.fromEntries(
      ["09", "10", "11", "12", "13", "14"].map((day) => [
        `202610${day}`,
        { earnings: Number(day) < 12 ? 2 : 4, pageViews: 100 },
      ])
    );
    const saved = {
      snapshot: { properties: [{ id: 123, ads }] },
      adsense: { currency: "USD" },
    };
    const result = model(saved).sites[0];
    expect(result).to.include({ earnLast: 12, earnChange: 100, rpm: 40 });
    delete ads["20261013"];
    expect(model(saved).sites[0].earnLast).to.equal(null);
    expect(model(saved).sites[0].earnChange).to.equal(null);
    expect(model(saved).adsense.matched).to.equal(0);
  });
});
