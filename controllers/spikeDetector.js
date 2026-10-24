/**
 * spikeDetector.js
 * Detects real-time traffic spikes across GA4 properties and analyzes referral data,
 * landing page trends, and traffic origins.
 */

const { runSafeRealtimeReport, runSafeHistoricalReport, getGA4AdminClient } = require("./ga4Service");

/**
 * Known referral domains & categories.
 * `shape` maps to a generic SVG icon on the frontend (search/social/forum/code/
 * video/ai) — no per-brand logos, just a recognizable shape for the type of source.
 */
const REFERRAL_CATEGORIES = [
  { key: "hn", label: "Hacker News", shape: "forum", match: /ycombinator|news\.ycombinator/i },
  { key: "twitter", label: "X / Twitter", shape: "social", match: /(^|[/.])(t\.co|x\.com)(\/|$)|twitter\.com/i },
  { key: "reddit", label: "Reddit", shape: "forum", match: /reddit\.com|redd\.it/i },
  { key: "producthunt", label: "Product Hunt", shape: "social", match: /producthunt\.com/i },
  { key: "google", label: "Google Search", shape: "search", match: /google\./i },
  { key: "github", label: "GitHub", shape: "code", match: /github\.com/i },
  { key: "linkedin", label: "LinkedIn", shape: "social", match: /linkedin\.com|lnkd\.in/i },
  { key: "youtube", label: "YouTube", shape: "video", match: /youtube\.com|youtu\.be/i },
  { key: "facebook", label: "Facebook / Meta", shape: "social", match: /facebook\.com|fb\.me|meta\.com/i },
  { key: "instagram", label: "Instagram", shape: "social", match: /instagram\.com/i },
  { key: "chatgpt", label: "ChatGPT / OpenAI", shape: "ai", match: /chatgpt|openai\.com|chat\.openai/i },
  { key: "tiktok", label: "TikTok", shape: "video", match: /tiktok\.com/i },
  { key: "discord", label: "Discord", shape: "social", match: /discord\.com|discord\.gg/i },
  { key: "telegram", label: "Telegram", shape: "social", match: /(^|[/.])t\.me(\/|$)|telegram\.org/i },
  { key: "whatsapp", label: "WhatsApp", shape: "social", match: /whatsapp\.com/i },
  { key: "pinterest", label: "Pinterest", shape: "social", match: /pinterest\.com/i },
  { key: "medium", label: "Medium", shape: "forum", match: /medium\.com/i },
  { key: "quora", label: "Quora", shape: "forum", match: /quora\.com/i },
  { key: "stackoverflow", label: "Stack Overflow", shape: "forum", match: /stackoverflow\.com|stackexchange\.com/i },
  { key: "bing", label: "Bing / Microsoft", shape: "search", match: /bing\.com/i },
  { key: "duckduckgo", label: "DuckDuckGo", shape: "search", match: /duckduckgo\.com/i },
  { key: "perplexity", label: "Perplexity AI", shape: "ai", match: /perplexity\.ai|perplexity/i },
  { key: "claude", label: "Claude (Anthropic)", shape: "ai", match: /claude|anthropic\.com/i },
];

/**
 * Classifies a raw source/referrer string into a recognizable platform category
 */
function classifyReferralSource(sourceStr) {
  if (!sourceStr || sourceStr === "(direct)" || sourceStr === "(none)" || sourceStr === "(not set)") {
    return { name: "Direct / Bookmark", category: "direct", shape: "link" };
  }

  for (const cat of REFERRAL_CATEGORIES) {
    if (cat.match.test(sourceStr)) {
      return { name: cat.label, category: cat.key, shape: cat.shape };
    }
  }

  return { name: sourceStr, category: "other", shape: "globe" };
}

/**
 * Average over days of each day's busiest hour, halved to match the 30-minute realtime window.
 * Fallback when the property timezone is unknown.
 */
function peakHalfHourBaseline(rows) {
  const peakByDay = {};
  for (const r of rows || []) {
    const day = (r.dimensionValues?.[0]?.value || "").slice(0, 8);
    const users = parseInt(r.metricValues?.[0]?.value || "0", 10);
    peakByDay[day] = Math.max(peakByDay[day] || 0, users);
  }
  const peaks = Object.values(peakByDay);
  if (peaks.length === 0) return 1;
  return Math.max(1, Math.round(peaks.reduce((a, b) => a + b, 0) / peaks.length / 2));
}

/**
 * Same hour-of-day over the last 7 days (median, week-over-week), halved for the 30-minute window.
 * Off-peak surges now count; dod/wow are the raw same-hour users yesterday and 7 days ago.
 * Returns null when no row matches the hour, so the caller can fall back to the peak baseline.
 */
function sameHourBaseline(rows, hour) {
  const byDay = {};
  for (const r of rows || []) {
    const dh = r.dimensionValues?.[0]?.value || "";
    if (dh.slice(8, 10) !== hour) continue;
    byDay[dh.slice(0, 8)] = parseInt(r.metricValues?.[0]?.value || "0", 10);
  }
  const days = Object.keys(byDay).sort();
  if (days.length === 0) return null;
  const halves = days.map((d) => byDay[d] / 2);
  // Median and MAD (scaled to match sd on normal data), so one viral or dead day
  // does not drag the usual level or widen the spread and hide a real surge.
  const median = (xs) => {
    const v = [...xs].sort((x, y) => x - y);
    const m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };
  const avg = median(halves);
  const sd = halves.length >= 3
    ? Math.round(1.4826 * median(halves.map((v) => Math.abs(v - avg))) * 100) / 100
    : null;
  return {
    baseline: Math.max(1, Math.round(avg)),
    sd,
    dod: byDay[days[days.length - 1]],
    wow: days.length >= 7 ? byDay[days[0]] : null,
  };
}

/**
 * Spike score for one property. z is how many standard deviations "active" sits above the usual
 * for this hour. Variance is the Poisson one (baseline + 1, so tiny means are not over-flagged),
 * or the observed day-to-day spread when that is larger. ratio is the plain lift over usual.
 * Spike: z >= opts.z and ratio >= opts.lift. Above usual: z >= 2 and ratio >= 1.15, not a spike.
 * public/js/main.js mirrors this in spikeScore(); keep the two in step.
 */
const SPIKE_DEFAULTS = { z: 3, lift: 1.5 };

function scoreSpike(active, baseline, sd, { z: zMin = SPIKE_DEFAULTS.z, lift = SPIKE_DEFAULTS.lift } = {}) {
  if (!baseline) return { z: 0, ratio: 0, isSpike: false, above: false };
  const variance = Math.max(baseline + 1, sd ? sd * sd : 0);
  const z = (active - baseline) / Math.sqrt(variance);
  const ratio = active / baseline;
  const isSpike = z >= zMin && ratio >= lift;
  return { z, ratio, isSpike, above: !isSpike && z >= 2 && ratio >= 1.15 };
}

/** Clamp ?z= and ?lift= query values; invalid or missing values fall back to the defaults. */
function parseSpikeOpts(query = {}) {
  const num = (v, lo, hi, def) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? Math.round(Math.min(hi, Math.max(lo, n)) * 100) / 100 : def;
  };
  return { z: num(query.z, 1.5, 6, SPIKE_DEFAULTS.z), lift: num(query.lift, 1, 5, SPIKE_DEFAULTS.lift) };
}

/** Limit optional drill-downs to explicitly connected properties. */
function selectSpikeProperties(properties, raw) {
  if (raw == null) return properties;
  if (typeof raw !== 'string' || !/^\d+(,\d+)*$/.test(raw)) {
    throw Object.assign(new Error('Choose connected property IDs for spike context.'), { status: 400 });
  }
  const ids = new Set(raw.split(','));
  const allowed = new Set(properties.map(property => String(property.id)));
  if (ids.size > 20 || [...ids].some(id => !allowed.has(id))) {
    throw Object.assign(new Error('Choose up to 20 connected properties for spike context.'), { status: 400 });
  }
  return properties.filter(property => ids.has(String(property.id)));
}

const tzCache = new Map();
// A failed lookup is retried after 10 minutes instead of sticking until restart.
const TZ_RETRY_MS = 10 * 60 * 1000;

async function propertyTimeZone(propertyId, now = Date.now()) {
  const hit = tzCache.get(propertyId);
  if (hit && (hit.tz || now - hit.at < TZ_RETRY_MS)) return hit.tz;
  let tz = null;
  try {
    const [p] = await getGA4AdminClient().getProperty({ name: `properties/${propertyId}` });
    tz = p?.timeZone || null;
  } catch (err) {
    console.warn(`[spikeDetector] timezone lookup failed for ${propertyId}: ${err.message}`);
  }
  tzCache.set(propertyId, { tz, at: now });
  return tz;
}

function hourIn(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now);
}

// History rows per property, kept 1 hour. The rows are cached (not the result)
// so the same-hour pick follows the clock across an hour boundary.
const BASELINE_TTL_MS = 60 * 60 * 1000;
const historyCache = new Map();

async function fetchHourlyHistory(propertyId) {
  const res = await runSafeHistoricalReport({
    propertyId,
    dimensions: [{ name: "dateHour" }],
    metrics: [{ name: "activeUsers" }],
    dateRange: { startDate: "7daysAgo", endDate: "yesterday" },
    limit: 7 * 24,
  });
  return res.ok ? res.rows : null;
}

/**
 * Usual users for a 30-minute window right now: same hour of day over the last 7 days
 * in the property timezone, else the average daily peak. Null when history fails.
 * deps lets tests swap the GA4 calls and the clock.
 */
async function propertyBaseline(prop, deps = {}) {
  const { fetchHistory = fetchHourlyHistory, timeZone = propertyTimeZone, now = new Date() } = deps;
  let hit = historyCache.get(prop.id);
  if (!hit || now.getTime() - hit.at >= BASELINE_TTL_MS) {
    const [rows, tz] = await Promise.all([fetchHistory(prop.id), timeZone(prop.id)]);
    if (!rows) return null;
    hit = { at: now.getTime(), rows, tz };
    historyCache.set(prop.id, hit);
  } else if (!hit.tz) {
    hit.tz = await timeZone(prop.id);
  }
  const same = hit.tz ? sameHourBaseline(hit.rows, hourIn(hit.tz, now)) : null;
  if (same) return { baseline: same.baseline, sd: same.sd, kind: "same-hour", dod: same.dod, wow: same.wow };
  return { baseline: peakHalfHourBaseline(hit.rows), sd: null, kind: "peak", dod: null, wow: null };
}

/**
 * Detects traffic spikes across all available properties
 */
async function detectAllSpikes(properties, opts = {}) {
  if (!properties || properties.length === 0) return [];

  const results = await Promise.all(
    properties.map(async (prop) => {
      try {
        // 1. Realtime active users, per stream. Summing per-page rows counted
        // a user once per page viewed, roughly doubling the total.
        const rtRes = await runSafeRealtimeReport({
          propertyId: prop.id,
          metrics: [{ name: "activeUsers" }],
          minuteRanges: [{ startMinutesAgo: 29, endMinutesAgo: 0 }],
        });

        if (!rtRes.ok) return null;

        const totalActive = rtRes.rows.reduce(
          (sum, r) => sum + parseInt(r.metricValues?.[0]?.value || "0", 10),
          0
        );

        // 2. Baseline: this hour of day over the last 7 days, in the property timezone.
        const base = await propertyBaseline(prop);
        const avgBaseline = base ? base.baseline : 1;
        const score = scoreSpike(totalActive, avgBaseline, base ? base.sd : null, opts);

        if (!score.isSpike) return null;

        // 3. Query Referral Sources & Landing Pages for this property
        const refRes = await runSafeHistoricalReport({
          propertyId: prop.id,
          dimensions: [{ name: "sessionSource" }, { name: "sessionMedium" }],
          metrics: [{ name: "sessions" }, { name: "activeUsers" }],
          dateRange: { startDate: "today", endDate: "today" },
          limit: 10,
        });

        const topReferrals = (refRes.rows || [])
          .map((r) => {
            const src = r.dimensionValues?.[0]?.value || "(direct)";
            const med = r.dimensionValues?.[1]?.value || "(none)";
            const users = parseInt(r.metricValues?.[1]?.value || "0", 10);
            const classified = classifyReferralSource(src);
            return {
              rawSource: `${src} / ${med}`,
              classifiedName: classified.name,
              category: classified.category,
              shape: classified.shape,
              users,
            };
          })
          .filter((r) => r.users > 0)
          .sort((a, b) => b.users - a.users);

        const pageRes = await runSafeRealtimeReport({
          propertyId: prop.id,
          dimensions: [{ name: "unifiedScreenName" }],
          metrics: [{ name: "activeUsers" }],
          minuteRanges: [{ startMinutesAgo: 29, endMinutesAgo: 0 }],
          limit: 1,
        });
        const topPage = pageRes.rows?.[0]?.dimensionValues?.[0]?.value || "/";

        // Heuristic Explanation Generation
        const primaryRef = topReferrals[0];
        let reasonSummary = "Increased visitor interest detected";
        if (primaryRef && primaryRef.category !== "direct") {
          reasonSummary = `Traffic surge driven by ${primaryRef.classifiedName} referring visitors to ${topPage}`;
        } else if (topPage && topPage !== "/") {
          reasonSummary = `Surge in activity concentrated on landing page: ${topPage}`;
        } else {
          reasonSummary = `High concurrent active visitor count (${totalActive} active users)`;
        }

        return {
          propertyId: prop.id,
          siteName: prop.site,
          domain: prop.domain || null,
          activeUsers: totalActive,
          baselineUsers: avgBaseline,
          baselineKind: base ? base.kind : "peak",
          sameHourYesterday: base ? base.dod : null,
          sameHourLastWeek: base ? base.wow : null,
          baselineSd: base ? base.sd : null,
          z: Math.round(score.z * 10) / 10,
          ratio: Math.round(score.ratio * 100) / 100,
          spikeMultiplier: Math.round(score.ratio * 10) / 10,
          topPage,
          topReferrals,
          primarySource: primaryRef ? primaryRef.classifiedName : "Direct / Search",
          primaryShape: primaryRef ? primaryRef.shape : "spike",
          reasonSummary,
          detectedAt: new Date().toISOString(),
        };
      } catch (err) {
        console.warn(`[spikeDetector] Failed analysis for property ${prop.id}:`, err.message);
        return null;
      }
    })
  );

  return results.filter((r) => r !== null).sort((a, b) => b.z - a.z || b.activeUsers - a.activeUsers);
}

module.exports = {
  classifyReferralSource,
  detectAllSpikes,
  peakHalfHourBaseline,
  sameHourBaseline,
  propertyBaseline,
  scoreSpike,
  parseSpikeOpts,
  selectSpikeProperties,
  SPIKE_DEFAULTS,
  hourIn,
};
