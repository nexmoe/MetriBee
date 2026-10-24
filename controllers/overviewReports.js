const { getAnalyticsCardConfig } = require('./analyticsRecipes');
const { runExtraCard } = require('./reportExtras');
const { buildVisitorPersonas } = require('./visitorInsights');
const { classifyReferralSource } = require('./spikeDetector');
const { previousWindow } = require('../lib/reportWindow');

const dims = row => (row.dimensionValues || []).map(v => v.value);
const values = row => (row.metricValues || []).map(v => Number(v.value) || 0);
const DAY = 86400000;
const iso = date => new Date(date).toISOString().slice(0, 10);
const CHANGE_REPORTS = [
  ['traffic-sources', 'Source', 'referrer'], ['landing-pages', 'Landing page', 'entry_page'],
  ['countries', 'Country', 'country'], ['page-paths', 'Pageviews', 'pathname'],
];
const NOTABLE_SOURCES = new Set(['chatgpt', 'twitter', 'reddit', 'hn', 'instagram', 'tiktok', 'discord', 'perplexity', 'claude', 'facebook', 'producthunt']);

function sourceSearchUrl(category, domain) {
  if (!domain) return null;
  const site = encodeURIComponent(`site:${domain}`), raw = encodeURIComponent(domain);
  const urls = {
    twitter: `https://twitter.com/search?q=${site}&src=typed_query&f=live`,
    reddit: `https://www.reddit.com/search/?q=${site}`, hn: `https://hn.algolia.com/?query=${site}&sort=byDate&type=story`,
    instagram: `https://www.instagram.com/explore/search/keyword/?q=${raw}`, producthunt: `https://www.producthunt.com/search?q=${raw}`,
    github: `https://github.com/search?q=${raw}&type=repositories`, linkedin: `https://www.linkedin.com/search/results/content/?keywords=${raw}`,
    youtube: `https://www.youtube.com/results?search_query=${raw}`, facebook: `https://www.facebook.com/search/top?q=${raw}`,
    perplexity: `https://www.perplexity.ai/search?q=${raw}`, pinterest: `https://www.pinterest.com/search/pins/?q=${raw}`,
    medium: `https://medium.com/search?q=${raw}`, quora: `https://www.quora.com/search?q=${raw}`, stackoverflow: `https://stackoverflow.com/search?q=${raw}`,
  };
  return urls[category] || null;
}

// All queries go through the native dashboard's scoped, cached and concurrency-limited runner.
// This keeps supplements on the same property, calendar window and filters as the main panels.
async function overviewReport({ type, report, dateRange, propertyId, ownHost, segment, propertyCurrency }) {
  if (type === 'what-changed') {
    const days = dateRange.startDateTime ? (Date.parse(dateRange.endDateTime) - Date.parse(dateRange.startDateTime)) / DAY : Math.round((Date.parse(dateRange.endDate) - Date.parse(dateRange.startDate)) / DAY) + 1;
    const previousRange = previousWindow(dateRange);
    const [groups, bots] = await Promise.all([
      Promise.all(CHANGE_REPORTS.map(async ([type, kind, parameter]) => {
        const args = { type, dateRange, propertyId, ownHost };
        const [current, previous] = await Promise.all([
          overviewReport({ ...args, report }),
          overviewReport({ ...args, dateRange: previousRange, report: (dims, metrics, filter, extra) => report(dims, metrics, filter, { ...extra, dateRange: previousRange }) }),
        ]);
        const key = row => JSON.stringify(row.dims);
        const before = new Map(previous.rows.map(row => [key(row), row]));
        const after = new Map(current.rows.map(row => [key(row), row]));
        // Include rows that dropped out, and look up the actual previous value even
        // when it was outside the previous top ten.
        const candidates = new Map([...current.rows.slice(0, 10), ...previous.rows.slice(0, 10)].map(row => [key(row), row]));
        return [...candidates].flatMap(([id, row]) => {
          const value = after.get(id)?.metrics[0] || 0, prior = before.get(id)?.metrics[0] || 0;
          const difference = value - prior, percent = prior ? difference / prior * 100 : null;
          if (!difference || (percent !== null && Math.abs(percent) < 10)) return [];
          return [{ kind, parameter, filterValue: parameter === 'country' ? row.dims[1] : row.dims[0],
            name: parameter === 'country' ? row.dims[0] : row.dims.join(' / '), current: value, previous: prior, difference, percent }];
        });
      })),
      overviewReport({ type: 'bot-traffic', report, dateRange, propertyId, ownHost }),
    ]);
    return { days, previousRange, changes: groups.flat().sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference)).slice(0, 6),
      bots: { sessions: (bots.flagged || []).reduce((sum, row) => sum + row.sessions, 0), segments: (bots.flagged || []).length } };
  }
  if (type === 'spikes') {
    const diagnostic = await overviewReport({ type: 'diagnostics', report, dateRange, propertyId, ownHost });
    return { sources: diagnostic.sources.filter(s => NOTABLE_SOURCES.has(s.category) || (s.share > 30 && !['google', 'direct'].includes(s.category))).map(s => ({ ...s,
      notable: NOTABLE_SOURCES.has(s.category), dominant: s.share > 30 && !['google', 'direct'].includes(s.category),
      searchUrl: sourceSearchUrl(s.category, ownHost),
    })) };
  }
  if (type === 'visitors') {
    const [segments, pages, timeline] = await Promise.all([
      report(['newVsReturning', 'firstUserDefaultChannelGroup'], ['activeUsers', 'sessions', 'engagedSessions', 'userEngagementDuration', 'keyEvents']),
      report(['pagePath'], ['screenPageViews', 'userEngagementDuration', 'eventCount']),
      report(['date'], ['activeUsers', 'sessions', 'userEngagementDuration', 'totalRevenue'], null, { orderBys: [{ dimension: { dimensionName: 'date' } }] }),
    ]);
    // Pages and timeline describe the whole selected audience, never an individual segment's history.
    return {
      personas: buildVisitorPersonas({ segmentRows: segments.rows }),
      pages: pages.rows.map(r => ({ dims: dims(r), metrics: values(r) })),
      timeline: timeline.rows.map(r => ({ dims: dims(r), metrics: values(r) })),
      currencyCode: timeline.metadata?.currencyCode,
    };
  }
  if (type === 'diagnostics') {
    const [sources, landing, referrers] = await Promise.all([
      report(['sessionSource', 'sessionMedium'], ['sessions', 'activeUsers']),
      report(['sessionSource', 'landingPagePlusQueryString'], ['sessions']),
      report(['pageReferrer'], ['sessions']),
    ]);
    const total = sources.rows.reduce((sum, row) => sum + values(row)[0], 0);
    return {
      sources: sources.rows.map(row => {
        const [source, medium] = dims(row), [sessions, users] = values(row);
        // GA4 commonly reports organic Google as a campaign label, not a host.
        const classified = classifyReferralSource(source === 'google' ? 'google.com' : source);
        return { source, medium, sessions, users, category: classified.category,
          name: classified.name, share: total ? sessions / total * 100 : 0,
          landingPages: landing.rows.filter(r => dims(r)[0] === source).slice(0, 5).map(r => ({ path: dims(r)[1], sessions: values(r)[0] })),
          referrers: referrers.rows.filter(r => { try { return new URL(dims(r)[0]).hostname === source; } catch { return false; } }).slice(0, 5).map(r => ({ url: dims(r)[0], sessions: values(r)[0] })),
        };
      }).filter(s => s.sessions >= 2 && ((!['google', 'direct', 'other'].includes(s.category)) || s.share > 30)),
    };
  }
  const cfg = getAnalyticsCardConfig(type);
  if (!cfg) throw Object.assign(new Error('Unknown overview report.'), { status: 404 });
  let currencyCode;
  const run = async ({ dimensions, metrics, dimensionFilter, ...extra }) => {
    const result = await report(dimensions.map(d => d.name), metrics.map(m => m.name), dimensionFilter, extra);
    currencyCode ||= result.metadata?.currencyCode;
    return result;
  };
  if (cfg.kind) {
    const seg = cfg.segments && (cfg.segments[segment] ? segment : Object.keys(cfg.segments)[0]);
    const data = await runExtraCard({ cfg, type, propertyId, dateRange, seg, ownHost, run });
    return { ...data, currencyCode: currencyCode || propertyCurrency };
  }
  const result = await report(cfg.dimensions, cfg.metrics, null, {
    limit: cfg.timeSeries ? 100000 : 10000,
    ...(cfg.fallbackMetrics ? { fallbackMetrics: cfg.fallbackMetrics.map(name => ({ name })) } : {}),
    orderBys: cfg.timeSeries ? [{ dimension: { dimensionName: cfg.dimensions[0] } }] : [{ metric: { metricName: cfg.metrics[0] }, desc: true }],
    metricAggregations: ['TOTAL'],
  });
  return {
    dimensionHeaders: cfg.dimensions,
    metricHeaders: (result.usedMetrics || cfg.metrics.map(name => ({ name }))).map(m => m.name),
    rows: result.rows.map(r => ({ dims: dims(r), metrics: values(r) })),
    rowCount: result.rowCount,
    currencyCode: result.metadata?.currencyCode || propertyCurrency,
  };
}

module.exports = { overviewReport };
