import { DateTime } from 'luxon';
import { useStore, getTimezone } from '../rybbit/src/lib/store';
import { getDashboardTimeForRange } from '../rybbit/src/lib/defaultTimeRange';
import { timeToUrlParams, comparisonToUrlParams, urlParamsToTime, urlParamsToComparison } from '../rybbit/src/lib/time';
import { getSharedRoute } from './navigation';

let restoring = false;
let lastLocation = '';
function restore() {
  if (lastLocation === location.href) return;
  lastLocation = location.href;
  restoring = true;
  try {
    const params = new URLSearchParams(location.search);
    const values: any = Object.fromEntries(params);
    const state = useStore.getState();
    const shared = getSharedRoute();
    const site = shared?.siteId || params.get('prop') || String((window as any).__GA4_CONTEXT__?.properties?.[0]?.id || '');
    if (state.site !== site || state.privateKey !== (shared?.privateKey ?? null)) state.setSiteContext(site, shared?.privateKey ?? null);
    const zone = getTimezone();
    const parsed = urlParamsToTime(values, zone);
    if (parsed) state.setTime(parsed);
    else if (params.get('range') === '28d') {
      state.setTime({ mode: 'range', startDate: DateTime.now().minus({ days: 27 }).toISODate()!, endDate: DateTime.now().toISODate()! });
    } else {
      const ranges: Record<string, any> = { today: 'today', '7d': 'last-7-days', '30d': 'last-30-days', '90d': 'last-90-days' };
      if (params.get('range') === '90d') state.setTime({ mode: 'range', startDate: DateTime.now().minus({ days: 89 }).toISODate()!, endDate: DateTime.now().toISODate()! });
      else state.setTime(getDashboardTimeForRange(ranges[params.get('range') || '30d'] || 'last-30-days', zone));
    }
    state.setComparison(urlParamsToComparison(values) || { mode: 'previous' });
    if (params.has('bucket')) state.setBucket(values.bucket);
    if (params.has('stat')) state.setSelectedStat(values.stat);
    let filters = [];
    try { filters = JSON.parse(params.get('filters') || '[]'); } catch { /* A malformed shared link starts with no filters. */ }
    state.setFilters(Array.isArray(filters) ? filters : []);
  } finally { restoring = false; }
}
restore();
window.addEventListener('popstate', restore);
window.addEventListener('ga4:navigate', restore);
useStore.subscribe((state, previous) => {
  if (restoring || (state.time === previous.time && state.comparison === previous.comparison && state.bucket === previous.bucket && state.selectedStat === previous.selectedStat && state.filters === previous.filters)) return;
  const params = new URLSearchParams(location.search);
  params.delete('range'); params.delete('start'); params.delete('end');
  const values = { ...timeToUrlParams(state.time), ...comparisonToUrlParams(state.comparison), prop: state.site, bucket: state.bucket, stat: state.selectedStat, filters: state.filters.length ? JSON.stringify(state.filters) : null };
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined) params.delete(key); else params.set(key, String(value));
  }
  history.replaceState({}, '', `${location.pathname}?${params}`);
  lastLocation = location.href;
  window.dispatchEvent(new Event('ga4:navigate'));
});
