/* Analytics workspace. Loaded only by views/analytics.hbs. */
(function analyticsPage() {
  const page = document.getElementById('anPage');
  if (!page || typeof PROPERTIES === 'undefined') return;

  const $ = id => document.getElementById(id);
  const qs = new URLSearchParams(location.search);
  const RANGES = ['today', '7d', '28d'];
  const PREV_LABEL = { today: 'Yesterday', '7d': 'Previous 7 days', '28d': 'Previous 28 days' };
  const TABLE_CHANGES = { 'traffic-sources': 'Source', 'landing-pages': 'Landing page', countries: 'Country', 'page-paths': 'Page views' };
  const GRID = CARDS.filter(c => c.type !== 'new-users-by-date');
  const GROUPS = [
    { id: 'acquisition', title: 'Acquisition', reports: [['traffic-sources', 'Sources'], ['referrers', 'Referrers'], ['source-split', 'Channels'], ['source-engagement', 'Quality']] },
    { id: 'content', title: 'Pages', reports: [['page-paths', 'Top pages'], ['landing-pages', 'Landing pages'], ['content-engagement', 'Engagement']] },
    { id: 'audience', title: 'Geography', reports: [['countries', 'Countries'], ['regions', 'Regions'], ['cities', 'Cities'], ['languages', 'Languages'], ['country-map', 'Map']] },
    { id: 'technology', title: 'Technology', reports: [['browsers', 'Browsers'], ['devices', 'Devices'], ['operating-systems', 'Operating Systems'], ['screen-resolutions', 'Screen Dimensions']] },
    { id: 'behavior', title: 'Activity', reports: [['hourly-traffic', 'Hourly'], ['events', 'Events'], ['dow', 'Day of week']] },
    { id: 'revenue', title: 'Revenue', reports: [['revenue-by-source', 'Sources'], ['revenue-key-events', 'Revenue & events']] },
    { id: 'diagnostics', title: 'Diagnostics', reports: [['traffic-anomalies', 'Sources'], ['bot-traffic', 'Bots'], ['spikes', 'Spikes']] },
  ];
  const activeReports = Object.fromEntries(GROUPS.map(g => [g.id, g.reports[0][0]]));
  let ensureReport = () => {};

  let prop = PROPERTIES.some(p => String(p.id) === qs.get('prop')) ? qs.get('prop') : String((PROPERTIES[0] || {}).id || '');
  let range = RANGES.includes(qs.get('range')) ? qs.get('range') : '28d';
  let trendI = 1;
  let store = {};
  let reports = null;
  let spikes = [];
  let loadId = 0;

  /* Formatting */
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const currency = () => (PROPERTIES.find(p => String(p.id) === prop) || {}).currencyCode || 'USD';
  function fmt(n) {
    const v = +n || 0;
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (Math.abs(v) >= 1e4) return (v / 1e3).toFixed(1) + 'k';
    return Math.round(v).toLocaleString('en-US');
  }
  function money(n) {
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency(), notation: 'compact', maximumFractionDigits: 1 }).format(+n || 0); }
    catch { return currency() + ' ' + fmt(n); }
  }
  const fmtDur = sec => { const s = Math.round(+sec || 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const fmtPct = p => (Math.round((+p || 0) * 10) / 10) + '%';
  const isMoney = m => /revenue|value/i.test(m || '');
  const dateLabel = d => new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  function safeHref(url) {
    try { const u = new URL(url); return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : ''; } catch { return ''; }
  }
  // Change vs previous period: { text, cls }. prev null means no match in the previous period.
  function delta(cur, prev) {
    if (prev == null) return { text: 'n/a', cls: 'faint' };
    if (!prev) return cur > 0 ? { text: 'new', cls: 'd-up' } : { text: 'n/a', cls: 'faint' };
    const p = Math.round(((cur - prev) / prev) * 100);
    if (!p) return { text: '0%', cls: 'faint' };
    return { text: (p > 0 ? '+' : '') + p + '%', cls: p > 0 ? 'd-up' : 'd-dn' };
  }

  const ICON = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const SHAPES = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/>',
    social: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
    forum: '<path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5Z"/>',
    code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
    video: '<path d="m5 3 14 9-14 9V3z"/>',
    ai: '<path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/><circle cx="12" cy="12" r="4"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    spike: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  };
  const shape = s => ICON(SHAPES[s] || SHAPES.globe);
  const CSV_ICON = ICON('<path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14"/>');
  const AUDIENCE_REPORTS = new Set(['countries', 'regions', 'cities', 'languages', 'browsers', 'devices', 'operating-systems', 'screen-resolutions']);
  const DEVICE_ICONS = {
    desktop: '<rect x="3" y="3" width="18" height="14"/><path d="M8 21h8M12 17v4"/>',
    mobile: '<rect x="6" y="2" width="12" height="20" rx="1"/><path d="M11 18h2"/>',
    tablet: '<rect x="4" y="2" width="16" height="20" rx="1"/><path d="M11 18h2"/>',
  };

  function renderAudience(d) {
    const rows = (d.rows || []).slice(0, 10);
    if (!rows.length) return empty('No data for this period.');
    const labels = { countries: 'Countries', regions: 'Regions', cities: 'Cities', languages: 'Languages', browsers: 'Browsers', devices: 'Devices', 'operating-systems': 'Operating Systems', 'screen-resolutions': 'Screen Dimensions' };
    const max = Math.max(1, ...rows.map(r => +r.metrics[0] || 0));
    return `<div class="scroll"><table class="tbl an-audience-table"><thead><tr><th>${labels[d.type]}</th><th class="n">Sessions</th></tr></thead><tbody>` + rows.map(row => {
      const value = +row.metrics[0] || 0;
      const label = AnalyticsAudience.rowLabel(d.type, row.dims);
      const flag = label.countryCode ? String.fromCodePoint(...[...label.countryCode].map(c => 127397 + c.charCodeAt(0))) : '';
      const icon = label.countryCode ? `<span class="an-flag" aria-hidden="true">${flag}<img src="/api/flag/${label.countryCode}" alt="" loading="lazy" width="20" height="15"></span>` : DEVICE_ICONS[label.device] ? ICON(DEVICE_ICONS[label.device]) : '';
      const prefix = label.prefix ? `<span class="faint">${esc(label.prefix)} ›</span> ` : '';
      const detail = label.detail ? `<span class="cap faint"> · ${esc(label.detail)}</span>` : '';
      return `<tr><td class="lc"><span class="an-row-fill" style="width:${(value / max) * 100}%"></span><span class="an-audience-label" title="${esc([label.prefix, label.text, label.detail].filter(Boolean).join(' / '))}">${icon}<span class="lbl">${prefix}${esc(label.text)}${detail}</span></span></td><td class="n num">${fmt(value)}</td></tr>`;
    }).join('') + '</tbody></table></div>';
  }

  let mapData = null;
  async function renderCountryMap() {
    const id = loadId;
    const d = store.countries;
    const body = $('card-country-map').querySelector('.card-b');
    if (!d) return;
    try {
      if (!mapData) mapData = fetch('/data/world-ind.json').then(r => { if (!r.ok) throw new Error('Map unavailable'); return r.json(); }).then(AnalyticsAudience.topologyPaths).catch(e => { mapData = null; throw e; });
      const paths = await mapData;
      if (id !== loadId) return;
      const counts = new Map((d.rows || []).map(r => [r.dims[1], +r.metrics[0] || 0]));
      const max = Math.max(0, ...counts.values());
      if (!max) { body.innerHTML = empty('No data for this period.'); return; }
      body.innerHTML = `<div class="an-country-map"><svg viewBox="0 0 720 360" role="img" aria-label="Sessions by country from Google Analytics">${paths.map(p => {
        const count = counts.get(p.countryCode) || 0;
        return `<path class="an-country${count ? ' has-data' : ''}" d="${p.path}"${count ? ` style="fill-opacity:${.15 + .85 * Math.sqrt(count / max)}"` : ''}><title>${esc(p.countryCode ? AnalyticsAudience.countryName(p.countryCode) : 'Unknown country')}: ${fmt(count)} sessions</title></path>`;
      }).join('')}</svg><div class="cap faint an-map-scale"><span>Country sessions</span><span class="num">0 – ${fmt(max)}</span></div></div>`;
    } catch (e) { if (id === loadId) body.innerHTML = empty(e.message); }
  }

  /* Chart: dither area + line, optional dashed previous period, axis for the trend and hourly cards. */
  let uid = 0;
  function lineChart(values, prev, { w = 800, h = 260, axis = true, labels = [], fmtY = fmt, label = 'Trend' } = {}) {
    const id = 'an' + (++uid);
    const n = Math.max(values.length, 2);
    const max = Math.max(1, ...values, ...(prev || []));
    const top = axis ? 10 : 2, bottom = axis ? 18 : 2, left = axis ? 40 : 0;
    const iw = w - left, ih = h - top - bottom;
    const x = i => left + (i / (n - 1)) * iw;
    const y = v => top + ih - ((+v || 0) / max) * ih;
    const pts = vs => vs.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const cur = pts(values);
    let g = '';
    if (axis) {
      for (const v of new Set([0, max / 2, max])) g += `<line class="grid" x1="${left}" x2="${w}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${left - 6}" y="${y(v) + 3}" text-anchor="end">${esc(fmtY(v))}</text>`;
      const idx = [...new Set([0, 1, 2, 3, 4].map(k => Math.round((k / 4) * (values.length - 1))))];
      for (const i of idx) g += `<text class="axis" x="${x(i)}" y="${h - 4}" text-anchor="${i === 0 ? 'start' : i === values.length - 1 ? 'end' : 'middle'}">${esc(labels[i] || '')}</text>`;
    }
    const pv = prev && prev.length ? `<polyline class="prev" points="${pts(prev.slice(0, values.length))}" vector-effect="non-scaling-stroke"/>` : '';
    return `<svg viewBox="0 0 ${w} ${h}" ${axis ? '' : 'preserveAspectRatio="none"'} role="img" aria-label="${esc(label)}">
      <defs><pattern id="${id}p" width="4" height="3" patternUnits="userSpaceOnUse"><rect width="4" height="1" class="dz" opacity=".55"/></pattern>
      <clipPath id="${id}c"><polygon points="${left},${top + ih} ${cur} ${x(values.length - 1)},${top + ih}"/></clipPath></defs>
      ${g}<rect x="${left}" y="${top}" width="${iw}" height="${ih}" fill="url(#${id}p)" clip-path="url(#${id}c)"/>${pv}
      <polyline class="ln" points="${cur}" vector-effect="non-scaling-stroke"/>
      ${axis ? `<line class="hover" x1="0" x2="0" y1="${top}" y2="${top + ih}" visibility="hidden"/><circle class="end" cx="${x(values.length - 1)}" cy="${y(values[values.length - 1])}" r="3"/>` : ''}</svg>`;
  }

  // Read the viewBox so the tooltip stays aligned when the overview chart resizes.
  function attachTip(box, rows, line) {
    const svg = box.querySelector('svg');
    if (!svg) return;
    const tip = document.createElement('div');
    tip.className = 'tip';
    box.appendChild(tip);
    const hover = svg.querySelector('.hover');
    svg.addEventListener('mousemove', e => {
      const r = svg.getBoundingClientRect();
      const width = svg.viewBox.baseVal.width;
      const vx = ((e.clientX - r.left) / r.width) * width;
      const i = Math.max(0, Math.min(rows.length - 1, Math.round(((vx - 40) / (width - 40)) * (rows.length - 1))));
      const hx = 40 + (i / Math.max(rows.length - 1, 1)) * (width - 40);
      hover.setAttribute('x1', hx); hover.setAttribute('x2', hx); hover.setAttribute('visibility', 'visible');
      tip.innerHTML = line(i);
      const bx = box.getBoundingClientRect();
      const left = Math.min(e.clientX - bx.left + 12, bx.width - tip.offsetWidth - 4);
      tip.style.transform = `translate(${Math.max(0, left)}px, ${e.clientY - bx.top - 40}px)`;
      tip.classList.add('on');
    });
    svg.addEventListener('mouseleave', () => { tip.classList.remove('on'); hover.setAttribute('visibility', 'hidden'); });
  }

  const skel = () => '<div class="skel" aria-hidden="true">' + [100, 78, 60, 90, 55].map(w => `<i style="width:${w}%"></i>`).join('') + '</div>';
  const empty = msg => `<p class="empty">${esc(msg)}</p>`;
  const errBox = (msg, type) => `<p class="empty">Could not load: ${esc(msg)} <button type="button" class="btn btn-sm" data-retry="${esc(type)}">Retry</button></p>`;

  /* Card renderers */
  function renderPlain(d) {
    const rows = (d.rows || []).slice(0, 10);
    if (!rows.length) return empty('No data for this period.');
    const m = (d.metricHeaders || [])[0];
    const max = Math.max(1, ...rows.map(r => +r.metrics[0] || 0));
    const hasPrev = rows.some(r => 'prev' in r);
    return `<div class="scroll"><table class="tbl"><thead><tr><th>Name</th><th class="n">${esc(metricLabel(m))}</th><th class="n">Change</th></tr></thead><tbody>` +
      rows.map(r => {
        const v = +r.metrics[0] || 0;
        const c = hasPrev ? delta(v, r.prev ? +r.prev[0] || 0 : null) : { text: 'n/a', cls: 'faint' };
        const name = r.dims.join(' / ') || '(empty)';
        return `<tr><td class="lc"><span class="lbl" title="${esc(name)}">${esc(name)}</span><div class="bar3"><i style="width:${(v / max) * 100}%"></i></div></td>` +
          `<td class="n num">${isMoney(m) ? money(v) : fmt(v)}</td><td class="n num ${c.cls}">${c.text}</td></tr>`;
      }).join('') + '</tbody></table></div>';
  }

  const ENG_HEAD = '<thead><tr><th>Name</th><th class="n">Sessions</th><th class="n">Engaged</th><th class="n">Avg time</th><th class="n">Key ev.</th></tr></thead>';
  const engCells = m => `<td class="n num">${fmt(m[0])}</td><td class="n num">${fmtPct(m[1])}</td><td class="n num">${fmtDur(m[2])}</td><td class="n num">${fmt(m[3])}</td>`;

  function renderEngagement(d) {
    const rows = (d.rows || []).slice(0, 10);
    if (!rows.length) return empty('No data for this period.');
    return `<div class="scroll"><table class="tbl">${ENG_HEAD}<tbody>` + rows.map(r => {
      const name = r.dims.join(' / ');
      return `<tr><td class="lc"><span class="lbl" title="${esc(name)}">${esc(name)}</span></td>${engCells(r.metrics)}</tr>`;
    }).join('') + '</tbody></table></div>';
  }

  function renderReferrers(d) {
    const groups = (d.groups || []).slice(0, 8);
    if (!groups.length) return empty('No external referrers in this range.');
    return `<div class="scroll"><table class="tbl">${ENG_HEAD}<tbody>` + groups.map(g =>
      `<tr class="grp"><td class="lc" colspan="5"><span class="lbl">${shape(g.shape)}${esc(g.name)} <span class="faint num">${fmt(g.sessions)} sessions</span></span></td></tr>` +
      g.rows.slice(0, 3).map(r => {
        const shown = String(r.url).replace(/^https?:\/\//, '');
        const href = safeHref(r.url);
        const label = href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(shown)}</a>` : esc(shown);
        return `<tr><td class="lc"><span class="lbl" title="${esc(shown)}">${label}</span></td>${engCells([r.sessions, r.engagementRate * 100, r.avgEngagement, r.keyEvents ?? 0])}</tr>`;
      }).join('')).join('') + '</tbody></table></div>';
  }

  function renderBots(d) {
    const rows = d.flagged || [];
    if (!rows.length) return empty('No bot-like traffic in this range.');
    return '<div class="scroll"><table class="tbl"><thead><tr><th>Segment</th><th class="n">Sessions</th><th class="n">Share</th></tr></thead><tbody>' +
      rows.map(r => `<tr><td class="lc"><span class="lbl">${esc(r.country + ' · ' + r.city)}</span><span class="lbl cap faint">${esc(r.source + ' · ' + r.device + ' · ' + r.reason)}</span></td>` +
        `<td class="n num">${fmt(r.sessions)}</td><td class="n num">${fmtPct(r.share * 100)}</td></tr>`).join('') + '</tbody></table></div>';
  }

  const REVENUE = [['totalAdRevenue', 'Ad revenue', true], ['purchaseRevenue', 'Purchase revenue', true], ['eventValue', 'Event value', true],
    ['publisherAdImpressions', 'Ad impressions'], ['publisherAdClicks', 'Ad clicks'], ['keyEvents', 'Key events']];
  function renderRevenue(d) {
    const s = d.summary || {};
    const rows = REVENUE.filter(([k]) => +s[k]).map(([k, label, cur]) => `<tr><td class="lc">${label}</td><td class="n num">${cur ? money(s[k]) : fmt(s[k])}</td></tr>`).join('');
    const events = (d.events || []).map(e => `<tr><td class="lc"><span class="lbl">${esc(e.name)}</span></td><td class="n num">${fmt(e.keyEvents)}</td></tr>`).join('');
    if (!rows && !events) return empty('No revenue or key events for this period.');
    return '<div class="scroll"><table class="tbl"><tbody>' + rows + '</tbody></table>' +
      (events ? `<table class="tbl"><thead><tr><th>Key event</th><th class="n">Count</th></tr></thead><tbody>${events}</tbody></table>` : '') + '</div>';
  }

  function renderHourly(d) {
    const ok = r => /^\d{10}$/.test(r.dims[0]);
    const rows = (d.rows || []).filter(ok).sort((a, b) => a.dims[0].localeCompare(b.dims[0]));
    if (rows.length < 2) return empty('Not enough hourly data yet.');
    const prev = (d.prevRows || []).filter(ok).sort((a, b) => a.dims[0].localeCompare(b.dims[0])).map(r => +r.metrics[0] || 0);
    const lab = r => (range === 'today' ? r.dims[0].slice(8) + ':00' : dateLabel(r.dims[0]));
    return `<div class="trend-b chart">${lineChart(rows.map(r => +r.metrics[0] || 0), prev, { h: 200, labels: rows.map(lab), label: 'Active users per hour' })}</div>`;
  }

  function renderBody(d) {
    if (AUDIENCE_REPORTS.has(d.type)) return renderAudience(d);
    if (d.type === 'hourly-traffic') return renderHourly(d);
    if (d.kind === 'engagement') return renderEngagement(d);
    if (d.kind === 'referrers') return renderReferrers(d);
    if (d.kind === 'bots') return renderBots(d);
    if (d.kind === 'revenue') return renderRevenue(d);
    return renderPlain(d);
  }

  function metricLabel(m) {
    const L = { sessions: 'Sessions', newUsers: 'New users', screenPageViews: 'Views', activeUsers: 'Users', eventCount: 'Events', totalRevenue: 'Revenue' };
    return L[m] || String(m || 'Value').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, s => s.toUpperCase());
  }

  /* Related reports share a card. Hidden panels retain their data when tabs change. */
  function reportTitle(type) {
    if (type === 'country-map') return 'Country map';
    return (CARDS.find(c => c.type === type) || {}).title || (type === 'dow' ? 'Day of week' : 'Spikes');
  }

  function buildGrid() {
    $('anGrid').innerHTML = GROUPS.map(g => {
      const active = activeReports[g.id];
      return `<section class="card an-report" id="${g.id}" aria-label="${g.title}">
        <div class="card-h">
        <div class="an-tabs" role="tablist" aria-label="${g.title} reports">${g.reports.map(([type, label]) =>
          `<button type="button" role="tab" id="tab-${type}" data-report="${type}" aria-controls="card-${type}" aria-selected="${type === active}" tabindex="${type === active ? 0 : -1}">${label}</button>`).join('')}</div>
          <button type="button" class="btn btn-ghost btn-icon" data-csv="${active === 'country-map' ? 'countries' : active}" aria-label="Export ${esc(reportTitle(active))} as CSV"${active === 'dow' || active === 'spikes' ? ' hidden' : ''}>${CSV_ICON}</button></div>
        ${g.reports.map(([type]) => `<section class="an-report-panel" id="card-${type}" role="tabpanel" aria-labelledby="tab-${type}" tabindex="0"${type === active ? '' : ' hidden'}>
          <div class="an-panel-tools" hidden><span class="seg seg-inline" role="group" aria-label="Report dimension" hidden></span></div>
          <div class="card-b"${type === 'spikes' ? ' id="anSpikes"' : ''}>${skel()}</div></section>`).join('')}
      </section>`;
    }).join('');
  }

  function revealReportTab(tab) {
    const box = tab.parentElement;
    const r = tab.getBoundingClientRect(), parent = box.getBoundingClientRect();
    if (r.left < parent.left) box.scrollLeft += r.left - parent.left;
    else if (r.right > parent.right) box.scrollLeft += r.right - parent.right;
  }

  function activateReport(type, focus = false) {
    const group = GROUPS.find(g => g.reports.some(r => r[0] === type));
    if (!group) return;
    activeReports[group.id] = type;
    const card = $(group.id);
    card.querySelectorAll('[data-report]').forEach(tab => {
      const selected = tab.dataset.report === type;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      $(tab.getAttribute('aria-controls')).hidden = !selected;
      if (selected) { if (focus) tab.focus(); revealReportTab(tab); }
    });
    const csv = card.querySelector('[data-csv]');
    csv.dataset.csv = type === 'country-map' ? 'countries' : type;
    csv.setAttribute('aria-label', `Export ${reportTitle(type)} as CSV`);
    csv.hidden = type === 'dow' || type === 'spikes';
    ensureReport(type);
  }

  function chooseReport(type, focus = false) {
    jumpHold = false;
    history.replaceState(null, '', `${location.pathname}${location.search}#card-${type}`);
    window.AnalyticsSidebar.sync();
    activateReport(type, focus);
  }

  function stickyOffset() {
    return ($('appNav')?.offsetHeight || 52) + (matchMedia('(max-width: 760px)').matches ? page.querySelector('.an-sidebar').offsetHeight : 0) + 16;
  }

  /* #card-<type> (navbar jump palette): scroll the card under the sticky navbar and keep it
     there while cards above it load, until the user scrolls or presses a key. */
  let jumpHold = false;
  function jumpToHash(start) {
    const m = /^#([\w-]+)$/.exec(location.hash);
    if (!m) return;
    if (start) jumpHold = true;
    if (!jumpHold) return;
    const type = m[1].startsWith('card-') ? m[1].slice(5) : null;
    if (type && type !== 'new-users-by-date') activateReport(type);
    const el = type === 'new-users-by-date' ? $('overview') : type ? $('card-' + type)?.closest('.an-report') : $(m[1]);
    if (!el) return;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - stickyOffset() });
  }
  ['wheel', 'touchstart', 'keydown'].forEach(ev => addEventListener(ev, () => { jumpHold = false; }, { passive: true }));
  addEventListener('hashchange', () => jumpToHash(true));

  async function loadCard(type, seg, fresh) {
    const id = loadId;
    const el = $('card-' + type);
    const body = el && el.querySelector('.card-b');
    if (body && type !== 'new-users-by-date') body.innerHTML = skel();
    try {
      const res = await fetch(`/api/analytics-card/${encodeURIComponent(prop)}/${type}?range=${range}${seg ? '&seg=' + encodeURIComponent(seg) : ''}${fresh ? '&fresh=1' : ''}`);
      const d = await res.json();
      if (!res.ok || d.error || d.ok === false) throw new Error(d.error || 'HTTP ' + res.status);
      if (id !== loadId) return;
      store[type] = d;
      if (body) body.innerHTML = d.hidden ? empty('No revenue or key events for this period.') : renderBody(d);
      if (type === 'hourly-traffic' && body) {
        const rows = (d.rows || []).filter(r => /^\d{10}$/.test(r.dims[0])).sort((a, b) => a.dims[0].localeCompare(b.dims[0]));
        const box = body.querySelector('.trend-b');
        if (box) attachTip(box, rows, i => `<b>${dateLabel(rows[i].dims[0])} ${rows[i].dims[0].slice(8)}:00</b><br><span class="num">${fmt(rows[i].metrics[0])} users</span>`);
      }
      if (d.segments && el) {
        const s = el.querySelector('.seg');
        s.parentElement.hidden = false;
        s.hidden = false;
        s.innerHTML = d.segments.map(x => `<button type="button" data-seg="${esc(x)}" aria-pressed="${x === d.seg}">${esc(x[0].toUpperCase() + x.slice(1))}</button>`).join('');
      }
    } catch (e) {
      if (id !== loadId) return;
      if (type === 'new-users-by-date') { $('anTrend').innerHTML = errBox(e.message, type); renderSums(); }
      else if (body) body.innerHTML = errBox(e.message, type);
      if (type === 'countries' && activeReports.audience === 'country-map') $('card-country-map').querySelector('.card-b').innerHTML = errBox(e.message, type);
      return;
    }
    if (type === 'new-users-by-date') { renderTrend(); renderSums(); }
    if (type === 'page-paths') renderSums();
    if (type === 'countries' && activeReports.audience === 'country-map') renderCountryMap();
    if (TABLE_CHANGES[type] || type === 'bot-traffic') renderChanges();
    renderFresh();
    jumpToHash();
  }

  /* Strip sums */
  function renderSums() {
    const t = store['new-users-by-date'];
    const p = store['page-paths'];
    const item = (label, cur, prev, f, index) => {
      const c = delta(+cur, prev == null ? null : +prev);
      const tag = index == null ? 'div' : 'button';
      const attr = index == null ? '' : ` type="button" data-trend-i="${index}" aria-pressed="${trendI === index}" aria-label="Show ${label.toLowerCase()} trend"`;
      return `<${tag} class="an-metric"${attr}><span class="an-metric-label">${label}</span><b class="an-metric-value num${cur == null ? ' faint' : ''}">${cur == null ? '—' : f(cur)}</b>
        <span class="an-metric-change num ${cur == null ? 'faint' : c.cls}" title="Compared with ${PREV_LABEL[range].toLowerCase()}">${cur == null ? 'Awaiting data' : c.text + ' vs previous'}</span></${tag}>`;
    };
    const tt = t && t.totals, tp = t && t.prevTotals;
    $('anSums').innerHTML =
      item('Sessions', tt && tt[1], tp && tp[1], fmt, 1) +
      item('New users', tt && tt[0], tp && tp[0], fmt, 0) +
      item('Views', p && p.totals && p.totals[0], p && p.prevTotals && p.prevTotals[0], fmt) +
      item('Revenue', tt && tt[2], tp && tp[2], money, 2);
  }

  /* Trend */
  function renderTrend() {
    const d = store['new-users-by-date'];
    const box = $('anTrend');
    if (!d) return;
    const rows = (d.rows || []).slice().sort((a, b) => a.dims[0].localeCompare(b.dims[0]));
    if (rows.length < 2) { box.innerHTML = empty('Pick 7d or 28d to see a trend.'); return; }
    const prevRows = (d.prevRows || []).slice().sort((a, b) => a.dims[0].localeCompare(b.dims[0]));
    const f = trendI === 2 ? money : fmt;
    const vals = rows.map(r => +r.metrics[trendI] || 0);
    const prev = prevRows.map(r => +r.metrics[trendI] || 0);
    const w = Math.max(280, box.clientWidth - 32);
    box.innerHTML = lineChart(vals, prev, { w, h: matchMedia('(max-width: 520px)').matches ? 208 : 240, labels: rows.map(r => dateLabel(r.dims[0])), fmtY: f, label: 'Daily trend vs previous period' });
    attachTip(box, rows, i => `<b>${dateLabel(rows[i].dims[0])}</b><br><span class="num">${f(vals[i])}</span>` +
      (prev[i] != null ? `<br><span class="faint num">Prev ${prevRows[i] ? dateLabel(prevRows[i].dims[0]) : ''}: ${f(prev[i])}</span>` : ''));
  }

  /* What changed */
  function renderChanges() {
    const items = [];
    const spike = spikes.find(s => String(s.propertyId) === prop);
    if (spike) items.push({ name: 'Live spike' + (spike.topPage ? ': ' + spike.topPage : ''), text: (+spike.ratio || 0).toFixed(1) + 'x', cls: 'd-up', why: spike.reasonSummary || 'Active users well above usual', w: Infinity });
    const bots = store['bot-traffic'];
    const botSessions = bots && (bots.flagged || []).reduce((s, r) => s + (+r.sessions || 0), 0);
    if (botSessions > 0) items.push({ name: 'Suspected bot traffic', text: fmt(botSessions), cls: 'd-dn', why: `${bots.flagged.length} segment${bots.flagged.length > 1 ? 's' : ''}, see bot card`, w: Infinity });
    const rest = [];
    for (const [type, kind] of Object.entries(TABLE_CHANGES)) {
      const d = store[type];
      if (!d || !(d.rows || []).some(r => 'prev' in r)) continue;
      d.rows.slice(0, 10).forEach(r => {
        const cur = +r.metrics[0] || 0;
        const prev = r.prev ? +r.prev[0] || 0 : 0;
        const diff = cur - prev;
        const pct = prev ? Math.round((diff / prev) * 100) : null;
        if (!diff || (pct != null && Math.abs(pct) < 10)) return;
        rest.push({ name: type === 'countries' ? r.dims[0] : r.dims.join(' / '), text: (diff > 0 ? '+' : '') + fmt(diff), cls: diff > 0 ? 'd-up' : 'd-dn',
          why: kind + ', ' + (pct == null ? 'new in top 10' : Math.abs(pct) + '% ' + (pct > 0 ? 'up' : 'down')), w: Math.abs(diff) });
      });
    }
    rest.sort((a, b) => b.w - a.w);
    const list = items.concat(rest).slice(0, 6);
    $('anChg').innerHTML = list.length
      ? list.map(i => `<li><span class="lbl" title="${esc(i.name)}">${esc(i.name)}</span><span class="num ${i.cls}">${esc(i.text)}</span><span class="why">${esc(i.why)}</span></li>`).join('')
      : `<li class="empty">${Object.keys(TABLE_CHANGES).some(t => store[t]) ? 'No big changes in this period.' : 'Loading.'}</li>`;
  }

  /* Spikes section and day-of-week card */
  async function loadReports(fresh) {
    const id = loadId;
    $('anSpikes').innerHTML = skel();
    try {
      const [r, s] = await Promise.all([
        fetch(`/api/analytics-reports/${encodeURIComponent(prop)}?range=${range}${fresh ? '&fresh=1' : ''}`).then(x => x.json()),
        fetch(fresh ? '/api/spikes?fresh=1' : '/api/spikes').then(x => x.json()).catch(() => ({ spikes: [] })),
      ]);
      if (id !== loadId) return;
      if (r.error) throw new Error(r.error);
      reports = r;
      spikes = s.spikes || [];
    } catch (e) {
      if (id !== loadId) return;
      $('anSpikes').innerHTML = errBox(e.message, 'reports');
      document.querySelector('#card-dow .card-b').innerHTML = errBox(e.message, 'reports');
      return;
    }
    renderSpikes();
    renderDow();
    renderChanges();
  }

  function renderDow() {
    const days = (reports && reports.dayOfWeek) || [];
    const body = document.querySelector('#card-dow .card-b');
    if (!days.length) { body.innerHTML = empty('No data for this period.'); return; }
    const max = Math.max(1, ...days.map(d => +d.avgSessions || 0));
    body.innerHTML = '<div class="scroll"><table class="tbl"><thead><tr><th>Day</th><th class="n">Avg sessions</th><th class="n">Sessions</th></tr></thead><tbody>' +
      days.map(d => `<tr><td class="lc">${esc(d.day)}<div class="bar3"><i style="width:${((+d.avgSessions || 0) / max) * 100}%"></i></div></td>` +
        `<td class="n num">${fmt(d.avgSessions)}</td><td class="n num">${fmt(d.sessions)}</td></tr>`).join('') + '</tbody></table></div>';
  }

  function renderSpikes() {
    const rows = [];
    spikes.filter(s => String(s.propertyId) === prop).forEach(s => rows.push({
      icon: 'spike', title: `Live spike: ${fmt(s.activeUsers)} active, ${(+s.ratio || 0).toFixed(1)}x usual`,
      sub: [s.reasonSummary, s.topPage && 'Top page ' + s.topPage].filter(Boolean).join(' · '), n: fmt(s.activeUsers) + ' users' }));
    (reports.spikeAnnotations || []).forEach(a => rows.push({
      icon: a.shape, title: a.annotation, n: fmt(a.sessions) + ' sessions', url: a.searchUrl, urlLabel: a.searchLabel,
      sub: [(a.landingPages || []).slice(0, 3).map(l => l.landingPage).join(', '), (a.referrers || []).slice(0, 2).map(r => r.referrer).join(', ')].filter(Boolean).join(' · ') }));
    (reports.unusualSources || []).forEach(u => rows.push({
      icon: u.shape, title: u.annotation, n: u.share + '% of traffic', url: u.searchUrl, urlLabel: u.searchLabel,
      sub: (u.landingPages || []).slice(0, 2).map(l => l.landingPage).join(', ') }));
    if (!rows.length) { $('anSpikes').innerHTML = empty('No traffic spikes or unusual sources in this period.'); return; }
    $('anSpikes').innerHTML = '<div class="scroll"><table class="tbl"><tbody>' + rows.map(r => {
      const href = r.url && safeHref(r.url);
      return `<tr><td class="lc"><span class="lbl">${shape(r.icon)}${esc(r.title)}</span>${r.sub ? `<span class="lbl cap faint" title="${esc(r.sub)}">${esc(r.sub)}</span>` : ''}</td>` +
        `<td class="n num">${esc(r.n)}</td><td class="n">${href ? `<a class="btn btn-ghost btn-sm" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(r.urlLabel || 'Find on source')}</a>` : ''}</td></tr>`;
    }).join('') + '</tbody></table></div>';
  }

  /* Freshness */
  function renderFresh() {
    const times = Object.values(store).map(d => d.fetchedAt).filter(Boolean);
    const b = $('anFresh');
    if (!times.length) {
      // Cache entries written before fetchedAt existed: the 1 h server cache TTL bounds their age.
      const any = Object.keys(store).length;
      b.className = 'badge' + (any ? ' good' : '');
      b.textContent = any ? 'Updated within 1 h' : 'Loading';
      return;
    }
    const min = Math.round((Date.now() - Math.min(...times)) / 60000);
    b.className = 'badge num ' + (min < 30 ? 'good' : 'warn');
    b.textContent = min < 1 ? 'Updated just now' : `Updated ${min} min ago`;
    b.title = Object.values(store).some(d => d.cached) ? 'Some cards come from the 1 hour server cache' : 'Fresh from GA4';
  }

  /* Live strip */
  let liveTimer = null;
  async function loadLive() {
    try {
      const j = await (await fetch('/api/realtime-all')).json();
      const row = (j.data || []).find(r => String(r.propertyId) === prop);
      if (!row) return;
      $('anLive').textContent = fmt(row.activeUsers);
      $('anLiveViews').textContent = `${fmt(row.pageViews)} views in 30 min`;
      $('anLiveChart').innerHTML = lineChart(row.series || Array(30).fill(0), null, { w: 600, h: 64, axis: false, label: 'Active users per minute, last 30 minutes' });
    } catch { /* ponytail: live strip keeps last values on a failed poll */ }
  }

  /* CSV */
  function csvRows(type) {
    const d = store[type];
    if (!d || !d.rows) return [];
    return d.rows.map(r => [r.dims.join(' / '), ...r.metrics.map((v, i) => [metricLabel((d.metricHeaders || [])[i]), v ?? 0])]);
  }
  const q = s => '"' + String(s).replace(/"/g, '""') + '"';
  function download(lines, name) {
    if (lines.length <= 1) return;
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name.replace(/[^a-z0-9_-]/gi, '_') + '_' + range + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
  function exportCard(type) {
    const d = store[type];
    const card = CARDS.find(c => c.type === type);
    const head = ['Dimension', ...((d && d.metricHeaders) || []).map(metricLabel)].map(q).join(',');
    download([head, ...csvRows(type).map(([dim, ...m]) => [q(dim), ...m.map(x => x[1])].join(','))], card ? card.title : type);
  }
  // Export all: fetch the cards not scrolled into view yet first (served from the 1 h cache when warm).
  async function exportAll() {
    await Promise.all(GRID.filter(c => !store[c.type]).map(c => loadCard(c.type)));
    const lines = ['Card,Dimension,Metric,Value'];
    CARDS.forEach(c => csvRows(c.type).forEach(([dim, ...m]) => m.forEach(([k, v]) => lines.push([q(c.title), q(dim), q(k), v].join(',')))));
    download(lines, 'analytics-export');
  }

  /* Keep the summary and change inputs eager. Other reports load only when their active
     panel approaches the viewport, or when a tab or direct report link selects them. */
  const EAGER = new Set(['new-users-by-date', 'page-paths', 'bot-traffic', ...Object.keys(TABLE_CHANGES)]);
  let lazyObs = null;
  function lazyLoad(fresh) {
    if (lazyObs) lazyObs.disconnect();
    const done = new Set();
    const load = (key) => {
      if (key === 'dow' || key === 'spikes') key = 'reports';
      if (done.has(key)) return;
      done.add(key);
      return key === 'reports' ? loadReports(fresh) : loadCard(key, undefined, fresh);
    };
    ensureReport = type => {
      if (type === 'country-map') { load('countries'); if (store.countries) renderCountryMap(); }
      else load(type);
    };
    [...EAGER].forEach(load);
    if (!('IntersectionObserver' in window)) { Object.values(activeReports).forEach(ensureReport); return; }
    lazyObs = new IntersectionObserver((hits, obs) => hits.forEach(h => {
      if (!h.isIntersecting) return;
      obs.unobserve(h.target);
      if (h.target.id === 'changes') load('reports');
      else ensureReport(activeReports[h.target.id]);
    }), { rootMargin: '300px 0px' });
    GROUPS.forEach(group => lazyObs.observe($(group.id)));
    lazyObs.observe($('changes'));
  }

  function renderProperty() {
    const site = PROPERTIES.find(p => String(p.id) === prop) || {};
    const today = new Date(new Date().toLocaleDateString('en-US', { timeZone: site.timeZone || undefined }));
    const start = new Date(today);
    start.setDate(start.getDate() - (range === 'today' ? 0 : range === '7d' ? 7 : 28));
    const fmtDate = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    $('anDateRange').textContent = range === 'today' ? fmtDate(today) : fmtDate(start) + ' – ' + fmtDate(today);
  }

  /* Load everything for the current property and range */
  // fresh: Refresh button and R key ask the server to skip its 1 h cache.
  function loadAll(fresh) {
    fresh = fresh === true;
    loadId++;
    store = {}; reports = null;
    const label = PREV_LABEL[range];
    document.querySelectorAll('.an-prev').forEach(el => { el.textContent = el.classList.contains('an-lc') ? label.toLowerCase() : label; });
    $('anRange').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.range === range)));
    $('analyticsProperty').value = prop;
    renderProperty();
    $('anGa4').href = `https://analytics.google.com/analytics/web/#/p${encodeURIComponent(prop)}/reports/reportinghub`;
    history.replaceState(null, '', `${location.pathname}?prop=${encodeURIComponent(prop)}&range=${range}${location.hash}`);
    window.AnalyticsSidebar.sync();
    $('anTrend').innerHTML = skel();
    renderSums();
    $('anChg').innerHTML = '<li>' + skel() + '</li>';
    buildGrid();
    renderFresh();
    lazyLoad(fresh);
    jumpToHash(true);
    $('anLive').textContent = '—';
    $('anLiveViews').textContent = 'Last 30 minutes';
    $('anLiveChart').innerHTML = '';
    loadLive();
    clearInterval(liveTimer);
    liveTimer = setInterval(loadLive, 60000);
  }

  /* Events */
  $('analyticsProperty').addEventListener('change', e => { prop = e.target.value; loadAll(); });
  $('anRange').addEventListener('click', e => { const b = e.target.closest('[data-range]'); if (b && b.dataset.range !== range) { range = b.dataset.range; loadAll(); } });
  $('anSums').addEventListener('click', e => {
    const metric = e.target.closest('[data-trend-i]');
    if (!metric) return;
    trendI = +metric.dataset.trendI;
    renderSums();
    renderTrend();
  });
  $('anExport').addEventListener('click', exportAll);
  $('anRefresh').addEventListener('click', () => loadAll(true));
  page.addEventListener('error', e => { if (e.target.matches?.('.an-flag img')) e.target.hidden = true; }, true);
  page.addEventListener('click', e => {
    const tab = e.target.closest('[data-report]');
    if (tab) { chooseReport(tab.dataset.report); return; }
    const t = e.target.closest('[data-csv],[data-retry],[data-seg]');
    if (!t) return;
    if (t.dataset.csv) exportCard(t.dataset.csv);
    else if (t.dataset.retry === 'reports') loadReports();
    else if (t.dataset.retry) loadCard(t.dataset.retry);
    else loadCard(t.closest('section').id.slice(5), t.dataset.seg);
  });
  $('anGrid').addEventListener('keydown', e => {
    const tab = e.target.closest('[role="tab"]');
    if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const tabs = [...tab.parentElement.querySelectorAll('[role="tab"]')];
    const index = tabs.indexOf(tab);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    chooseReport(tabs[next].dataset.report, true);
  });
  let resizeFrame = null;
  addEventListener('resize', () => {
    if (resizeFrame != null) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => { resizeFrame = null; renderTrend(); page.querySelectorAll('.an-tabs [aria-selected="true"]').forEach(revealReportTab); });
  });
  document.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || e.target.isContentEditable) return;
    const k = e.key.toLowerCase();
    if (k === 'e') exportAll();
    else if (k === 'r') loadAll(true);
    else if (RANGES[+k - 1] && RANGES[+k - 1] !== range) { range = RANGES[+k - 1]; loadAll(); }
  });
  setInterval(renderFresh, 60000);

  loadAll();
})();
