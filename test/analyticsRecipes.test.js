const { expect } = require("chai");

const {
  getAnalyticsCardConfig,
  getAnalyticsCardCacheKey,
  getAnalyticsCatalog,
  getDateRange,
  getPreviousDateRange,
  attachPrev,
} = require("../controllers/analyticsRecipes");

describe("analytics recipes", () => {
  it("returns stable date range presets", () => {
    expect(getDateRange("today")).to.deep.equal({
      startDate: "today",
      endDate: "today",
    });
    expect(getDateRange("unknown")).to.deep.equal({
      startDate: "27daysAgo",
      endDate: "today",
    });
  });

  it("keeps card API config separate from UI catalog metadata", () => {
    const config = getAnalyticsCardConfig("traffic-sources");
    expect(config.dimensions).to.deep.equal(["sessionSource", "sessionMedium"]);
    expect(config.metrics).to.deep.equal(["sessions", "activeUsers"]);
    expect(config.limit).to.equal(10);
    expect(config).to.not.have.property("icon");
  });

  it("exposes catalog cards grouped for the analytics UI", () => {
    const catalog = getAnalyticsCatalog();
    const traffic = catalog.find((card) => card.type === "traffic-sources");

    expect(catalog.length).to.be.greaterThan(5);
    expect(traffic).to.include({
      type: "traffic-sources",
      title: "Traffic Sources",
      group: "Acquisition",
    });
    expect(traffic).to.have.property("icon");
  });

  it("uses native GA4 audience dimensions with sessions as the ranking metric", () => {
    const dimensions = {
      countries: ['country', 'countryId'], regions: ['countryId', 'region'], cities: ['countryId', 'region', 'city'],
      languages: ['languageCode'], browsers: ['browser'], devices: ['deviceCategory'],
      'operating-systems': ['operatingSystem'], 'screen-resolutions': ['screenResolution'],
    };
    const catalog = getAnalyticsCatalog();
    for (const [type, expected] of Object.entries(dimensions)) {
      const config = getAnalyticsCardConfig(type);
      expect(config.dimensions, type).to.deep.equal(expected);
      expect(config.metrics[0], type).to.equal('sessions');
      expect(catalog.some(c => c.type === type), type).to.equal(true);
    }
    expect(getAnalyticsCardConfig('timezones')).to.equal(null);
  });

  it("keeps incompatible old country and browser cache entries out of the new reports", () => {
    expect(getAnalyticsCardCacheKey('123', 'countries', '28d')).to.not.equal('123:countries:28d');
    expect(getAnalyticsCardCacheKey('123', 'browsers', '28d')).to.not.equal('123:browsers:28d');
    expect(getAnalyticsCardCacheKey('123', 'traffic-sources', '28d')).to.equal('123:traffic-sources:28d');
    expect(getAnalyticsCardCacheKey('123', 'source-split', '7d', 'medium')).to.equal('123:source-split:7d:medium');
  });

  it("returns the same-length window before each range", () => {
    expect(getPreviousDateRange("today")).to.deep.equal({ startDate: "yesterday", endDate: "yesterday" });
    expect(getPreviousDateRange("7d")).to.deep.equal({ startDate: "13daysAgo", endDate: "7daysAgo" });
    expect(getPreviousDateRange("28d")).to.deep.equal({ startDate: "55daysAgo", endDate: "28daysAgo" });
    expect(getPreviousDateRange("unknown")).to.deep.equal({ startDate: "55daysAgo", endDate: "28daysAgo" });
  });

  it("matches previous rows on all dimensions", () => {
    const rows = [
      { dims: ["google", "organic"], metrics: [10, 8] },
      { dims: ["bing", "organic"], metrics: [5, 4] },
      { dims: ["google", "cpc"], metrics: [3, 3] },
    ];
    const prev = [
      { dims: ["google", "organic"], metrics: [7, 6] },
      { dims: ["google", "cpc"], metrics: [9, 9] },
    ];
    const out = attachPrev(rows, prev);
    expect(out.map(r => r.prev)).to.deep.equal([[7, 6], null, [9, 9]]);
    expect(out[0].metrics).to.deep.equal([10, 8]);
  });
});
