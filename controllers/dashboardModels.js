// GA4-only view models. Presentation stays in the copied Rybbit component library.
const { summarize } = require("../public/js/siteStatus");
const { scoreSpike, parseSpikeOpts } = require("./spikeDetector");

exports.scoreRealtime = (rows, query) => {
  const rule = parseSpikeOpts(query);
  return {
    rule,
    data: rows.map((row) => ({
      ...row,
      spike:
        row.error || row.errorMessage
          ? null
          : scoreSpike(
              row.activeUsers || 0,
              row.baseline,
              row.baselineSd,
              rule
            ),
    })),
  };
};
exports.sitesSnapshot = async (_req, res, next) => {
  try {
    const { snapshot, adsense } =
      await require("./sitesController").loadSitesSnapshot();
    res
      .set("Cache-Control", "no-store")
      .json({
        ...summarize(snapshot, adsense),
        generatedAt: snapshot?.generatedAt || null,
        adsense,
      });
  } catch (err) {
    next(err);
  }
};
