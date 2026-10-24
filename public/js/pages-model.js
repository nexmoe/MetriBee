(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PagesModel = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function change(current, previous) {
    if (previous == null) return null;
    if (previous === 0) return current > 0 ? Infinity : 0;
    return (current - previous) / previous * 100;
  }
  function sectionOf(path) {
    if (!path.startsWith('/') || path.startsWith('//')) return null;
    const parts = path.split('?')[0].split('/').filter(Boolean);
    return parts.length > 1 || (parts.length === 1 && path.endsWith('/')) ? `/${parts[0]}/` : null;
  }
  function group(rows, breakdown, view = 'all', previousRows = null) {
    if (breakdown !== 'section') return rows;
    const groups = new Map(), result = [];
    const previousGroups = new Map();
    for (const row of previousRows || []) {
      const section = sectionOf(row.path);
      if (!previousGroups.has(section)) previousGroups.set(section, { views: 0, sessions: 0 });
      const old = previousGroups.get(section);
      old.views += row.views; old.sessions += row.sessions;
    }
    for (const row of rows) {
      const section = sectionOf(row.path);
      if (!section) { result.push(row); continue; }
      if (!groups.has(section)) groups.set(section, []);
      groups.get(section).push(row);
    }
    for (const [path, children] of groups) {
      if (children.length === 1) { result.push(children[0]); continue; }
      const sum = key => children.reduce((n, row) => n + row[key], 0);
      const knownSum = key => children.every(row => row[key] != null) ? sum(key) : null;
      const views = sum('views'), engagement = sum('engagement');
      // Sessions and users overlap across pages. Do not manufacture group totals by adding them.
      const previousSum = key => previousRows ? previousGroups.get(path)?.[key] || 0 : null;
      const sessions = view === 'entry' ? sum('sessions') : null;
      result.push({ path, title: '', children, views, engagement, avgEngagement: views ? engagement / views : 0,
        sessions, users: null, bounce: sessions ? children.reduce((n, row) => n + row.bounce * row.sessions, 0) / sessions : null, entries: knownSum('entries'),
        previousViews: previousSum('views'), previousSessions: view === 'entry' ? previousSum('sessions') : null,
        series: children.every(row => row.series) ? children[0].series.map((_, i) => children.reduce((n, row) => n + row.series[i], 0)) : null });
    }
    return result;
  }
  function sort(rows, key, direction) {
    return [...rows].sort((a, b) => {
      if (key === 'path') return direction * a.path.localeCompare(b.path);
      const av = a[key], bv = b[key];
      if (av == null || bv == null) return av == null ? bv == null ? a.path.localeCompare(b.path) : 1 : -1;
      return direction * (av - bv) || a.path.localeCompare(b.path);
    });
  }
  function csv(rows) {
    const text = value => {
      let str = String(value ?? '');
      if (typeof value === 'string' && /^[\s]*[=+\-@]/.test(str)) str = "'" + str;
      return '"' + str.replace(/"/g, '""') + '"';
    };
    return rows.map(row => row.map(text).join(',')).join('\r\n');
  }
  return { group, sort, change, csv };
});
