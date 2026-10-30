// Public dashboards expose only the native, property-scoped report surface.
// Keep management, aggregate APIs and MCP behind their existing authorization.
const { stripLocale } = require('./uiLocale');

const pages = new Set(['/analytics', '/analytics/pages', '/events', '/journeys', '/retention', '/funnels', '/goals']);
const nativePage = /^\/(\d+)(?:\/(?:main|pages|events|journeys|retention|funnels|goals))?$/;
const reports = /^(?:|has-data|is-public|overview(?:-lite|\/time-series|-bucketed-lite)?|metric(?:-lite)?|page-titles|pages(?:\/summary|\/trends)?|live-user-count|ga4\/[a-z0-9-]+|events(?:\/(?:names(?:\/stats)?|overview|silent|properties|count|time-series|outbound|autocapture|autocapture-values))?|retention|journeys(?:\/(?:capabilities|summary|sessions|context))?|funnels(?:\/(?:summary|events|[1-9]\d*))?|goals(?:\/(?:summary|time-series|[1-9]\d*))?|(?:segments|annotations)(?:\/[1-9]\d*)?|gsc\/(?:connection|status))$/;

function publicPageSite(path, query = {}) {
  const pathname = stripLocale(path).replace(/\/+$/, '') || '/';
  const native = nativePage.exec(pathname);
  if (native) return query.prop === undefined || query.prop === native[1] ? native[1] : null;
  return pages.has(pathname) && typeof query.prop === 'string' && /^\d+$/.test(query.prop) ? query.prop : null;
}

function publicApiSite(path, method) {
  const match = /^\/api\/rybbit\/sites\/(\d+)(?:\/(.*))?$/.exec(path);
  if (!match) return null;
  const action = match[2] || '';
  return method === 'GET' && reports.test(action) || method === 'POST' && action === 'funnels/analyze' ? match[1] : null;
}

module.exports = { publicPageSite, publicApiSite };
