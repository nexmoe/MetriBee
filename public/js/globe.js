/* Live globe (/globe): two map engines behind one interface, plus a shared summary panel, event feed,
   city card and avatar marker layer that only use engine.project(), engine.center() and engine.flyTo().

   Border data: Natural Earth 10m admin 0 countries, India point of view only
   (ne_10m_admin_0_countries_ind from naciscdn.org). Never swap in default Natural Earth or tile borders.
     pnpm dlx mapshaper@0.6.102 ne_10m_admin_0_countries_ind.shp -filter-fields ISO_A2 -rename-layers ind -simplify 3% keep-shapes -o format=topojson quantization=1e4 public/data/world-ind.json
     pnpm dlx mapshaper@0.6.102 ne_10m_admin_0_countries_ind.shp -innerlines -simplify 15% keep-shapes -o format=geojson precision=0.0001 public/data/borders-ind.json

   ponytail: no own vector tiles, no Mapbox token. Revisit only if OpenFreeMap goes down or gets slow. */
(() => {
const $ = (s) => document.querySelector(s);
const root = document.documentElement;
const stage = $("#gstage"), host = $("#gmap"), marks = $("#gmarks"), card = $("#gcard");
const feedBox = $("#gfeed"), feedList = $("#gfeedList"), feedHead = $("#gfeedH");
if (!stage) return;

const load = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const save = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const narrow = () => matchMedia("(max-width: 860px)").matches;
const css = (n) => getComputedStyle(root).getPropertyValue(n).trim();
const isDark = () => root.dataset.theme === "dark";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => Number(n || 0).toLocaleString();

const ICON = {
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  leaf: '<path d="M3 20 9 9l4 6 3-4 5 9z"/><circle cx="17" cy="5" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  chev: '<path d="m6 15 6-6 6 6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  sites: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>',
  eyeoff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
};
const svg = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`;
document.querySelectorAll("[data-icon]").forEach((b) => { b.innerHTML = svg(b.dataset.icon); });

const state = {
  engine: load("globe.engine") === "canvas" ? "canvas" : "ml",
  style: load("globe.style") === "outdoors" ? "outdoors" : "minimal",
  flat: load("globe.proj") === "2d",
  refresh: ["auto", "30", "60", "120", "300"].includes(load("globe.refresh")) ? load("globe.refresh") : "auto",
  feed: true, filter: null, sel: null, list: null, f: { site: "", country: "", device: "" },
  panel: narrow() ? "min" : load("globe.panel") === "min" ? "min" : "open",
  avatar: load("globe.avatar") === "sites" ? "sites" : "people",
  night: load("globe.night") !== "off",
  data: null, cities: [], feedKeys: new Set(), newKeys: new Set(),
};
root.dataset.map = state.style;

/* ── Avatars: DiceBear Notionists, seeded by city + device; initials until (or unless) it loads ── */
let avatarUri = null;
import("https://cdn.jsdelivr.net/npm/@dicebear/core@9.2.2/+esm").then(async (core) => {
  const style = await import("https://cdn.jsdelivr.net/npm/@dicebear/notionists@9.2.2/+esm");
  const cache = {};
  avatarUri = (seed) => cache[seed] || (cache[seed] = core.createAvatar(style, { seed, backgroundColor: ["eef2ff", "e0f2fe", "fef3c7", "ede9fe"] }).toDataUri());
  renderMarks(); renderFeed(); if (state.sel != null) renderCard(); else if (state.list) renderList();
}).catch(() => { /* initials stay */ });
const initials = (city) => esc(String(city || "?").replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2) || "?");
const avHtml = (city) => avatarUri ? `<img alt="" src="${avatarUri(city)}">` : `<span>${initials(city)}</span>`;

/* ── Site faces: favicon from /api/favicon/:id, letter tile (letterTile.js) when there is none ── */
const noFav = new Set();
const siteName = (s) => s.name || s.site || "";
function tileHtml(s) {
  const t = letterTile(siteName(s), Number(s.id) || 0);
  return `<span class="fav tile" style="background:${t.color}" data-privacy aria-hidden="true">${esc(t.letter)}</span>`;
}
const favHtml = (s) => !s.id || noFav.has(String(s.id)) ? tileHtml(s)
  : `<img class="fav" alt="" src="/api/favicon/${encodeURIComponent(s.id)}" data-id="${esc(s.id)}" data-n="${esc(siteName(s))}" data-privacy>`;
/* Broken favicon becomes a letter tile, broken flag a neutral tile. Capture phase: error does not bubble. */
document.addEventListener("error", (e) => {
  const im = e.target;
  if (im.classList?.contains("flag")) im.outerHTML = '<span class="flag" aria-hidden="true"></span>';
  else if (im.classList?.contains("fav")) { noFav.add(im.dataset.id); im.outerHTML = tileHtml({ id: im.dataset.id, name: im.dataset.n }); }
}, true);
/* Marker face: a DiceBear person, or in Sites mode the city's top site icon */
const faceHtml = (c) => state.avatar === "sites" && c.sites?.[0] ? favHtml(c.sites[0]) : avHtml(c.city);

/* ── Shared marker layer ──
   Markers are keyed DOM nodes, one per group, keyed by the sorted member city keys, so a poll with the same
   city set reuses every node and every <img> (src is only set when the URL changes). Per frame only their
   `translate` changes. Groups are recomputed on data/zoom change or at most every 500 ms while spinning,
   with hysteresis (merge at GROUP_PX, split at SPLIT_PX) so they do not flip at the edge.
   Every marker is the same size (48 px); a group shows up to 3 overlapping faces. */
const cityKey = (c) => `${c.city}||${c.countryId}`;
const cardOpen = () => state.sel != null || !!state.list;
const GROUP_PX = 56, SPLIT_PX = 64, RECLUSTER_MS = 500, FACE_STEP = 11;
const markEls = new Map();
let groups = [], keyIdx = new Map(), clusterAt = 0, clusterZoom = "", forceCluster = true;
function renderMarks() { keyIdx = new Map(state.cities.map((c, i) => [cityKey(c), i])); forceCluster = true; placeMarks(); }
/* hover title carries the count (no badge); it names only cities, so privacy mode leaves it */
marks.addEventListener("pointerover", (e) => { const m = e.target.closest(".mk"); if (m) m.title = m._label || ""; });
/* A press or wheel that starts on a marker still moves the map: the marker forwards it to the engine's input
   element (MapLibre and d3.drag track the rest of the drag on the document). A click opens the card only when
   the pointer did not travel, so a drag that starts on a marker does not open one. */
marks.addEventListener("mousedown", (e) => { const t = engine?.input?.(); if (t && e.target.closest(".mk")) t.dispatchEvent(new MouseEvent("mousedown", e)); });
marks.addEventListener("wheel", (e) => { const t = engine?.input?.(); if (!t) return; e.preventDefault(); t.dispatchEvent(new WheelEvent("wheel", e)); }, { passive: false });
let downXY = [0, 0];
marks.addEventListener("pointerdown", (e) => { downXY = [e.clientX, e.clientY]; });
const dragged = (e) => Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]) > 6;
/* Face of one city: an image (DiceBear data URI or favicon URL) or small HTML (initials, letter tile) */
function faceSpec(c) {
  const s = state.avatar === "sites" ? c.sites?.[0] : null;
  if (s) return s.id && !noFav.has(String(s.id)) ? { img: `/api/favicon/${encodeURIComponent(s.id)}`, cls: "fav", id: String(s.id), n: siteName(s) } : { html: tileHtml(s) };
  return avatarUri ? { img: avatarUri(c.city), cls: "" } /* seed by city only: dominant device flips between polls */ : { html: `<span>${initials(c.city)}</span>` };
}
function setFace(slot, f) {
  if (!f.img) { if (slot._html !== f.html) { slot._html = f.html; slot.innerHTML = f.html; } return; }
  let im = slot.firstElementChild;
  if (slot._html != null || !im || im.tagName !== "IMG") { slot._html = null; im = new Image(); im.alt = ""; slot.replaceChildren(im); }
  if (im.className !== f.cls) im.className = f.cls;
  if (f.id) { im.dataset.id = f.id; im.dataset.n = f.n; im.setAttribute("data-privacy", ""); } else im.removeAttribute("data-privacy");
  if (im.getAttribute("src") !== f.img) im.src = f.img;
}
const setIf = (el, k, v) => { if (el[k] !== v) el[k] = v; };
function syncMark(el, keys) {
  const ids = keys.map((k) => keyIdx.get(k)).filter((i) => i != null);
  if (!ids.length) return;
  const count = ids.reduce((n, i) => n + state.cities[i].count, 0);
  const sel = ids.includes(state.sel) || (!!state.list && keys.some((k) => state.list.includes(k)));
  const label = ids.length === 1 ? `${state.cities[ids[0]].city}, ${fmt(count)} active users` : `${ids.length} cities, ${fmt(count)} users`;
  setIf(el, "className", `mk${sel ? " sel" : ""}${el._new ? " new" : ""}`);
  if (el.dataset.m !== ids.join(" ")) el.dataset.m = ids.join(" ");
  if (el._label !== label) { el._label = label; el.setAttribute("aria-label", label); }
  const n = Math.min(3, ids.length);
  if (el._n !== n) { el._n = n; el.style.setProperty("--n", n - 1); }
  if (el.style.zIndex !== String(count)) el.style.zIndex = count;
  while (el.children.length > n) el.lastElementChild.remove();
  while (el.children.length < n) { const f = document.createElement("span"); const j = el.children.length; f.className = "f"; f.style.cssText = `--o:${j * FACE_STEP}px;z-index:${3 - j}`; el.append(f); }
  /* keys are sorted, so each face keeps its slot from poll to poll */
  ids.slice(0, n).forEach((i, j) => setFace(el.children[j], faceSpec(state.cities[i])));
}
function placeMarks() {
  if (!engine || !engine.ready) return;
  const center = state.flat ? null : engine.center();
  const pts = [], vis = new Map();
  state.cities.forEach((c, i) => {
    const p = engine.project(c.lng, c.lat);
    if (p && (state.flat || !center || d3.geoDistance([c.lng, c.lat], center) < Math.PI / 2 - engine.horizonPad)) {
      const pt = { x: p[0], y: p[1], count: c.count, i: cityKey(c) };
      pts.push(pt); vis.set(pt.i, pt);
    }
  });
  const now = performance.now(), zoom = `${state.flat}:${Number(engine.zoom?.() ?? 0).toFixed(2)}`;
  const recluster = forceCluster || zoom !== clusterZoom || now - clusterAt > RECLUSTER_MS;
  if (recluster) {
    groups = clusterMarks(pts, GROUP_PX, { splitPx: SPLIT_PX, prev: groups.filter((g) => g.keys.length > 1).map((g) => g.keys) })
      .map((g) => { const keys = g.items.map((p) => p.i).sort(); return { keys, id: keys.join("\n"), lead: g.items[0].i }; });
    forceCluster = false; clusterAt = now; clusterZoom = zoom;
  }
  const seen = new Set();
  for (const g of groups) {
    const lead = vis.get(g.lead) || g.keys.map((k) => vis.get(k)).find(Boolean);
    if (!lead) continue;
    let el = markEls.get(g.id);
    if (!el) {
      el = document.createElement("button"); el.type = "button"; el._new = true;
      setTimeout(() => { el._new = false; el.classList.remove("new"); }, 300); /* timer, not animationend: reduced motion runs no animation */
      markEls.set(g.id, el); marks.append(el);
    }
    if (recluster || el._keys !== g.keys) { el._keys = g.keys; syncMark(el, g.keys); }
    el.style.translate = `${lead.x}px ${lead.y}px`;
    seen.add(g.id);
  }
  for (const [k, el] of markEls) if (!seen.has(k)) { el.remove(); markEls.delete(k); }
  if (!card.hidden) positionCard();
}

/* ── Day and night (variant A): 16 stacked circles around the anti-solar point (radius 90 to 72 deg), each at
   1/16 of the map-only --night token, so dusk is a smooth ramp with no visible bands and the core is about --night.
   Sun math in sun.js; recomputed every 60 s (tickNight). ── */
const NIGHT_N = 16, NIGHT_R = Array.from({ length: NIGHT_N }, (_, i) => 90 - i * 18 / (NIGHT_N - 1));
/* --night rgba to an opaque color plus the per-circle opacity whose 16-fold stack equals the token alpha */
function nightPaint() {
  const [r, g, b, a = 1] = (css("--night").match(/[\d.]+/g) || [0, 0, 0, 0.3]).map(Number);
  return { color: `rgb(${r},${g},${b})`, opacity: 1 - (1 - a) ** (1 / NIGHT_N) };
}
/* A spherical polygon as flat lng/lat rings. d3's equirectangular stream cuts it at the antimeridian and walks the
   pole edge when it covers a pole; a plain lng/lat ring cannot say that, and MapLibre reads GeoJSON as flat. */
const PLATE = d3.geoEquirectangular().scale(180 / Math.PI).translate([0, 0]).precision(0);
function flatRings(geo) {
  const rings = []; let ring = null;
  d3.geoPath(PLATE, {
    moveTo(x, y) { ring = [[x, -y]]; rings.push(ring); },
    lineTo(x, y) { ring.push([x, -y]); },
    closePath() { ring.push(ring[0]); },
    arc() {}, rect() {},
  })(geo);
  return rings.filter((r) => r.length > 3);
}
/* circles: sphere polygons for the canvas engine; fc: flat features for MapLibre, property i = circle index */
function nightShapes(d = new Date()) {
  const s = Sun.sun(d), anti = [s.lng + 180, -s.lat];
  const circles = NIGHT_R.map((r) => d3.geoCircle().center(anti).radius(r).precision(2)());
  const features = circles.flatMap((c, i) => flatRings(c).map((ring) => ({ type: "Feature", properties: { i }, geometry: { type: "Polygon", coordinates: [ring] } })));
  return { circles, fc: { type: "FeatureCollection", features } };
}
let night = nightShapes();

/* ── Canvas engine (d3 orthographic / equirectangular, no tiles) ── */
let world = null;
async function loadWorld() {
  if (world) return world;
  const t = await (await fetch("/data/world-ind.json")).json();
  world = { land: topojson.feature(t, t.objects.ind), borders: topojson.mesh(t, t.objects.ind, (a, b) => a !== b) };
  return world;
}
function canvasEngine() {
  let canvas, ctx, W = 0, H = 0, proj, k = 1, drag = false, flying = false, dead = false;
  const rot = [-78, -14];
  const graticule = d3.geoGraticule10();
  const baseScale = () => Math.min(W, H) * 0.46;
  const onWheel = (e) => { if (state.flat) return; e.preventDefault(); k = Math.min(6, Math.max(1, k * Math.exp(-e.deltaY * 0.0015))); proj.scale(baseScale() * k); api.draw(); };
  const api = {
    name: "canvas", horizonPad: 0.05, ready: false,
    zoom: () => k,
    input: () => canvas, /* element that takes drag and wheel input */
    async init() {
      await loadWorld();
      if (dead) throw new Error("cancelled");
      canvas = document.createElement("canvas");
      host.append(canvas);
      ctx = canvas.getContext("2d");
      d3.select(canvas).call(d3.drag()
        .on("start", () => { drag = true; canvas.style.cursor = "grabbing"; })
        .on("drag", (e) => { if (state.flat) return; rot[0] += e.dx * 0.3; rot[1] = Math.max(-90, Math.min(90, rot[1] - e.dy * 0.3)); proj.rotate(rot); api.draw(); })
        .on("end", () => { drag = false; canvas.style.cursor = "grab"; }));
      canvas.addEventListener("wheel", onWheel, { passive: false });
      api.ready = true;
      api.resize();
    },
    resize() {
      if (!canvas) return;
      const box = host.getBoundingClientRect(); W = box.width; H = box.height;
      const dpr = devicePixelRatio || 1;
      canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const wide = W > 860;
      proj = state.flat
        ? d3.geoEquirectangular().fitExtent([[wide ? 364 : 8, 8], [W - 8, H - 8]], { type: "Sphere" })
        : d3.geoOrthographic().clipAngle(90).rotate(rot).scale(baseScale() * k).translate([wide ? W * 0.6 : W / 2, H / 2]);
      api.draw();
    },
    draw() {
      if (!proj || !world) return;
      const path = d3.geoPath(proj, ctx), globe = !state.flat, [cx, cy] = proj.translate(), r = proj.scale();
      ctx.clearRect(0, 0, W, H);
      if (globe) { ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.shadowColor = css("--halo"); ctx.shadowBlur = 60; ctx.fillStyle = css("--sea"); ctx.fill(); ctx.restore(); }
      ctx.beginPath(); path({ type: "Sphere" }); ctx.fillStyle = css("--sea"); ctx.fill();
      ctx.beginPath(); path(graticule); ctx.strokeStyle = css("--grat"); ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); path(world.land); ctx.fillStyle = css("--land"); ctx.fill();
      if (state.night) { const np = nightPaint(); ctx.fillStyle = np.color; ctx.globalAlpha = np.opacity; for (const c of night.circles) { ctx.beginPath(); path(c); ctx.fill(); } ctx.globalAlpha = 1; } /* above land, under the India borders */
      ctx.beginPath(); path(world.borders); ctx.strokeStyle = css("--landline"); ctx.lineWidth = 0.6; ctx.stroke();
      if (globe) { /* sphere shading: light from top left, darker limb */
        const g = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.45, r * 0.05, cx, cy, r);
        g.addColorStop(0, "rgba(255,255,255,.18)"); g.addColorStop(0.55, "rgba(255,255,255,0)"); g.addColorStop(1, "rgba(0,0,0,.20)");
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.fillStyle = g; ctx.fill();
      }
      placeMarks();
    },
    project: (lng, lat) => proj ? proj([lng, lat]) : null,
    center: () => [-rot[0], -rot[1]],
    zoomBy(f) {
      if (state.flat || !proj) return; // ponytail: flat canvas map has no zoom, same as its wheel
      k = Math.min(6, Math.max(1, k * f)); proj.scale(baseScale() * k); api.draw();
    },
    zoomIn(c, done) {
      if (state.flat || k >= 6) return false;
      api.flyTo(c, done, Math.min(6, k * 4));
      return true;
    },
    flyTo(c, done, kTo) {
      if (state.flat) return done();
      const r0 = rot.slice(), k0 = k, k1 = kTo || Math.max(k0, 2.4);
      const r1 = [r0[0] + ((((-c.lng - r0[0]) % 360) + 540) % 360 - 180), Math.max(-60, Math.min(60, -c.lat))];
      const ir = d3.interpolate(r0, r1), t0 = performance.now(), dur = reduce() ? 0 : 800;
      flying = true;
      const f = (t) => {
        if (dead) return;
        const u = dur ? Math.min(1, (t - t0) / dur) : 1, e = d3.easeCubicInOut(u);
        const rr = ir(e); rot[0] = rr[0]; rot[1] = rr[1]; k = k0 + (k1 - k0) * e;
        proj.rotate(rot).scale(baseScale() * k); api.draw();
        if (u < 1) requestAnimationFrame(f); else { flying = false; done(); }
      };
      requestAnimationFrame(f);
    },
    setStyle() { api.draw(); },
    setNight() { api.draw(); },
    setProjection() { k = 1; api.resize(); },
    spin(dt) { if (drag || flying || cardOpen() || !proj) return; rot[0] += dt * 0.004; /* d3 centers on -rot[0]: center longitude goes down, west to east */ proj.rotate(rot); api.draw(); },
    destroy() { dead = true; api.ready = false; canvas?.removeEventListener("wheel", onWheel); canvas?.remove(); },
  };
  return api;
}

/* ── MapLibre engine (OpenFreeMap tiles, tile borders removed, India POV borders on top) ── */
/* MapLibre 6 ships as an ES module; it loads its worker (maplibre-gl-worker.mjs) from the same folder */
let maplibregl = null;
const loadMapLibre = async () => (maplibregl ||= await import("/vendor/maplibre/maplibre-gl.mjs"));
function loadCss(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement("link"); l.rel = "stylesheet"; l.href = href; document.head.append(l);
}
function webglOk() {
  try { const c = document.createElement("canvas"); return !!c.getContext("webgl2"); /* MapLibre 6 needs WebGL2 */ } catch { return false; }
}
function mlEngine() {
  let map = null, el = null, borders = null, dead = false;
  const styleUrl = () => `https://tiles.openfreemap.org/styles/${state.style === "outdoors" ? "liberty" : isDark() ? "dark" : "positron"}`;
  /* Clutter: only water, land, relief, place labels and our borders survive */
  const DROP = new Set(["boundary", "transportation", "transportation_name", "poi", "building", "park", "aeroway", "aerodrome_label", "landuse", "mountain_peak"]);
  function sky() {
    try { map.setSky({ "sky-color": css("--space"), "horizon-color": "#4a9fd8", "fog-color": "#4a9fd8", "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 4, 1, 7, 0] }); } catch { /* no sky support */ }
  }
  function onStyle() {
    try { map.setProjection({ type: state.flat ? "mercator" : "globe" }); } catch { /* older style spec */ }
    /* India rule: drop every tile boundary and state line, then draw Natural Earth India POV borders on top */
    for (const l of map.getStyle().layers) {
      const sl = l["source-layer"];
      if (DROP.has(sl) || (sl === "landcover" && !/ice|glacier/.test(l.id)) || (l.type !== "symbol" && /state/.test(l.id))) map.removeLayer(l.id);
    }
    const dark = isDark(), vivid = state.style === "outdoors";
    for (const l of map.getStyle().layers) {
      if (vivid && l.type === "background") map.setPaintProperty(l.id, "background-color", dark ? "#24502f" : "#9cd08a");
      if (vivid && l.type === "fill" && l["source-layer"] === "water") map.setPaintProperty(l.id, "fill-color", dark ? "#0b3a5e" : "#4a9fd8");
      if (vivid && l.type === "raster") map.setPaintProperty(l.id, "raster-opacity", dark ? 0.35 : 0.5);
      if (l.type !== "symbol" || !l.layout?.["text-field"]) continue;
      map.setLayoutProperty(l.id, "text-field", ["coalesce", ["get", "name:en"], ["get", "name_en"], ["get", "name"]]);
      const max = l.maxzoom ?? 24;
      if (/country/.test(l.id)) { map.setLayoutProperty(l.id, "text-size", 11); map.setLayoutProperty(l.id, "symbol-spacing", 1000); map.setLayoutProperty(l.id, "text-optional", true); }
      else if (/state|water|sea|ocean|marine|region/.test(l.id)) map.setLayerZoomRange(l.id, Math.max(5, l.minzoom || 0), max);
      else map.setLayerZoomRange(l.id, Math.max(4, l.minzoom || 0), max);
    }
    addNight();
    if (!map.getSource("ind")) map.addSource("ind", { type: "geojson", data: borders });
    if (!map.getLayer("ind-borders")) map.addLayer({ id: "ind-borders", type: "line", source: "ind", paint: {
      "line-color": css("--indline"),
      "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.5, 4, 1.2],
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0.4, 4, 0.8],
    } });
    sky();
  }
  /* Night fills sit under the place labels and the India borders (added after them), above land and water */
  function addNight() {
    if (!map.getSource("night")) map.addSource("night", { type: "geojson", data: night.fc });
    const before = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
    NIGHT_R.forEach((_, i) => {
      if (!map.getLayer(`night-${i}`)) map.addLayer({ id: `night-${i}`, type: "fill", source: "night", filter: ["==", ["get", "i"], i],
        layout: { visibility: state.night ? "visible" : "none" }, paint: { "fill-color": nightPaint().color, "fill-opacity": nightPaint().opacity, "fill-antialias": false } }, before);
    });
  }
  const api = {
    name: "ml", horizonPad: 0.2, ready: false,
    zoom: () => map?.getZoom() ?? 0,
    input: () => map?.getCanvasContainer(),
    /* a new press ends any inertia or camera ease first, so the gesture handlers start from a clean state */
    halt: () => map?.isMoving() && map.stop(),
    async init() {
      if (!webglOk()) throw new Error("WebGL unavailable");
      loadCss("/vendor/maplibre/maplibre-gl.css");
      const [, b] = await Promise.all([loadMapLibre(), fetch("/data/borders-ind.json").then((r) => r.json())]);
      if (dead) throw new Error("cancelled");
      borders = b;
      el = document.createElement("div"); host.append(el);
      map = new maplibregl.Map({ container: el, style: styleUrl(), center: [78, 16], zoom: narrow() ? 1.4 : 2.3, attributionControl: false, renderWorldCopies: false });
      map.on("style.load", onStyle);
      map.on("move", placeMarks);
      map.on("error", () => { /* tile hiccups: the 8 s load timeout handles a dead style */ });
      await new Promise((ok) => map.once("load", ok));
      if (dead) throw new Error("cancelled");
      $("#gattr").hidden = false;
      api.ready = true;
      placeMarks();
    },
    resize() { map?.resize(); placeMarks(); },
    project(lng, lat) { const q = map.project([lng, lat]); return [q.x, q.y]; },
    center() { const c = map.getCenter(); return [c.lng, c.lat]; },
    flyTo(c, done) {
      map.flyTo({ center: [c.lng, c.lat], zoom: Math.max(map.getZoom(), 4), duration: reduce() ? 0 : 1200, essential: true });
      map.once("moveend", done);
    },
    zoomBy(f) { map.easeTo({ zoom: map.getZoom() + Math.log2(f), duration: reduce() ? 0 : 200 }); },
    zoomIn(c) {
      if (map.getZoom() >= 8) return false;
      map.flyTo({ center: [c.lng, c.lat], zoom: Math.min(8, map.getZoom() + 2), duration: reduce() ? 0 : 900, essential: true });
      return true;
    },
    setStyle() { map?.setStyle(styleUrl(), { diff: false }); },
    setNight() {
      if (!map?.getSource("night")) return;
      map.getSource("night").setData(night.fc);
      NIGHT_R.forEach((_, i) => map.setLayoutProperty(`night-${i}`, "visibility", state.night ? "visible" : "none"));
    },
    setProjection() { try { map.setProjection({ type: state.flat ? "mercator" : "globe" }); } catch { /* noop */ } sky(); placeMarks(); },
    /* setCenter is a jumpTo, and jumpTo calls stop(), which resets every gesture handler. The spin loop
       must never run while the user holds or wheels the map (see userBusy), or a pan or zoom dies. */
    spin(dt) {
      if (!map || state.flat || cardOpen() || !map.isStyleLoaded() || map.isMoving() || map.getZoom() >= 3) return;
      /* Earth turns west to east: land moves left to right, so the center longitude goes down */
      const c = map.getCenter(); map.setCenter([c.lng - dt * 0.004, c.lat]);
    },
    destroy() { dead = true; api.ready = false; try { map?.remove(); } catch { /* already gone */ } el?.remove(); $("#gattr").hidden = true; },
  };
  return api;
}

/* ── Engine switching with automatic fallback ── */
let engine = null;
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what} did not load within ${ms / 1000} s`)), ms))]);
async function startEngine(name) {
  engine?.destroy(); engine = null; host.replaceChildren();
  const e = name === "ml" ? mlEngine() : canvasEngine();
  try {
    await withTimeout(e.init(), 8000, name === "ml" ? "MapLibre" : "Map data");
    engine = e;
    syncTools();
  } catch (err) {
    e.destroy(); host.replaceChildren();
    if (name === "ml") {
      console.warn(`[globe] MapLibre unavailable (${err.message}), using the lightweight map`);
      $("#gLight").checked = true;
      return startEngine("canvas");
    }
    host.innerHTML = '<p class="gerr">The map could not load. Check the connection and reload.</p>';
    return;
  }
  placeMarks();
}

/* ── Summary panel (variant A): live count header, filter chips, top countries, sites ── */
/* name: the country, as alt and hover title where the flag stands in for the country text */
/* GA4 sends "(not set)" or "" when the country is unknown: neutral tile, "--", no /api/flag request.
   "(other)" is GA4's high-cardinality bucket: neutral tile too, but its own "Other" row. */
const knownCC = (cc) => /^[A-Z]{2}$/.test(cc || "");
const OTHER = "(other)";
const countryName = (cc, name) => cc === OTHER ? "Other" : knownCC(cc) && name && name !== "(not set)" ? name : "--";
const flagHtml = (cc, name = "") => knownCC(cc)
  ? `<img class="flag" alt="${esc(name)}"${name ? ` title="${esc(name)}"` : ""} src="/api/flag/${cc.toLowerCase()}">`
  : '<span class="flag" aria-hidden="true"></span>';
/* Filter chip: "All", or the chosen value cut to 14 characters with the full value as hover title.
   The <button> is the customizable-select face (Chrome 135+); other browsers drop it and show the plain select. */
const short = (s, n = 14) => (s = String(s ?? "")).length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
function chipHtml(f, key, label, items) {
  const cur = state.f[f], sel = items.find((x) => x.v === cur);
  const shown = sel ? sel.label : "All", priv = f === "site" ? " data-privacy" : "";
  return `<label class="chip${sel ? " set" : ""}"${sel ? ` title="${esc(shown)}"` : ""}><span class="k">${key}</span><select data-f="${f}" aria-label="${label}"${priv}><button type="button"><span class="cv">${esc(short(shown))}</span></button>${opt("", "All", cur)}${items.map((x) => opt(x.v, x.label, cur, x.icon || "")).join("")}</select></label>`;
}
const DEVICE = { mobile: "Mobile", desktop: "Desktop", tablet: "Tablet" };
/* Filters narrow the markers: a site filter shows that site's numbers per city, a device filter that device's users */
function viewCities(users) {
  const f = state.f;
  return users.filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng) && (!f.country || c.countryId === f.country)).map((c) => {
    if (f.site) {
      const s = (c.sites || []).find((x) => String(x.id) === f.site);
      if (!s) return null;
      c = { ...c, count: s.users, views: s.views, keyEvents: s.keyEvents, topPage: s.topPage || c.topPage, sites: [s] };
    }
    if (f.device) {
      const n = c.devices?.[f.device] || 0;
      if (!n) return null;
      c = { ...c, count: f.site ? Math.min(n, c.count) : n }; // ponytail: site x device split is not in the data, min() is an upper bound
    }
    return c;
  }).filter(Boolean);
}
const opt = (v, label, cur, icon = "") => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${icon}${esc(label)}</option>`;
function renderSummary() {
  const d = state.data || {};
  const sites = (d.properties || []).filter((p) => p.count > 0);
  const filtered = state.f.site || state.f.country || state.f.device;
  $("#gTotal").textContent = fmt(filtered ? state.cities.reduce((n, c) => n + c.count, 0) : d.totalActiveUsers);
  $("#gSub").textContent = filtered ? "active, filtered" : "active now";
  const countries = d.countries || [];
  /* not while a filter menu is open, a poll would close it */
  if (!$("#gChips").contains(document.activeElement)) $("#gChips").innerHTML =
    chipHtml("site", "Site", "Filter by site", sites.map((s) => ({ v: String(s.id), label: s.site, icon: favHtml(s) }))) +
    chipHtml("country", "Country", "Filter by country", countries.filter((c) => knownCC(c.id)).map((c) => ({ v: c.id, label: c.name }))) +
    chipHtml("device", "Device", "Filter by device", (d.devices || []).map((x) => String(x.name).toLowerCase()).filter((k) => DEVICE[k]).map((k) => ({ v: k, label: DEVICE[k] })));
  /* Top countries: GA4 totals when unfiltered, else summed from the filtered cities. Unknown countries share one "--" row, "(other)" has its own. */
  const m = new Map();
  const add = (id, name, n) => { const k = knownCC(id) || id === OTHER ? id : "--"; const r = m.get(k) || { id: k, name: countryName(id, name), n: 0 }; r.n += n; m.set(k, r); };
  if (filtered) for (const c of state.cities) add(c.countryId, c.country, c.count);
  else for (const c of countries) add(c.id, c.name, c.count);
  const top = [...m.values()].sort((a, b) => b.n - a.n);
  $("#gCountries").innerHTML = top.length ? `<span class="lbl">Top countries</span>${top.slice(0, 5).map((c) => `<div class="row">${flagHtml(c.id)}<span class="n">${esc(c.name)}</span><span class="v num">${fmt(c.n)}</span></div>`).join("")}` : "";
  $("#gSites").innerHTML = sites.length ? `<span class="lbl rh"><span>Sites</span>${d.keyEvents ? `<span class="key"><span class="num">${fmt(d.keyEvents)}</span> key events</span>` : ""}</span>${sites.slice(0, 5).map((s) => `<div class="row">${favHtml(s)}<span class="n" data-privacy>${esc(s.site)}</span><span class="v num">${fmt(s.count)}</span></div>`).join("")}` : "";
  renderRefresh();
}

/* ── Event feed ── */
const feedKey = (f) => `${f.city}|${f.countryId}|${f.site}|${f.page}|${f.event}`;
const VIEW_EVENTS = new Set(["page_view", "screen_view"]);
function feedLi(f, isNew) {
  const where = f.city === "(not set)" ? "an unknown city" : `<b>${esc(f.city)}</b>`;
  const page = `<em data-privacy>${esc(f.page)}</em>`;
  const times = f.count > 1 ? ` <span class="num">${f.count}</span> times` : "";
  const ev = f.isKey ? `<span class="key">${esc(f.event)}</span>` : esc(f.event);
  const what = VIEW_EVENTS.has(f.event)
    ? (f.count > 1 ? `Visitors in ${where} viewed ${page}${times}` : `Someone in ${where} viewed ${page}`)
    : (f.count > 1 ? `${ev} in ${where} on ${page}${times}` : `Someone in ${where}: ${ev} on ${page}`);
  const key = f.isKey && VIEW_EVENTS.has(f.event) ? ' <span class="key">with key event</span>' : "";
  return `<li class="${isNew ? "new" : ""}"><span class="av">${avHtml(f.city)}</span><span>${what}${key} <span class="t" data-privacy>${esc(f.site)}</span></span><span class="t num">${f.minutesAgo ? `${f.minutesAgo} min` : "now"}</span></li>`;
}
function renderFeed() {
  const rows = (state.data?.feed || []).filter((f) => !state.filter || f.city === state.filter);
  feedHead.innerHTML = `<b>Live events</b><span>${state.filter ? `<span>${esc(state.filter)}</span> only, <button type="button" data-t="clear">show all</button>` : "Press M to hide"}</span>`;
  feedList.innerHTML = rows.map((f) => feedLi(f, state.newKeys.has(feedKey(f)))).join("")
    || `<li class="empty">${state.data ? "No events in the last 30 min." : "Loading events"}</li>`;
}

/* ── City card and group list (variant A): renderCityCard()/renderList() and the ".gcity" CSS block in globe.hbs
   are the whole design, swap them together. Both render synchronously from the live feed already in memory;
   only images (flag, favicons) load after first paint, over a --surface-3 placeholder. ── */
/* Local time and day or night for a city: "<sun|moon> 9:42 PM local · Day"; compact (stack list) is icon + time.
   No tz from the server: no time, Day or Night still comes from the sun altitude at the city. */
const tfmts = new Map();
function localTime(tz, d) {
  if (!tz) return "";
  try {
    if (!tfmts.has(tz)) tfmts.set(tz, new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }));
    return tfmts.get(tz).format(d);
  } catch { return ""; } /* unknown zone name */
}
function dnHtml(lat, lng, tz, compact = false) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
  const d = new Date(), nt = Sun.isNight(lat, lng, d), t = localTime(tz, d), word = nt ? "Night" : "Day";
  const ic = `<svg viewBox="0 0 24 24" class="${nt ? "nt" : "dy"}" role="img" aria-label="${word}">${ICON[nt ? "moon" : "sun"]}</svg>`;
  const txt = compact ? (t ? `<span class="num">${t}</span>` : "") : `${t ? `<span class="num">${t}</span> local · ` : ""}${word}`;
  return `<span class="dn" data-lat="${lat}" data-lng="${lng}" data-tz="${esc(tz || "")}"${compact ? " data-compact" : ""}${compact ? ` title="${t ? `${t} local, ` : ""}${word}"` : ""}>${ic}${txt}</span>`;
}
/* every 60 s: move the night shade and the card times */
function tickNight() {
  night = nightShapes();
  if (engine?.ready) engine.setNight();
  card.querySelectorAll(".dn").forEach((el) => { el.outerHTML = dnHtml(Number(el.dataset.lat), Number(el.dataset.lng), el.dataset.tz, el.hasAttribute("data-compact")); });
}
setInterval(tickNight, 60000);

const closeBtn = () => `<button type="button" class="ib x" data-t="close" aria-label="Close">${svg("x")}</button>`;
/* g (stack card only): { title, ids } adds a "N cities near X" title and the member city list */
function renderCityCard(c, g = null) {
  const dv = c.devices || {};
  const sites = c.sites || [];
  const more = sites.length > 3 ? `<span class="more num">+${sites.length - 3}</span>` : "";
  const foot = [["Mobile", dv.mobile], ["Desktop", dv.desktop], ["Tablet", dv.tablet]].filter(([, n]) => n > 0).map(([l, n]) => `${l} <span class="num">${fmt(n)}</span>`);
  if (c.lastSeen != null) foot.push(`Last seen ${c.lastSeen ? `<span class="num">${c.lastSeen}</span> min ago` : "now"}`);
  return `<div class="gcity">
  <div class="ch">${flagHtml(c.countryId, c.country)}<div class="ct"><b>${g ? g.title : esc(c.city)}</b>${g ? "" : dnHtml(c.lat, c.lng, c.tz)}</div><div class="stack" aria-label="${sites.length} ${sites.length === 1 ? "site" : "sites"}">${sites.slice(0, 3).map(favHtml).join("")}${more}</div></div>
  <div class="cb">
    <div class="kv"><div><small>Active</small><b class="num">${fmt(c.count)}</b></div><div><small>Views</small><b class="num">${fmt(c.views)}</b></div><div><small>Key events</small><b class="num">${fmt(c.keyEvents)}</b></div></div>
    ${c.topPage ? `<div class="tp"><small>Top page</small><div class="page" data-privacy title="${esc(c.topPage)}">${esc(c.topPage)}</div></div>` : ""}
    ${sites.length ? `<div class="tw"><table class="tbl"><thead><tr><th>Site</th><th>Users</th><th>Views</th></tr></thead><tbody>${sites.map((x) => `<tr><td><span class="site">${favHtml(x)}<span data-privacy title="${esc(x.topPage || "")}">${esc(x.name)}</span></span></td><td class="num">${fmt(x.users)}</td><td class="num">${fmt(x.views)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    ${g ? `<ul class="glist" aria-label="Cities in this stack">${g.ids.map((i) => { const x = state.cities[i]; return `<li><button type="button" data-i="${i}">${flagHtml(x.countryId, countryName(x.countryId, x.country))}<span class="ct"><b>${esc(x.city)}</b></span>${dnHtml(x.lat, x.lng, x.tz, true)}<span class="num">${fmt(x.count)}</span></button></li>`; }).join("")}</ul>` : ""}
    ${foot.length ? `<div class="foot">${foot.join(" · ")}</div>` : ""}
  </div>
  </div>`;
}
/* Stack card: the members summed into one city-shaped object (sites merged by id), largest city first */
function groupCity(ids) {
  const cs = ids.map((i) => state.cities[i]), lead = cs[0], sites = new Map();
  const sum = (k) => cs.reduce((n, c) => n + (Number(c[k]) || 0), 0);
  const dev = (k) => cs.reduce((n, c) => n + (Number(c.devices?.[k]) || 0), 0);
  for (const c of cs) for (const s of c.sites || []) {
    const r = sites.get(String(s.id)) || { ...s, users: 0, views: 0, keyEvents: 0, top: -1 };
    r.users += s.users || 0; r.views += s.views || 0; r.keyEvents += s.keyEvents || 0;
    if ((s.users || 0) > r.top) { r.top = s.users || 0; r.topPage = s.topPage; } /* hover title: the page from the city with most users */
    sites.set(String(s.id), r);
  }
  const seen = cs.map((c) => c.lastSeen).filter((v) => v != null);
  return {
    city: lead.city, countryId: lead.countryId, country: lead.country,
    count: sum("count"), views: sum("views"), keyEvents: sum("keyEvents"),
    devices: { mobile: dev("mobile"), desktop: dev("desktop"), tablet: dev("tablet") },
    sites: [...sites.values()].sort((a, b) => b.users - a.users),
    lastSeen: seen.length ? Math.min(...seen) : null, topPage: null,
  };
}
function showCard(html, label) {
  card.innerHTML = closeBtn() + html;
  card.setAttribute("aria-label", label);
  card.hidden = false;
  positionCard();
}
/* Card sits next to the selected avatar (right, left, below, above), clear of the panel, feed and zoom, inside the stage.
   Phone: bottom sheet above the events header. */
function positionCard() {
  const S = stage.getBoundingClientRect(), cs = card.style;
  if (matchMedia("(max-width: 860px)").matches) {
    const f = feedBox.hidden ? null : feedBox.getBoundingClientRect();
    const bottom = f ? Math.max(0, S.bottom - f.top) : 0;
    Object.assign(cs, { left: "0px", right: "0px", top: "auto", bottom: bottom + "px", maxHeight: Math.max(160, S.height - bottom - 56) + "px" });
    return;
  }
  cs.right = cs.bottom = "auto"; cs.maxHeight = S.height - 24 + "px";
  const m = marks.querySelector(".mk.sel")?.getBoundingClientRect(), w = card.offsetWidth, h = card.offsetHeight, gap = 12;
  const avoid = [$(".gsum"), feedBox, $(".gzoom")].filter((el) => el && !el.hidden && el.offsetParent).map((el) => el.getBoundingClientRect());
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const fit = (x, y) => [clamp(x, S.left + 8, S.right - w - 8), clamp(y, S.top + 8, S.bottom - h - 8)];
  const hits = ([x, y]) => avoid.some((r) => x < r.right && x + w > r.left && y < r.bottom && y + h > r.top);
  const a = m || { left: S.left + S.width / 2, right: S.left + S.width / 2, top: S.top + S.height / 2, bottom: S.top + S.height / 2, width: 0, height: 0 };
  const mx = a.left + a.width / 2, my = a.top + a.height / 2;
  const tries = [[a.right + gap, my - h / 2], [a.left - gap - w, my - h / 2], [mx - w / 2, a.bottom + gap], [mx - w / 2, a.top - gap - h]].map(([x, y]) => fit(x, y));
  /* ponytail: 4 slots then a stage scan in 24px steps; enough for one card */
  let pos = tries.find((t) => !hits(t));
  for (let y = S.top + 8; !pos && y < S.bottom - h; y += 24) for (let x = S.left + 8; !pos && x < S.right - w; x += 24) if (!hits([x, y])) pos = [x, y];
  pos ||= tries[0];
  cs.left = pos[0] - S.left + "px"; cs.top = pos[1] - S.top + "px";
}
function renderCard() {
  const c = state.cities[state.sel];
  if (!c) return closeCard();
  showCard(renderCityCard(c), `${c.city} details`);
}
function renderList() {
  const ids = state.list.map((k) => keyIdx.get(k)).filter((i) => i != null && state.cities[i]).sort((a, b) => state.cities[b].count - state.cities[a].count);
  if (!ids.length) return closeCard();
  if (ids.length === 1) { state.list = null; state.sel = ids[0]; state.filter = state.cities[ids[0]].city; renderMarks(); renderFeed(); return renderCard(); }
  const lead = state.cities[ids[0]];
  const title = `<span class="num">${ids.length}</span> cities near ${esc(lead.city)}`;
  showCard(renderCityCard(groupCity(ids), { title, ids }), `${ids.length} cities near ${lead.city}`);
}
/* Group: one card with the summed numbers and its cities, no auto zoom (zoom by hand to split the stack) */
function openGroup(ids) {
  const keys = ids.map((i) => state.cities[i] && cityKey(state.cities[i])).filter(Boolean);
  if (!keys.length) return;
  state.sel = null; state.filter = null; state.list = keys;
  renderMarks(); renderList(); renderFeed();
}
/* Card paints in the click handler (bottom-right column, above the feed); the camera move runs after */
function openCity(i) {
  const c = state.cities[i];
  if (!c || !engine) return;
  state.list = null; state.sel = i; state.filter = c.city;
  renderMarks(); renderCard(); renderFeed();
  engine.flyTo(c, () => {});
}
function closeCard() {
  const had = state.filter, open = cardOpen();
  state.sel = null; state.list = null; state.filter = null; card.hidden = true;
  if (open) renderMarks();
  if (had) renderFeed();
}

/* ── Data + quota-aware refresh ── */
let nextAt = Date.now(), polling = false, lastError = false;
const interval = () => (state.refresh === "auto" ? (state.data?.refresh?.autoSec || 60) : Number(state.refresh));
function applyData(j) {
  const selKey = state.sel != null && state.cities[state.sel] ? cityKey(state.cities[state.sel]) : null;
  const first = !state.data;
  state.data = j;
  state.cities = viewCities(j.users || []);
  const keys = new Set((j.feed || []).map(feedKey));
  state.newKeys = first ? new Set() : new Set([...keys].filter((k) => !state.feedKeys.has(k)));
  state.feedKeys = keys;
  const idx = selKey ? state.cities.findIndex((c) => cityKey(c) === selKey) : -1;
  if (selKey && idx < 0) { state.sel = null; state.filter = null; card.hidden = true; } else if (idx >= 0) state.sel = idx;
  renderSummary(); renderMarks(); renderFeed();
  if (state.sel != null) renderCard(); else if (state.list) renderList();
}
async function poll(maxAge) {
  if (polling) return;
  polling = true;
  try {
    const r = await fetch(`/api/globe-users?maxAge=${maxAge}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.statusText);
    lastError = false;
    applyData(j);
  } catch (err) {
    lastError = true;
    console.warn("[globe] refresh failed:", err.message);
    if (!state.data) $("#gSub").textContent = "Live data could not load. Retrying.";
  } finally {
    polling = false;
    nextAt = Date.now() + interval() * 1000;
    renderRefresh();
  }
}
function renderRefresh() {
  const rf = state.data?.refresh;
  const sel = $("#rfSel");
  sel.value = state.refresh;
  sel.options[0].textContent = rf ? `Auto (${rf.autoSec} s)` : "Auto";
  const cap = $("#rfCap");
  if (rf?.throttled) cap.innerHTML = '<span class="warn">GA4 hourly quota is low: data refreshes every 5 min.</span>';
  else if (state.refresh === "auto") cap.innerHTML = rf ? `Set from your GA4 quota: <span class="num">${fmt(rf.usedThisHour)}</span> of <span class="num">${fmt(rf.perHour)}</span> tokens used this hour (busiest site).` : "Set from your GA4 quota once the first refresh lands.";
  else cap.textContent = "Fixed by you. Slows to 5 min if hourly quota runs low.";
  tickCountdown();
}
function tickCountdown() {
  const el = $("#rfNext");
  const s = Math.max(0, Math.ceil((nextAt - Date.now()) / 1000));
  const at = state.data?.fetchedAt ? Math.round((Date.now() - new Date(state.data.fetchedAt).getTime()) / 1000) : null;
  el.textContent = polling ? "updating" : `${at != null ? `data ${at} s old, ` : ""}${lastError ? "retry" : "next"} in ${s} s`;
}
setInterval(() => {
  if (!polling && !document.hidden && Date.now() >= nextAt) poll(interval());
  tickCountdown();
}, 1000);

/* ── Controls ── */
function syncTools() {
  const proj = stage.querySelector('[data-t="proj"]');
  const projLabel = state.flat ? "Switch to 3D globe" : "Switch to 2D map";
  proj.innerHTML = svg(state.flat ? "globe" : "map"); proj.setAttribute("aria-label", projLabel);
  proj.setAttribute("aria-pressed", String(state.flat));
  const st = stage.querySelector('[data-t="style"]');
  st.setAttribute("aria-pressed", String(state.style === "outdoors"));
  st.setAttribute("aria-label", state.style === "outdoors" ? "Map style: Outdoors (switch to Minimal)" : "Map style: Minimal (switch to Outdoors)");
  const av = stage.querySelector('[data-t="avatar"]'), sitesMode = state.avatar === "sites";
  av.innerHTML = svg(sitesMode ? "sites" : "user"); av.setAttribute("aria-pressed", String(sitesMode));
  av.setAttribute("aria-label", sitesMode ? "Avatars: Sites (switch to People)" : "Avatars: People (switch to Sites)");
  stage.querySelector('[data-t="feed"]').setAttribute("aria-pressed", String(state.feed));
  const pb = stage.querySelector('[data-t="panel"]'), min = state.panel === "min", pl = min ? "Expand panel" : "Collapse panel";
  stage.querySelectorAll(".zb").forEach((b) => { b.disabled = engine?.name === "canvas" && state.flat; });
  $(".gsum").toggleAttribute("data-min", min); pb.setAttribute("aria-expanded", String(!min)); pb.setAttribute("aria-label", pl);
  feedBox.hidden = !state.feed;
  stage.dataset.av = state.avatar;
  $("#gNote").textContent = state.avatar === "sites" ? "Icon = top site in a city. Stack = nearby cities, click to open." : "Avatar = city. Stack = nearby cities, click to open.";
  $("#gLight").checked = state.engine === "canvas" || engine?.name === "canvas";
  $("#gNight").checked = state.night;
  /* Dark space backdrop for the vivid looks (MapLibre globe or Outdoors) */
  if ((engine?.name !== "canvas" && !state.flat) || state.style === "outdoors") root.dataset.gspace = "dark"; else delete root.dataset.gspace;
}
const restyle = () => engine?.ready && engine.setStyle();
new MutationObserver(restyle).observe(root, { attributes: true, attributeFilter: ["data-theme"] });

stage.addEventListener("click", (e) => {
  const mk = e.target.closest(".mk");
  if (mk) { if (e.detail && dragged(e)) return; /* detail 0: keyboard */ const ids = mk.dataset.m.split(" ").map(Number); if (ids.length > 1) openGroup(ids); else openCity(ids[0]); return; }
  const pick = e.target.closest(".gcard [data-i]");
  if (pick) { openCity(Number(pick.dataset.i)); return; }
  const t = e.target.closest("[data-t]")?.dataset.t;
  if (!t) return;
  if (t === "close" || t === "clear") closeCard();
  else if (t === "proj") {
    closeCard(); state.flat = !state.flat; save("globe.proj", state.flat ? "2d" : "3d");
    syncTools(); engine?.ready && engine.setProjection();
  } else if (t === "style") {
    state.style = state.style === "outdoors" ? "minimal" : "outdoors"; root.dataset.map = state.style; save("globe.style", state.style);
    restyle(); syncTools();
  } else if (t === "theme") {
    const nav = document.getElementById("themeToggle");
    if (nav) nav.click(); else root.dataset.theme = isDark() ? "light" : "dark";
  } else if (t === "feed") { state.feed = !state.feed; syncTools(); }
  else if (t === "refresh") poll(0);
  else if (t === "rfpop") toggleRf();
  else if (t === "avatar") { state.avatar = state.avatar === "sites" ? "people" : "sites"; save("globe.avatar", state.avatar); syncTools(); renderMarks(); showTip(e.target.closest(".ib")); }
  else if (t === "panel") { state.panel = state.panel === "min" ? "open" : "min"; save("globe.panel", state.panel); if (state.panel === "min") toggleRf(false); syncTools(); }
  else if (t === "zin" || t === "zout") engine?.ready && engine.zoomBy(t === "zin" ? 2 : 0.5);
  else if (t === "full") {
    if (document.fullscreenElement) document.exitFullscreen?.(); else stage.requestFullscreen?.().catch(() => {});
  }
});
$("#gChips").addEventListener("change", (e) => {
  const k = e.target.dataset.f;
  if (!k || !state.data) return;
  state.f[k] = e.target.value;
  closeCard();
  state.cities = viewCities(state.data.users || []);
  renderSummary(); renderMarks();
});
$("#rfSel").addEventListener("change", (e) => {
  state.refresh = e.target.value; save("globe.refresh", state.refresh);
  nextAt = Date.now() + interval() * 1000; renderRefresh();
});
/* Refresh popover: opens under the strip button, closes on outside click or Escape */
const rfPop = $("#grf"), rfBtn = stage.querySelector('[data-t="rfpop"]');
function toggleRf(open = rfPop.hidden) {
  rfPop.hidden = !open; rfBtn.setAttribute("aria-expanded", String(open)); rfBtn.setAttribute("aria-pressed", String(open));
  if (!open) return;
  hideTip();
  const S = stage.getBoundingClientRect(), r = rfBtn.getBoundingClientRect();
  rfPop.style.left = `${Math.max(12, Math.min(r.left - S.left, S.width - rfPop.offsetWidth - 12))}px`;
  rfPop.style.top = `${r.bottom - S.top + 6}px`;
}
document.addEventListener("pointerdown", (e) => { if (!rfPop.hidden && !rfPop.contains(e.target) && !rfBtn.contains(e.target)) toggleRf(false); });
/* Hover label for the panel icon buttons, from aria-label, kept inside the stage */
const tip = $("#gtip");
function showTip(b) {
  if (!b || !matchMedia("(hover: hover)").matches || (b === rfBtn && !rfPop.hidden)) return hideTip();
  tip.textContent = b.getAttribute("aria-label"); tip.hidden = false;
  const S = stage.getBoundingClientRect(), r = b.getBoundingClientRect(), w = tip.offsetWidth;
  tip.style.left = `${Math.max(8, Math.min(r.left - S.left + r.width / 2 - w / 2, S.width - w - 8))}px`;
  tip.style.top = `${r.bottom - S.top + 6}px`;
}
function hideTip() { tip.hidden = true; }
const tipBtn = (e) => e.target.closest?.(".gsum .ib");
stage.addEventListener("pointerover", (e) => { const b = tipBtn(e); if (b) showTip(b); });
stage.addEventListener("pointerout", (e) => { if (tipBtn(e) && !tipBtn(e).contains(e.relatedTarget)) hideTip(); });
stage.addEventListener("focusin", (e) => { const b = tipBtn(e); if (b?.matches(":focus-visible")) showTip(b); });
stage.addEventListener("focusout", hideTip);
$("#gNight").addEventListener("change", (e) => {
  state.night = e.target.checked; save("globe.night", state.night ? "on" : "off");
  if (engine?.ready) engine.setNight();
});
$("#gLight").addEventListener("change", (e) => {
  state.engine = e.target.checked ? "canvas" : "ml"; save("globe.engine", state.engine);
  closeCard(); startEngine(state.engine);
});
document.addEventListener("keydown", (e) => {
  if (e.target.closest?.("input, select, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "m" || e.key === "M") { state.feed = !state.feed; syncTools(); }
  if (e.key === "Escape") { if (!rfPop.hidden) { toggleRf(false); rfBtn.focus(); } else closeCard(); }
});
let rz;
const onResize = () => { clearTimeout(rz); rz = setTimeout(() => { engine?.ready && engine.resize(); }, 120); };
addEventListener("resize", onResize);
document.addEventListener("fullscreenchange", onResize);

/* Auto-spin: one rAF loop, each engine decides when it may turn.
   It pauses while any pointer is down and for 3 s after the last press, wheel or touch. */
const down = new Set();
let idleAt = 0;
const poke = () => { idleAt = performance.now() + 3000; };
stage.addEventListener("pointerdown", (e) => { down.add(e.pointerId); poke(); if (host.contains(e.target) || marks.contains(e.target)) engine?.halt?.(); }, true);
for (const t of ["pointerup", "pointercancel"]) addEventListener(t, (e) => { down.delete(e.pointerId); poke(); }, true);
stage.addEventListener("wheel", poke, { capture: true, passive: true });
stage.addEventListener("touchstart", poke, { capture: true, passive: true });
const userBusy = () => down.size > 0 || performance.now() < idleAt;
let last = performance.now();
function spin(t) {
  const dt = Math.min(64, t - last); last = t;
  /* hold still under the pointer so a marker does not slide away mid-click */
  if (engine?.ready && !reduce() && !document.hidden && !userBusy() && !marks.querySelector(".mk:hover")) engine.spin(dt);
  requestAnimationFrame(spin);
}

Object.defineProperty(window, "__globeEngine", { get: () => engine }); /* read-only hook for browser tests */
syncTools();
renderFeed();
startEngine(state.engine).then(() => requestAnimationFrame(spin));
poll(interval());
})();
