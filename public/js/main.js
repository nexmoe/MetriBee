/* ──────────────────────────────────────────────────────────────
   GA4 Dashboard: main.js
   Loaded on every page. Home (live) rendering only runs when #liveHome exists.
   Handles: live cards, spike banner, quota bars, auto-refresh, cache refresh,
            privacy blur, keyboard shortcuts, toast notifications.
─────────────────────────────────────────────────────────────── */

// One IIFE: page inline scripts (globe.hbs) declare some of the same top-level names.
(() => {
const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const QUOTA_POLL_MS       = 60 * 1000;      // 1 minute

// ── Helpers ──────────────────────────────────────────────────

function qNum(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'object' && 'value' in v) return parseInt(v.value, 10) || 0;
  return parseInt(v, 10) || 0;
}

function formatRelativeTime(isoString) {
  if (!isoString) return 'unknown';
  const diffMin = Math.floor((Date.now() - new Date(isoString).getTime()) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.floor(diffH / 24)}d ago`;
}

function escHtmlMain(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Quota bars ────────────────────────────────────────────────

const QUOTA_DEFS = [
  { key: 'tokensPerProjectPerHour', label: 'Project, hour', note: 'shared pool' },
  { key: 'tokensPerHour',           label: 'Property, hour', note: '' },
  { key: 'tokensPerDay',            label: 'Property, day',  note: '' },
];

function renderQuotaBars(quota) {
  const metersEl = document.getElementById('quotaMeters');
  if (!metersEl || !quota) return;
  const noneEl = document.getElementById('quotaNone');
  if (noneEl) noneEl.hidden = true;
  metersEl.querySelectorAll('.quota-meter').forEach(el => el.remove());

  QUOTA_DEFS.forEach(def => {
    const raw = quota[def.key];
    if (!raw) return;
    const consumed = qNum(raw.consumed);
    const total = consumed + qNum(raw.remaining);
    if (total === 0) return;
    const pct = Math.round((consumed / total) * 100);
    const el = document.createElement('div');
    el.className = 'quota-meter';
    el.innerHTML = `
      <div class="qm-head">
        <span>${def.label}${def.note ? ` <span class="faint">(${def.note})</span>` : ''}</span>
        <span class="num">${consumed.toLocaleString()} / ${total.toLocaleString()} (${pct}%)</span>
      </div>
      <div class="qm-bar-bg"><div class="qm-bar-fill ${pct > 80 ? 'danger' : pct > 50 ? 'amber' : ''}" style="--pct:${pct / 100}"></div></div>`;
    metersEl.appendChild(el);
  });

  const tsEl = document.getElementById('quotaUpdatedAt');
  if (tsEl && quota.updatedAt) tsEl.textContent = `Updated ${formatRelativeTime(quota.updatedAt)}`;
}

if (document.getElementById('quotaMeters')) {
  setInterval(async () => {
    try {
      const json = await (await fetch('/api/quota')).json();
      if (json.ok && json.quota) renderQuotaBars(json.quota);
    } catch { /* silent */ }
  }, QUOTA_POLL_MS);
}

// ── Live home: variant C cards ────────────────────────────────

(function liveHome() {
  const root = document.getElementById('liveHome');
  if (!root || typeof PAGE_DATA === 'undefined') return;

  // Spike rule: viewer-tunable, saved per browser. Defaults match controllers/spikeDetector.js SPIKE_DEFAULTS.
  const RULE_KEY = 'ga4dash.spikeRule';
  const PRESETS = { sensitive: { z: 2.5, lift: 1.3 }, normal: { z: 3, lift: 1.5 }, strict: { z: 4, lift: 2 } };
  const clampRule = r => {
    const c = (v, lo, hi, d) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.round(Math.min(hi, Math.max(lo, n)) * 100) / 100 : d; };
    return { z: c(r && r.z, 1.5, 6, PRESETS.normal.z), lift: c(r && r.lift, 1, 5, PRESETS.normal.lift) };
  };
  let rule = (() => {
    try { return clampRule(JSON.parse(localStorage.getItem(RULE_KEY) || 'null') || PRESETS.normal); } catch { return { ...PRESETS.normal }; }
  })();

  // Same math as scoreSpike() in controllers/spikeDetector.js; keep the two in step.
  function spikeScore(active, baseline, sd, r) {
    if (!baseline) return { z: 0, ratio: 0, isSpike: false, above: false };
    const z = (active - baseline) / Math.sqrt(Math.max(baseline + 1, sd ? sd * sd : 0));
    const ratio = active / baseline;
    const isSpike = z >= r.z && ratio >= r.lift;
    return { z, ratio, isSpike, above: !isSpike && z >= 2 && ratio >= 1.15 };
  }
  const nf = n => Number(n || 0).toLocaleString();
  const ICON = {
    ga: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/></svg>',
    report: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 17v-4M12 17V7M16 17v-7"/></svg>',
    ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
  };

  // Server rows carry analyticsUrl/websiteUrl; /api/realtime-all rows carry fresh numbers.
  let rows = PAGE_DATA.map(p => ({ ...p }));
  let hydrated = PAGE_DATA.some(p => Array.isArray(p.series));
  let updatedAt = hydrated ? new Date() : null;
  const reasons = {}; // propertyId -> spike reasonSummary from /api/spikes

  const RANGE_KEY = 'ga4dash.homeRange';
  const CARD_RANGES = {
    '30m': { label: 'Last 30 minutes', chart: 'Active users per minute, last 30 minutes' },
    today: { label: 'Today', chart: 'Active users per hour, today', interval: 'Hourly' },
    '7d': { label: 'Last 7 days', chart: 'Active users per day, last 7 days', interval: 'Daily' },
    '28d': { label: 'Last 28 days', chart: 'Active users per day, last 28 days', interval: 'Daily' },
  };
  const validRange = value => Object.prototype.hasOwnProperty.call(CARD_RANGES, value);
  let cardRange = '30m';
  try {
    const saved = localStorage.getItem(RANGE_KEY);
    if (validRange(saved)) cardRange = saved;
  } catch { /* storage may be unavailable */ }
  const rangeSelect = document.getElementById('homeCardRange');
  if (rangeSelect) rangeSelect.value = cardRange;
  let cardRows = null;
  let cardLoading = cardRange !== '30m';
  let cardError = false;
  let cardsUpdatedAt = null;
  let cardRequest = 0;

  function model() {
    const props = rows.map(p => {
      const active = p.activeUsers || 0;
      const s = spikeScore(active, p.baseline, p.baselineSd, rule);
      return { ...p, active, views: p.pageViews || 0, series: p.series || Array(30).fill(0), x: s.ratio, z: s.z, spike: s.isSpike, above: s.above };
    });
    // Rank by z: how unusual right now, so a handful of users never tops the list on ratio alone.
    const ok = props.filter(p => !p.error);
    const live = ok.filter(p => p.active > 0).sort((a, b) => b.z - a.z || b.active - a.active);
    return {
      live,
      spikes: live.filter(p => p.spike),
      quiet: ok.filter(p => !p.active),
      errors: props.filter(p => p.error),
      total: ok.reduce((s, p) => s + p.active, 0),
      views: ok.reduce((s, p) => s + p.views, 0),
      combined: Array.from({ length: 30 }, (_, i) => ok.reduce((s, p) => s + (p.series[i] || 0), 0)),
    };
  }

  let uid = 0;
  function areaChart(values, { w = 720, h = 160, axis = true, label = CARD_RANGES['30m'].chart } = {}) {
    const id = 'dz' + (++uid);
    const max = Math.max(1, ...values);
    const top = axis ? 10 : 2, bottom = axis ? 18 : 2, left = axis ? 28 : 0;
    const iw = w - left, ih = h - top - bottom;
    const x = i => left + (i / (values.length - 1)) * iw;
    const y = v => top + ih - (v / max) * ih;
    const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = `${left},${top + ih} ${pts} ${w},${top + ih}`;
    let g = '';
    if (axis) {
      const mid = max <= 4 ? max : Math.ceil(max / 2);
      for (const v of new Set([0, mid, max])) g += `<line class="grid" x1="${left}" x2="${w}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${left - 6}" y="${y(v) + 3}" text-anchor="end">${v}</text>`;
      for (const m of [29, 20, 10, 0]) g += `<text class="axis" x="${x(29 - m)}" y="${h - 4}" text-anchor="${m === 29 ? 'start' : m === 0 ? 'end' : 'middle'}">${m === 0 ? 'now' : '-' + m + 'm'}</text>`;
    }
    const last = values[values.length - 1];
    return `<svg viewBox="0 0 ${w} ${h}" ${axis ? '' : 'preserveAspectRatio="none"'} role="img" aria-label="${escHtmlMain(label)}, peak ${max}">
      <defs><pattern id="${id}p" width="4" height="3" patternUnits="userSpaceOnUse"><rect width="4" height="1" class="dz" opacity=".55"/></pattern>
      <clipPath id="${id}c"><polygon points="${area}"/></clipPath></defs>
      ${g}<rect x="${left}" y="${top}" width="${iw}" height="${ih}" fill="url(#${id}p)" clip-path="url(#${id}c)"/>
      <polyline class="ln" points="${pts}" vector-effect="non-scaling-stroke"/>
      ${axis ? `<circle class="end" cx="${x(values.length - 1)}" cy="${y(last)}" r="3"/>` : ''}</svg>`;
  }

  const usualText = p => (p.baselineKind === 'same-hour' ? 'usual for this hour' : 'usual peak');
  // Floor, so 1.49 never reads as the 1.5 lift line.
  const fx = p => (Math.floor(p.x * 10) / 10).toFixed(1);
  const xLabel = p => (p.baseline ? `${fx(p)}x usual` : 'No baseline yet');

  function meter(p) {
    if (!p.baseline) return '<span></span>';
    // Full width is lift / 0.75, so the lift tick always sits at 75%.
    const full = rule.lift / 0.75;
    const pct = Math.min(p.x / full, 1) * 100;
    const spread = p.baselineSd != null ? `, day-to-day spread ${p.baselineSd.toFixed(1)}` : '';
    const tip = `${p.x.toFixed(2)}x ${usualText(p)}, z ${p.z.toFixed(1)} (${nf(p.active)} now, usual ${nf(p.baseline)}${spread}). Spike at z ${rule.z} and ${rule.lift}x.`;
    return `<div class="meter" title="${escHtmlMain(tip)}"><i class="${p.spike ? 'hot' : ''}" style="width:${pct}%"></i><b style="left:75%"></b></div>`;
  }

  function card(p) {
    const historical = cardRange !== '30m';
    const range = CARD_RANGES[cardRange];
    const domain = p.domain || `Property ${p.propertyId}`;
    const badge = p.spike
      ? '<span class="badge warn">Spike</span>'
      : p.above ? '<span class="badge accent">Above usual</span>' : '';
    const ga = `https://analytics.google.com/analytics/web/#/p${encodeURIComponent(p.propertyId)}/reports/intelligenthome`;
    const report = p.analyticsUrl || `/analytics?prop=${encodeURIComponent(p.propertyId)}`;
    return `<article class="card pc ${p.spike ? 'hot' : ''}" data-pid="${escHtmlMain(p.propertyId)}">
      <div class="top"><div class="site"><b data-privacy>${escHtmlMain(p.siteName)}</b><span data-privacy>${escHtmlMain(domain)}</span></div>${badge}</div>
      <div class="nums"><div><span class="n num">${nf(p.active)}</span><span class="faint cap">${historical ? 'active users' : 'active'}</span></div><div><span class="n v num">${nf(p.views)}</span><span class="faint cap">views</span></div></div>
      <div class="chart">${areaChart(p.series, { axis: false, w: 260, h: 44, label: range.chart })}</div>
      <div class="foot">${historical
        ? `<span class="faint cap">${range.label}</span><span class="faint cap">${range.interval}</span>`
        : `${meter(p)}<span class="num cap ${p.spike ? 'x-hot' : 'muted'}">${xLabel(p)}</span>`}</div>
      <div class="pc-actions">
        <a class="btn btn-ghost btn-sm" href="${ga}" target="_blank" rel="noopener">${ICON.ga}Open GA4</a>
        <a class="btn btn-ghost btn-sm" href="${escHtmlMain(report)}">${ICON.report}Report</a>
        ${p.websiteUrl ? `<a class="btn btn-ghost btn-sm" href="${escHtmlMain(p.websiteUrl)}" target="_blank" rel="noopener">${ICON.ext}Visit site</a>` : ''}
      </div>
    </article>`;
  }

  function spikeBanner(p) {
    const why = reasons[p.propertyId] || `Usual ${p.baselineKind === 'same-hour' ? 'for this hour' : 'busiest half hour'}: ${nf(p.baseline)} users.`;
    return `<div class="spike" role="status">
      <span class="t"><span data-privacy>${escHtmlMain(p.siteName)}</span> · ${nf(p.active)} active, ${fx(p)}x ${usualText(p)}</span>
      <span class="badge warn">Spike</span>
      <span class="why" data-privacy>${escHtmlMain(why)}</span></div>`;
  }

  const SPIKES_KEY = 'ga4dash.spikesCollapsed';
  let spikesCollapsed = false;
  try { spikesCollapsed = localStorage.getItem(SPIKES_KEY) === '1'; } catch { /* private mode */ }
  const spikeToggle = open => `<button class="btn btn-ghost btn-icon btn-sm spike-tg" type="button" data-spike-toggle aria-expanded="${open}" aria-label="${open ? 'Collapse' : 'Expand'} spike alerts" title="${open ? 'Collapse' : 'Expand'}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${open ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'}"/></svg></button>`;
  document.getElementById('spikeBanner')?.addEventListener('click', e => {
    if (!e.target.closest('[data-spike-toggle]')) return;
    spikesCollapsed = !spikesCollapsed;
    try { localStorage.setItem(SPIKES_KEY, spikesCollapsed ? '1' : '0'); } catch { /* keep for this page */ }
    render();
    document.querySelector('#spikeBanner [data-spike-toggle]')?.focus();
  });

  function render() {
    const m = model();
    document.getElementById('jsTotal').textContent = nf(m.total);
    document.getElementById('jsTotalViews').textContent = nf(m.views);
    document.getElementById('jsLiveCount').textContent = nf(m.live.length);
    document.getElementById('jsCombined').innerHTML = areaChart(m.combined, { w: 560, h: 90 });

    const banner = document.getElementById('spikeBanner');
    banner.hidden = !m.spikes.length;
    const names = list => `<span data-privacy>${list.map(p => escHtmlMain(p.siteName)).join(', ')}</span>`;
    if (spikesCollapsed) {
      // Collapsed: one line naming every spiking site; the cards still show each spike.
      banner.innerHTML = `<div class="spike spike-min" role="status"><span class="t">${m.spikes.length} ${m.spikes.length === 1 ? 'site' : 'sites'} spiking: ${names(m.spikes)}</span>${spikeToggle(false)}</div>`;
    } else {
      // Top 2 get a full banner; the rest are named in one line (their cards still show the spike).
      const more = m.spikes.slice(2);
      banner.innerHTML = m.spikes.slice(0, 2).map(spikeBanner).join('') + (more.length
        ? `<p class="spike-more">${more.length} more spiking: ${names(more)}</p>`
        : '');
      banner.querySelector('.spike .badge')?.insertAdjacentHTML('afterend', spikeToggle(true));
    }

    renderCards(m);

    document.getElementById('lhUpdated').textContent = updatedAt
      ? `Updated ${updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      : 'Loading live data';
  }

  function renderCards(live) {
    const historical = cardRange !== '30m';
    const range = CARD_RANGES[cardRange];
    const grid = document.getElementById('propGrid');
    const status = document.getElementById('cardsUpdated');
    const loading = cardLoading || (!historical && !hydrated);
    grid.dataset.range = cardRange;
    grid.setAttribute('aria-busy', String(loading));
    if (loading || cardError) {
      status.textContent = `${range.label} · ${loading ? 'Loading' : 'Unavailable'}`;
      grid.innerHTML = loading
        ? '<div class="card empty">Loading property data.</div>'
        : '<div class="card empty">Could not load this range. <button type="button" class="btn btn-sm" data-retry-cards>Retry</button></div>';
      return;
    }

    let m = live;
    if (historical) {
      const metadata = new Map(rows.map(p => [String(p.propertyId), p]));
      const props = (cardRows || []).map(p => ({
        ...metadata.get(String(p.propertyId)), ...p,
        error: p.error || null,
        active: p.activeUsers || 0, views: p.pageViews || 0,
        spike: false, above: false,
      }));
      const ok = props.filter(p => !p.error);
      m = {
        live: ok.filter(p => p.active || p.views).sort((a, b) => b.active - a.active || b.views - a.views),
        quiet: ok.filter(p => !p.active && !p.views),
        errors: props.filter(p => p.error),
      };
    }
    const fetchedAt = historical ? cardsUpdatedAt : updatedAt;
    status.textContent = historical
      ? `${range.label} · ${range.interval} · GA4 property time zones`
      : range.label;
    if (fetchedAt) status.textContent += ` · Updated ${formatRelativeTime(fetchedAt)}`;
    const liveIds = new Set(m.live.map(p => String(p.propertyId)));
    const accounts = window.homeAccounts.groupPropertiesByAccount([...m.live, ...m.quiet, ...m.errors]);
    grid.innerHTML = accounts.length ? accounts.map((account, index) => {
      const active = account.properties.filter(p => liveIds.has(String(p.propertyId)));
      const errors = account.properties.filter(p => p.error);
      const quiet = account.properties.filter(p => !p.error && !liveIds.has(String(p.propertyId)));
      const notes = [];
      if (quiet.length) notes.push(`${quiet.length} ${historical ? 'with no activity in this range' : 'with no one in the last 30 min'}`);
      if (errors.length) notes.push(`${errors.length} with errors`);
      const chips = errors.map(p => `<span class="chip bad" data-pid="${escHtmlMain(p.propertyId)}" title="${escHtmlMain(p.error)}"><span data-privacy>${escHtmlMain(p.siteName)}</span> · error</span>`).join('')
        + quiet.map(p => `<a class="chip" data-pid="${escHtmlMain(p.propertyId)}" href="${escHtmlMain(p.analyticsUrl || `/analytics?prop=${encodeURIComponent(p.propertyId)}`)}" title="Open report"><span data-privacy>${escHtmlMain(p.siteName)}</span></a>`).join('');
      return `<section class="pc-account" data-account-id="${escHtmlMain(account.accountId || 'unknown')}" aria-labelledby="homeAccount${index}">
        <div class="pc-account-head"><h3 id="homeAccount${index}" data-privacy>${escHtmlMain(account.accountName)}</h3><span class="faint cap num">${account.properties.length} ${account.properties.length === 1 ? 'property' : 'properties'}</span></div>
        ${active.length ? `<div class="c-cards">${active.map(card).join('')}</div>` : ''}
        ${chips ? `<div class="pc-account-quiet"><span class="faint cap">${notes.join(' · ')}</span><div class="chips">${chips}</div></div>` : ''}
      </section>`;
    }).join('') : '<div class="card empty">No properties available.</div>';
  }

  async function loadCardRange() {
    const request = ++cardRequest;
    const range = cardRange;
    cardRows = null;
    cardsUpdatedAt = null;
    cardError = false;
    cardLoading = range !== '30m';
    renderCards(model());
    if (!cardLoading) return;
    try {
      const response = await fetch(`/api/home-cards?range=${encodeURIComponent(range)}`);
      const json = await response.json();
      if (request !== cardRequest) return;
      if (!response.ok || !json.ok || json.range !== range || !Array.isArray(json.data)) throw new Error('Report query failed');
      cardRows = json.data;
      cardsUpdatedAt = json.fetchedAt;
    } catch {
      if (request !== cardRequest) return;
      cardError = true;
    } finally {
      if (request === cardRequest) {
        cardLoading = false;
        renderCards(model());
      }
    }
  }

  rangeSelect?.addEventListener('change', () => {
    cardRange = validRange(rangeSelect.value) ? rangeSelect.value : '30m';
    try { localStorage.setItem(RANGE_KEY, cardRange); } catch { /* keep the choice for this page */ }
    loadCardRange();
  });
  document.getElementById('propGrid').addEventListener('click', e => {
    if (e.target.closest('[data-retry-cards]')) loadCardRange();
  });

  async function hydrate() {
    try {
      const json = await (await fetch('/api/realtime-all')).json();
      if (!json.ok || !Array.isArray(json.data)) return;
      const byId = new Map(rows.map(r => [String(r.propertyId), r]));
      rows = json.data.map(d => {
        const base = byId.get(String(d.propertyId)) || {};
        return { ...base, ...d, error: d.error ? (d.errorMessage || 'Error') : null, analyticsUrl: base.analyticsUrl, websiteUrl: base.websiteUrl };
      });
      hydrated = true;
      updatedAt = new Date();
      render();
      if (json.quota) renderQuotaBars(json.quota);
    } catch { /* keep the server-rendered numbers */ }
  }

  // Reasons come from the server run of the same rule; a stale response for an older rule is dropped.
  let reasonsReq = 0;
  async function loadSpikeReasons() {
    const req = ++reasonsReq;
    try {
      const json = await (await fetch(`/api/spikes?z=${encodeURIComponent(rule.z)}&lift=${encodeURIComponent(rule.lift)}`)).json();
      if (req !== reasonsReq) return;
      for (const s of (json.ok && json.spikes) || []) reasons[s.propertyId] = s.reasonSummary;
      if (Object.keys(reasons).length) render();
    } catch { /* banner falls back to the baseline line */ }
  }

  // ── Spike rule: Settings menu group (presets + Custom) and the custom popover ──
  const navMenu = document.getElementById('navMenu');
  const gear = document.getElementById('navSettings');
  const rulePop = document.getElementById('rulePop');
  const zIn = document.getElementById('ruleZ');
  const liftIn = document.getElementById('ruleLift');
  const presetBtns = rulePop ? [...rulePop.querySelectorAll('[data-preset]')] : [];
  let menuPresets = [];
  let ruleSummary = null;
  let reasonsTimer = null;

  if (navMenu && rulePop) {
    const grp = document.createElement('div');
    grp.className = 'nb-grp';
    grp.setAttribute('role', 'group');
    grp.setAttribute('aria-labelledby', 'nbRuleL');
    const blank = '<span class="nb-i" aria-hidden="true"></span>';
    const check = '<svg class="nb-i nb-ck" aria-hidden="true"><use href="#nb-check"/></svg>';
    grp.innerHTML = '<div class="nb-gl" id="nbRuleL">Spike rule</div>'
      + Object.keys(PRESETS).map(k => `<button type="button" class="nb-mi" role="menuitemradio" aria-checked="false" tabindex="-1" data-rule-preset="${k}">${blank}${k[0].toUpperCase() + k.slice(1)}${check}</button>`).join('')
      + `<button type="button" class="nb-mi" role="menuitemradio" aria-checked="false" tabindex="-1" data-rule-custom aria-haspopup="dialog"><svg class="nb-i" aria-hidden="true"><use href="#nb-setup"/></svg>Custom<span class="faint num nb-rs" id="ruleSummary"></span></button>`;
    navMenu.insertBefore(grp, navMenu.querySelector('[aria-labelledby="nbSetupL"]'));
    menuPresets = [...grp.querySelectorAll('[data-rule-preset]')];
    ruleSummary = document.getElementById('ruleSummary');
  }

  function closeNavMenu() {
    navMenu.hidden = true;
    gear.setAttribute('aria-expanded', 'false');
  }

  function syncRuleUi() {
    if (!rulePop) return;
    zIn.value = rule.z;
    liftIn.value = rule.lift;
    const name = Object.keys(PRESETS).find(k => PRESETS[k].z === rule.z && PRESETS[k].lift === rule.lift);
    presetBtns.forEach(b => {
      const on = b.dataset.preset === name;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on || (!name && b === presetBtns[0]) ? 0 : -1;
    });
    menuPresets.forEach(b => b.setAttribute('aria-checked', String(b.dataset.rulePreset === name)));
    if (ruleSummary) {
      ruleSummary.textContent = name ? '' : `z ${rule.z}, ${rule.lift}x`;
      ruleSummary.parentElement.setAttribute('aria-checked', String(!name));
    }
  }

  function setRule(next) {
    rule = clampRule(next);
    try { localStorage.setItem(RULE_KEY, JSON.stringify(rule)); } catch { /* private mode: keep it for this page only */ }
    syncRuleUi();
    for (const k of Object.keys(reasons)) delete reasons[k];
    render();
    clearTimeout(reasonsTimer);
    reasonsTimer = setTimeout(loadSpikeReasons, 400);
  }

  function openPop(open) {
    rulePop.classList.toggle('open', open);
    if (open) (presetBtns.find(b => b.tabIndex === 0) || zIn).focus();
  }

  if (rulePop) {
    syncRuleUi();
    if (navMenu) navMenu.addEventListener('click', e => {
      const p = e.target.closest('[data-rule-preset]');
      if (p) { setRule(PRESETS[p.dataset.rulePreset]); closeNavMenu(); gear.focus(); return; }
      if (e.target.closest('[data-rule-custom]')) { e.stopPropagation(); closeNavMenu(); openPop(true); }
    });
    document.getElementById('ruleClose').addEventListener('click', () => { openPop(false); gear.focus(); });
    document.getElementById('ruleReset').addEventListener('click', () => setRule(PRESETS.normal));
    presetBtns.forEach((b, i) => {
      b.addEventListener('click', () => { setRule(PRESETS[b.dataset.preset]); b.focus(); });
      b.addEventListener('keydown', e => {
        const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        const nb = presetBtns[(i + step + presetBtns.length) % presetBtns.length];
        setRule(PRESETS[nb.dataset.preset]);
        nb.focus();
      });
    });
    const onInput = () => {
      const z = parseFloat(zIn.value), lift = parseFloat(liftIn.value);
      if (Number.isFinite(z) && Number.isFinite(lift)) setRule({ z, lift });
    };
    zIn.addEventListener('change', onInput);
    liftIn.addEventListener('change', onInput);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && rulePop.classList.contains('open')) { openPop(false); gear.focus(); }
    });
    document.addEventListener('click', e => {
      if (rulePop.classList.contains('open') && !rulePop.contains(e.target)) openPop(false);
    });
  }

  render();
  if (cardRange !== '30m') loadCardRange();
  if (typeof QUOTA !== 'undefined') renderQuotaBars(QUOTA);
  hydrate().then(loadSpikeReasons);

  const cacheAgeEl = document.getElementById('jsCacheAge');
  if (cacheAgeEl && typeof CACHE_AGE !== 'undefined' && CACHE_AGE) {
    cacheAgeEl.title = new Date(CACHE_AGE).toLocaleString();
    cacheAgeEl.textContent = formatRelativeTime(CACHE_AGE);
  }
})();

// ── Privacy blur ──────────────────────────────────────────────

const privacyBtn = document.getElementById('privacyBtn');
if (privacyBtn) {
  const setPrivacy = on => {
    document.body.classList.toggle('privacy-blur', on);
    privacyBtn.setAttribute('aria-pressed', String(on));
    localStorage.setItem('pb_privacy', on ? '1' : '0');
  };
  setPrivacy(localStorage.getItem('pb_privacy') === '1');
  privacyBtn.addEventListener('click', () => setPrivacy(!document.body.classList.contains('privacy-blur')));
}

// ── Auto-refresh toggle ───────────────────────────────────────

const toggleEl    = document.getElementById('autoRefreshToggle');
const countdownEl = document.getElementById('refreshCountdown');
let countdownTimer = null;

function formatCountdown(secs) {
  return `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
}

function setAutoRefresh(on) {
  clearInterval(countdownTimer);
  if (countdownEl) countdownEl.textContent = '';
  if (toggleEl) toggleEl.setAttribute('aria-pressed', String(on));
  localStorage.setItem('pb_autoRefresh', on ? '1' : '0');
  if (!on) return;
  let secs = REFRESH_INTERVAL_MS / 1000;
  if (countdownEl) countdownEl.textContent = `· reload in ${formatCountdown(secs)}`;
  countdownTimer = setInterval(() => {
    secs--;
    if (countdownEl) countdownEl.textContent = `· reload in ${formatCountdown(secs)}`;
    if (secs <= 0) { clearInterval(countdownTimer); location.reload(); }
  }, 1000);
}

if (toggleEl) {
  setAutoRefresh(localStorage.getItem('pb_autoRefresh') === '1');
  toggleEl.addEventListener('click', () => setAutoRefresh(toggleEl.getAttribute('aria-pressed') !== 'true'));
}

// ── Reload button ─────────────────────────────────────────────

const reloadBtn = document.getElementById('reloadBtn');
if (reloadBtn) {
  reloadBtn.addEventListener('click', () => {
    document.getElementById('reloadIcon')?.classList.add('spinning');
    location.reload();
  });
}

// ── Cache refresh button ──────────────────────────────────────

const refreshCacheBtn = document.getElementById('refreshCacheBtn');
if (refreshCacheBtn) {
  refreshCacheBtn.addEventListener('click', async () => {
    refreshCacheBtn.textContent = 'Refreshing';
    refreshCacheBtn.disabled = true;
    try {
      const json = await (await fetch('/api/refresh-cache', { method: 'POST' })).json();
      if (json.ok) {
        refreshCacheBtn.textContent = `${json.count} properties`;
        setTimeout(() => location.reload(), 800);
        return;
      }
      refreshCacheBtn.textContent = 'Error, retry?';
    } catch {
      refreshCacheBtn.textContent = 'Network error';
    }
    refreshCacheBtn.disabled = false;
  });
}

// ── Toast notification system ──────────────────────────────────

function showToast(msg) {
  let container = document.getElementById('pbToast');
  if (!container) {
    container = document.createElement('div');
    container.id = 'pbToast';
    container.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:40;display:flex;flex-direction:column;gap:8px';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.style.cssText = 'background:var(--surface,#fff);color:var(--text,#18181b);border:1px solid var(--border-2,#dcdce3);border-radius:3px;padding:10px 14px;font-size:12px;font-weight:500;box-shadow:var(--pop-shadow,0 8px 24px -6px rgba(0,0,0,.18));opacity:0;transform:translateY(8px);transition:opacity 180ms ease-out,transform 180ms ease-out';
  el.textContent = msg;
  container.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
  setTimeout(() => {
    el.style.opacity = '0'; el.style.transform = 'translateY(8px)';
    setTimeout(() => el.remove(), 200);
  }, 2800);
}

// ── Keyboard shortcuts (dashboard) ─────────────────────────────

document.addEventListener('keydown', (e) => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  switch (e.key.toLowerCase()) {
    case 'r':
      if (reloadBtn) { e.preventDefault(); showToast('Reloading'); reloadBtn.click(); }
      break;
    case 'p':
      if (privacyBtn) { e.preventDefault(); privacyBtn.click(); }
      break;
    case 'a':
      if (toggleEl) { e.preventDefault(); toggleEl.click(); }
      break;
    case 'g':
      e.preventDefault();
      window.location.href = '/globe';
      break;
    case '?':
      e.preventDefault();
      showToast('R Reload · P Privacy · A Auto-refresh · G Globe');
      break;
  }
});
})();
