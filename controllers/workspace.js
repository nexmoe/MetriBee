const fs = require('node:fs');
const path = require('node:path');
const demo = require('./demoData');
const { getLocale } = require('../lib/uiLocale');
const { getAnalyticsCatalog } = require('./analyticsRecipes');
const { runSafeHistoricalReport } = require('./ga4Service');
const { cacheGet, cacheSet, shouldBypass } = require('./reportCache');
const DAYS = { today: 1, '7d': 7, '28d': 28, '30d': 30, '90d': 90 };
const METRICS = ['totalUsers', 'newUsers', 'sessions', 'screenPageViews', 'bounceRate', 'averageSessionDuration', 'totalRevenue'];
const pending = new Map();

async function workspaceView(req, res, next) {
  try {
    const manifestPath = path.join(__dirname, '../public/ui/.vite/manifest.json');
    if (!fs.existsSync(manifestPath)) return res.status(503).send('Build the analytics UI with pnpm build:ui, then reload this page.');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const entry = manifest['index.html'];
    const setupPage = /\/setup\/?$/.test(req.path);
    const { properties } = req.metricWidget ? { properties: [] } : req.sharedProperty ? { properties: [req.sharedProperty] }
      : setupPage ? { properties: [] } : await require('./apiController').ensureProperties();
    res.render('workspace', { layout: false, title: 'MetriBee', locale: getLocale(req.path), setup: setupPage,
      bootstrap: { properties, catalog: getAnalyticsCatalog(), demo: demo.enabled(),
        ...(req.sharedProperty ? { sharedSiteId: String(req.sharedProperty.id) } : {}),
        ...(req.metricWidget ? { metricWidget: req.metricWidget } : {}) },
      demo: demo.enabled(), script: '/ui/' + entry.file, styles: (entry.css || []).map(file => '/ui/' + file),
    });
  } catch (err) { next(err); }
}

function createOverviewHandler({ run = runSafeHistoricalReport, read = cacheGet, write = cacheSet, properties = () => require('./apiController').ensureProperties() } = {}) {
  return async (req, res) => {
    const propertyId = req.params.propertyId, range = req.query.range || '30d';
    if (!/^\d+$/.test(propertyId || '') || typeof range !== 'string' || !Object.hasOwn(DAYS, range)) return res.status(400).json({ ok: false, error: 'Choose a property and a valid date range.' });
    try {
      if (!(await properties()).properties.some(p => String(p.id) === propertyId)) return res.status(404).json({ ok: false, error: 'Property not found.' });
      const key = `overview-v1:${propertyId}:${range}`;
      const cached = req.query.fresh === '1' && shouldBypass(key) ? null : await read('report', key);
      if (cached) return res.json({ ...cached, cached: true });
      if (!pending.has(key)) {
        const task = (async () => {
          const days = DAYS[range], current = { startDate: days === 1 ? 'today' : `${days - 1}daysAgo`, endDate: 'today' };
          const previous = { startDate: `${days * 2 - 1}daysAgo`, endDate: `${days}daysAgo` };
          const query = { propertyId, dimensions: [], metrics: METRICS.map(name => ({ name })), limit: 1 };
          const report = await run({ ...query, dateRange: current });
          if (!report.ok) throw new Error(report.error || 'Overview unavailable.');
          const before = await run({ ...query, dateRange: previous });
          const trendQuery = { propertyId, dimensions: [{ name: 'date' }], metrics: ['totalUsers', 'newUsers', 'sessions', 'screenPageViews'].map(name => ({ name })), limit: days,
            orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }] };
          const daily = await run({ ...trendQuery, dateRange: current });
          const beforeDaily = await run({ ...trendQuery, dateRange: previous });
          const summary = r => Object.fromEntries(METRICS.map((name, i) => [name, Number(r.rows?.[0]?.metricValues?.[i]?.value) || 0]));
          const rows = r => (r.rows || []).map(row => ({ date: row.dimensionValues[0].value, values: row.metricValues.map(m => Number(m.value) || 0) }));
          const payload = { ok: true, summary: summary(report), previous: before.ok ? summary(before) : null,
            rows: daily.ok ? rows(daily) : [], previousRows: beforeDaily.ok ? rows(beforeDaily) : [],
            comparisonUnavailable: !before.ok, trendUnavailable: !daily.ok,
            timeZone: report.metadata?.timeZone || 'UTC', fetchedAt: Date.now(), range,
            limited: [report, before, daily, beforeDaily].some(r => r.metadata?.dataLossFromOtherRow || r.metadata?.subjectToThresholding || r.metadata?.samplingMetadatas?.length),
          };
          if (before.ok && daily.ok && beforeDaily.ok) await write('report', key, payload);
          return payload;
        })().finally(() => pending.delete(key));
        pending.set(key, task);
      }
      res.json(await pending.get(key));
    } catch (err) { res.status(502).json({ ok: false, error: err.message || 'Overview unavailable.' }); }
  };
}
module.exports = { workspaceView, createOverviewHandler };
