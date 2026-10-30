const { DateTime } = require("luxon");
const { windowFor, previousWindow } = require("../reportWindow");
const { failure } = require("../access");
async function collectReport({
  property,
  query,
  gateway,
  identity,
  asOf = new Date(),
}) {
  if (query.start_datetime || query.past_minutes_start)
    throw failure("PDF reports require whole calendar days.", 400);
  const range = windowFor(query, property.timeZone || "UTC", asOf);
  const days =
    Math.round(
      (Date.parse(range.endDate) - Date.parse(range.startDate)) / 86400000
    ) + 1;
  const previous = previousWindow(range);
  const q = { ...query, start_date: range.startDate, end_date: range.endDate };
  const call = (action, params = q) =>
    new Promise((resolve, reject) =>
      gateway(
        {
          identity,
          method: "GET",
          path: `/sites/${property.id}/${action}`,
          query: params,
        },
        {
          status(code) {
            this.code = code;
            return this;
          },
          send(payload) {
            if (this.code >= 400) reject(failure(payload.error, this.code));
            else resolve(payload.data);
          },
        },
        asOf
      ).catch(reject)
    );
  const [overview, previousOverview, chartData] = await Promise.all([
    call("overview"),
    call("overview", {
      ...q,
      start_date: previous.startDate,
      end_date: previous.endDate,
    }),
    call("overview/time-series", {
      ...q,
      bucket: days <= 1 ? "hour" : days <= 60 ? "day" : "week",
    }),
  ]);
  const data = {
    siteId: Number(property.id),
    siteName:
      property.site || property.name || property.domain || String(property.id),
    siteDomain: property.domain || "",
    ...range,
    timeZone: property.timeZone || query.time_zone || "UTC",
    generatedAt: DateTime.fromJSDate(asOf)
      .toUTC()
      .toFormat("MMMM d, yyyy 'at' HH:mm 'UTC'"),
    overview,
    previousOverview,
    chartData,
  };
  for (const [key, parameter] of Object.entries({
    topCountries: "country",
    topRegions: "region",
    topCities: "city",
    topPages: "pathname",
    topReferrers: "referrer",
    deviceBreakdown: "device_type",
    topBrowsers: "browser",
    topOperatingSystems: "operating_system",
  })) {
    const result = await call("metric", { ...q, parameter, limit: 13 });
    data[key] = result.data;
  }
  return data;
}
module.exports = { collectReport };
