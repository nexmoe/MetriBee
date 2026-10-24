// Same greedy grouping and merge/split hysteresis as public/js/clusterMarks.js.
import type { City } from "./Map";

export type Point = {
  city: City;
  x: number;
  y: number;
  count: number;
  i: string;
};
export type Cluster = { x: number; y: number; count: number; items: Point[] };
export function groupMarkers(points: Point[], previous: Cluster[]): Cluster[] {
  const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  const byId = new Map(points.map((p) => [p.i, p]));
  const used = new Set<string>();
  const groups: Cluster[] = [];
  for (const group of previous) {
    const live = group.items
      .map((p) => byId.get(p.i))
      .filter((p): p is Point => !!p && !used.has(p.i))
      .sort((a, b) => b.count - a.count);
    const items = live.filter((p) => distance(p, live[0]) <= 64 ** 2);
    if (items.length < 2) continue;
    items.forEach((p) => used.add(p.i));
    groups.push({
      x: items[0].x,
      y: items[0].y,
      count: items.reduce((n, p) => n + p.count, 0),
      items,
    });
  }
  for (const p of [...points].sort((a, b) => b.count - a.count)) {
    if (used.has(p.i)) continue;
    const hit = groups.find((g) => distance(g, p) <= 56 ** 2);
    if (hit) {
      hit.items.push(p);
      hit.count += p.count;
    } else groups.push({ x: p.x, y: p.y, count: p.count, items: [p] });
  }
  return groups;
}
