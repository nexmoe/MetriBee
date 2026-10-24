/** Referrer-based page transitions. Aggregates are never stitched into session paths. */
const { runSafeHistoricalReport } = require('./ga4Service');
const { cacheGet, cacheSet, shouldBypass } = require('./reportCache');

const ROW_LIMIT = 10000;
const RANGES = { today: 1, '7d': 7, '28d': 28, '30d': 30 };
const inFlight = new Map();
const count = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const hostName = value => String(value || '').toLowerCase().replace(/^www\./, '').replace(/\.$/, '');

function dateRange(range, previous = false) {
  const days = RANGES[range] || 30;
  const ago = n => n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n}daysAgo`;
  return { startDate: ago(previous ? days * 2 - 1 : days - 1), endDate: ago(previous ? days : 0) };
}

function pagePath(value) {
  const path = String(value || '').split(/[?#]/)[0];
  return path.startsWith('/') && !path.startsWith('//') ? path : null;
}

function buildTransitions(response) {
  const pairs = new Map();
  let internalViews = 0;
  let reportedViews = 0;
  let unavailableViews = 0;
  for (const row of response.rows || []) {
    const [host, referrer, destination] = (row.dimensionValues || []).map(d => d.value);
    const views = count(row.metricValues?.[0]?.value);
    reportedViews += views;
    const to = pagePath(destination);
    let url;
    try { url = new URL(referrer); } catch { unavailableViews += views; continue; }
    if (!/^https?:$/.test(url.protocol) || !hostName(host) || hostName(url.hostname) !== hostName(host)) continue;
    const from = pagePath(url.pathname);
    if (!from || !to) { unavailableViews += views; continue; }
    const normalizedHost = hostName(host);
    const key = JSON.stringify([normalizedHost, from, to]);
    if (!pairs.has(key)) pairs.set(key, { host: normalizedHost, from, to, views: 0 });
    pairs.get(key).views += views;
    internalViews += views;
  }
  const rows = [...pairs.values()].sort((a, b) => b.views - a.views || a.host.localeCompare(b.host) || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  const top = field => {
    const pages = new Map();
    for (const row of rows) {
      const key = JSON.stringify([row.host, row[field]]);
      const item = pages.get(key) || { host: row.host, path: row[field], views: 0 };
      item.views += row.views;
      pages.set(key, item);
    }
    return [...pages.values()].sort((a, b) => b.views - a.views)[0] || null;
  };
  return {
    rows, internalViews, reportedViews, unavailableViews,
    topReferrer: top('from'), topDestination: top('to'),
    rowCount: response.rowCount ?? (response.rows || []).length,
    truncated: response.rowCount != null && response.rowCount > (response.rows || []).length,
    quality: {
      dataLossFromOtherRow: !!response.metadata?.dataLossFromOtherRow,
      subjectToThresholding: !!response.metadata?.subjectToThresholding,
      sampled: !!response.metadata?.samplingMetadatas?.length,
    },
    timeZone: response.metadata?.timeZone || null,
  };
}

async function fetchPeriod(propertyId, range, previous, run) {
  const common = { propertyId, dateRange: dateRange(range, previous) };
  const transitions = await run({
    ...common,
    dimensions: ['hostName', 'pageReferrer', 'pagePath'].map(name => ({ name })),
    metrics: [{ name: 'screenPageViews' }], limit: ROW_LIMIT,
    dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'page_view' } } },
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
  });
  if (!transitions.ok) throw Object.assign(new Error(transitions.error || 'Page transitions unavailable'), { code: transitions.errorCode });
  let summary;
  try {
    summary = await run({ ...common, dimensions: [], metrics: [{ name: 'sessions' }, { name: 'screenPageViews' }], limit: 1 });
  } catch { summary = null; }
  const values = summary?.ok ? summary.rows?.[0]?.metricValues : null;
  const sessions = values ? count(values[0]?.value) : null;
  const totalViews = values ? count(values[1]?.value) : null;
  return { ...buildTransitions(transitions), sessions, totalViews, viewsPerSession: sessions > 0 ? totalViews / sessions : null };
}

async function fetchJourneys({ propertyId, range, compare, run = runSafeHistoricalReport }) {
  const current = await fetchPeriod(propertyId, range, false, run);
  let previous = null;
  let comparisonUnavailable = false;
  if (compare) {
    try { previous = await fetchPeriod(propertyId, range, true, run); }
    catch { comparisonUnavailable = true; }
  }
  return {
    ok: true, mode: 'referrer-transitions', metric: 'screenPageViews', steps: 2,
    propertyId, range, dateRange: dateRange(range), previousDateRange: compare ? dateRange(range, true) : null,
    ...current, previous, comparisonUnavailable, fetchedAt: Date.now(),
  };
}

function createJourneysHandler({ run, getProperties = () => require('./apiController').ensureProperties(), readCache = cacheGet, writeCache = cacheSet } = {}) {
  return async (req, res) => {
    const { propertyId } = req.params;
    const range = req.query.range || '30d';
    if (!/^\d+$/.test(propertyId || '')) return res.status(400).json({ error: 'Invalid propertyId' });
    if (!Object.hasOwn(RANGES, range)) return res.status(400).json({ error: 'Invalid range' });
    try {
      const { properties } = await getProperties();
      if (!properties.some(p => String(p.id) === propertyId)) return res.status(404).json({ error: 'Unknown property' });
      const compare = req.query.compare !== 'none';
      const key = `v1:${propertyId}:${range}:${compare ? 'previous' : 'none'}`;
      const fresh = req.query.fresh === '1' && shouldBypass(`journeys:${key}`);
      const cached = fresh ? null : await readCache('journeys', key);
      if (cached) return res.json({ ...cached, cached: true });
      if (!inFlight.has(key)) {
        const pending = fetchJourneys({ propertyId, range, compare, run })
          .then(async payload => { await writeCache('journeys', key, payload); return payload; })
          .finally(() => inFlight.delete(key));
        inFlight.set(key, pending);
      }
      return res.json(await inFlight.get(key));
    } catch (err) {
      res.status(err.code === 7 ? 403 : err.code === 8 || err.code === 429 ? 429 : 502)
        .json({ ok: false, error: 'Could not load page transitions. Try again later.', rateLimited: err.code === 8 || err.code === 429 });
    }
  };
}

async function journeysView(req, res) {
  const { properties } = await require('./apiController').ensureProperties();
  res.locals.nav = { ...res.locals.nav, title: 'Journeys', analytics: true, journeys: true };
  res.render('journeys', {
    properties,
    head: { title: 'GA4 Dashboard · Journeys', description: 'Explore page-to-page journeys from Google Analytics 4' },
  });
}

module.exports = { ROW_LIMIT, dateRange, buildTransitions, fetchJourneys, createJourneysHandler, journeysView };
