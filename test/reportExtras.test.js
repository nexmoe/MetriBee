const { expect } = require("chai");
const {
  botReason,
  engagementStats,
  flagBots,
  groupReferrers,
  hasRevenueData,
  isOwnHost,
  runExtraCard,
} = require("../controllers/reportExtras");
const { getAnalyticsCardConfig } = require("../controllers/analyticsRecipes");

describe("report extras", () => {
  it("computes engagement rate and avg time per user", () => {
    expect(engagementStats({ sessions: 10, engagedSessions: 4, duration: 300, users: 5 })).to.deep.equal({
      engagementRate: 0.4,
      avgEngagement: 60,
    });
    expect(engagementStats({})).to.deep.equal({ engagementRate: 0, avgEngagement: 0 });
  });

  it("flags low-engagement rows and datacenter cities", () => {
    expect(botReason({ city: "Paris", sessions: 20, engagedSessions: 1, duration: 10 })).to.equal("Low engagement");
    expect(botReason({ city: "Paris", sessions: 9, engagedSessions: 0, duration: 0 })).to.equal(null);
    expect(botReason({ city: "Ashburn", sessions: 3, engagedSessions: 0, duration: 50 })).to.equal("Datacenter city");
    expect(botReason({ city: "Ashburn", sessions: 10, engagedSessions: 5, duration: 500 })).to.equal(null);

    const flagged = flagBots(
      [
        { city: "Boardman", sessions: 5, engagedSessions: 0, duration: 0 },
        { city: "Pune", sessions: 50, engagedSessions: 30, duration: 900 },
      ],
      100,
    );
    expect(flagged).to.have.length(1);
    expect(flagged[0]).to.include({ city: "Boardman", reason: "Datacenter city", share: 0.05 });
  });

  it("groups referrers by platform and drops own domain and empty rows", () => {
    const groups = groupReferrers(
      [
        { url: "https://www.reddit.com/r/webdev/comments/abc/", sessions: 5 },
        { url: "https://old.reddit.com/r/selfhosted/", sessions: 3 },
        { url: "https://t.co/xyz", sessions: 4 },
        { url: "https://chatgpt.com/", sessions: 1 },
        { url: "https://blog.example.org/post", sessions: 2 },
        { url: "https://www.mysite.com/about", sessions: 40 },
        { url: "", sessions: 99 },
      ],
      "mysite.com",
    );
    expect(groups.map((g) => g.name)).to.deep.equal(["Reddit", "X / Twitter", "blog.example.org", "ChatGPT / OpenAI"]);
    expect(groups[0].sessions).to.equal(8);
    expect(groups[0].rows[0].url).to.equal("https://www.reddit.com/r/webdev/comments/abc/");
    expect(isOwnHost("app.mysite.com", "www.mysite.com")).to.equal(true);
    expect(isOwnHost("notmysite.com", "mysite.com")).to.equal(false);
  });

  it("hides the revenue card when every metric is zero", async () => {
    expect(hasRevenueData({ totalAdRevenue: 0, keyEvents: 0 })).to.equal(false);
    expect(hasRevenueData({ totalAdRevenue: 0, keyEvents: 3 })).to.equal(true);

    const run = async () => ({
      ok: true,
      usedMetrics: [{ name: "purchaseRevenue" }, { name: "keyEvents" }, { name: "eventValue" }],
      rows: [{ metricValues: [{ value: "0" }, { value: "0" }, { value: "0" }] }],
    });
    const result = await runExtraCard({
      cfg: getAnalyticsCardConfig("revenue-key-events"),
      type: "revenue-key-events",
      propertyId: "1",
      dateRange: {},
      run,
    });
    expect(result).to.include({ kind: "revenue", hidden: true });
  });
});
