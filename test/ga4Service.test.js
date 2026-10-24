const { expect } = require("chai");
const { runSafeRealtimeReport } = require("../controllers/ga4Service");

describe("ga4 service realtime fallback", () => {
  it("retries realtime reports with fallback metrics when GA4 rejects a metric combination", async () => {
    const calls = [];
    const fakeClient = {
      runRealtimeReport: async (request) => {
        calls.push(request);
        if (calls.length === 1) {
          const err = new Error("3 INVALID_ARGUMENT: Selected dimensions and metrics cannot be queried together");
          err.code = 3;
          throw err;
        }
        return [{ rows: [{ metricValues: [{ value: "7" }] }] }];
      },
    };

    const result = await runSafeRealtimeReport({
      propertyId: "123456789",
      dimensions: [{ name: "unifiedScreenName" }],
      metrics: [{ name: "screenPageViews" }],
      fallbackMetrics: [{ name: "activeUsers" }],
      client: fakeClient,
    });

    expect(result.ok).to.equal(true);
    expect(result.usedMetrics).to.deep.equal([{ name: "activeUsers" }]);
    expect(calls).to.have.length(2);
    expect(calls[0].metrics).to.deep.equal([{ name: "screenPageViews" }]);
    expect(calls[1].metrics).to.deep.equal([{ name: "activeUsers" }]);
  });
});
