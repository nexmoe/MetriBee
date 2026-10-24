const { expect } = require("chai");
const { analyticsUrl, websiteUrl } = require("../controllers/propertyActions");

describe("property card destinations", () => {
  it("builds an Analytics URL for the selected property", () => {
    expect(analyticsUrl("123")).to.equal("/analytics?prop=123");
  });

  it("accepts HTTP(S) website URLs and rejects missing or unsafe values", () => {
    expect(websiteUrl("https://example.com/docs")).to.equal("https://example.com/docs");
    expect(websiteUrl("http://example.com")).to.equal("http://example.com");
    expect(websiteUrl("javascript:alert(1)")).to.equal(null);
    expect(websiteUrl("")).to.equal(null);
    expect(websiteUrl(null)).to.equal(null);
  });

  it("keeps the generated Analytics destination property-specific", () => {
    expect(analyticsUrl("property/with spaces")).to.equal(
      "/analytics?prop=property%2Fwith%20spaces",
    );
  });
});
