const { expect } = require("chai");
const { buildGlobeUsersPayload, autoInterval, refreshInfo } = require("../controllers/globeUsers");

const row = (dims, mets) => ({
  dimensionValues: dims.map((value) => ({ value })),
  metricValues: mets.map((value) => ({ value: String(value) })),
});
const coords = (city) => ({ Pune: [18.52, 73.86], Dublin: [53.33, -6.25] })[city] || null;

describe("globe users payload", () => {
  const prop = { id: "1", site: "quiz.example", domain: "quiz.example" };
  const users = [{
    prop,
    rows: [
      row(["Pune", "IN", "mobile", "web"], [5, 12, 1]),
      row(["Pune", "IN", "desktop", "web"], [1, 2, 0]),
      row(["Dublin", "IE", "desktop", "Android"], [2, 3, 0]),
      row(["(not set)", "", "mobile", "web"], [37, 40, 0]),
    ],
  }];
  const events = [{
    prop,
    rows: [
      row(["Pune", "Love Quiz", "3"], [4, 0]),
      row(["Pune", "Love Quiz", "0"], [1, 1]),
      row(["Pune", "Result", "0"], [6, 0]),
      row(["Dublin", "Home", "1"], [2, 0]),
    ],
  }];
  const p = buildGlobeUsersPayload(users, events, coords);

  it("sorts the feed by minutesAgo, then count descending", () => {
    expect(p.feed.map((f) => [f.minutesAgo, f.count])).to.deep.equal([[0, 6], [0, 1], [1, 2], [3, 4]]);
    expect(p.feed[3]).to.include({ city: "Pune", countryId: "IN", page: "Love Quiz", event: "page_view" });
  });

  it("flags feed rows with key events and totals key events from query 1", () => {
    expect(p.feed[1].isKey).to.equal(true);
    expect(p.feed[0].isKey).to.equal(false);
    expect(p.keyEvents).to.equal(1);
  });

  it("turns an empty country ID into (not set)", () => {
    const c = p.countries.find((x) => x.count === 37);
    expect(c).to.deep.equal({ name: "(not set)", id: "(not set)", count: 37 });
  });

  it("adds per-city country name, views, devices, top site, top page and key events", () => {
    const pune = p.users.find((u) => u.city === "Pune");
    expect(pune).to.include({ country: "India", countryId: "IN", count: 6, views: 14, topSite: "quiz.example", topPage: "Result", keyEvents: 1, device: "mobile" });
    expect(pune.devices).to.deep.equal({ mobile: 5, desktop: 1, tablet: 0 });
    expect(pune.lastSeen).to.be.a("number");
    expect(pune.sites).to.deep.equal([{ id: "1", name: "quiz.example", users: 6, views: 14, keyEvents: 1, topPage: "Result" }]);
    expect(p.totalActiveUsers).to.equal(45);
    expect(p.platforms).to.deep.equal([{ name: "web", count: 43 }, { name: "android", count: 2 }]);
  });
});

describe("globe auto refresh interval", () => {
  it("clamps low to 30 s", () => {
    expect(autoInterval({ tokensPerPoll: 1, remaining: 14000 })).to.equal(30);
  });
  it("clamps high to 300 s", () => {
    expect(autoInterval({ tokensPerPoll: 500, remaining: 1000 })).to.equal(300);
  });
  it("rounds up to the next 15 s", () => {
    // 3600 * 44 / 3500 = 45.26 -> 46 -> 60
    expect(autoInterval({ tokensPerPoll: 44, remaining: 14000 })).to.equal(60);
  });
  it("reports the busiest property and throttles under 10%", () => {
    const q = new Map([
      ["a", { tokensPerProjectPerHour: { consumed: 2, remaining: 13000 }, tokensPerHour: { consumed: 2, remaining: 39000 } }],
      ["b", { tokensPerProjectPerHour: { consumed: 2, remaining: 1000 }, tokensPerHour: { consumed: 2, remaining: 39000 } }],
    ]);
    const r = refreshInfo(q, new Map([["a", 10], ["b", 10]]));
    expect(r).to.include({ perHour: 14000, usedThisHour: 13000, busiestPropertyId: "b", throttled: true });
  });
  it("sizes the interval from per-property cost, not the summed cost", () => {
    const q = new Map([
      ["a", { tokensPerProjectPerHour: { consumed: 40, remaining: 13000 } }],
      ["b", { tokensPerProjectPerHour: { consumed: 40, remaining: 13000 } }],
    ]);
    const r = refreshInfo(q, new Map([["a", 40], ["b", 40]]));
    // per property: ceil(3600*40/3250) = 45 -> 45 s; summed 80 would be 89 -> 90 s
    expect(r.autoSec).to.equal(45);
    expect(r.tokensPerPoll).to.equal(40);
  });
  it("assumes the 14,000 project limit when the project bucket is missing", () => {
    // Property bucket: 40,000 limit, 2,000 used this hour -> project remaining 14,000 - 2,000 = 12,000.
    const r = refreshInfo(new Map([["a", { tokensPerHour: { consumed: 38, remaining: 38000 } }]]), new Map([["a", 38]]));
    expect(r).to.include({ perHour: 14000, usedThisHour: 2000, throttled: false });
    expect(r.perHour).to.not.equal(40000);
  });
});

describe("globe clusterMarks", () => {
  const { clusterMarks } = require("../public/js/clusterMarks");
  it("merges close points into the largest one, keeps far points apart", () => {
    const g = clusterMarks([
      { id: "a", x: 100, y: 100, count: 2 },
      { id: "b", x: 120, y: 110, count: 9 },
      { id: "c", x: 300, y: 300, count: 1 },
    ], 40);
    expect(g).to.have.length(2);
    expect(g[0]).to.include({ x: 120, y: 110, count: 11 });
    expect(g[0].items.map((p) => p.id)).to.deep.equal(["b", "a"]);
    expect(g[1].items.map((p) => p.id)).to.deep.equal(["c"]);
  });
  it("hysteresis: a previous group stays merged up to splitPx, new pairs merge only at radiusPx", () => {
    const pts = [{ i: 1, x: 0, y: 0, count: 5 }, { i: 2, x: 60, y: 0, count: 1 }];
    expect(clusterMarks(pts, 56)).to.have.length(2);
    expect(clusterMarks(pts, 56, { splitPx: 64, prev: [[1, 2]] })).to.have.length(1);
    pts[1].x = 70;
    expect(clusterMarks(pts, 56, { splitPx: 64, prev: [[1, 2]] })).to.have.length(2);
  });
});
