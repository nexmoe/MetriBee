/* /setup page: polls /api/setup/status every 3 s and drives the checklist, copy buttons, demo hint and MCP scope toggle. */
(() => {
  const page = document.getElementById('setupPage');
  if (!page) return;
  const $ = (id) => document.getElementById(id);
  const POLL_MS = 3000;
  let last = null, checkedAt = 0, email = '', timer = null;

  /* ── Copy ── */
  async function copy(text, btn) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    const label = btn.querySelector('span') || btn;
    const was = label.dataset.was || label.textContent;
    label.dataset.was = was;
    label.textContent = 'Copied';
    clearTimeout(btn._t);
    btn._t = setTimeout(() => { label.textContent = was; }, 1500);
  }
  page.addEventListener('click', (e) => {
    const b = e.target.closest('[data-copy], [data-copy-from]');
    if (!b) return;
    copy(b.dataset.copy || $(b.dataset.copyFrom).textContent, b);
  });
  $('copyEmail').addEventListener('click', (e) => email && copy(email, e.currentTarget));

  /* ── Demo hint ── */
  $('demoBtn').addEventListener('click', (e) => {
    const box = $('demoCmd'), open = box.hidden;
    box.hidden = !open;
    e.currentTarget.setAttribute('aria-expanded', String(open));
  });

  /* ── MCP scope toggle ── */
  const mcp = $('mcpPrompt'), mcpBase = mcp.textContent;
  const SCOPE_LINE = /^Scope:.*$/m;
  page.querySelectorAll('[data-scope]').forEach((b) => b.addEventListener('click', () => {
    page.querySelectorAll('[data-scope]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    mcp.textContent = b.dataset.scope === 'user'
      ? mcpBase.replace('--scope project', '--scope user').replace(SCOPE_LINE, 'Scope: all projects (user scope, available in every folder).')
      : mcpBase;
  }));

  /* ── Checklist ── */
  const BADGE = { ok: ['good', 'Done'], now: ['warn', 'To do'], bad: ['bad', 'Fix'], wait: ['', 'Waiting'] };
  function step(name, state, sub) {
    const li = page.querySelector(`[data-step="${name}"]`);
    li.dataset.state = state;
    const [cls, text] = BADGE[state];
    const badge = li.querySelector(':scope > .badge');
    badge.className = 'badge' + (cls ? ' ' + cls : '');
    badge.textContent = text;
    if (sub != null) li.querySelector('.su-sub').textContent = sub;
    const dot = li.querySelector('.su-dot');
    if (state === 'ok') dot.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    else dot.textContent = dot.dataset.n || (dot.dataset.n = dot.textContent);
  }
  // remember step numbers before the first render swaps them for checks
  page.querySelectorAll('[data-step] .su-dot').forEach((d) => { d.dataset.n = d.textContent; });

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  function render(s) {
    last = s;
    email = s.clientEmail || '';
    const connected = s.propertyCount > 0;

    step('env', s.envFound ? 'ok' : 'now',
      s.envFound ? 'GA4_CLIENT_EMAIL, GA4_PRIVATE_KEY' : `Missing: ${(s.missing || ['GA4_CLIENT_EMAIL', 'GA4_PRIVATE_KEY']).join(', ')}`);

    if (!s.envFound) step('key', 'wait', 'Waiting for step 1');
    else if (s.keyAccepted) step('key', 'ok', email);
    else step('key', 'bad', 'Google rejected the key. See below.');

    if (!s.keyAccepted) step('access', 'wait', 'Waiting for step 2');
    else if (connected) step('access', 'ok', 'Service account can read GA4');
    else if (s.propertyCount === 0) step('access', 'now', `Add ${email} as Viewer in GA4 Admin, Account access management.`);
    else step('access', 'bad', 'GA4 request failed. See below.');
    $('accessAct').hidden = !(s.keyAccepted && s.propertyCount === 0);

    if (connected) step('props', 'ok', `${plural(s.propertyCount, 'property', 'properties')} in ${plural(s.accountCount, 'account', 'accounts')}`);
    else step('props', 'wait', s.keyAccepted && s.propertyCount === 0 ? 'Checks again every 3 seconds' : 'Waiting for step 3');

    $('okBox').hidden = !connected;
    if (connected) $('okText').textContent = `${plural(s.propertyCount, 'property', 'properties')} in ${plural(s.accountCount, 'account', 'accounts')} visible. The dashboard is ready.`;

    const failed = !!s.error;
    $('errBox').hidden = !failed;
    if (failed) {
      $('errHint').textContent = s.hint || '';
      $('errLine').textContent = s.error;
      const a = $('errLink');
      a.hidden = !s.link;
      if (s.link) { a.href = s.link; a.textContent = /analytics\.google/.test(s.link) ? 'Open GA4 Admin' : 'Open the Google Cloud page'; }
    }
  }

  async function poll() {
    clearTimeout(timer);
    try {
      const r = await fetch(page.dataset.poll, { cache: 'no-store' });
      if (r.ok) { render(await r.json()); checkedAt = Date.now(); }
    } catch { /* server restarting; try again */ }
    tick();
    if (!(last && last.propertyCount > 0)) timer = setTimeout(poll, POLL_MS);
  }

  function tick() {
    if (!checkedAt) return;
    const s = Math.round((Date.now() - checkedAt) / 1000);
    $('checkedAgo').textContent = s < 2 ? 'Checked just now' : `Checked ${s} s ago`;
  }
  setInterval(tick, 1000);

  $('recheck').addEventListener('click', () => { last = null; poll(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !(last && last.propertyCount > 0)) poll(); });
  poll();
})();
