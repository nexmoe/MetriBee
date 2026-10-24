/* Shared analytics sidebar. Page controllers call sync after updating their URL. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.AnalyticsSidebar = api; api.sync(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const canonicalPath = path => path.replace(/\/+$/, '') || '/';

  function hrefFor(route, currentUrl, { ranges, defaultRange, customDates = false } = {}) {
    const current = new URL(currentUrl, 'http://localhost');
    if (canonicalPath(current.pathname) === route) return route + current.search + current.hash;
    const query = new URLSearchParams();
    const prop = current.searchParams.get('prop');
    if (prop) query.set('prop', prop);
    if (customDates && current.searchParams.has('start') && current.searchParams.has('end')) {
      query.set('start', current.searchParams.get('start'));
      query.set('end', current.searchParams.get('end'));
    } else {
      const range = current.searchParams.get('range');
      query.set('range', ranges.includes(range) ? range : defaultRange);
    }
    return route + '?' + query;
  }

  function sync() {
    if (typeof document === 'undefined') return;
    const sidebar = document.querySelector('[data-analytics-sidebar]');
    if (!sidebar) return;
    const select = sidebar.querySelector('#analyticsProperty');
    const current = new URL(location.href);
    const requested = current.searchParams.get('prop');
    const option = [...select.options].find(item => item.value === requested) || select.options[0];
    const prop = option?.value || '';
    select.value = prop;
    if (prop) current.searchParams.set('prop', prop); else current.searchParams.delete('prop');
    sidebar.querySelector('#analyticsPropertyMeta').textContent = prop ? 'Property ' + prop : 'No properties available';
    sidebar.querySelectorAll('[data-analytics-route]').forEach(link => {
      const route = link.dataset.analyticsRoute;
      link.href = hrefFor(route, current.href, {
        ranges: link.dataset.supportedRanges.split(' '), defaultRange: link.dataset.defaultRange,
        customDates: link.dataset.customDates === 'true',
      });
      if (canonicalPath(location.pathname) === route) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }
  return { hrefFor, sync };
});
