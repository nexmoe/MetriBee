/* Navbar command bar (views/partials/navbar.hbs): settings menu, theme, jump palette.
   Theme lives on <html data-theme> (light default, key pb_theme); the <head> script in
   views/layouts/main.hbs applies it before paint. globe.js watches the attribute. */
(function nav() {
  const root = document.documentElement;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const THEME_KEY = 'pb_theme';

  /* ── Theme ── */
  const menu = $('navMenu'), gear = $('navSettings');
  const themeItems = [...menu.querySelectorAll('[data-set-theme]')];
  function syncTheme() {
    const t = root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    themeItems.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.setTheme === t)));
    try { localStorage.setItem(THEME_KEY, t); } catch {}
  }
  // Any theme change (this menu or the globe's own toggle) is saved and reflected here.
  new MutationObserver(syncTheme).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  syncTheme();

  /* ── Settings menu ── */
  const items = () => [...menu.querySelectorAll('[role^="menuitem"]')];
  const quota = $('navQuota');
  const fmt = (n) => Number(n).toLocaleString('en-US');
  async function loadQuota() {
    try {
      const r = await fetch('/api/quota');
      const d = await r.json();
      const h = d && d.ok && d.quota && d.quota.tokensPerHour;
      if (!h || h.consumed == null) { quota.hidden = true; return; }
      const total = Number(h.consumed) + Number(h.remaining || 0);
      quota.textContent = `GA4 quota: ${fmt(h.consumed)} of ${fmt(total)} tokens this hour`;
      quota.hidden = false;
    } catch { quota.hidden = true; }
  }
  function openMenu(focusLast) {
    menu.hidden = false;
    gear.setAttribute('aria-expanded', 'true');
    const list = items();
    const cur = list.find((b) => b.getAttribute('aria-checked') === 'true');
    (focusLast ? list[list.length - 1] : cur || list[0]).focus();
    loadQuota();
  }
  function closeMenu(refocus) {
    if (menu.hidden) return;
    menu.hidden = true;
    gear.setAttribute('aria-expanded', 'false');
    if (refocus) gear.focus();
  }
  gear.addEventListener('click', () => (menu.hidden ? openMenu() : closeMenu(true)));
  gear.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openMenu(e.key === 'ArrowUp'); }
  });
  menu.addEventListener('click', (e) => {
    if (e.target.closest('a.nb-mi')) { closeMenu(false); return; } // same-page hash links (/setup#ai)
    const b = e.target.closest('[data-set-theme]');
    if (!b) return;
    root.setAttribute('data-theme', b.dataset.setTheme);
    closeMenu(true);
  });
  menu.addEventListener('keydown', (e) => {
    const list = items(), i = list.indexOf(document.activeElement);
    let n = null;
    if (e.key === 'ArrowDown') n = (i + 1) % list.length;
    else if (e.key === 'ArrowUp') n = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = list.length - 1;
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(true); return; }
    else if (e.key === 'Tab') { closeMenu(false); return; }
    if (n !== null) { e.preventDefault(); list[n].focus(); }
  });
  document.addEventListener('pointerdown', (e) => {
    if (!menu.hidden && !menu.contains(e.target) && !gear.contains(e.target)) closeMenu(false);
  });

  /* ── Jump palette ── */
  const dlg = $('jumpDlg'), q = $('jumpQ'), list = $('jumpList'), opener = $('jumpOpen');
  const isMac = /mac|iphone|ipad/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '');
  if (isMac) $('jumpKbd').textContent = '⌘K';

  const PAGES = [
    { name: 'Dashboard', href: '/', icon: 'nb-dash' },
    { name: 'Globe', href: '/globe', icon: 'nb-globe' },
    { name: 'Analytics', href: '/analytics', icon: 'nb-bars' },
    { name: 'Journeys', href: '/journeys', icon: 'nb-report' },
    { name: 'Pages', href: '/analytics/pages', icon: 'nb-report' },
    { name: 'Retention', href: '/retention', icon: 'nb-bars' },
    { name: 'Events', href: '/events', icon: 'nb-report' },
    { name: 'Sites', href: '/sites', icon: 'nb-sites' },
    { name: 'Setup', href: '/setup', icon: 'nb-setup' },
  ];
  let index = null, loading = null, shown = [], sel = 0;

  function loadIndex() {
    if (index || loading) return loading;
    loading = fetch('/api/nav-index').then((r) => r.json()).then((d) => {
      index = { sites: d.sites || [], reports: d.reports || [] };
    }).catch(() => { index = { sites: [], reports: [], failed: true }; })
      .finally(() => { loading = null; if (dlg.open) render(); });
    return loading;
  }
  // Reports open on the property selected in the shared sidebar, or the first site.
  function reportHref(id) {
    const qs = new URLSearchParams(location.search);
    const pick = document.getElementById('analyticsProperty');
    const onAn = !!pick;
    const prop = (pick && pick.value) || (onAn && qs.get('prop')) || (index.sites[0] && index.sites[0].id) || '';
    const range = onAn && qs.get('range');
    return `/analytics?prop=${encodeURIComponent(prop)}${range ? `&range=${encodeURIComponent(range)}` : ''}#card-${encodeURIComponent(id)}`;
  }
  const icon = (id) => `<svg class="nb-i" aria-hidden="true"><use href="#${id}"/></svg>`;

  function render() {
    const term = q.value.trim().toLowerCase();
    const hit = (s) => !term || String(s).toLowerCase().includes(term);
    const groups = [['Pages', PAGES.filter((p) => hit(p.name)).map((p) => ({ ...p, lead: icon(p.icon) }))]];
    if (index) {
      groups.push(['Sites', index.sites.filter((s) => hit(s.name) || hit(s.domain)).map((s) => ({
        name: s.name, sub: s.domain && s.domain !== s.name ? s.domain : '', privacy: true,
        href: `/analytics?prop=${encodeURIComponent(s.id)}`,
        lead: `<img class="jump-fav" alt="" src="/api/favicon/${encodeURIComponent(s.id)}" data-privacy data-l="${esc((s.name.match(/[a-z0-9]/i) || ['?'])[0].toUpperCase())}">`,
      }))]);
      groups.push(['Reports', index.reports.filter((r) => hit(r.name)).map((r) => ({ name: r.name, sub: r.group || '', href: reportHref(r.id), lead: icon('nb-report') }))]);
    }
    shown = [];
    let html = '';
    for (const [label, rows] of groups) {
      if (!rows.length) continue;
      const gid = 'jg-' + label.toLowerCase();
      html += `<div role="group" aria-labelledby="${gid}"><div class="jump-gl" id="${gid}" role="presentation">${label}</div>`;
      for (const r of rows) {
        const i = shown.push(r) - 1;
        html += `<div class="jump-it" role="option" id="jo-${i}" data-i="${i}" aria-selected="false">${r.lead}<span class="nm"${r.privacy ? ' data-privacy' : ''}>${esc(r.name)}</span>${r.sub ? `<span class="sub"${r.privacy ? ' data-privacy' : ''}>${esc(r.sub)}</span>` : ''}</div>`;
      }
      html += '</div>';
    }
    if (!index) html += '<div class="jump-empty">Loading sites and reports</div>';
    else if (!shown.length) html += `<div class="jump-empty">${index.failed ? 'Could not load sites and reports.' : 'No matches.'}</div>`;
    list.innerHTML = html;
    list.querySelectorAll('img.jump-fav').forEach((img) => img.addEventListener('error', () => {
      const t = document.createElement('span');
      t.className = 'jump-tile'; t.textContent = img.dataset.l; t.setAttribute('aria-hidden', 'true');
      img.replaceWith(t);
    }, { once: true }));
    select(0);
  }
  function select(i) {
    if (!shown.length) { q.removeAttribute('aria-activedescendant'); return; }
    sel = (i + shown.length) % shown.length;
    list.querySelectorAll('[aria-selected="true"]').forEach((el) => el.setAttribute('aria-selected', 'false'));
    const el = $('jo-' + sel);
    el.setAttribute('aria-selected', 'true');
    q.setAttribute('aria-activedescendant', el.id);
    el.scrollIntoView({ block: 'nearest' });
  }
  function go(i) {
    const r = shown[i];
    if (!r) return;
    dlg.close();
    location.href = r.href;
  }
  function openJump() {
    if (dlg.open) return;
    closeMenu(false);
    q.value = '';
    render();
    dlg.showModal();
    q.focus();
    loadIndex();
  }

  opener.addEventListener('click', openJump);
  q.addEventListener('input', render);
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); select(sel + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); select(sel - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); go(sel); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); dlg.close(); }
    // Keep page shortcuts (globe Escape, analytics keys) from reacting while the palette is open.
    e.stopPropagation();
  });
  list.addEventListener('pointermove', (e) => { const it = e.target.closest('.jump-it'); if (it && +it.dataset.i !== sel) select(+it.dataset.i); });
  list.addEventListener('click', (e) => { const it = e.target.closest('.jump-it'); if (it) go(+it.dataset.i); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => opener.focus({ preventScroll: true }));

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (dlg.open) dlg.close(); else openJump();
    }
  });
})();
