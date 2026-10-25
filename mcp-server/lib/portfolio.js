const { buildHomeSites } = require('../../controllers/homeSites');
const { comparisonWindow, paginateReport } = require('./results');
const DAY = 86400000;

/** Read saved portfolio data only. No cache miss may trigger Admin or report requests. */
function createPortfolio({ readProperties, loadSnapshot, now, resolveDates }) {
  return async function cachedSites(args = {}) {
    try {
      const metadata = await readProperties();
      const all = metadata?.properties || [];
      const { snapshot, adsense } = await loadSnapshot({ properties: all });
      if (!snapshot || !all.length) return { error: 'snapshot_unavailable', apiCalls: 0,
        hint: 'No saved snapshot/property metadata is available. This tool never fetches Google data; generate the normal site snapshot first.' };
      const window = resolveDates(args, { timeZone: 'UTC' }, now());
      const previous = comparisonWindow(window, args.comparison || 'previous_period', dates => resolveDates(dates, { timeZone: 'UTC' }, now()));
      const range = { startDate: window.start_date, endDate: window.end_date };
      const comparison = { startDate: previous.start_date, endDate: previous.end_date };
      const selected = all.filter(property => (!args.accountId || String(property.accountId) === args.accountId)
        && (!args.search || [property.site, property.domain, property.accountName, property.id].some(value => String(value || '').toLowerCase().includes(args.search.toLowerCase()))));
      const valuesFor = (saved, period) => {
        const result = [];
        for (let date = Date.parse(period.startDate); date <= Date.parse(period.endDate); date += DAY) {
          const day = new Date(date).toISOString().slice(0, 10), key = day.replaceAll('-', '');
          const value = saved?.daily?.[key];
          if (value == null || !Number.isFinite(Number(value)) || Number(value) < 0) return null;
          result.push({ time: day + ' 00:00:00', sessions: Number(value) });
        }
        return result;
      };
      const metrics = Object.fromEntries(selected.map(property => {
        const saved = snapshot.properties.find(item => String(item.id) === String(property.id));
        const series = valuesFor(saved, range), prior = valuesFor(saved, comparison);
        if (saved?.error || !series) return [property.id, { error: saved?.error || 'Saved snapshot does not fully cover the selected dates.' }];
        return [property.id, { current: { sessions: series.reduce((sum, row) => sum + row.sessions, 0) },
          previous: prior ? { sessions: prior.reduce((sum, row) => sum + row.sessions, 0) } : null,
          comparisonUnavailable: !prior, series }];
      }));
      const report = buildHomeSites({ range, comparison, bucket: 'day', properties: selected, metrics, snapshot, adsense, now: now() });
      let rows = report.sites;
      if (args.groupBy === 'account') {
        const accounts = new Map();
        for (const site of rows) {
          const key = site.accountId || 'unknown';
          if (!accounts.has(key)) accounts.set(key, []);
          accounts.get(key).push(site);
        }
        rows = [...accounts].map(([accountId, sites]) => {
          const last = sites.every(site => site.last != null) ? sites.reduce((sum, site) => sum + site.last, 0) : null;
          const prev = sites.every(site => site.prev != null) ? sites.reduce((sum, site) => sum + site.prev, 0) : null;
          return { accountId, name: sites[0].accountName || accountId, siteCount: sites.length,
            coveredSites: sites.filter(site => site.last != null).length, last, prev,
            change: last == null || prev == null || prev === 0 ? null : (last - prev) / prev * 100 };
        });
      }
      const sortKey = args.sort === 'change' ? 'change' : args.sort === 'name' ? 'name' : 'last';
      rows.sort((a, b) => {
        if (a[sortKey] == null || b[sortKey] == null) return a[sortKey] == null ? b[sortKey] == null ? 0 : 1 : -1;
        const order = typeof a[sortKey] === 'string' ? a[sortKey].localeCompare(b[sortKey]) : a[sortKey] - b[sortKey];
        return (args.order === 'asc' ? order : -order) || String(a.id || a.accountId).localeCompare(String(b.id || b.accountId));
      });
      return paginateReport({ data: rows, range, comparison, source: 'saved-snapshot', timeZone: 'UTC',
        generatedAt: snapshot.generatedAt, apiCalls: 0, groupBy: args.groupBy || 'site',
        coverage: { totalSites: report.sites.length, coveredSites: report.sites.filter(site => site.last != null).length },
        limitations: ['Saved snapshot dates only; missing dates remain unknown.', 'No Google requests or automatic refresh. Snapshot dates may use a different calendar from the live property reports. Monetary totals are not summed across properties.'] }, args);
    } catch (error) { return { error: 'snapshot_unavailable', message: error.message, apiCalls: 0 }; }
  };
}

module.exports = { createPortfolio };
