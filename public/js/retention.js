(function retentionPage() {
  const page = document.getElementById('rtPage');
  if (!page) return;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const qs = new URLSearchParams(location.search);
  const props = RETENTION_PROPERTIES;
  let prop = props.some(p => String(p.id) === qs.get('prop')) ? qs.get('prop') : String(props[0]?.id || '');
  let range = ['7d', '30d', '90d'].includes(qs.get('range')) ? qs.get('range') : '30d';
  let bucket = qs.get('bucket') === 'day' ? 'day' : 'week';
  let mode = qs.get('stat') === 'users' ? 'users' : 'percent';
  let compare = qs.get('compare') !== 'none';
  let end = /^\d{4}-\d{2}-\d{2}$/.test(qs.get('end') || '') ? qs.get('end') : '';
  let data = null, selected = null, hover = 0, controller = null, loadId = 0;
  const number = n => n == null ? '—' : Math.round(n).toLocaleString('en-US');
  const pct = n => n == null ? 'n/a' : (n * 100).toFixed(1) + '%';
  const unit = () => bucket === 'week' ? 'Week' : 'Day';
  const labelDate = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const dates = (a, b) => a === b ? labelDate(a) : `${labelDate(a)} – ${labelDate(b)}`;
  const cohortLabel = c => dates(c.startDate, c.endDate);
  const shift = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

  function sync() {
    const q = new URLSearchParams({ prop, range, bucket, stat: mode });
    if (end) q.set('end', end);
    if (!compare) q.set('compare', 'none');
    history.replaceState(null, '', `/retention?${q}`);
    window.AnalyticsSidebar.sync();
    $('analyticsProperty').value = prop;
    $('rtRange').value = range;
    $('rtCompare').value = compare ? 'previous' : 'none';
    page.querySelectorAll('[data-bucket]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.bucket === bucket)));
    page.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    $('rtReportTitle').textContent = `Retention by ${bucket === 'week' ? 'weekly' : 'daily'} cohort`;
    $('rtSubtitle').textContent = `Share of each ${bucket}'s new users who were active again, by ${bucket}s since their first visit.`;
  }

  function delta(current, previous, size = false) {
    if (!compare || current == null || previous == null || (size && !previous)) return '';
    const raw = size ? (current - previous) / previous * 100 : (current - previous) * 100;
    const diff = Math.round(raw * 10) / 10;
    return `<span class="rt-delta num ${diff > 0 ? 'rt-up' : diff < 0 ? 'rt-down' : 'faint'}">${diff > 0 ? '↑' : diff < 0 ? '↓' : ''} ${Math.abs(diff).toFixed(1)}${size ? '%' : ' pp'}</span>`;
  }

  function metrics() {
    const summary = data.summary, prev = data.previous.summary;
    const cards = [0, 1, 2].map(i => {
      const cur = summary.cells[i]?.rate ?? null, previous = prev.cells[i]?.rate ?? null;
      return `<div class="rt-metric"><span class="rt-metric-label">${unit()} ${i + 1} retention</span><div class="rt-metric-value"><strong class="num">${pct(cur)}</strong>${delta(cur, previous)}</div><span class="cap faint">${compare && previous != null ? `${pct(previous)} in ${dates(data.previous.startDate, data.previous.endDate)}` : cur == null ? 'No complete return period yet' : 'Complete return periods only'}</span></div>`;
    });
    cards.push(`<div class="rt-metric"><span class="rt-metric-label">Avg. cohort size</span><div class="rt-metric-value"><strong class="num">${number(summary.averageSize)}</strong>${delta(summary.averageSize, prev.averageSize, true)}</div><span class="cap faint">new users per complete ${bucket}</span></div>`);
    const best = data.cohorts.find(c => c.name === summary.bestCohort);
    cards.push(`<div class="rt-metric"><span class="rt-metric-label">Best cohort</span><strong class="num">${best ? esc(cohortLabel(best)) : '—'}</strong><span class="cap faint">${best ? `${pct(best.cells[0].rate)} came back in ${unit().toLowerCase()} 1` : 'No complete return period yet'}</span></div>`);
    $('rtMetrics').innerHTML = cards.join('');
    $('rtMetrics').setAttribute('aria-busy', 'false');
  }

  function legend(index) {
    const cohort = data.cohorts.find(c => c.name === selected);
    const others = data.cohorts.filter(c => c.name !== selected && c.cells[index]?.status === 'complete' && c.cells[index].rate != null).map(c => c.cells[index].rate);
    const line = (name, value, cls) => `<div class="rt-legend-line"><span><i class="${cls}"></i>${esc(name)}</span><b class="num">${esc(value)}</b></div>`;
    return `<div class="rt-legend-title"><b>${unit()} ${index + 1}</b><span class="faint">after first visit</span></div>`
      + line('Average, all cohorts', pct(data.summary.cells[index]?.rate), 'rt-dot')
      + (cohort ? line(cohortLabel(cohort) + ' cohort', pct(cohort.cells[index]?.rate), 'rt-dot selected') : '')
      + (compare ? line('Comparison period', pct(data.previous.summary.cells[index]?.rate), 'rt-dash') : '')
      + line('Other cohorts', others.length ? `${pct(Math.min(...others))} – ${pct(Math.max(...others))}` : 'n/a', 'rt-dot other')
      + `<div class="rt-legend-note">${unit()} 0 is the acquisition period, so the curve starts at ${unit().toLowerCase()} 1. Averages exclude striped cells.</div>`;
  }

  function chart() {
    const available = data.summary.cells.map(c => c.rate);
    const other = data.cohorts.map(c => c.cells.map(cell => cell.status === 'complete' ? cell.rate : null));
    const selectedCohort = data.cohorts.find(c => c.name === selected);
    const previous = data.previous.summary.cells.map(c => c.rate);
    const shown = [...available, ...other.flat(), ...(compare ? previous : [])].filter(v => v != null);
    if (!shown.length) return '<div class="rt-chart-empty">Return periods will appear as these cohorts mature.</div>';
    const max = Math.max(.02, Math.ceil(Math.max(...shown) * 100 / 2) * .02);
    const w = 820, h = 224, left = 40, right = 16, top = 12, bottom = 26;
    const n = data.periods;
    const x = i => n === 1 ? (w + left) / 2 : left + i * (w - left - right) / (n - 1);
    const y = v => h - bottom - v / max * (h - top - bottom);
    let svg = '';
    for (let i = 0; i <= 4; i++) {
      const v = max * i / 4;
      svg += `<line class="grid" x1="${left}" x2="${w - right}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${left - 8}" y="${y(v) + 4}" text-anchor="end">${(v * 100).toFixed(max < .04 ? 1 : 0)}%</text>`;
    }
    function line(values, cls) {
      let path = '', pen = false;
      values.forEach((v, i) => {
        if (v == null) { pen = false; return; }
        path += `${pen ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)} `; pen = true;
      });
      return `<path class="rt-line ${cls}" d="${path}" vector-effect="non-scaling-stroke"/>`;
    }
    other.forEach(v => { svg += line(v, 'other'); });
    if (compare) svg += line(previous, 'previous');
    svg += line(available, '');
    if (selectedCohort) {
      svg += line(selectedCohort.cells.map(c => c.status === 'complete' ? c.rate : null), 'selected');
      selectedCohort.cells.forEach((cell, i) => {
        if (cell.status === 'complete' && cell.rate != null) svg += `<circle class="rt-point selected" cx="${x(i)}" cy="${y(cell.rate)}" r="3"/>`;
      });
    }
    available.forEach((v, i) => { if (v != null) svg += `<circle class="rt-point" cx="${x(i)}" cy="${y(v)}" r="3"/>`; });
    svg += `<line class="rt-guide" id="rtGuide" x1="${x(hover)}" x2="${x(hover)}" y1="${top}" y2="${h - bottom}"/>`;
    for (let i = 0; i < n; i++) {
      if (n <= 8 || i === 0 || i === n - 1 || (i + 1) % 5 === 0) svg += `<text class="axis" x="${x(i)}" y="${h - 6}" text-anchor="middle">${unit()} ${i + 1}</text>`;
      const start = i ? (x(i - 1) + x(i)) / 2 : left;
      const finish = i === n - 1 ? w - right : (x(i) + x(i + 1)) / 2;
      svg += `<rect class="rt-hit" data-period="${i}" data-x="${x(i)}" x="${start}" y="${top}" width="${Math.max(1, finish - start)}" height="${h - top - bottom}" tabindex="0" role="button" aria-label="${unit()} ${i + 1}, average retention ${pct(available[i])}"/>`;
    }
    return `<svg viewBox="0 0 ${w} ${h}" role="group" aria-label="Retention by periods since first visit">${svg}</svg>`;
  }

  function heat(rate, max) { return Math.round(4 + (rate == null ? 0 : Math.min(1, rate / max)) * 44) + '%'; }
  function table() {
    const max = Math.max(.01, ...data.cohorts.flatMap(c => c.cells.map(cell => cell.rate || 0)));
    $('rtScaleMax').textContent = pct(max);
    const value = cell => mode === 'users' ? number(cell.users) : pct(cell.rate);
    const header = `<thead><tr><th scope="col">Cohort, by first visit</th><th scope="col">New users</th>${Array.from({ length: data.periods }, (_, i) => `<th scope="col">${unit()} ${i + 1}</th>`).join('')}</tr></thead>`;
    const averages = `<tr class="rt-average"><th scope="row">All cohorts <span class="cap faint">weighted</span></th><td class="rt-size num">${number(data.summary.totalUsers)} <span class="cap faint">total</span></td>${data.summary.cells.map(c => `<td>${c.rate == null ? '<span class="rt-unknown">n/a</span>' : `<span class="rt-cell num" style="--heat:${heat(c.rate, max)};line-height:32px" title="${number(c.users)} of ${number(c.size)} users in ${c.cohorts} complete return periods">${value(c)}</span>`}</td>`).join('')}</tr>`;
    const rows = data.cohorts.map((c, index) => {
      const label = cohortLabel(c);
      const cells = c.cells.map((cell, j) => {
        if (cell.status === 'future') return '<td><span class="rt-unknown" aria-label="Not observed">—</span></td>';
        if (cell.rate == null) return '<td><span class="rt-unknown">n/a</span></td>';
        const text = `${label} cohort, ${unit()} ${j + 1}: ${pct(cell.rate)}, ${number(cell.users)} of ${number(c.size)} users${cell.status === 'partial' ? ', in progress' : ''}`;
        return `<td><button type="button" class="rt-cell num ${cell.status === 'partial' ? 'partial' : ''}" style="--heat:${heat(cell.rate, max)}" data-cell="${index}:${j}" aria-label="${esc(text)}" title="${esc(text)}">${value(cell)}</button></td>`;
      }).join('');
      const waiting = c.cells.every(cell => cell.status === 'future');
      return `<tr class="${c.name === selected ? 'is-selected' : ''}"><th scope="row"><button type="button" class="rt-cohort num" data-cohort="${index}" aria-pressed="${c.name === selected}" title="${c.partial ? 'Partial acquisition period · ' : ''}Highlight this cohort">${esc(label)}${c.partial ? ' <span class="cap faint">*</span>' : ''}</button></th><td class="rt-size num">${number(c.size)}</td>${waiting ? `<td colspan="${data.periods}" class="rt-pending">Returns start ${labelDate(shift(c.periodStart, bucket === 'week' ? 7 : 1))}.</td>` : cells}</tr>`;
    }).join('');
    return `<div class="rt-table-wrap"><table class="rt-table num" style="min-width:${Math.max(640, 280 + data.periods * 72)}px" aria-label="Retention by first-visit cohort">${header}<tbody>${averages}${rows}</tbody></table></div>`;
  }

  function render() {
    if (!data) return;
    sync(); metrics();
    $('rtDates').textContent = `${dates(data.startDate, data.endDate)}, ${data.endDate.slice(0, 4)} · ${data.timeZone}`;
    $('rtNext').disabled = data.endDate >= data.today;
    $('rtContent').innerHTML = data.summary.totalUsers
      ? `<div class="rt-chart-row"><div class="rt-legend" id="rtLegend">${legend(hover)}</div><div class="rt-chart" id="rtChart">${chart()}</div></div>${table()}`
      : '<div class="rt-empty"><h3>No new users in this range</h3><p>Choose another property or a longer date range to see its retention cohorts.</p></div>';
    $('rtFoot').innerHTML = `<div><span><i class="rt-partial-key"></i>In progress</span><span>* Partial acquisition period</span>${bucket === 'week' ? '<span>Weeks start on Sunday</span>' : ''}<span>First visit in GA4 · ${esc(data.timeZone)}</span>${bucket === 'day' && data.days > 30 ? '<span>First 30 return days shown</span>' : ''}${data.thresholded ? '<span>GA4 privacy thresholds may affect these counts</span>' : ''}${data.sampled ? '<span>Sampled GA4 report</span>' : ''}</div><span>Click a cell for details</span>`;
    $('rtReport').setAttribute('aria-busy', 'false');
    $('rtExport').disabled = !data.summary.totalUsers;
  }

  async function load(fresh = false) {
    controller?.abort();
    controller = new AbortController();
    const id = ++loadId;
    data = null; selected = null; hover = 0;
    sync();
    $('rtExport').disabled = true;
    $('rtNext').disabled = true;
    $('rtFresh').textContent = 'Loading';
    $('rtFresh').className = 'badge';
    $('rtDates').textContent = '';
    $('rtMetrics').setAttribute('aria-busy', 'true');
    $('rtScaleMax').textContent = '—';
    $('rtMetrics').querySelectorAll('strong').forEach(n => { n.textContent = '—'; });
    $('rtMetrics').querySelectorAll('.rt-delta, .rt-metric > .cap').forEach(n => { n.textContent = ''; });
    $('rtReport').setAttribute('aria-busy', 'true');
    $('rtContent').innerHTML = '<div class="rt-loading" role="status">Loading first-visit cohorts…</div>';
    if (!prop) { fail('No GA4 properties are available.'); return; }
    try {
      const q = new URLSearchParams({ range, bucket });
      if (end) q.set('end', end);
      if (fresh) q.set('fresh', '1');
      const response = await fetch(`/api/retention/${encodeURIComponent(prop)}?${q}`, { signal: controller.signal });
      const result = await response.json();
      if (id !== loadId) return;
      if (!response.ok || !result.ok) throw new Error(result.error || 'Could not load the cohort report.');
      data = result;
      selected = result.summary.bestCohort || result.cohorts.find(c => c.size)?.name;
      const age = Math.max(0, Math.round((Date.now() - Date.parse(result.fetchedAt)) / 60000));
      $('rtFresh').textContent = age < 1 ? 'Updated just now' : `Updated ${age} min ago`;
      $('rtFresh').className = 'badge' + (age > 60 ? ' warn' : '');
      $('rtFresh').title = `Fetched ${new Date(result.fetchedAt).toLocaleString()}${result.cached ? ' · cached for up to one hour' : ''}`;
      render();
    } catch (err) { if (err.name !== 'AbortError' && id === loadId) fail(err.message); }
  }

  function fail(message) {
    $('rtFresh').textContent = 'Unavailable'; $('rtFresh').className = 'badge bad';
    $('rtMetrics').setAttribute('aria-busy', 'false');
    $('rtReport').setAttribute('aria-busy', 'false');
    $('rtContent').innerHTML = `<div class="rt-empty" role="alert"><h3>Retention data is unavailable</h3><p>${esc(message)}</p><button type="button" class="btn" data-retry>Retry</button></div>`;
  }

  function choose(index) {
    selected = data.cohorts[index].name;
    render();
  }

  function detail(index, period) {
    const c = data.cohorts[index], cell = c.cells[period];
    choose(index);
    $('rtDetailTitle').textContent = `${unit()} ${period + 1} retention`;
    $('rtDetailBody').innerHTML = `<p class="small faint">${esc(cohortLabel(c))} cohort</p><div class="rt-detail-rate num">${pct(cell.rate)}</div><p class="small muted">${number(cell.users)} of ${number(c.size)} users were active again.</p><dl><dt>First visit</dt><dd class="num">${esc(dates(c.startDate, c.endDate))}</dd><dt>Return period</dt><dd class="num">${esc(dates(cell.startDate, cell.endDate))}</dd><dt>Time zone</dt><dd>${esc(data.timeZone)}</dd><dt>Status</dt><dd>${cell.status === 'partial' ? 'In progress · excluded from average' : 'Complete return period'}</dd></dl>${cell.status === 'partial' ? '<p class="cap faint">This period is still filling in. Recent activity may also be processing in GA4.</p>' : ''}`;
    $('rtDetail').showModal();
  }

  function inspectPeriod(target) {
    if (!data || !target?.dataset.period) return;
    hover = Number(target.dataset.period);
    $('rtLegend').innerHTML = legend(hover);
    const guide = $('rtGuide');
    if (guide) { guide.setAttribute('x1', target.dataset.x); guide.setAttribute('x2', target.dataset.x); }
  }

  $('rtContent').addEventListener('mouseover', e => inspectPeriod(e.target.closest('[data-period]')));
  $('rtContent').addEventListener('focusin', e => inspectPeriod(e.target.closest('[data-period]')));
  $('rtContent').addEventListener('click', e => {
    if (e.target.closest('[data-retry]')) { load(true); return; }
    const cell = e.target.closest('[data-cell]');
    if (cell && data) { const [i, j] = cell.dataset.cell.split(':').map(Number); detail(i, j); return; }
    const cohort = e.target.closest('[data-cohort]');
    if (cohort && data) choose(Number(cohort.dataset.cohort));
  });
  $('rtDetailClose').addEventListener('click', () => $('rtDetail').close());
  $('rtDetail').addEventListener('click', e => { if (e.target === $('rtDetail')) { const r = e.target.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close(); } });
  $('analyticsProperty').addEventListener('change', e => { prop = e.target.value; end = ''; load(); });
  $('rtRange').addEventListener('change', e => { range = e.target.value; end = ''; load(); });
  $('rtRefresh').addEventListener('click', () => load(true));
  $('rtBucket').addEventListener('click', e => { const button = e.target.closest('[data-bucket]'); if (button && bucket !== button.dataset.bucket) { bucket = button.dataset.bucket; load(); } });
  $('rtMode').addEventListener('click', e => { const button = e.target.closest('[data-mode]'); if (button) { mode = button.dataset.mode; sync(); if (data) render(); } });
  $('rtCompare').addEventListener('change', e => { compare = e.target.value === 'previous'; sync(); if (data) render(); });
  $('rtPrev').addEventListener('click', () => { if (data) { end = shift(data.endDate, -data.days); load(); } });
  $('rtNext').addEventListener('click', () => { if (data) { const next = shift(data.endDate, data.days); end = next >= data.today ? '' : next; load(); } });
  $('rtExport').addEventListener('click', () => {
    if (!data) return;
    const rows = [['Cohort start', 'Cohort end', 'New users', 'Return period', 'Return start', 'Return end', 'Active users', 'Retention percent', 'Status', 'Time zone']];
    data.cohorts.forEach(c => c.cells.forEach(cell => rows.push([c.startDate, c.endDate, c.size, `${unit()} ${cell.offset}`, cell.startDate, cell.endDate, cell.users ?? '', cell.rate == null ? '' : (cell.rate * 100).toFixed(4), cell.status, data.timeZone])));
    const csv = rows.map(row => row.map(v => '"' + String(v).replaceAll('"', '""') + '"').join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a'); a.href = url; a.download = `retention-${prop}-${data.startDate}-${data.endDate}-${bucket}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  load();
})();
