/* Sites page (views/sites.hbs): three views over the daily snapshot (SITES_DATA).
   Rules live in siteStatus.js. View: ?view=look|table|heat, else localStorage pb_sites_view. */
(function sitesPage() {
  const app = document.getElementById('stApp');
  if (!app || typeof SITES_DATA === 'undefined' || !window.SiteStatus) return;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Number(n).toLocaleString('en-US');
  const VIEWS = ['look', 'table', 'heat'];
  const KEY = 'pb_sites_view';
  const S = window.SiteStatus;

  const ads = SITES_DATA.adsense;
  const { days, adDays, sites } = S.summarize(SITES_DATA.snapshot, ads);
  const money = ads ? new Intl.NumberFormat('en-US', { style: 'currency', currency: ads.currency || 'USD', maximumFractionDigits: 0 }) : null;
  const money2 = ads ? new Intl.NumberFormat('en-US', { style: 'currency', currency: ads.currency || 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null;
  const dd = (k) => k ? new Date(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';

  /* ── Summary and freshness ── */
  const total = sites.reduce((a, s) => a + s.last, 0), totalPrev = sites.reduce((a, s) => a + s.prev, 0);
  const tp = S.pct(total, totalPrev);
  $('stSum').innerHTML = `Sessions last 7 days <b class="num">${fmt(total)}</b> vs <span class="num">${fmt(totalPrev)}</span> the week before${tp === null ? '' : ` (<span class="num ${tp <= -10 ? 'st-dn' : tp >= 10 ? 'st-up' : ''}">${tp > 0 ? '+' : ''}${tp}%</span>)`}.`
    + (ads ? ` Earnings <b class="num">${money.format(sites.reduce((a, s) => a + (s.earnLast || 0), 0))}</b>.` : '');
  const when = (iso) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const stale = (iso) => Date.now() - new Date(iso).getTime() > 36 * 3600e3;
  const gen = SITES_DATA.snapshot.generatedAt;
  $('stFresh').innerHTML = [
    `<span class="badge ${stale(gen) ? 'warn' : ''}" title="Written by pnpm snapshot:sessions">GA4 snapshot ${esc(when(gen))}</span>`,
    `<span>${sites.length} properties, ${esc(dd(days[0]))} to ${esc(dd(days[days.length - 1]))}</span>`,
    ads ? `<span class="badge ${stale(ads.generatedAt) ? 'warn' : ''}">AdSense ${esc(when(ads.generatedAt))}, ${ads.matched} matched</span>` : '',
  ].join(' ');

  /* ── Shared bits ── */
  const name = (s) => `<span class="st-name"><img class="st-fav" alt="" loading="lazy" src="/api/favicon/${encodeURIComponent(s.id)}" data-privacy><a href="/analytics?prop=${encodeURIComponent(s.id)}" data-privacy title="${esc(s.name)}">${esc(s.name)}</a></span>`;
  const bars = (s) => {
    const m = Math.max(...s.vals, 1);
    return `<span class="st-bars" role="img" aria-label="Daily sessions, 14 days">${s.vals.map((x, i) => `<i class="${x === 0 ? 'zero' : i < 7 ? 'prev' : ''}" style="height:${Math.max(2, Math.round((x / m) * 24))}px" title="${esc(dd(days[i]))}: ${fmt(x)}"></i>`).join('')}</span>`;
  };
  const chg = (c, bad = -30, good = 30) => c === null || c === undefined ? '<span class="badge good">New</span>'
    : `<span class="num ${c <= bad ? 'st-dn' : c >= good ? 'st-up' : 'st-flat'}">${c > 0 ? '+' : ''}${c}%</span>`;
  const eChg = (s) => !s.earn ? '' : s.earn.change === null ? '<span class="faint">-</span>' : chg(s.earn.change);
  const eAmt = (s) => s.earn ? `<span class="num">${money.format(s.earn.last)}</span>` : '<span class="faint">-</span>';
  document.addEventListener('error', (e) => { if (e.target.classList && e.target.classList.contains('st-fav')) e.target.hidden = true; }, true);

  /* ── Needs a look ── */
  function look() {
    const groups = [
      ['Needs a look', (s) => S.BAD.includes(s.st.k)],
      ['Growing', (s) => s.st.k === 'up'],
      ['Steady', (s) => s.st.k === 'steady'],
      ['Low or no traffic', (s) => s.st.k === 'low' || s.st.k === 'dead'],
    ];
    return `<div class="st st-look${ads ? ' earn' : ''}">` + groups.map(([title, f], gi) => {
      const arr = sites.filter(f).sort((a, b) => b.last - a.last);
      if (!arr.length) return '';
      return `<section class="card"><div class="card-h"><h2>${title}</h2><span class="n num">${arr.length}</span></div>${arr.map((s) => `<div class="st-row${gi === 3 ? ' muted' : ''}">
        <div style="min-width:0">${name(s)}<div class="st-id num">${esc(s.id)}</div></div>
        <div class="r num">${fmt(s.last)} <span class="st-id">/ wk</span></div>
        <div class="r">${chg(s.change)}</div>
        ${bars(s)}
        ${ads ? `<div class="r earn-c">${s.earn ? `${eAmt(s)} ${eChg(s)}` : '<span class="faint">No ads</span>'}</div>` : ''}
        <div class="why">${esc(s.st.why || (s.error ? 'Snapshot error: ' + s.error : ''))}</div>
      </div>`).join('')}</section>`;
    }).join('') + '</div>';
  }

  /* ── Table ── */
  let sortKey = 'last', dir = -1, showAll = false;
  const COLS = [
    ['name', 'Site'], ['last', 'Last 7 days'], ['prev', 'Week before'], ['change', 'Change'], [null, '14 days'],
    ...(ads ? [['earnLast', 'Earnings 7d'], ['earnChange', 'Change'], ['rpm', 'Page RPM']] : []),
    [null, 'Flag'],
  ];
  const sortIcon = (d) => `<svg class="st-sort" viewBox="0 0 24 24" aria-hidden="true"><path d="${d < 0 ? 'M6 9l6 6 6-6' : 'M6 15l6-6 6 6'}"/></svg>`;
  function table() {
    const val = (s) => sortKey === 'name' ? s.name.toLowerCase() : (s[sortKey] ?? -1e12);
    const list = [...sites].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * dir);
    const live = list.filter((s) => s.last >= S.LOW || s.prev >= S.LOW), rest = list.filter((s) => !live.includes(s));
    const rows = (arr) => arr.map((s) => `<tr class="${s.last < S.LOW ? 'muted' : ''}">
      <td>${name(s)}</td><td class="num">${fmt(s.last)}</td><td class="num">${fmt(s.prev)}</td><td>${chg(s.change)}</td><td>${bars(s)}</td>
      ${ads ? `<td>${eAmt(s)}</td><td>${s.earn ? eChg(s) : '<span class="faint">-</span>'}</td><td class="num">${s.rpm === null ? '<span class="faint">-</span>' : money2.format(s.rpm)}</td>` : ''}
      <td>${s.st.cls ? `<span class="badge ${s.st.cls}" title="${esc(s.st.why)}">${esc(s.st.label)}</span>` : ''}</td></tr>`).join('');
    const th = COLS.map(([k, label]) => k
      ? `<th${k === sortKey ? ` aria-sort="${dir < 0 ? 'descending' : 'ascending'}"` : ''}><button type="button" data-k="${k}">${label}${k === sortKey ? sortIcon(dir) : ''}</button></th>`
      : `<th>${label}</th>`).join('');
    return `<section class="card"><div class="card-h"><h2>Sessions by site</h2><span class="n num">${live.length} with traffic, ${rest.length} under ${S.LOW} a week</span></div>
      <div class="st-scroll"><table class="st-tbl"><thead><tr>${th}</tr></thead><tbody>${rows(live)}${showAll ? rows(rest) : ''}</tbody></table></div>
      ${rest.length ? `<button type="button" class="st-toggle" id="stToggle" aria-expanded="${showAll}">${showAll ? 'Hide' : 'Show'} ${rest.length} low-traffic properties</button>` : ''}</section>`;
  }
  app.addEventListener('click', (e) => {
    const b = e.target.closest('th button[data-k]');
    if (b) { dir = sortKey === b.dataset.k ? -dir : (b.dataset.k === 'name' ? 1 : -1); sortKey = b.dataset.k; render(); app.querySelector(`th button[data-k="${sortKey}"]`)?.focus(); return; }
    if (e.target.closest('#stToggle')) { showAll = !showAll; render(); $('stToggle')?.focus(); }
  });

  /* ── Heatmap ── */
  const shade = (x, med) => {
    const r = x / (med || 1);
    const a = r >= 1.5 ? 55 : r >= 1.1 ? 35 : r >= 0.75 ? 18 : 6;
    return `background:color-mix(in srgb, var(--c1) ${a}%, transparent)`;
  };
  function heat() {
    const list = sites.filter((s) => s.last + s.prev > 0).sort((a, b) => b.last - a.last);
    let html = `<section class="card"><div class="card-h"><h2>Daily sessions, 14 days</h2><span class="n">Shade: day vs that site's own median. Red: 0 sessions.</span></div><div class="st-scroll"><div class="st-hm${ads ? ' earn' : ''}">`
      + `<div class="h l">Site</div>${days.map((k) => `<div class="h num" title="${esc(dd(k))}">${+k.slice(6)}</div>`).join('')}<div class="h r">Last 7</div><div class="h r">Change</div>${ads ? '<div class="h r">Earnings 7d</div>' : ''}`;
    for (const s of list) {
      const med = [...s.vals].sort((a, b) => a - b)[Math.floor(s.vals.length / 2)];
      html += `<div>${name(s)}</div>${s.vals.map((x, i) => `<div class="c num${x === 0 ? ' z' : ''}" ${x ? `style="${shade(x, med)}"` : ''} title="${esc(dd(days[i]))}: ${fmt(x)}">${x >= 1000 ? Math.round(x / 100) / 10 + 'k' : x}</div>`).join('')}<div class="r num">${fmt(s.last)}</div><div class="r">${chg(s.change)}</div>${ads ? `<div class="r">${eAmt(s)}</div>` : ''}`;
    }
    html += `</div></div><div class="st-legend"><span style="${shade(0.5, 1)}"></span>under 0.75x median <span style="${shade(1, 1)}"></span>normal <span style="${shade(1.2, 1)}"></span>1.1x+ <span style="${shade(2, 1)}"></span>1.5x+ <span style="background:var(--bad-soft)"></span>0 sessions</div></section>`;
    const hidden = sites.length - list.length;
    return html + (hidden ? `<p class="st-note">${hidden} properties with 0 sessions in 14 days hidden.</p>` : '');
  }

  /* ── View switch ── */
  const qs = new URLSearchParams(location.search);
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch {}
  let view = VIEWS.includes(qs.get('view')) ? qs.get('view') : VIEWS.includes(saved) ? saved : 'look';
  const seg = $('stView');
  function render() {
    seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    app.innerHTML = view === 'table' ? table() : view === 'heat' ? heat() : look();
  }
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (!b || b.dataset.view === view) return;
    view = b.dataset.view;
    try { localStorage.setItem(KEY, view); } catch {}
    const u = new URL(location.href);
    u.searchParams.set('view', view);
    history.replaceState(null, '', u);
    render();
  });
  render();
})();
