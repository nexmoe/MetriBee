const { expect } = require("chai");
const { classifyReferralSource } = require("../controllers/spikeDetector");

describe("spike detector referral classification", () => {
  it("classifies known referral sources", () => {
    expect(classifyReferralSource("news.ycombinator.com")).to.include({
      category: "hn",
      name: "Hacker News",
    });
    expect(classifyReferralSource("t.co")).to.include({
      category: "twitter",
      name: "X / Twitter",
    });
  });

  it("classifies empty and direct sources as direct traffic", () => {
    expect(classifyReferralSource("(direct)")).to.include({
      category: "direct",
      name: "Direct / Bookmark",
    });
    expect(classifyReferralSource("")).to.include({
      category: "direct",
      name: "Direct / Bookmark",
    });
  });
});

describe("spike detector baseline", () => {
  const row = (dateHour, users) => ({
    dimensionValues: [{ value: dateHour }],
    metricValues: [{ value: String(users) }],
  });

  it("averages each day's busiest hour, halved for the 30-minute window", () => {
    const { peakHalfHourBaseline } = require("../controllers/spikeDetector");
    const rows = [row("2026100810", 40), row("2026100803", 5), row("2026100910", 80), row("2026100902", 2)];
    expect(peakHalfHourBaseline(rows)).to.equal(30);
  });

  it("falls back to 1 with no history", () => {
    const { peakHalfHourBaseline } = require("../controllers/spikeDetector");
    expect(peakHalfHourBaseline([])).to.equal(1);
  });

  it("same-hour baseline averages only the matching hour, with dod and wow", () => {
    const { sameHourBaseline } = require("../controllers/spikeDetector");
    const rows = [];
    for (let d = 1; d <= 7; d++) rows.push(row(`202610${String(d).padStart(2, "0")}03`, d * 2), row(`202610${String(d).padStart(2, "0")}14`, 100));
    // hour 03: 2,4,...,14 halved 1..7, avg 4, sample sd sqrt(28/6)
    expect(sameHourBaseline(rows, "03")).to.deep.equal({ baseline: 4, sd: 2.97, dod: 14, wow: 2 });
    expect(sameHourBaseline(rows, "22")).to.equal(null);
  });

  it("hourIn reads the hour in the property timezone", () => {
    const { hourIn } = require("../controllers/spikeDetector");
    expect(hourIn("Asia/Kolkata", new Date("2026-10-09T00:00:00Z"))).to.equal("05");
  });

  it("one viral day does not inflate the usual level or spread", () => {
    const { sameHourBaseline, scoreSpike } = require("../controllers/spikeDetector");
    const hours = [100, 104, 96, 102, 98, 100, 1000];
    const rows = hours.map((u, i) => row(`2026100${i + 1}03`, u));
    const b = sameHourBaseline(rows, "03");
    expect(b.baseline).to.equal(50);
    expect(b.sd).to.be.below(3);
    expect(scoreSpike(100, b.baseline, b.sd).isSpike).to.equal(true);
  });

  it("propertyBaseline caches history for an hour", async () => {
    const { propertyBaseline } = require("../controllers/spikeDetector");
    let calls = 0;
    const fetchHistory = async () => { calls++; return [row("2026100803", 10), row("2026100903", 6)]; };
    const deps = { fetchHistory, timeZone: async () => "UTC", now: new Date("2026-10-10T03:10:00Z") };
    const prop = { id: "test-cache-prop" };
    const a = await propertyBaseline(prop, deps);
    const b = await propertyBaseline(prop, { ...deps, now: new Date("2026-10-10T03:50:00Z") });
    expect(calls).to.equal(1);
    expect(a).to.deep.equal({ baseline: 4, sd: null, kind: "same-hour", dod: 6, wow: null });
    expect(b).to.deep.equal(a);
    await propertyBaseline(prop, { ...deps, now: new Date("2026-10-10T04:11:00Z") });
    expect(calls).to.equal(2);
  });

  it("propertyBaseline retries a failed timezone lookup without refetching history", async () => {
    const { propertyBaseline } = require("../controllers/spikeDetector");
    let tz = null;
    const deps = { fetchHistory: async () => [row("2026100903", 10)], timeZone: async () => tz, now: new Date("2026-10-10T03:10:00Z") };
    const prop = { id: "test-tz-retry" };
    expect((await propertyBaseline(prop, deps)).kind).to.equal("peak");
    tz = "UTC";
    expect((await propertyBaseline(prop, deps)).kind).to.equal("same-hour");
  });
});

describe("scoreSpike", () => {
  const { scoreSpike, parseSpikeOpts } = require("../controllers/spikeDetector");
  const spike = (a, b, sd = null, opts) => scoreSpike(a, b, sd, opts).isSpike;

  it("does not call a handful of users a spike", () => {
    expect(spike(4, 1)).to.equal(false);
    expect(spike(12, 6)).to.equal(false);
  });
  it("flags clear surges over the usual", () => {
    expect(spike(6, 1)).to.equal(true);
    expect(spike(16, 6)).to.equal(true);
    expect(spike(378, 172, 20)).to.equal(true);
  });
  it("needs real lift on big properties", () => {
    expect(spike(260, 247)).to.equal(false);
  });
  it("a noisy hour (large sd) suppresses the spike", () => {
    expect(spike(40, 20, 15)).to.equal(false);
    expect(scoreSpike(40, 20, 15).z).to.be.closeTo(1.33, 0.01);
  });
  it("returns plain ratio and z, and marks above-usual below the spike line", () => {
    const s = scoreSpike(12, 6, null);
    expect(s.ratio).to.equal(2);
    expect(s.z).to.be.closeTo(2.27, 0.01);
    expect(s.above).to.equal(true);
    expect(scoreSpike(5, 0, null)).to.deep.equal({ z: 0, ratio: 0, isSpike: false, above: false });
  });
  it("honors custom thresholds", () => {
    expect(spike(12, 6, null, { z: 2, lift: 1.5 })).to.equal(true);
  });
  it("parseSpikeOpts clamps and ignores invalid values", () => {
    expect(parseSpikeOpts({})).to.deep.equal({ z: 3, lift: 1.5 });
    expect(parseSpikeOpts({ z: "9", lift: "0.2" })).to.deep.equal({ z: 6, lift: 1 });
    expect(parseSpikeOpts({ z: "abc", lift: "1.3" })).to.deep.equal({ z: 3, lift: 1.3 });
  });
});
