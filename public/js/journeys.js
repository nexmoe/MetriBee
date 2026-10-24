/* Shared pure transforms also run in Node tests. No inferred multi-step paths. */
(function journeysModule() {
  const keyOf = row => JSON.stringify([row.host, row.from, row.to]);
  const pageKey = (host, path) => JSON.stringify([host, path]);
  const folder = path => path === '/' ? '/' : '/' + path.split('/').filter(Boolean)[0] + '/**';
  function groupRows(rows, grouping) {
    const groups = new Map();
    for (const row of rows || []) {
      const item = { ...row, from: grouping === 'folder' ? folder(row.from) : row.from, to: grouping === 'folder' ? folder(row.to) : row.to };
      const key = keyOf(item);
      if (!groups.has(key)) groups.set(key, { ...item, views: 0 });
      groups.get(key).views += row.views;
    }
    return [...groups.values()].sort((a, b) => b.views - a.views || keyOf(a).localeCompare(keyOf(b)));
  }
  function matchesPage(path, search) {
    if (!search) return true;
    // Literal pieces in order support * wildcards without running user input as a regex.
    const value = path.toLowerCase();
    let offset = 0;
    for (const part of String(search).toLowerCase().split('*').filter(Boolean)) {
      const index = value.indexOf(part, offset);
      if (index < 0) return false;
      offset = index + part.length;
    }
    return true;
  }
  function selectRows(rows, { from = '', to = '', search = '', limit = 15 } = {}) {
    const matched = rows.filter(r => (!from || pageKey(r.host, r.from) === from) && (!to || pageKey(r.host, r.to) === to) && (matchesPage(r.from, search) || matchesPage(r.to, search)));
    return { matched, shown: matched.slice(0, limit) };
  }
  function layoutGraph(rows, width) {
    const total = rows.reduce((sum, r) => sum + r.views, 0);
    const columns = ['from', 'to'].map(field => {
      const nodes = new Map();
      for (const row of rows) {
        const key = pageKey(row.host, row[field]);
        if (!nodes.has(key)) nodes.set(key, { key, host: row.host, path: row[field], views: 0 });
        nodes.get(key).views += row.views;
      }
      return [...nodes.values()].sort((a, b) => b.views - a.views || a.key.localeCompare(b.key));
    });
    const gap = 32;
    const most = Math.max(...columns.map(c => c.length), 1);
    const height = Math.max(480, most * 44 + 80);
    const scale = total ? (height - gap * (most - 1)) / total : 0;
    const maps = columns.map((nodes, col) => {
      let y = 58;
      return new Map(nodes.map(node => {
        const h = node.views * scale;
        const out = { ...node, x: col ? width - 248 : 0, y, h, offset: 0 };
        y += h + gap;
        return [node.key, out];
      }));
    });
    const links = rows.map(row => {
      const source = maps[0].get(pageKey(row.host, row.from));
      const target = maps[1].get(pageKey(row.host, row.to));
      const h = row.views * scale;
      const sy = source.y + source.offset;
      const ty = target.y + target.offset;
      source.offset += h; target.offset += h;
      const x1 = source.x + 8, x2 = target.x, mid = (x1 + x2) / 2;
      return { ...row, key: keyOf(row), source, target, h, path: `M${x1},${sy}C${mid},${sy} ${mid},${ty} ${x2},${ty}L${x2},${ty + h}C${mid},${ty + h} ${mid},${sy + h} ${x1},${sy + h}Z` };
    });
    return { columns: maps.map(m => [...m.values()]), links, width, height: height + 80, total };
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { keyOf, pageKey, groupRows, matchesPage, selectRows, layoutGraph };
    return;
  }
  const page = document.getElementById('jyPage');
  if (!page || typeof JOURNEY_PROPERTIES === 'undefined') return;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const pct = n => (n * 100).toFixed(1) + '%';
  const params = new URLSearchParams(location.search);
  const ranges = { today: 1, '7d': 7, '28d': 28, '30d': 30 };
  let prop = JOURNEY_PROPERTIES.some(p => String(p.id) === params.get('prop')) ? params.get('prop') : String(JOURNEY_PROPERTIES[0]?.id || '');
  let range = Object.hasOwn(ranges, params.get('range')) ? params.get('range') : '30d';
  let compare = params.get('compare') === 'none' ? 'none' : 'previous';
  let grouping = params.get('group') === 'folder' ? 'folder' : 'exact';
  let from = params.get('from') || '', to = params.get('to') || '', search = (params.get('q') || '').slice(0, 200);
  let limit = [5, 10, 15, 25].includes(+params.get('limit')) ? +params.get('limit') : 15;
  let data = null, selected = null, shown = [], loadId = 0, abort;

  function syncUrl() {
    const q = new URLSearchParams({ prop, range });
    if (compare !== 'previous') q.set('compare', compare);
    if (grouping !== 'exact') q.set('group', grouping);
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    if (search) q.set('q', search);
    if (limit !== 15) q.set('limit', limit);
    history.replaceState(null, '', '/journeys?' + q);
    window.AnalyticsSidebar.sync();
  }
  function delta(cur, prev) {
    if (!data?.previous || compare === 'none' || cur == null || prev == null) return '';
    if (prev === 0) return cur > 0 ? '<span class="faint">New</span>' : '<span class="faint">—</span>';
    const n = (cur - prev) / prev;
    return `<span class="num ${n > 0 ? 'd-up' : n < 0 ? 'd-dn' : 'faint'}">${n > 0 ? '+' : ''}${pct(n)}</span>`;
  }
  function dateLabel() {
    const site = JOURNEY_PROPERTIES.find(p => String(p.id) === prop) || {};
    const tz = data?.timeZone || site.timeZone;
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz || undefined, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date());
    const v = name => +parts.find(p => p.type === name).value;
    const end = new Date(Date.UTC(v('year'), v('month') - 1, v('day')));
    const start = new Date(end); start.setUTCDate(start.getUTCDate() - ranges[range] + 1);
    const f = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    $('jyDateRange').textContent = (ranges[range] === 1 ? f(end) : f(start) + ' – ' + f(end)) + (tz ? ' · ' + tz : '');
  }
  function renderMetrics() {
    const d = data, p = d.previous;
    const metric = (label, value, note, change = '') => `<div class="jy-metric"><span>${label}</span><b class="num">${esc(value)}${change ? `<span class="jy-delta">${change}</span>` : ''}</b><small>${esc(note)}</small></div>`;
    const top = (label, item) => metric(label, item?.path || '—', item ? `${fmt(item.views)} views · ${item.host}` : 'No internal transitions');
    $('jyMetrics').innerHTML =
      metric(d.truncated ? 'Internal page views · partial' : 'Internal page views', fmt(d.internalViews), d.totalViews == null ? 'Views with a same-site referrer' : `${pct(d.totalViews ? d.internalViews / d.totalViews : 0)} of ${fmt(d.totalViews)} page views`, delta(d.internalViews, p?.internalViews)) +
      metric('Views per session', d.viewsPerSession == null ? '—' : d.viewsPerSession.toFixed(2), d.sessions == null ? 'Summary unavailable' : `Across ${fmt(d.sessions)} sessions`, delta(d.viewsPerSession, p?.viewsPerSession)) +
      top('Top referring page', d.topReferrer) + top('Top destination page', d.topDestination);
    const warnings = [];
    if (d.truncated) warnings.push(`Only the top ${fmt(10000)} of ${fmt(d.rowCount)} GA4 rows were retrieved. Internal totals and shares cover this subset.`);
    if (d.quality?.dataLossFromOtherRow) warnings.push('GA4 grouped some high-cardinality data into (other).');
    if (d.quality?.subjectToThresholding) warnings.push('GA4 reporting thresholds may suppress some rows.');
    if (d.quality?.sampled) warnings.push('GA4 returned sampled data.');
    if (d.previous?.truncated || Object.values(d.previous?.quality || {}).some(Boolean)) warnings.push('The comparison period has partial or limited data.');
    if (d.comparisonUnavailable) warnings.push('Previous-period data is unavailable. Current data is shown.');
    if (d.totalViews == null) warnings.push('Property summary is unavailable; page transitions are still shown.');
    $('jyQuality').textContent = warnings.join(' ');
    $('jyQuality').hidden = !warnings.length;
    $('jyMetrics').setAttribute('aria-busy', 'false');
    dateLabel();
  }
  function fillPageFilters(rows) {
    for (const [id, field, value] of [['jyFrom', 'from', from], ['jyTo', 'to', to]]) {
      const pages = new Map();
      rows.forEach(r => pages.set(pageKey(r.host, r[field]), { host: r.host, path: r[field] }));
      const multipleHosts = new Set(rows.map(r => r.host)).size > 1;
      const options = [...pages].sort((a, b) => a[1].path.localeCompare(b[1].path));
      $(id).innerHTML = '<option value="">Any page</option>' + options.map(([key, item]) => `<option value="${esc(key)}">${esc((multipleHosts ? item.host : '') + item.path)}</option>`).join('');
      if (value && !pages.has(value)) $(id).add(new Option('Selected page (no data)', value));
      $(id).value = value;
    }
  }
  const trim = (text, n) => text.length > n ? text.slice(0, n - 1) + '…' : text;
  function renderGraph(rows) {
    const box = $('jyChart');
    if (!rows.length) {
      box.innerHTML = `<div class="jy-empty"><b>${data.rows.length ? 'No paths match these filters' : 'No internal page transitions'}</b><span>${data.rows.length ? 'Try another page or clear the filters.' : 'GA4 has no same-site referrer pairs for this period. Try a longer date range.'}</span>${from || to || search ? '<button type="button" class="btn" data-clear-filters>Clear filters</button>' : ''}</div>`;
      return;
    }
    const width = Math.max(688, $('jyChartScroll').clientWidth - 32);
    const graph = layoutGraph(rows, width);
    const multipleHosts = new Set(rows.map(r => r.host)).size > 1;
    const label = node => (multipleHosts ? node.host : '') + node.path;
    box.innerHTML = `<svg viewBox="0 0 ${graph.width} ${graph.height}" role="group" aria-label="Page transition flow chart, ${fmt(graph.total)} page views. Use Tab to select a flow or filter by page.">
      <text x="0" y="16" class="jy-column">Referring page<tspan x="0" y="35" class="jy-column-count">${fmt(graph.total)} internal page views</tspan></text>
      <text x="${width - 248}" y="16" class="jy-column">Current page<tspan x="${width - 248}" y="35" class="jy-column-count">Same-site referrers · 2-page transitions</tspan></text>
      ${graph.links.map((link, i) => `<path d="${link.path}" class="jy-flow" data-path="${i}" role="button" tabindex="0" aria-pressed="${selected === link.key}" aria-label="${esc(link.host + link.from + ' to ' + link.to + ', ' + fmt(link.views) + ' page views')}"><title>${esc(link.from + ' → ' + link.to + '\n' + fmt(link.views) + ' page views')}</title></path>`).join('')}
      ${graph.columns.map((nodes, col) => nodes.map((node, i) => `<g><rect x="${node.x}" y="${node.y}" width="8" height="${Math.max(1, node.h)}" rx="2" class="jy-node-bar"/><text x="${node.x + 16}" y="${node.y + 11}" class="jy-node-label" data-node="${col}:${i}" role="button" tabindex="0" aria-label="Filter ${col ? 'destination' : 'referring'} page ${esc(label(node))}"><title>${esc(label(node))}</title>${esc(trim(label(node), col ? 30 : Math.max(22, Math.floor((width - 300) / 12))))}</text><text x="${node.x + 16}" y="${node.y + 27}" class="jy-node-count">${fmt(node.views)} views</text></g>`).join('')).join('')}
    </svg>`;
    box.querySelectorAll('[data-node]').forEach(el => {
      const activate = () => {
        const [col, index] = el.dataset.node.split(':').map(Number);
        const key = graph.columns[col][index].key;
        if (col) to = to === key ? '' : key; else from = from === key ? '' : key;
        selected = null; render();
        $(col ? 'jyTo' : 'jyFrom').focus();
      };
      el.addEventListener('click', activate);
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
    });
    box.querySelectorAll('[data-path]').forEach(el => {
      const activate = () => pin(+el.dataset.path);
      el.addEventListener('click', activate);
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
      el.addEventListener('mouseenter', () => highlight(keyOf(rows[+el.dataset.path])));
      el.addEventListener('mouseleave', () => highlight(selected));
      el.addEventListener('focus', () => highlight(keyOf(rows[+el.dataset.path])));
      el.addEventListener('blur', () => highlight(selected));
    });
    highlight(selected);
  }
  function highlight(key) {
    $('jyChart').querySelectorAll('[data-path]').forEach(el => {
      const active = keyOf(shown[+el.dataset.path]) === key;
      el.classList.toggle('is-selected', !!key && active);
      el.classList.toggle('is-muted', !!key && !active);
      el.setAttribute('aria-pressed', String(selected === keyOf(shown[+el.dataset.path])));
    });
    $('jyRows').querySelectorAll('[data-row]').forEach(el => el.classList.toggle('is-selected', keyOf(shown[+el.dataset.row]) === key));
  }
  function pin(index) {
    const row = shown[index]; if (!row) return;
    selected = selected === keyOf(row) ? null : keyOf(row);
    $('jySelection').hidden = !selected;
    $('jyPinnedLabel').textContent = selected ? `${row.from} → ${row.to} · ${fmt(row.views)} page views` : '';
    highlight(selected);
  }
  function render() {
    if (!data) return;
    const rows = groupRows(data.rows, grouping);
    fillPageFilters(rows);
    const result = selectRows(rows, { from, to, search, limit });
    shown = result.shown;
    if (!shown.some(r => keyOf(r) === selected)) selected = null;
    $('jySelection').hidden = !selected;
    $('jyCoverage').textContent = `Top ${shown.length} paths cover ${fmt(shown.reduce((s, r) => s + r.views, 0))} of ${fmt(data.internalViews)} internal page views (${pct(data.internalViews ? shown.reduce((s, r) => s + r.views, 0) / data.internalViews : 0)})`;
    renderGraph(shown);
    const previous = new Map(groupRows(data.previous?.rows || [], grouping).map(r => [keyOf(r), r.views]));
    const multipleHosts = new Set(rows.map(r => r.host)).size > 1;
    $('jyChangeHead').hidden = compare === 'none';
    $('jyRows').innerHTML = shown.length ? shown.map((row, i) => {
      const share = data.internalViews ? row.views / data.internalViews : 0;
      return `<tr data-row="${i}"><td class="num">${i + 1}</td><td class="jy-path-cell"><button type="button" data-pin="${i}" aria-label="Select path ${esc(row.from + ' to ' + row.to)}">${esc(row.from)}<span class="jy-path-arrow" aria-hidden="true">→</span>${esc(row.to)}</button>${multipleHosts ? `<span class="jy-path-host">${esc(row.host)}</span>` : ''}</td><td class="num">${fmt(row.views)}</td><td class="num" ${compare === 'none' ? 'hidden' : ''}>${data.previous ? delta(row.views, previous.get(keyOf(row)) ?? (data.previous.truncated || Object.values(data.previous.quality || {}).some(Boolean) ? null : 0)) || '—' : '—'}</td><td class="num">${pct(share)}<span class="jy-share-bar"><i style="width:${share * 100}%"></i></span></td><td><button type="button" class="btn btn-ghost btn-icon" data-pin="${i}" aria-label="Pin path ${i + 1}" title="Pin path">↗</button></td></tr>`;
    }).join('') : `<tr><td colspan="6" class="faint">${data.rows.length ? 'No paths match these filters.' : 'No internal page transitions for this period.'}</td></tr>`;
    $('jyTableMeta').textContent = `Showing ${shown.length} of ${fmt(result.matched.length)} ${grouping === 'folder' ? 'grouped ' : ''}paths · Share of all retrieved internal page views`;
    $('jyExport').disabled = !result.matched.length;
    highlight(selected); syncUrl();
  }
  function exportCsv() {
    if (!data) return;
    const rows = selectRows(groupRows(data.rows, grouping), { from, to, search, limit }).matched;
    const previous = new Map(groupRows(data.previous?.rows || [], grouping).map(r => [keyOf(r), r.views]));
    // Neutralize spreadsheet formulas in text fields as well as escaping CSV quotes.
    const cell = value => '"' + String(value ?? '').replace(/^[=+@\-\t\r]/, s => "'" + s).replace(/"/g, '""') + '"';
    const lines = [['Hostname', 'Referring page', 'Current page', 'Page views', 'Previous page views', 'Share of retrieved internal views'], ...rows.map(r => [r.host, r.from, r.to, r.views, data.previous ? previous.get(keyOf(r)) ?? '' : '', data.internalViews ? r.views / data.internalViews : 0])];
    const url = URL.createObjectURL(new Blob(['\uFEFF' + lines.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `journeys_${prop}_${range}.csv`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function load(fresh = false) {
    const id = ++loadId;
    abort?.abort(); abort = new AbortController();
    data = null; selected = null; shown = [];
    $('analyticsProperty').value = prop; $('jyRange').value = range; $('jyCompare').value = compare;
    $('jySelection').hidden = true; $('jyQuality').hidden = true; $('jyExport').disabled = true;
    $('jyFresh').textContent = 'Loading'; $('jyPaths').setAttribute('aria-busy', 'true'); $('jyMetrics').setAttribute('aria-busy', 'true');
    $('jyMetrics').querySelectorAll('b').forEach(el => el.textContent = '—');
    $('jyMetrics').querySelectorAll('small').forEach(el => el.textContent = 'Loading…');
    $('jyCoverage').textContent = 'The most common transitions within your site';
    $('jyChart').innerHTML = '<div class="jy-empty" role="status">Loading page transitions…</div>';
    $('jyRows').innerHTML = '<tr><td colspan="6" class="faint">Loading paths…</td></tr>';
    $('jyTableMeta').textContent = '';
    syncUrl(); dateLabel();
    if (!prop) {
      $('jyFresh').textContent = 'No properties'; $('jyChart').innerHTML = '<div class="jy-empty"><b>No GA4 properties available</b><span>Connect a property in Setup to explore journeys.</span><a class="btn" href="/setup">Open Setup</a></div>';
      $('jyRows').innerHTML = '<tr><td colspan="6" class="faint">No properties available.</td></tr>';
      $('jyPaths').setAttribute('aria-busy', 'false'); $('jyMetrics').setAttribute('aria-busy', 'false');
      return;
    }
    try {
      const response = await fetch(`/api/journeys/${prop}?range=${range}&compare=${compare}${fresh ? '&fresh=1' : ''}`, { signal: abort.signal });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.rateLimited ? 'GA4 quota is temporarily paused. Try again later.' : payload.error || 'Could not load page transitions.');
      if (id !== loadId) return;
      data = payload; renderMetrics(); render();
      $('jyFresh').textContent = `${payload.cached ? 'Cached' : 'Updated'} ${new Date(payload.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch (err) {
      if (id !== loadId || err.name === 'AbortError') return;
      $('jyFresh').textContent = 'Unavailable';
      $('jyChart').innerHTML = `<div class="jy-empty" role="alert"><b>Could not load journeys</b><span>${esc(err.message)}</span><button type="button" class="btn" data-retry>Try again</button></div>`;
      $('jyRows').innerHTML = '<tr><td colspan="6" class="faint">Journey data is unavailable.</td></tr>';
      $('jyMetrics').querySelectorAll('small').forEach(el => el.textContent = 'Unavailable');
    } finally {
      if (id === loadId) { $('jyPaths').setAttribute('aria-busy', 'false'); $('jyMetrics').setAttribute('aria-busy', 'false'); }
    }
  }
  $('jyGroup').value = grouping; $('jyLimit').value = limit; $('jySearch').value = search;
  $('analyticsProperty').addEventListener('change', e => { prop = e.target.value; from = to = search = ''; $('jySearch').value = ''; load(); });
  $('jyRange').addEventListener('change', e => { range = e.target.value; load(); });
  $('jyCompare').addEventListener('change', e => { compare = e.target.value; load(); });
  $('jyGroup').addEventListener('change', e => { grouping = e.target.value; from = to = ''; selected = null; render(); });
  $('jyFrom').addEventListener('change', e => { from = e.target.value; selected = null; render(); });
  $('jyTo').addEventListener('change', e => { to = e.target.value; selected = null; render(); });
  $('jyLimit').addEventListener('change', e => { limit = +e.target.value; render(); });
  let searchTimer;
  $('jySearch').maxLength = 200;
  $('jySearch').addEventListener('input', e => { search = e.target.value; clearTimeout(searchTimer); searchTimer = setTimeout(render, 150); });
  $('jyRefresh').addEventListener('click', () => load(true));
  $('jyExport').addEventListener('click', exportCsv);
  $('jyUnpin').addEventListener('click', () => { selected = null; $('jySelection').hidden = true; highlight(null); });
  page.addEventListener('click', e => {
    if (e.target.closest('[data-retry]')) load(true);
    if (e.target.closest('[data-clear-filters]')) { from = to = search = ''; $('jySearch').value = ''; render(); }
    const pinButton = e.target.closest('[data-pin]'); if (pinButton) pin(+pinButton.dataset.pin);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && selected) { selected = null; $('jySelection').hidden = true; highlight(null); } });
  let resizeTimer;
  new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (data) renderGraph(shown); }, 100); }).observe($('jyChartScroll'));
  load();
})();
