const { expect } = require("chai");
const fs = require("fs");

const home = fs.readFileSync("views/home.hbs", "utf8");
const main = fs.readFileSync("public/js/main.js", "utf8");

describe("homepage property actions", () => {
  it("renders card hover actions and no card modal", () => {
    expect(main).to.include("Open GA4");
    expect(main).to.include("Report");
    expect(main).to.include("Visit site");
    expect(home).to.not.include("cardModal");
    expect(main).to.not.include("cardModal");
  });

  it("does not render the removed spike rail", () => {
    expect(home).to.not.include('id="spikeInsightsContainer"');
    expect(main).to.not.include("spikeInsightsContainer");
    expect(home).to.include('id="spikeBanner"');
  });
});
