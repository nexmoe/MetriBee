const { expect } = require("chai");
const { buildVisitorPersonas } = require("../controllers/visitorInsights");

describe("visitor insights formatter", () => {
  it("builds aggregate persona cards from new and returning visitor segments", () => {
    const personas = buildVisitorPersonas({
      segmentRows: [
        {
          dimensionValues: [{ value: "new" }, { value: "Organic Search" }],
          metricValues: [
            { value: "24" },
            { value: "18" },
            { value: "12" },
            { value: "360" },
            { value: "0" },
          ],
        },
        {
          dimensionValues: [{ value: "returning" }, { value: "Direct" }],
          metricValues: [
            { value: "9" },
            { value: "12" },
            { value: "10" },
            { value: "420" },
            { value: "0" },
          ],
        },
      ],
      pageRows: [],
      timelineRows: [
        {
          dimensionValues: [{ value: "20260719" }],
          metricValues: [
            { value: "4" },
            { value: "5" },
            { value: "100" },
            { value: "12.5" },
          ],
        },
      ],
    });

    expect(personas).to.have.length(2);
    expect(personas[0]).to.include({
      id: "new-organic-search",
      visitType: "First visit",
      label: "New visitors",
      channel: "Organic Search",
      activeUsers: 24,
      intent: "Discovery",
    });
    expect(personas[0].avgEngagementSeconds).to.equal(15);
    expect(personas[0].timeline[0]).to.include({
      date: "20260719",
      activeUsers: 4,
      avgEngagementSeconds: 25,
    });
    expect(personas[1]).to.include({
      visitType: "Revisit",
      label: "Returning visitors",
      intent: "Evaluation",
    });
  });
});
