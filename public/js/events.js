/* GA4 aggregate event workspace. No synthetic users or individual event records. */
(function eventsPage() {
  const page = document.getElementById('evPage');
  if (!page) return;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => Number(n || 0).toLocaleString('en-US');
  const compact = n => Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);
  const dateLabel = s => new Date(`${s}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const ranges = { today: 1, '7d': 7, '28d': 28, '30d': 30, '90d': 90 };
  const colors = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--text-2)', 'var(--text-3)', 'var(--c1)'];
  const qs = new URLSearchParams(location.search);
  let property = EVENT_PROPERTIES.some(p => String(p.id) === qs.get('prop')) ? qs.get('prop') : String(EVENT_PROPERTIES[0]?.id || '');
  let range = Object.hasOwn(ranges, qs.get('range')) ? qs.get('range') : '30d';
  let offset = /^\d{1,3}$/.test(qs.get('offset') || '') && +qs.get('offset') <= 365 ? +qs.get('offset') : 0;
  let bucket = qs.get('bucket') === 'week' ? 'week' : 'day';
  let breakdown = qs.get('breakdown') === 'name' ? 'name' : 'type';
  let compare = qs.get('compare') !== '0';
  let data = null, activity = null, generation = 0, activityGeneration = 0;
  let category = 'all', activityCategory = 'all', selectedEvent = '', sort = 'events', desc = true;
  let visible = new Set(), series = [], chartBuckets = [];
  let controller, activityController, activityVisible = false;
  const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    if (entries.some(e => e.isIntersecting)) {
      activityVisible = true;
      if (data && !activity) loadActivity();
      observer.disconnect();
    }
  }, { rootMargin: '160px' }) : null;
  if (observer) observer.observe($('evActivity')); else activityVisible = true;

  function delta(current, previous) {
    if (!compare) return '';
    if (!previous) return current ? '<span class="ev-change">New</span>' : '<span class="ev-change">—</span>';
    const n = ((current - previous) / previous) * 100;
    return `<span class="ev-change num ${n > 0 ? 'up' : n < 0 ? 'down' : ''}">${n > 0 ? '↑' : n < 0 ? '↓' : ''} ${Math.abs(n).toFixed(1)}%</span>`;
  }

  function urlState() {
    const next = new URLSearchParams();
    next.set('prop', property); next.set('range', range); next.set('bucket', bucket);
    if (offset) next.set('offset', offset);
    if (breakdown === 'name') next.set('breakdown', 'name');
    if (!compare) next.set('compare', '0');
    history.replaceState(null, '', `${location.pathname}?${next}`);
    window.AnalyticsSidebar.sync();
    $('analyticsProperty').value = property;
    $('evRange').value = range; $('evBucket').value = bucket; $('evBreakdown').value = breakdown; $('evCompare').checked = compare;
    $('evNext').disabled = !offset;
    $('evPrev').disabled = offset + ranges[range] > 365;
  }

  function renderStats(loading = false) {
    const cards = [
      ['All events', 'events', 'All reported GA4 events'],
      ['Users with an event', 'users', 'Distinct users across this period'],
      ['Events per session', 'perSession', 'Across all sessions'],
      ['Event names', 'eventNames', data ? `${fmt(data.newNames)} new vs previous period` : 'Distinct event names'],
      ['Key events', 'keyEvents', 'Events marked as key events in GA4'],
    ];
    $('evStats').innerHTML = cards.map(([label, key, sub]) => {
      const current = key === 'eventNames' ? data?.eventNames : data?.totals[key];
      const val = key === 'perSession' ? Number(current || 0).toFixed(2) : fmt(current);
      const prev = key === 'eventNames' ? data?.previousEventNames : data?.previous?.[key];
      return `<div class="ev-stat"><span class="ev-stat-label">${label}</span><div class="ev-stat-line"><b class="num">${loading ? '—' : val}</b>${loading ? '' : delta(current, prev)}</div><span class="cap faint">${sub}</span></div>`;
    }).join('');
    $('evStats').setAttribute('aria-busy', String(loading));
  }

  function buildSeries() {
    series = breakdown === 'type' ? data.types.map(t => ({ ...t, name: t.label })) :
      [...data.events].sort((a, b) => b.events - a.events).slice(0, 6).map(e => ({ ...e, id: e.name }));
    visible = new Set(series.filter(s => s.events && (breakdown === 'name' || s.id !== 'pageviews')).map(s => s.id));
    if (!visible.size) series.filter(s => s.events).forEach(s => visible.add(s.id));
  }

  function renderChart() {
    $('evChartTitle').textContent = `Events by ${breakdown === 'type' ? 'type' : 'name'}`;
    $('evLegendLabel').textContent = breakdown === 'type' ? 'Type' : 'Event';
    $('evChartPeriod').textContent = `per ${bucket}, ${dateLabel(data.dates[0])} – ${dateLabel(data.dates.at(-1))}`;
    const step = bucket === 'week' ? 7 : 1;
    chartBuckets = Array.from({ length: Math.ceil(data.dates.length / step) }, (_, i) => ({ start: i * step, end: Math.min(data.dates.length, (i + 1) * step) }));
    const plotted = series.map(s => ({ ...s, values: chartBuckets.map(b => s.series.slice(b.start, b.end).reduce((a, n) => a + n, 0)) }));
    const active = plotted.filter(s => visible.has(s.id));
    const max = Math.max(1, ...active.flatMap(s => s.values));
    const w = 800, h = 264, left = 44, right = 12, top = 12, bottom = 32;
    const x = i => chartBuckets.length === 1 ? (w + left - right) / 2 : left + i * (w - left - right) / (chartBuckets.length - 1);
    const y = n => top + (h - top - bottom) * (1 - n / max);
    let svg = '';
    for (let i = 0; i <= 4; i++) {
      const n = max * i / 4;
      svg += `<line class="grid" x1="${left}" x2="${w - right}" y1="${y(n)}" y2="${y(n)}"/><text class="axis" x="${left - 8}" y="${y(n) + 3}" text-anchor="end">${esc(compact(n))}</text>`;
    }
    const tickCount = Math.min(7, chartBuckets.length);
    const ticks = [...new Set(Array.from({ length: tickCount }, (_, i) => Math.round(i * (chartBuckets.length - 1) / Math.max(1, tickCount - 1))))];
    for (const i of ticks) svg += `<text class="axis" x="${x(i)}" y="${h - 8}" text-anchor="${i === 0 ? 'start' : i === chartBuckets.length - 1 ? 'end' : 'middle'}">${esc(dateLabel(data.dates[chartBuckets[i].start]))}</text>`;
    plotted.forEach((s, i) => {
      if (!visible.has(s.id)) return;
      const points = s.values.map((n, k) => `${x(k).toFixed(1)},${y(n).toFixed(1)}`).join(' ');
      svg += `<polyline class="ev-series" style="color:${colors[i % colors.length]}" ${i >= 4 ? 'stroke-dasharray="4 3"' : ''} points="${points}" vector-effect="non-scaling-stroke"/>`;
      if (s.values.length === 1) svg += `<circle cx="${x(0)}" cy="${y(s.values[0])}" r="3" style="fill:${colors[i % colors.length]}"/>`;
    });
    if (!data.events.length || !active.length) svg += `<text class="axis" x="${w / 2}" y="${h / 2}" text-anchor="middle">${data.events.length ? 'Select a series to display' : 'No events for this period'}</text>`;
    $('evChart').innerHTML = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Daily event counts by ${breakdown}, ${data.dates[0]} to ${data.dates.at(-1)}">${svg}<line class="ev-hover" x1="0" x2="0" y1="${top}" y2="${h - bottom}" visibility="hidden"/></svg>`;
    $('evChart').setAttribute('aria-busy', 'false');
    $('evLegend').innerHTML = plotted.map((s, i) => `<button type="button" class="ev-legend-row" data-series="${esc(s.id)}" aria-pressed="${visible.has(s.id)}" title="${esc(s.name)}"><span class="ev-legend-name"><i class="ev-swatch" style="color:${colors[i % colors.length]}"></i>${esc(s.name)}</span><b class="num">${compact(s.events)}</b>${delta(s.events, s.previous) || '<span></span>'}</button>`).join('');
    const node = $('evChart').querySelector('svg');
    node.addEventListener('mousemove', e => {
      const rect = node.getBoundingClientRect();
      const index = Math.max(0, Math.min(chartBuckets.length - 1, Math.round(((e.clientX - rect.left) / rect.width * w - left) / (w - left - right) * (chartBuckets.length - 1))));
      const b = chartBuckets[index];
      const tip = $('evChartTip');
      tip.innerHTML = `<b>${esc(dateLabel(data.dates[b.start]))}${step > 1 ? ' – ' + esc(dateLabel(data.dates[b.end - 1])) : ''}</b>` + active.map(s => `<div><span>${esc(s.name)}</span><b class="num">${fmt(s.values[index])}</b></div>`).join('');
      tip.hidden = false;
      const plot = node.parentElement.parentElement.getBoundingClientRect();
      tip.style.left = `${Math.max(12, Math.min(e.clientX - plot.left + 12, plot.width - tip.offsetWidth - 12))}px`;
      tip.style.top = '48px';
      const line = node.querySelector('.ev-hover'); line.setAttribute('x1', x(index)); line.setAttribute('x2', x(index)); line.setAttribute('visibility', 'visible');
    });
    node.addEventListener('mouseleave', () => { $('evChartTip').hidden = true; node.querySelector('.ev-hover').setAttribute('visibility', 'hidden'); });
  }

  function categories() {
    return [{ id: 'all', label: 'All events', names: data.eventNames }, ...data.types.filter(t => t.names)];
  }
  function renderCategories() {
    $('evTabs').innerHTML = categories().map(t => `<button type="button" data-category="${t.id}" aria-pressed="${category === t.id}">${esc(t.label)}<span class="faint num">${fmt(t.names)}</span></button>`).join('');
    $('evActivityTypes').innerHTML = categories().map(t => `<button class="btn btn-sm btn-ghost" type="button" data-category="${t.id}" aria-pressed="${activityCategory === t.id}">${esc(t.label)}</button>`).join('');
  }

  function filteredEvents() {
    const term = $('evSearch').value.trim().toLowerCase();
    return data.events.filter(e => (category === 'all' || e.type === category) && e.name.toLowerCase().includes(term)).sort((a, b) => {
      const metric = e => sort === 'change' ? (e.previous ? (e.events - e.previous) / e.previous : e.events ? Infinity : 0) : e[sort];
      const av = metric(a), bv = metric(b);
      const n = sort === 'name' ? av.localeCompare(bv) : av === bv ? 0 : av > bv ? 1 : -1;
      return n * (desc ? -1 : 1) || a.name.localeCompare(b.name);
    });
  }
  function spark(values) {
    const max = Math.max(1, ...values);
    const points = values.map((v, i) => `${2 + i / Math.max(1, values.length - 1) * 92},${22 - v / max * 20}`).join(' ');
    return `<svg viewBox="0 0 96 24" role="img" aria-label="Daily event count trend"><polyline class="ln" points="${points}" vector-effect="non-scaling-stroke"/></svg>`;
  }
  function renderNames() {
    const rows = filteredEvents();
    $('evNamesBody').innerHTML = rows.map(e => `<tr><td><button type="button" class="ev-event-btn" data-event="${esc(e.name)}" title="View activity for ${esc(e.name)}"><span aria-hidden="true">›</span><span>${esc(e.name)}</span></button></td><td class="n"><div class="ev-count-cell"><b class="num">${fmt(e.events)}</b><span class="ev-count-bar"><i style="width:${data.events ? Math.min(100, e.events / Math.max(1, data.events.reduce((a, r) => Math.max(a, r.events), 0)) * 100) : 0}%"></i></span></div></td><td class="n num">${fmt(e.users)}</td><td class="n num">${e.users ? (e.events / e.users).toFixed(2) : '—'}</td><td class="ev-trend chart">${spark(e.series)}</td><td class="n">${delta(e.events, e.previous) || '—'}</td><td class="n faint num">${e.latestDay ? esc(dateLabel(e.latestDay)) : '—'}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No events match this search and category.</td></tr>';
    $('evNamesCount').textContent = `${fmt(rows.length)} of ${fmt(data.eventNames)} event names`;
    page.querySelectorAll('[data-sort]').forEach(b => {
      const key = b.dataset.sort;
      b.textContent = ({ name: 'Event', events: 'Events', users: 'Users', change: 'Change' })[key] + (sort === key ? desc ? ' ↓' : ' ↑' : '');
      b.parentElement.removeAttribute('aria-sort');
      if (sort === key) b.parentElement.setAttribute('aria-sort', desc ? 'descending' : 'ascending');
    });
  }

  function renderActivity() {
    if (!activity) return;
    const term = $('evActivitySearch').value.trim().toLowerCase();
    const rows = activity.rows.filter(r => (activityCategory === 'all' || r.type === activityCategory) && `${r.name} ${r.page} ${r.device}`.toLowerCase().includes(term));
    $('evActivityBody').innerHTML = rows.map(r => {
      const h = r.hour;
      const stamp = /^\d{10}$/.test(h) ? `${dateLabel(`${h.slice(0, 4)}-${h.slice(4, 6)}-${h.slice(6, 8)}`)}, ${h.slice(8)}:00` : h;
      return `<tr><td class="num faint">${esc(stamp)}</td><td>${esc(r.name)}</td><td title="${esc(r.page)}">${esc(r.page)}</td><td class="faint">${esc(r.device)}</td><td class="n num">${fmt(r.events)}</td><td class="n num">${fmt(r.users)}</td></tr>`;
    }).join('') || '<tr><td colspan="6" class="empty">No reported activity matches this filter.</td></tr>';
    $('evActivityCount').textContent = `${fmt(rows.length)} matching rows · Latest ${fmt(activity.rows.length)} of ${fmt(activity.rowCount)} reported groups · ${activity.timeZone}`;
    $('evActivityFresh').textContent = `Fetched ${new Date(activity.fetchedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}${activity.cached ? ' · Cached' : ''}${activity.thresholded ? ' · GA4 thresholds apply' : ''}${activity.sampled ? ' · Sampled' : ''}`;
    $('evClearEvent').hidden = !selectedEvent;
    $('evClearEvent').textContent = selectedEvent ? `${selectedEvent} ×` : 'Clear event filter ×';
  }

  async function jsonFetch(url, signal) {
    const response = await fetch(url, { signal });
    const body = await response.json();
    if (!response.ok || body.error) throw new Error(body.error || 'Report unavailable');
    return body;
  }
  function apiUrl(activityPage, fresh) {
    const params = new URLSearchParams({ range, offset: String(offset) });
    if (fresh) params.set('fresh', '1');
    if (activityPage && selectedEvent) params.set('event', selectedEvent);
    return `/api/events/${encodeURIComponent(property)}${activityPage ? '/activity' : ''}?${params}`;
  }

  async function loadActivity(fresh = false) {
    const id = ++activityGeneration;
    if (activityController) activityController.abort();
    activityController = new AbortController();
    activity = null;
    $('evActivityBody').innerHTML = '<tr><td colspan="6" class="empty">Loading reported activity…</td></tr>';
    $('evActivityCount').textContent = ''; $('evActivityFresh').textContent = '';
    $('evClearEvent').hidden = !selectedEvent;
    $('evClearEvent').textContent = `${selectedEvent} ×`;
    try {
      const report = await jsonFetch(apiUrl(true, fresh), activityController.signal);
      if (id !== activityGeneration) return;
      activity = report; renderActivity();
    } catch (err) {
      if (id !== activityGeneration || err.name === 'AbortError') return;
      $('evActivityBody').innerHTML = `<tr><td colspan="6" class="empty">${esc(err.message)} <button class="btn btn-sm" data-retry-activity type="button">Retry</button></td></tr>`;
    }
  }

  function renderFresh() {
    if (!data) return;
    const age = Math.max(0, Math.floor((Date.now() - data.fetchedAt) / 60000));
    $('evFresh').className = `badge num ${age < 15 ? 'good' : 'warn'}`;
    $('evFresh').textContent = age ? `Fetched ${age} min ago` : 'Fetched just now';
    $('evFresh').title = `GA4 aggregate report · 15 minute cache${data.cached ? ' · Served from cache' : ''}. Fetched time is not the latest event time.`;
  }

  async function load(fresh = false) {
    const id = ++generation;
    activityGeneration++;
    if (controller) controller.abort();
    if (activityController) activityController.abort();
    controller = new AbortController();
    data = null; activity = null; selectedEvent = ''; activityCategory = 'all'; category = 'all';
    $('evError').hidden = true; $('evExport').disabled = true; $('evRefresh').disabled = true;
    $('evFresh').className = 'badge'; $('evFresh').textContent = 'Loading';
    $('evDateRange').textContent = ''; $('evDataQuality').textContent = '';
    $('evChart').innerHTML = '<p class="empty">Loading event trends…</p>'; $('evChart').setAttribute('aria-busy', 'true');
    $('evChartTip').hidden = true; $('evLegend').innerHTML = ''; $('evTabs').innerHTML = '';
    $('evNamesBody').innerHTML = '<tr><td colspan="7" class="empty">Loading event names…</td></tr>';
    $('evNamesCount').textContent = ''; $('evActivityCount').textContent = ''; $('evActivityFresh').textContent = '';
    $('evActivityTypes').innerHTML = ''; $('evClearEvent').hidden = true;
    $('evActivityBody').innerHTML = '<tr><td colspan="6" class="empty">Activity loads when this report is ready.</td></tr>';
    urlState(); renderStats(true);
    if (!property) {
      $('evError').hidden = false; $('evError').textContent = 'No GA4 properties are connected. Add property access on the Setup page.';
      $('evFresh').textContent = 'No properties'; $('evRefresh').disabled = false;
      return;
    }
    try {
      const report = await jsonFetch(apiUrl(false, fresh), controller.signal);
      if (id !== generation) return;
      data = report;
      $('evDateRange').textContent = `${dateLabel(data.dates[0])} – ${dateLabel(data.dates.at(-1))} · ${data.timeZone}`;
      buildSeries(); renderStats(); renderCategories(); renderChart(); renderNames(); renderFresh();
      $('evExport').disabled = !data.events.length;
      const notices = [];
      if (data.limited) notices.push('Some breakdown rows are omitted or grouped by GA4; charts and lists may be partial.');
      if (data.thresholded) notices.push('GA4 privacy thresholds may suppress some rows.');
      if (data.sampled) notices.push('GA4 returned sampled data.');
      $('evDataQuality').textContent = notices.length ? ' ' + notices.join(' ') : '';
      if (activityVisible) loadActivity(fresh);
    } catch (err) {
      if (id !== generation || err.name === 'AbortError') return;
      $('evError').hidden = false;
      $('evError').innerHTML = `${esc(err.message)} <button class="btn btn-sm" data-retry type="button">Retry</button>`;
      $('evFresh').className = 'badge bad'; $('evFresh').textContent = 'Unavailable';
      $('evStats').setAttribute('aria-busy', 'false'); $('evChart').setAttribute('aria-busy', 'false');
      $('evChart').innerHTML = '<p class="empty">Event trends are unavailable. Retry to load this report.</p>';
      $('evNamesBody').innerHTML = '<tr><td colspan="7" class="empty">Event names are unavailable.</td></tr>';
      $('evActivityBody').innerHTML = '<tr><td colspan="6" class="empty">Retry the event report to load activity.</td></tr>';
    } finally {
      if (id === generation) $('evRefresh').disabled = false;
    }
  }

  $('analyticsProperty').addEventListener('change', () => { property = $('analyticsProperty').value; offset = 0; load(); });
  $('evRange').addEventListener('change', () => { range = $('evRange').value; offset = 0; load(); });
  $('evPrev').addEventListener('click', () => { offset = Math.min(365, offset + ranges[range]); load(); });
  $('evNext').addEventListener('click', () => { offset = Math.max(0, offset - ranges[range]); load(); });
  $('evRefresh').addEventListener('click', () => load(true));
  $('evBucket').addEventListener('change', () => { bucket = $('evBucket').value; urlState(); if (data) renderChart(); });
  $('evBreakdown').addEventListener('change', () => { breakdown = $('evBreakdown').value; urlState(); if (data) { buildSeries(); renderChart(); } });
  $('evCompare').addEventListener('change', () => { compare = $('evCompare').checked; urlState(); if (data) { renderStats(); renderChart(); renderNames(); } });
  $('evSearch').addEventListener('input', () => { if (data) renderNames(); });
  $('evActivitySearch').addEventListener('input', renderActivity);
  $('evClearEvent').addEventListener('click', () => { selectedEvent = ''; activityCategory = 'all'; renderCategories(); loadActivity(); });
  $('evLegend').addEventListener('click', e => {
    const button = e.target.closest('[data-series]'); if (!button || !data) return;
    const key = button.dataset.series; if (visible.has(key)) visible.delete(key); else visible.add(key);
    renderChart();
  });
  $('evTabs').addEventListener('click', e => {
    const button = e.target.closest('[data-category]'); if (!button || !data) return;
    category = button.dataset.category; renderCategories(); renderNames();
  });
  $('evActivityTypes').addEventListener('click', e => {
    const button = e.target.closest('[data-category]'); if (!button || !data) return;
    activityCategory = button.dataset.category; renderCategories(); renderActivity();
  });
  page.addEventListener('click', e => {
    const event = e.target.closest('[data-event]');
    if (event && data) {
      selectedEvent = event.dataset.event; activityCategory = 'all'; activityVisible = true;
      renderCategories(); loadActivity();
      $('evActivity').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    }
    const header = e.target.closest('[data-sort]');
    if (header && data) { desc = sort === header.dataset.sort ? !desc : header.dataset.sort !== 'name'; sort = header.dataset.sort; renderNames(); }
    if (e.target.closest('[data-retry]')) load();
    if (e.target.closest('[data-retry-activity]')) loadActivity();
  });
  $('evExport').addEventListener('click', () => {
    if (!data) return;
    // Prevent spreadsheet formulas in event names; quoting alone does not do that.
    const csv = s => '"' + String(/^[=+\-@\t\r]/.test(String(s)) ? "'" + s : s).replace(/"/g, '""') + '"';
    const lines = [['Event', 'Type', 'Events', 'Users', 'Events per user', 'Previous events', 'Latest reported day', 'Period start', 'Period end', 'Time zone'],
      ...filteredEvents().map(e => [e.name, data.types.find(t => t.id === e.type)?.label, e.events, e.users, e.users ? (e.events / e.users).toFixed(2) : '', e.previous, e.latestDay || '', data.dates[0], data.dates.at(-1), data.timeZone])];
    const url = URL.createObjectURL(new Blob(['\uFEFF' + lines.map(row => row.map(csv).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `ga4-events-${property}-${data.dates[0]}-${data.dates.at(-1)}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  setInterval(() => { if (!document.hidden) renderFresh(); }, 60000);
  load();
})();
