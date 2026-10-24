const { cleanName, pct } = require("../public/js/siteStatus");
const { todayInZone } = require("./retention");
const { DateTime } = require("luxon");
const DAY = 86400000;
const iso = (value) => new Date(value).toISOString().slice(0, 10);
const dateCount = (range) =>
  Math.round((Date.parse(range.endDate) - Date.parse(range.startDate)) / DAY) +
  1;

function datesIn(range) {
  if (!range || range.startDateTime) return [];
  return Array.from({ length: dateCount(range) }, (_, i) =>
    iso(Date.parse(range.startDate) + i * DAY)
  );
}

function reportBucket(range, requested) {
  if (range.startDateTime && ["minute", "hour"].includes(requested)) return requested;
  const days = dateCount(range);
  // Keep long heatmaps bounded, while sharing the cards' normal time buckets.
  if (days > 730 && !["month", "year"].includes(requested)) return "month";
  if (days > 31 && requested === "hour") return "day";
  return ["hour", "day", "week", "month", "year"].includes(requested)
    ? requested
    : "day";
}

function bucketStart(date, bucket) {
  const value = new Date(date + "T00:00:00Z");
  if (bucket === "week")
    value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  if (bucket === "month" || bucket === "year") value.setUTCDate(1);
  if (bucket === "year") value.setUTCMonth(0);
  return iso(value);
}

function timeline(range, bucket) {
  if (range.startDateTime && ["minute", "hour"].includes(bucket)) {
    const end = DateTime.fromISO(range.endDateTime), result = [];
    for (let point = DateTime.fromISO(range.startDateTime).toUTC().startOf(bucket); point < end; point = point.plus({ [bucket]: 1 })) result.push(point.toFormat("yyyy-MM-dd HH:mm:ss"));
    return result;
  }
  if (bucket === "hour")
    return datesIn({ startDate: range.startDate, endDate: range.endDate }).flatMap((date) =>
      Array.from(
        { length: 24 },
        (_, h) => `${date} ${String(h).padStart(2, "0")}:00:00`
      )
    );
  return [
    ...new Set(datesIn({ startDate: range.startDate, endDate: range.endDate }).map((date) => bucketStart(date, bucket))),
  ].map((date) => date + " 00:00:00");
}

function earningsFor(property, currentDates, previousDates) {
  if (!property?.ads) return null;
  const sum = (dates, metric) =>
    dates.length &&
    dates.every((date) => Object.hasOwn(property.ads, date.replaceAll("-", "")))
      ? dates.reduce(
          (total, date) =>
            total +
            (Number(property.ads[date.replaceAll("-", "")]?.[metric]) || 0),
          0
        )
      : null;
  const last = sum(currentDates, "earnings"),
    prev = sum(previousDates, "earnings");
  const views = sum(currentDates, "pageViews");
  return {
    last,
    prev,
    change: last != null && prev != null ? pct(last, prev) : null,
    rpm: last != null && views ? (last / views) * 1000 : null,
  };
}

function periodStatus({ last, prev, zeroDays, lowThreshold, earn }) {
  const change = prev == null ? null : pct(last, prev);
  let st = {
    k: "steady",
    label: "Steady",
    why: "Traffic is within its usual range for the selected comparison.",
  };
  if (!last && prev === 0)
    st = {
      k: "dead",
      label: "No traffic",
      why: "No sessions in the selected or comparison period.",
    };
  else if (last >= lowThreshold && zeroDays)
    st = {
      k: "gap",
      label: `${zeroDays} zero periods`,
      why: `${zeroDays} completed time buckets have no sessions. Check the site or tag.`,
    };
  else if (!last && prev > 0)
    st = {
      k: "gone",
      label: "Stopped",
      why: `Had ${prev.toLocaleString(
        "en-US"
      )} sessions in the comparison period, none in the selected period.`,
    };
  else if (last < lowThreshold)
    st = {
      k: "low",
      label: "Low",
      why: `Under ${lowThreshold.toLocaleString(
        "en-US"
      )} sessions for this date range (50 per week).`,
    };
  else if (prev == null)
    st = {
      k: "steady",
      label: "No comparison",
      why: "Comparison is off or unavailable. Showing the selected period only.",
    };
  else if (change != null && change <= -30)
    st = {
      k: "drop",
      label: `${change}%`,
      why: `Down ${Math.abs(change)}% against the selected comparison period.`,
    };
  else if (change == null || change >= 50)
    st = {
      k: "up",
      label: change == null ? "New" : `+${change}%`,
      why:
        change == null
          ? "New traffic compared with the selected comparison period."
          : `Up ${change}% against the selected comparison period.`,
    };
  if (earn?.prev >= 5 && earn.change != null && earn.change <= -30) {
    const why = `Earnings down ${Math.abs(
      earn.change
    )}% against the selected comparison period.`;
    st = ["gap", "gone", "drop"].includes(st.k)
      ? { ...st, why: st.why + " " + why }
      : { k: "edrop", label: `Earnings ${earn.change}%`, why };
  }
  return { change, st };
}

function buildHomeSites({
  range,
  comparison,
  bucket,
  properties,
  metrics,
  snapshot,
  adsense,
  now = new Date(),
}) {
  const days = timeline(range, bucket),
    currentDates = datesIn(range),
    previousDates = datesIn(comparison);
  const durationDays = range.startDateTime ? (Date.parse(range.endDateTime) - Date.parse(range.startDateTime)) / DAY : currentDates.length;
  const lowThreshold = Math.max(1, Math.ceil((50 * durationDays) / 7));
  const sites = properties.map((property) => {
    const id = String(property.id),
      metric = metrics[id];
    const base = {
      id,
      name: cleanName(property.site || property.domain || id),
      domain: property.domain || "",
      accountId: property.accountId || null,
      accountName: property.accountName || null,
    };
    if (!metric || metric.error)
      return {
        ...base,
        last: null,
        prev: null,
        change: null,
        vals: days.map(() => null),
        error: metric?.error || "Report unavailable.",
        st: {
          k: "error",
          label: "Unavailable",
          why: "This property could not be loaded. Retry the report.",
        },
      };
    const points = new Map(
      metric.series.map((point) => [point.time, point.sessions])
    );
    const vals = days.map((time) => points.get(time) || 0);
    // Missing future buckets in today's chart are not evidence that tracking stopped.
    const localToday = new Date(
      todayInZone(now, property.timeZone || "UTC") + "T00:00:00Z"
    );
    // Quiet hours are normal; gap detection applies to completed days or longer buckets.
    const completed =
      bucket === "hour"
        ? 0
        : days
            .map((time, i) => {
              const date = new Date(time.replace(" ", "T") + "Z");
              if (bucket === "hour") date.setUTCHours(date.getUTCHours() + 1);
              if (bucket === "day") date.setUTCDate(date.getUTCDate() + 1);
              if (bucket === "week") date.setUTCDate(date.getUTCDate() + 7);
              if (bucket === "month") date.setUTCMonth(date.getUTCMonth() + 1);
              if (bucket === "year")
                date.setUTCFullYear(date.getUTCFullYear() + 1);
              return date <= localToday && vals[i] === 0;
            })
            .filter(Boolean).length;
    const last = metric.current.sessions,
      prev = metric.previous?.sessions ?? null;
    const earn = adsense
      ? earningsFor(
          snapshot?.properties?.find((p) => String(p.id) === id),
          currentDates,
          previousDates
        )
      : null;
    return {
      ...base,
      last,
      prev,
      vals,
      error: "",
      comparisonUnavailable: !!metric.comparisonUnavailable,
      earn,
      earnLast: earn?.last ?? null,
      earnChange: earn?.change ?? null,
      rpm: earn?.rpm ?? null,
      ...periodStatus({ last, prev, zeroDays: completed, lowThreshold, earn }),
    };
  });
  return {
    days,
    range,
    comparison,
    bucket,
    lowThreshold,
    sites,
    adsense: adsense
      ? {
          ...adsense,
          matched: sites.filter((site) => site.earnLast != null).length,
        }
      : null,
  };
}

module.exports = { buildHomeSites, reportBucket };
