const { cacheGet, cacheSet, shouldBypass } = require('./reportCache');
const { createHash } = require('node:crypto');

const LIMIT = 10000;
const TREND_LIMIT = 100;
const METRICS = ['screenPageViews', 'sessions', 'totalUsers', 'userEngagementDuration', 'bounceRate'];
const RANGES = { today: 1, '7d': 7, '28d': 28, '30d': 30, '90d': 90 };
const DAY = 86400000;

function dateNumber(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const ms = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? ms / DAY : NaN;
}
const isoDay = number => new Date(number * DAY).toISOString().slice(0, 10);

function parsePeriod(query) {
  if (query.start !== undefined || query.end !== undefined) {
    const start = dateNumber(query.start), end = dateNumber(query.end);
    const days = end - start + 1;
    if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error('Choose a valid range of 1–90 days.');
    return { days, key: `${query.start}:${query.end}`, current: { startDate: query.start, endDate: query.end },
      previous: { startDate: isoDay(start - days), endDate: isoDay(start - 1) } };
  }
  const range = query.range === undefined ? '30d' : query.range;
  if (typeof range !== 'string' || !Object.hasOwn(RANGES, range)) throw new Error('Choose today, 7d, 28d, 30d or 90d.');
  const days = RANGES[range];
  return { days, key: range, current: { startDate: days === 1 ? 'today' : `${days - 1}daysAgo`, endDate: 'today' },
    previous: { startDate: `${days * 2 - 1}daysAgo`, endDate: `${days}daysAgo` } };
}

function resolvedPeriod(period, timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = type => parts.find(p => p.type === type).value;
  const today = dateNumber(`${part('year')}-${part('month')}-${part('day')}`);
  const resolve = value => /^\d{4}-/.test(value) ? value : isoDay(today - (value === 'today' ? 0 : parseInt(value, 10)));
  const dates = range => ({ startDate: resolve(range.startDate), endDate: resolve(range.endDate) });
  return { current: dates(period.current), previous: dates(period.previous) };
}

const values = row => METRICS.map((_, i) => Number(row?.metricValues?.[i]?.value) || 0);
function summary(row, pages) {
  const [views, sessions, users, engagement, bounce] = values(row);
  return { views, sessions, users, engagement, bounce, pages, viewsPerSession: sessions ? views / sessions : 0,
    avgEngagement: views ? engagement / views : 0 };
}

async function mapBounded(items, task) {
  const result = Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(2, items.length) }, async () => {
    while (next < items.length) { const index = next++; result[index] = await task(items[index]); }
  }));
  return result;
}

function createPagesReportHandler(deps = {}) {
  const read = deps.read || cacheGet, write = deps.write || cacheSet;
  const bypass = deps.bypass || shouldBypass;
  const loadProperties = deps.loadProperties || (() => require('./apiController').ensureProperties());
  const getClient = deps.getClient || (() => require('./ga4Service').getGA4DataClient());
  const inFlight = new Map();

  async function load(propertyId, period, view, fresh) {
    const key = `pages-v1:${propertyId}:${period.key}:${view}`;
    if (inFlight.has(key)) return inFlight.get(key);
    const pending = (async () => {
      const cached = await read('report', key);
      if (cached && !(fresh && bypass(key))) return { ...cached, cached: true };
      const client = getClient();
      const warnings = [];
      const dimension = view === 'entry' ? 'landingPage' : 'pagePath';
      const ranking = view === 'entry' ? 'sessions' : 'screenPageViews';
      async function run(dimensions, metrics, dateRange, extra = {}) {
        const [response] = await client.runReport({ property: `properties/${propertyId}`,
          dateRanges: [dateRange], dimensions: dimensions.map(name => ({ name })), metrics: metrics.map(name => ({ name })),
          limit: LIMIT, ...extra }, { timeout: 20000, retry: null });
        if (response.metadata?.subjectToThresholding) warnings.push('GA4 applied privacy thresholds.');
        if (response.metadata?.dataLossFromOtherRow) warnings.push('GA4 grouped some high-cardinality data into (other).');
        return response;
      }
      const pageQuery = dateRange => run([dimension], METRICS, dateRange, {
        orderBys: [{ metric: { metricName: ranking }, desc: true }],
        metricFilter: { filter: { fieldName: ranking, numericFilter: { operation: 'GREATER_THAN', value: { int64Value: '0' } } } },
      });
      const [current, total] = await Promise.all([
        pageQuery(period.current), run([], METRICS, period.current, { limit: 1 }),
      ]);
      const paths = (current.rows || []).slice(0, TREND_LIMIT).map(row => row.dimensionValues[0].value);
      const jobs = [
        ['previous pages', () => pageQuery(period.previous)],
        ['previous summary', () => run([], METRICS, period.previous, { limit: 1 })],
        ['titles', () => run(['pagePath', 'pageTitle'], ['screenPageViews'], period.current,
          { orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }] })],
      ];
      if (view === 'all') jobs.push(['entries', () => run(['landingPage'], ['sessions'], period.current,
        { orderBys: [{ metric: { metricName: 'sessions' }, desc: true }] })]);
      if (paths.length) jobs.push(['trends', () => run([dimension, 'nthDay'], [ranking], period.current, {
        limit: TREND_LIMIT * period.days,
        dimensionFilter: { filter: { fieldName: dimension, inListFilter: { values: paths, caseSensitive: true } } },
      })]);
      const reports = Object.fromEntries(await mapBounded(jobs, async ([name, task]) => {
        try { return [name, await task()]; }
        catch (err) { warnings.push(`Could not load ${name}: ${err.message}`); return [name, null]; }
      }));
      const previous = reports['previous pages'];
      const complete = report => !!report && (report.rowCount || report.rows?.length || 0) <= (report.rows?.length || 0);
      const prevMap = new Map((previous?.rows || []).map(row => [row.dimensionValues[0].value, values(row)]));
      const titles = new Map();
      for (const row of reports.titles?.rows || []) {
        const [path, title] = row.dimensionValues.map(d => d.value);
        if (!titles.has(path) && title && title !== '(not set)') titles.set(path, title);
      }
      const entries = new Map((reports.entries?.rows || []).map(row => [row.dimensionValues[0].value, Number(row.metricValues[0].value) || 0]));
      const series = new Map(paths.map(path => [path, Array(period.days).fill(0)]));
      if (reports.trends) {
        for (const row of reports.trends.rows || []) {
          const [path, bucket] = row.dimensionValues.map(d => d.value);
          const index = Number(bucket);
          if (series.has(path) && index >= 0 && index < period.days) series.get(path)[index] = Number(row.metricValues[0].value) || 0;
        }
      }
      const rows = (current.rows || []).map(row => {
        const path = row.dimensionValues[0].value;
        const [views, sessions, users, engagement, bounce] = values(row);
        const prev = prevMap.get(path);
        return { path, title: titles.get(path.split('?')[0]) || '', views, sessions, users, engagement, bounce,
          avgEngagement: views ? engagement / views : 0,
          entries: view === 'entry' ? sessions : entries.get(path) ?? (complete(reports.entries) ? 0 : null),
          previousViews: prev ? prev[0] : complete(previous) ? 0 : null,
          previousSessions: prev ? prev[1] : complete(previous) ? 0 : null,
          series: reports.trends && series.has(path) ? series.get(path) : null };
      });
      const timeZone = total.metadata?.timeZone || 'UTC';
      const payload = { ok: true, view, propertyId, days: period.days, ...resolvedPeriod(period, timeZone), timeZone,
        summary: summary(total.rows?.[0], current.rowCount ?? rows.length),
        previousSummary: reports['previous summary'] ? summary(reports['previous summary'].rows?.[0], previous?.rowCount ?? null) : null,
        rows, previousRows: previous ? (previous.rows || []).map(row => ({ path: row.dimensionValues[0].value, views: values(row)[0], sessions: values(row)[1] })) : null,
        truncated: !complete(current), previousTruncated: previous ? !complete(previous) : false,
        trendLimit: TREND_LIMIT, warnings: [...new Set(warnings)], fetchedAt: Date.now(), cached: false };
      // Optional report failures should recover on retry rather than being cached for an hour.
      if (Object.values(reports).every(report => report !== null)) await write('report', key, payload);
      return payload;
    })();
    inFlight.set(key, pending);
    try { return await pending; } finally { inFlight.delete(key); }
  }

  return async (req, res) => {
    const propertyId = req.params.propertyId;
    let period;
    const view = req.query.view === undefined ? 'all' : req.query.view;
    try {
      if (typeof propertyId !== 'string' || !/^\d+$/.test(propertyId)) throw new Error('Invalid property ID.');
      if (view !== 'all' && view !== 'entry') throw new Error('Choose all or entry pages.');
      period = parsePeriod(req.query);
    } catch (err) { return res.status(400).json({ ok: false, error: err.message }); }
    try {
      const { properties } = await loadProperties();
      if (!properties.some(p => String(p.id) === propertyId)) return res.status(404).json({ ok: false, error: 'Property not found.' });
      res.set?.('Cache-Control', 'no-store');
      return res.json(await load(propertyId, period, view, req.query.fresh === '1'));
    } catch (err) { return res.status(502).json({ ok: false, error: err.message || 'GA4 report unavailable.' }); }
  };
}

async function pagesView(req, res) {
  try {
    const { properties } = await require('./apiController').ensureProperties();
    res.render('pages', { properties, head: { title: 'GA4 Dashboard · Pages', description: 'Page traffic, landing pages and period comparisons' } });
  } catch (err) { res.status(500).send('Could not load properties.'); }
}

function createSectionReportHandler(deps = {}) {
  const read = deps.read || cacheGet, write = deps.write || cacheSet;
  const getClient = deps.getClient || (() => require('./ga4Service').getGA4DataClient());
  const loadProperties = deps.loadProperties || (() => require('./apiController').ensureProperties());
  const inFlight = new Map();
  return async (req, res) => {
    let period;
    const propertyId = req.params.propertyId, section = req.query.section;
    const view = req.query.view || 'all';
    try {
      if (!/^\d+$/.test(propertyId) || typeof section !== 'string' || !/^\/[^\/?#\\]{1,200}\/$/.test(section)) throw new Error('Invalid property or directory.');
      if (view !== 'all' && view !== 'entry') throw new Error('Choose all or entry pages.');
      period = parsePeriod(req.query);
    } catch (err) { return res.status(400).json({ ok: false, error: err.message }); }
    try {
      const { properties } = await loadProperties();
      if (!properties.some(p => String(p.id) === propertyId)) return res.status(404).json({ ok: false, error: 'Property not found.' });
      // A digest avoids both punctuation collisions and reportCache's filename length cap.
      const key = `pages-section-v1:${propertyId}:${period.key}:${view}:${createHash('sha256').update(section).digest('hex')}`;
      if (!inFlight.has(key)) {
        const pending = (async () => {
          const cached = await read('report', key);
          if (cached && !(req.query.fresh === '1' && shouldBypass(key))) return { ...cached, cached: true };
          const dimension = view === 'entry' ? 'landingPage' : 'pagePath';
          const [report] = await getClient().runReport({ property: `properties/${propertyId}`,
            dateRanges: [{ ...period.current, name: 'current' }, { ...period.previous, name: 'previous' }],
            dimensions: [{ name: 'date' }], metrics: METRICS.map(name => ({ name })),
            dimensionFilter: { filter: { fieldName: dimension, stringFilter: { matchType: 'BEGINS_WITH', value: section, caseSensitive: true } } },
            metricAggregations: ['TOTAL'], limit: period.days * 2,
          }, { timeout: 20000, retry: null });
          const headers = report.dimensionHeaders || [];
          const rangeIndex = headers.findIndex(d => d.name === 'dateRange');
          const dateIndex = Math.max(0, headers.findIndex(d => d.name === 'date'));
          const rangeOf = row => rangeIndex < 0 ? 'current' : row.dimensionValues?.[rangeIndex]?.value;
          const total = name => (report.totals || []).find(row => rangeOf(row) === name);
          const current = total('current');
          // GA4 TOTAL aggregates distinct sessions and users across days. Never add daily users.
          if (!current) throw new Error('GA4 directory totals unavailable.');
          const timeZone = report.metadata?.timeZone || 'UTC';
          const dates = resolvedPeriod(period, timeZone);
          const start = dateNumber(dates.current.startDate);
          const series = Array(period.days).fill(0);
          for (const row of report.rows || []) {
            if (rangeOf(row) !== 'current') continue;
            const date = row.dimensionValues?.[dateIndex]?.value || '';
            const index = dateNumber(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`) - start;
            if (index >= 0 && index < series.length) series[index] = values(row)[view === 'entry' ? 1 : 0];
          }
          const payload = { ok: true, section, summary: summary(current, null),
            previousSummary: total('previous') ? summary(total('previous'), null) : null,
            series, fetchedAt: Date.now(), thresholded: !!report.metadata?.subjectToThresholding,
            dataLoss: !!report.metadata?.dataLossFromOtherRow };
          await write('report', key, payload);
          return payload;
        })();
        inFlight.set(key, pending);
        pending.finally(() => { if (inFlight.get(key) === pending) inFlight.delete(key); }).catch(() => {});
      }
      return res.json(await inFlight.get(key));
    } catch (err) { return res.status(502).json({ ok: false, error: err.message }); }
  };
}

module.exports = { createPagesReportHandler, createSectionReportHandler, pagesView, parsePeriod, resolvedPeriod };
