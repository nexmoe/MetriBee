/* Sites page rules (views/sites.hbs): 14-day sessions snapshot to per-site status.
   Shared by the browser (window.SiteStatus) and node (controllers, test/siteStatus.test.js). */
(function (g) {
  const LOW = 50; // sessions a week
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : a ? null : 0);
  const cleanName = (s) => String(s || '').replace(/\s*-\s*GA4?$/i, '').replace(/^www\./i, '');
  const fmt = (n) => Number(n).toLocaleString('en-US');

  /** Status for one site from 14 daily values (oldest first). earn: { last, prev } in currency units, optional. */
  function siteStatus(vals, earn) {
    const prev = sum(vals.slice(0, 7)), last = sum(vals.slice(7));
    const change = prev < 20 && last >= LOW ? null : pct(last, prev);
    const zeroDays = vals.slice(7).filter((x) => x === 0).length;
    let st = { k: 'steady', label: 'Steady', cls: '', why: '' };
    if (!last && !prev) st = { k: 'dead', label: 'No traffic', cls: '', why: 'No sessions in 14 days. Tag removed or site retired?' };
    else if (last && zeroDays && last >= LOW) st = { k: 'gap', label: zeroDays + ' zero days', cls: 'bad', why: zeroDays + ' day(s) with 0 sessions last week: tag or site down?' };
    else if (!last && prev) st = { k: 'gone', label: 'Stopped', cls: 'bad', why: 'Had ' + fmt(prev) + ' sessions the week before, 0 last week.' };
    else if (last < LOW) st = { k: 'low', label: 'Low', cls: '', why: 'Under 50 sessions a week.' };
    else if (change !== null && change <= -30) st = { k: 'drop', label: change + '%', cls: 'bad', why: 'Down ' + Math.abs(change) + '% week over week.' };
    else if (change === null || change >= 50) st = { k: 'up', label: change === null ? 'New' : '+' + change + '%', cls: 'good', why: change === null ? 'New traffic: under 20 sessions the week before.' : 'Up ' + change + '% week over week.' };

    // Earnings drop: <= -30% week over week with >= 5 the week before. Overrides a calm status, adds to a bad one.
    const eChange = earn && earn.prev ? pct(earn.last, earn.prev) : null;
    if (earn && earn.prev >= 5 && eChange !== null && eChange <= -30) {
      const why = 'Earnings down ' + Math.abs(eChange) + '% week over week.';
      if (st.cls === 'bad') st = { ...st, why: st.why + ' ' + why };
      else st = { k: 'edrop', label: 'Earnings ' + eChange + '%', cls: 'bad', why };
    }
    return { prev, last, change, zeroDays, st };
  }

  const BAD = ['gap', 'gone', 'drop', 'edrop'];

  /** Last n day keys (YYYYMMDD) present in any of the daily maps, oldest first. */
  function dayKeys(maps, n) {
    const set = new Set();
    for (const m of maps) for (const k of Object.keys(m || {})) set.add(k);
    return [...set].sort().slice(-n);
  }

  /** Snapshot ({generatedAt, properties:[{id,name,daily,ads?}]}) plus optional adsense meta to view rows. */
  function summarize(snap, adsense) {
    const props = (snap && snap.properties) || [];
    const days = dayKeys(props.map((p) => p.daily), 14);
    const adDays = adsense ? dayKeys(props.map((p) => p.ads), 14) : [];
    const sites = props.map((p) => {
      const vals = days.map((k) => Number((p.daily || {})[k]) || 0);
      let earn = null;
      if (adsense && p.ads) {
        const e = adDays.map((k) => Number(((p.ads[k] || {}).earnings)) || 0);
        const pv = adDays.map((k) => Number(((p.ads[k] || {}).pageViews)) || 0);
        const last = sum(e.slice(-7)), prev = sum(e.slice(0, -7)), views = sum(pv.slice(-7));
        earn = { last, prev, change: prev ? pct(last, prev) : null, rpm: views ? (last / views) * 1000 : null, host: p.adsHost || '' };
      }
      const s = siteStatus(vals, earn);
      return { id: String(p.id), name: cleanName(p.name), error: p.error || '', vals, earn, earnLast: earn ? earn.last : null, earnChange: earn ? earn.change : null, rpm: earn ? earn.rpm : null, ...s };
    });
    return { days, adDays, sites };
  }

  /** AdSense domain key for a site host: exact hostname first, then ignore a leading www. on both sides. */
  function matchHost(host, domains) {
    if (!host) return null;
    const h = String(host).toLowerCase();
    if (domains.includes(h)) return h;
    const bare = h.replace(/^www\./, '');
    return domains.find((d) => d.replace(/^www\./, '') === bare) || null;
  }

  const api = { siteStatus, summarize, matchHost, cleanName, pct, BAD, LOW };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else g.SiteStatus = api;
})(this);
