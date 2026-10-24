/** @typedef {'cards' | 'status' | 'table' | 'heatmap'} HomeView */

/** @param {unknown} value @param {HomeView} [fallback] @returns {HomeView} */
function getHomeView(value, fallback = 'cards') {
  if (value === 'look') return 'status';
  if (value === 'heat') return 'heatmap';
  return value === 'cards' || value === 'status' || value === 'table' || value === 'heatmap'
    ? value : fallback;
}

/** Preserve the locale and report parameters of bookmarked Sites views. */
function sitesHomeUrl(href) {
  const url = new URL(href, 'http://localhost');
  url.pathname = url.pathname.replace(/\/sites\/?$/, '') || '/';
  if (url.pathname === '/en') url.pathname = '/';
  url.searchParams.set('view', getHomeView(url.searchParams.get('view'), 'status'));
  return url.pathname + url.search + url.hash;
}

module.exports = { getHomeView, sitesHomeUrl };
