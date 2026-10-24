(function () {
  if (!document.getElementById('pagesPage')) return;
  const $ = id => document.getElementById(id);
  const model = window.PagesModel;
  const properties = PAGE_PROPERTIES;
  const params = new URLSearchParams(location.search);
  const ranges = ['today', '7d', '28d', '30d', '90d'];
  const state = {
    prop: properties.some(p => String(p.id) === params.get('prop')) ? params.get('prop') : String(properties[0]?.id || ''),
    range: ranges.includes(params.get('range')) ? params.get('range') : '30d',
    start: params.get('start') || '', end: params.get('end') || '',
    view: params.get('view') === 'entry' ? 'entry' : 'all',
    breakdown: params.get('breakdown') === 'page' ? 'page' : 'section',
    compare: params.get('compare') !== 'none', q: params.get('q') || '',
    sort: 'views', direction: -1, page: 0,
  };
  if (state.start && state.end) state.range = 'custom';
  if (state.view === 'entry') state.sort = 'entries';
  const expanded = new Set();
  const sections = new Map();
  const PAGE_SIZE = 25;
  let data = null, controller, generation = 0, visible = [], grouped = [];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const number = value => value == null ? '—' : Math.round(value).toLocaleString('en-US');
  const compact = value => value == null ? '—' : new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  const duration = value => value == null ? '—' : Math.round(value) < 60 ? `${Math.round(value)}s` : `${Math.floor(Math.round(value) / 60)}m ${Math.round(value) % 60}s`;
  const percent = value => value == null ? '—' : `${(value * 100).toFixed(1)}%`;
  const dateLabel = value => new Date(value + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const shiftDate = (value, days) => new Date(Date.parse(value + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
  function today() {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: data?.timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const part = name => parts.find(p => p.type === name).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }
  function delta(value, inverse = false, suffix = '%') {
    if (value == null) return '<span class="faint">—</span>';
    if (!value) return '<span class="faint">0' + suffix + '</span>';
    const positive = inverse ? value < 0 : value > 0;
    return `<span class="${positive ? 'pg-positive' : 'pg-negative'}">${value > 0 ? '↑' : '↓'} ${value === Infinity ? 'New' : Math.abs(value).toFixed(1) + suffix}</span>`;
  }
  function updateUrl() {
    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set('prop', state.prop);
    if (state.range === 'custom') { url.searchParams.set('start', state.start); url.searchParams.set('end', state.end); }
    else url.searchParams.set('range', state.range);
    if (state.view !== 'all') url.searchParams.set('view', state.view);
    if (state.breakdown !== 'section') url.searchParams.set('breakdown', state.breakdown);
    if (!state.compare) url.searchParams.set('compare', 'none');
    if (state.q) url.searchParams.set('q', state.q);
    history.replaceState(null, '', url.pathname + url.search);
    window.AnalyticsSidebar.sync();
  }
  function summary() {
    if (!data) return;
    const current = data.summary, previous = data.previousSummary;
    const stats = [
      ['Pageviews', 'views', compact, false, 'All pageviews in the selected period'],
      [state.view === 'entry' ? 'Entry pages' : 'Pages with traffic', 'pages', number, false, 'Distinct page paths in the report'],
      ['Views per session', 'viewsPerSession', n => n.toFixed(2), false, 'GA4 pageviews ÷ sessions'],
      ['Engagement / view', 'avgEngagement', duration, false, 'GA4 foreground engagement time ÷ pageviews'],
      ['Entry bounce rate', 'bounce', percent, true, 'Non-engaged sessions ÷ sessions; GA4 definition'],
    ];
    $('pgSummary').innerHTML = stats.map(([label, key, format, inverse, title]) => {
      const prev = previous?.[key];
      const change = key === 'bounce' ? prev == null ? null : (current[key] - prev) * 100 : model.change(current[key], prev);
      return `<div class="pg-stat" title="${esc(title)}"><span class="pg-stat-label">${label}</span><div class="pg-stat-value num"><b>${format(current[key])}</b>${state.compare ? `<span class="pg-delta">${delta(change, inverse, key === 'bounce' ? ' pp' : '%')}</span>` : ''}</div><span class="cap faint num">${state.compare ? prev == null ? 'Comparison unavailable' : `${format(prev)} previous period` : key === 'avgEngagement' ? 'Foreground time ÷ views' : 'Selected period'}</span></div>`;
    }).join('');
    $('pgSummary').setAttribute('aria-busy', 'false');
  }
  function safeLink(path) {
    if (!path.startsWith('/') || path.startsWith('//')) return '';
    const property = properties.find(p => String(p.id) === state.prop);
    try {
      const base = property.url || (property.domain ? 'https://' + property.domain : '');
      const url = new URL(path, base);
      const origin = new URL(base);
      return /^https?:$/.test(url.protocol) && url.origin === origin.origin ? url.href : '';
    } catch { return ''; }
  }
  function spark(series) {
    if (!series) return '<span class="faint" title="Daily trend unavailable; trends cover the top 100 pages">—</span>';
    const max = Math.max(1, ...series);
    const points = series.map((n, i) => `${(i / Math.max(1, series.length - 1) * 70).toFixed(1)},${(22 - n / max * 20).toFixed(1)}`).join(' ');
    return `<svg class="pg-spark" viewBox="0 0 72 24" role="img" aria-label="Daily ${state.view === 'entry' ? 'entry sessions' : 'views'}: ${esc(series.join(', '))}"><polyline points="${points}"/></svg>`;
  }
  const unavailable = '<span class="faint" title="Sessions and users overlap across pages. Expand the directory to see page values.">—</span>';
  function rowHtml(row, child = false, maxViews = 1) {
    const directory = !!row.children;
    const link = directory ? '' : safeLink(row.path);
    const title = row.title || row.path;
    const share = data.summary.views ? row.views / data.summary.views : 0;
    const change = model.change(state.view === 'entry' ? row.entries : row.views, state.view === 'entry' ? row.previousSessions : row.previousViews);
    return `<tr class="${directory ? 'pg-directory' : child ? 'pg-child' : ''}"><td><div class="pg-label">${directory ? `<button type="button" class="pg-toggle" data-expand="${esc(row.path)}" aria-expanded="${expanded.has(row.path)}" aria-label="${expanded.has(row.path) ? 'Collapse' : 'Expand'} ${esc(row.path)}">${expanded.has(row.path) ? '⌄' : '›'}</button>` : ''}<div class="pg-label-text"><strong><span title="${esc(title)}">${esc(title)}</span>${directory ? '<span class="faint" aria-hidden="true">▱</span>' : link ? `<a class="pg-external" href="${esc(link)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(row.path)} in a new tab">↗</a>` : ''}</strong><small title="${esc(row.path)}">${directory ? `${row.children.length.toLocaleString('en-US')} pages` : row.title ? esc(row.path) : 'Page path'}</small></div></div></td>
      <td class="num"><div class="pg-view-cell"><span class="pg-bar" aria-hidden="true"><i style="width:${Math.max(0, Math.min(100, row.views / maxViews * 100))}%"></i></span><span>${number(row.views)}</span><small>${share > 0 && share < .001 ? '<0.1%' : percent(share)}</small></div></td>
      <td class="num">${row.sessions == null ? unavailable : number(row.sessions)}</td><td class="num">${number(row.entries)}</td><td class="num">${row.users == null ? unavailable : number(row.users)}</td><td class="num">${duration(row.avgEngagement)}</td><td class="num">${row.bounce == null ? unavailable : percent(row.bounce)}</td><td class="num" ${state.compare ? '' : 'hidden'}>${delta(change)}</td><td>${spark(row.series)}</td></tr>`;
  }
  function rowsForDisplay() {
    const query = state.q.trim().toLowerCase();
    visible = data.rows.filter(row => !query || (row.title + ' ' + row.path).toLowerCase().includes(query));
    const titleByPath = new Map(data.rows.map(row => [row.path, row.title]));
    const previous = data.previousTruncated ? null : data.previousRows?.filter(row => !query || ((titleByPath.get(row.path) || '') + ' ' + row.path).toLowerCase().includes(query));
    grouped = model.group(visible, state.breakdown, state.view, previous);
    // Directory reports use GA4's own TOTAL, which deduplicates sessions and users.
    if (!query) grouped = grouped.map(row => {
      const section = sections.get(row.path);
      if (!row.children || !section) return row;
      const summary = section.summary;
      return { ...row, sessions: summary.sessions, users: summary.users, bounce: summary.bounce,
        avgEngagement: summary.avgEngagement, series: section.series,
        previousViews: section.previousSummary?.views ?? null, previousSessions: section.previousSummary?.sessions ?? null };
    });
    const enrich = row => ({ ...row, change: model.change(state.view === 'entry' ? row.entries : row.views, state.view === 'entry' ? row.previousSessions : row.previousViews) });
    grouped = model.sort(grouped.map(enrich), state.sort, state.direction);
    return grouped;
  }
  function table() {
    if (!data) return;
    rowsForDisplay();
    const pages = Math.max(1, Math.ceil(grouped.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    const current = grouped.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);
    const maxViews = Math.max(1, ...grouped.map(row => row.views));
    $('pgBody').innerHTML = current.map(row => rowHtml(row, false, maxViews) +
      (row.children && expanded.has(row.path) ? model.sort(row.children.map(child => ({ ...child, change: model.change(state.view === 'entry' ? child.entries : child.views, state.view === 'entry' ? child.previousSessions : child.previousViews) })), state.sort, state.direction).map(child => rowHtml(child, true, maxViews)).join('') : '')).join('') || '<tr><td colspan="9" class="pg-empty">' + (state.q ? 'No pages match your search.' : 'No page traffic in this period.') + '</td></tr>';
    document.querySelectorAll('#pgTable th[data-column]').forEach(th => {
      th.removeAttribute('aria-sort');
      if (th.dataset.column === state.sort) th.setAttribute('aria-sort', state.direction === 1 ? 'ascending' : 'descending');
      if (th.dataset.column === 'change') th.hidden = !state.compare;
    });
    $('pgCount').textContent = `${grouped.length.toLocaleString('en-US')} rows · ${visible.length.toLocaleString('en-US')} ${state.view === 'entry' ? 'entry pages' : 'pages with traffic'}${data.truncated ? ` (first ${data.rows.length.toLocaleString('en-US')} of ${number(data.summary.pages)})` : ''}`;
    $('pgPage').textContent = `${state.page + 1} / ${pages}`;
    $('pgFirst').disabled = $('pgBack').disabled = state.page === 0;
    $('pgForward').disabled = $('pgLast').disabled = state.page === pages - 1;
    $('pgExpand').disabled = $('pgCollapse').disabled = !grouped.some(row => row.children);
    $('pgTableWrap').setAttribute('aria-busy', 'false');
  }
  function syncControls() {
    $('analyticsProperty').value = state.prop;
    $('pgRange').value = state.range;
    $('pgBreakdown').value = state.breakdown;
    $('pgCompare').value = state.compare ? 'previous' : 'none';
    $('pgSearch').value = state.q;
    $('pgMode').querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === state.view)));
    updateUrl();
  }
  async function load(fresh = false) {
    controller?.abort();
    controller = new AbortController();
    const id = ++generation;
    data = null;
    state.page = 0;
    expanded.clear();
    sections.clear();
    syncControls();
    $('pgNotice').hidden = true;
    $('pgFresh').textContent = 'Loading'; $('pgFresh').className = 'badge';
    $('pgSummary').setAttribute('aria-busy', 'true'); $('pgTableWrap').setAttribute('aria-busy', 'true');
    $('pgSummary').innerHTML = Array(5).fill('<div class="pg-stat"><span class="pg-stat-label">Loading</span><span class="pg-skeleton"></span><span class="cap faint">Fetching GA4 data</span></div>').join('');
    $('pgBody').innerHTML = '<tr><td colspan="9" class="pg-empty">Loading page traffic…</td></tr>';
    $('pgCount').textContent = '';
    ['pgExport', 'pgPrev', 'pgNext', 'pgRefresh', 'pgFirst', 'pgBack', 'pgForward', 'pgLast', 'pgExpand', 'pgCollapse'].forEach(key => { $(key).disabled = true; });
    if (!state.prop) { fail('No GA4 properties are available.'); return; }
    const query = new URLSearchParams({ view: state.view });
    if (state.range === 'custom') { query.set('start', state.start); query.set('end', state.end); }
    else query.set('range', state.range);
    if (fresh) query.set('fresh', '1');
    try {
      const response = await fetch(`/api/pages-report/${encodeURIComponent(state.prop)}?${query}`, { signal: controller.signal });
      const body = await response.json();
      if (id !== generation) return;
      if (!response.ok || !body.ok) throw new Error(body.error || 'GA4 report unavailable.');
      data = body;
      summary(); table();
      $('pgDates').textContent = `${dateLabel(data.current.startDate)} – ${dateLabel(data.current.endDate)} · ${data.timeZone}`;
      $('pgFresh').textContent = `${data.cached ? 'Cached' : 'Updated'} ${new Date(data.fetchedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
      $('pgFresh').title = new Date(data.fetchedAt).toLocaleString();
      $('pgFresh').className = 'badge' + (data.warnings.length ? ' warn' : '');
      const notices = [...data.warnings];
      if (state.view === 'entry') notices.unshift('Entry pages: metrics cover full sessions that started on each landing page.');
      if (data.truncated) notices.push(`Showing the first ${number(data.rows.length)} of ${number(data.summary.pages)} paths.`);
      if (data.previousTruncated) notices.push('The previous report is truncated; missing comparison rows are unavailable.');
      $('pgNotice').textContent = notices.join(' '); $('pgNotice').hidden = !notices.length;
      $('pgExport').disabled = false; $('pgPrev').disabled = false;
      $('pgNext').disabled = shiftDate(data.current.endDate, data.days) > today();
      $('pgStart').value = data.current.startDate; $('pgEnd').value = data.current.endDate;
      $('pgStart').max = $('pgEnd').max = today();
      loadSections(id, fresh);
    } catch (error) { if (id === generation && error.name !== 'AbortError') fail(error.message); }
    finally { if (id === generation) $('pgRefresh').disabled = false; }
  }
  async function loadSections(id, fresh) {
    // At most 25 directory queries, two at a time, with no polling. Server caches each for an hour.
    const paths = model.sort(model.group(data.rows, 'section'), 'views', -1).filter(row => row.children).slice(0, 25).map(row => row.path);
    const query = new URLSearchParams({ view: state.view });
    if (state.range === 'custom') { query.set('start', state.start); query.set('end', state.end); }
    else query.set('range', state.range);
    if (fresh) query.set('fresh', '1');
    const prop = state.prop, signal = controller.signal;
    let next = 0, failed = 0;
    await Promise.all(Array.from({ length: Math.min(2, paths.length) }, async () => {
      while (next < paths.length && id === generation) {
        const section = paths[next++];
        try {
          const response = await fetch(`/api/pages-section/${encodeURIComponent(prop)}?${query}&section=${encodeURIComponent(section)}`, { signal });
          const body = await response.json();
          if (id !== generation) return;
          if (!response.ok || !body.ok) { failed++; continue; }
          sections.set(section, body);
          if (body.thresholded || body.dataLoss) failed++;
          if (state.breakdown === 'section' && !state.q) {
            const focused = document.activeElement?.dataset.expand;
            table();
            if (focused) [...$('pgBody').querySelectorAll('[data-expand]')].find(button => button.dataset.expand === focused)?.focus();
          }
        } catch (error) { if (error.name !== 'AbortError') failed++; }
      }
    }));
    if (id === generation && failed) {
      $('pgNotice').textContent += ` ${failed} directory reports are unavailable or limited by GA4. Expand a directory for page values.`;
      $('pgNotice').hidden = false;
    }
  }
  function fail(message) {
    $('pgFresh').textContent = 'Unavailable'; $('pgFresh').className = 'badge bad';
    $('pgSummary').innerHTML = '<div class="pg-stat"><span class="cap faint">Report unavailable</span><b>—</b></div>';
    $('pgSummary').setAttribute('aria-busy', 'false');
    $('pgBody').innerHTML = `<tr><td colspan="9" class="pg-empty">${esc(message)} <button type="button" class="btn btn-sm" id="pgRetry">Retry</button></td></tr>`;
    $('pgTableWrap').setAttribute('aria-busy', 'false');
    $('pgRetry').addEventListener('click', () => load(true));
    $('pgRefresh').disabled = false;
  }
  $('analyticsProperty').addEventListener('change', () => { state.prop = $('analyticsProperty').value; load(); });
  $('pgRange').addEventListener('change', () => {
    const value = $('pgRange').value;
    $('pgCustom').hidden = value !== 'custom';
    if (value !== 'custom') { state.range = value; state.start = state.end = ''; load(); }
  });
  $('pgCustom').addEventListener('submit', event => {
    event.preventDefault();
    const start = $('pgStart').value, end = $('pgEnd').value;
    const days = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
    $('pgEnd').setCustomValidity(days >= 1 && days <= 90 ? '' : 'Choose 1–90 days, with the end on or after the start.');
    if (!$('pgCustom').reportValidity()) return;
    state.range = 'custom'; state.start = start; state.end = end;
    $('pgCustom').hidden = true; load();
  });
  ['pgStart', 'pgEnd'].forEach(key => $(key).addEventListener('input', () => $('pgEnd').setCustomValidity('')));
  [['pgPrev', -1], ['pgNext', 1]].forEach(([key, direction]) => $(key).addEventListener('click', () => {
    if (!data) return;
    state.range = 'custom'; state.start = shiftDate(data.current.startDate, direction * data.days); state.end = shiftDate(data.current.endDate, direction * data.days);
    load();
  }));
  $('pgMode').addEventListener('click', event => {
    const button = event.target.closest('[data-view]');
    if (!button || button.dataset.view === state.view) return;
    state.view = button.dataset.view; state.sort = state.view === 'entry' ? 'entries' : 'views'; state.direction = -1; load();
  });
  $('pgBreakdown').addEventListener('change', () => { state.breakdown = $('pgBreakdown').value; state.page = 0; if (data) table(); updateUrl(); });
  $('pgCompare').addEventListener('change', () => { state.compare = $('pgCompare').value !== 'none'; if (data) { summary(); table(); } updateUrl(); });
  $('pgSearch').addEventListener('input', () => { state.q = $('pgSearch').value; state.page = 0; if (data) table(); updateUrl(); });
  $('pgTable').addEventListener('click', event => {
    const expand = event.target.closest('[data-expand]');
    if (expand && data) {
      const key = expand.dataset.expand;
      if (expanded.has(key)) expanded.delete(key); else expanded.add(key);
      table();
      [...$('pgBody').querySelectorAll('[data-expand]')].find(button => button.dataset.expand === key)?.focus();
    }
    const sort = event.target.closest('[data-sort]');
    if (sort && data) { state.direction = state.sort === sort.dataset.sort ? -state.direction : -1; state.sort = sort.dataset.sort; state.page = 0; table(); }
  });
  $('pgExpand').addEventListener('click', () => { grouped.filter(row => row.children).forEach(row => expanded.add(row.path)); table(); });
  $('pgCollapse').addEventListener('click', () => { expanded.clear(); table(); });
  [['pgFirst', () => 0], ['pgBack', () => state.page - 1], ['pgForward', () => state.page + 1], ['pgLast', () => Math.max(0, Math.ceil(grouped.length / PAGE_SIZE) - 1)]].forEach(([key, page]) => $(key).addEventListener('click', () => { state.page = page(); table(); }));
  $('pgRefresh').addEventListener('click', () => load(true));
  $('pgExport').addEventListener('click', () => {
    if (!data) return;
    const rows = [['Path', 'Title', 'Views', 'Sessions', 'Entries', 'Users', 'Engagement per view (s)', 'GA4 bounce rate', 'Previous views', 'Previous entry sessions'],
      ...visible.map(row => [row.path, row.title, row.views, row.sessions, row.entries, row.users, row.avgEngagement, row.bounce, row.previousViews, row.previousSessions])];
    const url = URL.createObjectURL(new Blob(['\uFEFF' + model.csv(rows)], { type: 'text/csv;charset=utf-8;' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `pages-${state.prop}-${data.current.startDate}-${data.current.endDate}.csv`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  load();
})();
