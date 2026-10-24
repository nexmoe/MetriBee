/* Greedy screen-space marker grouping for /globe. Browser global + CommonJS (mocha). */
(function (g) {
  const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  /**
   * @param {Array<{x:number,y:number,count:number,i?:any}>} points projected, visible markers
   * @param {number} radiusPx a point within this distance of a group leader joins it (merge edge)
   * @param {{splitPx?:number, prev?:Array<Array<any>>}} [opts] hysteresis: previous groups (lists of point ids `i`)
   *   stay together while members are within splitPx of their leader, so groups do not flip at the merge edge.
   * @returns {Array<{x:number,y:number,count:number,items:Array}>} leader position = largest point
   */
  function clusterMarks(points, radiusPx, opts = {}) {
    const s2 = (opts.splitPx ?? radiusPx) ** 2, r2 = radiusPx * radiusPx;
    const byId = new Map(points.map((p) => [p.i, p]));
    const used = new Set();
    const groups = [];
    for (const ids of opts.prev || []) {
      const live = ids.map((id) => byId.get(id)).filter((p) => p && !used.has(p.i)).sort((a, b) => b.count - a.count);
      const items = live.filter((p) => d2(p, live[0] || p) <= s2);
      if (items.length < 2) continue;
      items.forEach((p) => used.add(p.i));
      groups.push({ x: items[0].x, y: items[0].y, count: items.reduce((n, p) => n + p.count, 0), items });
    }
    // ponytail: O(n*groups) scan, fine for a few hundred cities; grid buckets if it ever lags.
    for (const p of [...points].sort((a, b) => b.count - a.count)) {
      if (used.has(p.i) && p.i !== undefined) continue;
      const hit = groups.find((q) => d2(q, p) <= r2);
      if (hit) { hit.items.push(p); hit.count += p.count; } else groups.push({ x: p.x, y: p.y, count: p.count, items: [p] });
    }
    return groups;
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { clusterMarks };
  else g.clusterMarks = clusterMarks;
})(this);
