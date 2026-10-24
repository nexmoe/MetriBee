import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import * as d3 from "d3";
import { sun } from "./solar";
import { Avatar } from "./Avatar";
import { groupMarkers, type Cluster, type Point } from "./cluster";
// Map renderer adapted from GA4 Dashboard's globe.js. Controls and panels use Rybbit.
// All country borders use the repository's approved India POV data.
const DROP = new Set([
  "boundary",
  "transportation",
  "transportation_name",
  "poi",
  "building",
  "park",
  "aeroway",
  "aerodrome_label",
  "landuse",
  "mountain_peak",
]);
export type City = {
  city: string;
  country: string;
  countryId: string;
  lat: number;
  lng: number;
  tz?: string;
  count: number;
  views: number;
  keyEvents: number;
  device: string;
  devices: Record<string, number>;
  lastSeen?: number | null;
  topSite: string;
  prop: string;
  topPage: string;
  sites: any[];
};
export type MapHandle = { zoom: (d: number) => void; fly: (c: City) => void };
export function GlobeMap({
  cities,
  flat,
  style,
  night,
  spin,
  privacy,
  faces,
  onSelect,
  handle,
  onEngine,
  lightweight,
}: {
  cities: City[];
  flat: boolean;
  style: string;
  night: boolean;
  spin: boolean;
  privacy: boolean;
  faces: boolean;
  onSelect: (cities: City[], point: { x: number; y: number }) => void;
  handle: React.MutableRefObject<MapHandle | null>;
  onEngine: (s: string) => void;
  lightweight: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const refs = useRef({ cities, onSelect, flat, night, spin });
  refs.current = { cities, onSelect, flat, night, spin };
  const [positions, setPositions] = useState<Cluster[]>([]);
  useEffect(() => {
    let dead = false;
    let cleanup = () => {};
    let animation = 0;
    let tick = 0;
    let placedAt = 0;
    let groups: Cluster[] = [];
    const el = host.current!;
    const dark = resolvedTheme === "dark";
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let project: (c: City) => [number, number] | null = () => null;
    const place = () => {
      if (dead) return;
      // Markers only need 30 fps; grouping retains nearby cities rather than dropping them.
      const now = performance.now();
      if (now - placedAt < 32) return;
      placedAt = now;
      const w = el.clientWidth,
        h = el.clientHeight;
      const out: Point[] = [];
      for (const c of [...refs.current.cities].sort(
        (a, b) => b.count - a.count
      )) {
        const p = project(c);
        if (!p || p[0] < 0 || p[1] < 0 || p[0] > w || p[1] > h) continue;
        out.push({
          city: c,
          x: p[0],
          y: p[1],
          count: c.count,
          i: c.countryId + "||" + c.city,
        });
      }
      groups = groupMarkers(out, groups);
      setPositions(groups);
    };
    async function canvasFallback() {
      onEngine("Lightweight map");
      el.replaceChildren();
      const canvas = document.createElement("canvas");
      canvas.style.cssText =
        "width:100%;height:100%;cursor:grab;touch-action:none";
      el.append(canvas);
      const ctx = canvas.getContext("2d")!;
      const world = await fetch("/countries.json").then((r) => r.json());
      if (dead) return;
      // D3 uses clockwise exterior rings on the sphere.
      for (const f of world.features) {
        const polygons =
          f.geometry.type === "Polygon"
            ? [f.geometry.coordinates]
            : f.geometry.type === "MultiPolygon"
            ? f.geometry.coordinates
            : [];
        for (const rings of polygons) {
          if (d3.geoArea({ type: "Polygon", coordinates: rings }) > 2 * Math.PI)
            for (const ring of rings) ring.reverse();
        }
      }
      let rot: [number, number] = [-78, -16],
        k = 1,
        w = 0,
        h = 0,
        proj: d3.GeoProjection;
      let dragging = false;
      const draw = () => {
        if (dead || !proj) return;
        ctx.clearRect(0, 0, w, h);
        const path = d3.geoPath(proj, ctx);
        ctx.beginPath();
        path({ type: "Sphere" });
        ctx.fillStyle = dark ? "#0f0f13" : "#e4e5ec";
        ctx.fill();
        ctx.beginPath();
        path(world);
        ctx.fillStyle =
          style === "outdoors"
            ? dark
              ? "#264b3a"
              : "#c8dfc4"
            : dark
            ? "#1d1d23"
            : "#ffffff";
        ctx.fill();
        ctx.strokeStyle = dark ? "#647077" : "#b4c1c4";
        ctx.lineWidth = 0.5;
        ctx.stroke();
        if (refs.current.night) {
          const solar = sun(new Date());
          ctx.beginPath();
          path(
            d3
              .geoCircle()
              .center([solar.lng + 180, -solar.lat])
              .radius(90)()
          );
          ctx.fillStyle = dark ? "rgba(0,0,6,.65)" : "rgba(30,32,64,.28)";
          ctx.fill();
        }
        place();
      };
      const resize = () => {
        w = el.clientWidth;
        h = el.clientHeight;
        canvas.width = w * devicePixelRatio;
        canvas.height = h * devicePixelRatio;
        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        proj = flat
          ? d3.geoEquirectangular().fitExtent(
              [
                [8, 8],
                [w - 8, h - 8],
              ],
              { type: "Sphere" }
            )
          : d3
              .geoOrthographic()
              .clipAngle(90)
              .rotate(rot)
              .translate([w / 2, h / 2])
              .scale(Math.min(w, h) * 0.46 * k);
        draw();
      };
      project = (c) =>
        !flat &&
        d3.geoDistance([c.lng, c.lat], [-rot[0], -rot[1]]) > Math.PI / 2
          ? null
          : proj([c.lng, c.lat]);
      d3.select(canvas).call(
        d3
          .drag<HTMLCanvasElement, unknown>()
          .on("start", () => {
            dragging = true;
          })
          .on("drag", (e) => {
            if (flat) return;
            rot = [
              rot[0] + e.dx * 0.3,
              Math.max(-89, Math.min(89, rot[1] - e.dy * 0.3)),
            ];
            proj.rotate(rot);
            draw();
          })
          .on("end", () => {
            dragging = false;
          })
      );
      const wheel = (e: WheelEvent) => {
        if (flat) return;
        e.preventDefault();
        k = Math.max(1, Math.min(6, k * Math.exp(-e.deltaY * 0.0015)));
        resize();
      };
      canvas.addEventListener("wheel", wheel, { passive: false });
      handle.current = {
        zoom: (d) => {
          k = Math.max(1, Math.min(6, k * 2 ** d));
          resize();
        },
        fly: (c) => {
          rot = [-c.lng, -c.lat];
          k = 2.4;
          resize();
        },
      };
      const observer = new ResizeObserver(resize);
      observer.observe(el);
      resize();
      const frame = (t: number) => {
        if (dead) return;
        const dt = t - tick;
        tick = t;
        if (refs.current.spin && !refs.current.flat && !reduce && !dragging) {
          rot[0] += Math.min(dt, 40) * 0.004;
          proj.rotate(rot);
          draw();
        } else place();
        animation = requestAnimationFrame(frame);
      };
      animation = requestAnimationFrame(frame);
      cleanup = () => {
        observer.disconnect();
        canvas.removeEventListener("wheel", wheel);
        canvas.remove();
      };
    }
    async function start() {
      let map: any = null;
      try {
        if (lightweight) {
          await canvasFallback();
          return;
        }
        const test = document.createElement("canvas");
        if (!test.getContext("webgl2")) throw new Error("WebGL unavailable");
        if (
          !document.querySelector(
            'link[href="/vendor/maplibre/maplibre-gl.css"]'
          )
        ) {
          const css = document.createElement("link");
          css.rel = "stylesheet";
          css.href = "/vendor/maplibre/maplibre-gl.css";
          document.head.append(css);
        }
        const path = "/vendor/maplibre/maplibre-gl.mjs";
        const [gl, borders] = await Promise.all([
          import(/* @vite-ignore */ path),
          fetch("/data/borders-ind.json").then((r) => r.json()),
        ]);
        if (dead) return;
        map = new gl.Map({
          container: el,
          style: `https://tiles.openfreemap.org/styles/${
            style === "outdoors" ? "liberty" : dark ? "dark" : "positron"
          }`,
          center: [78, 16],
          zoom: el.clientWidth < 700 ? 1.4 : 2.3,
          attributionControl: false,
          renderWorldCopies: false,
        });
        cleanup = () => map.remove();
        map.on("style.load", () => {
          if (dead) return;
          map.setProjection({ type: flat ? "mercator" : "globe" });
          for (const l of map.getStyle().layers) {
            const sl = l["source-layer"];
            if (
              DROP.has(sl) ||
              (sl === "landcover" && !/ice|glacier/.test(l.id)) ||
              (l.type !== "symbol" && /state/.test(l.id))
            )
              map.removeLayer(l.id);
          }
          for (const l of map.getStyle().layers) {
            if (l.type === "symbol" && l.layout?.["text-field"]) {
              map.setLayoutProperty(l.id, "text-field", [
                "coalesce",
                ["get", "name:en"],
                ["get", "name_en"],
                ["get", "name"],
              ]);
              if (/country/.test(l.id)) {
                map.setLayoutProperty(l.id, "text-size", 11);
                map.setLayoutProperty(l.id, "symbol-spacing", 1000);
              } else
                map.setLayerZoomRange(
                  l.id,
                  Math.max(
                    /state|water|sea|ocean|marine|region/.test(l.id) ? 5 : 4,
                    l.minzoom || 0
                  ),
                  l.maxzoom ?? 24
                );
            }
            if (style === "outdoors" && l.type === "background")
              map.setPaintProperty(
                l.id,
                "background-color",
                dark ? "#24502f" : "#9cd08a"
              );
            if (
              style === "outdoors" &&
              l.type === "fill" &&
              l["source-layer"] === "water"
            )
              map.setPaintProperty(
                l.id,
                "fill-color",
                dark ? "#0b3a5e" : "#4a9fd8"
              );
          }
          map.setSky({
            "sky-color": "#05070d",
            "horizon-color": "#4a9fd8",
            "fog-color": "#4a9fd8",
            "atmosphere-blend": [
              "interpolate",
              ["linear"],
              ["zoom"],
              0,
              1,
              4,
              1,
              7,
              0,
            ],
          });
          map.addSource("ind", { type: "geojson", data: borders });
          map.addLayer({
            id: "ind-borders",
            source: "ind",
            type: "line",
            paint: {
              "line-color": dark ? "#71818d" : "#8a999d",
              "line-width": 0.6,
            },
          });
          if (night) {
            const solar = sun(new Date());
            const circle = d3
              .geoCircle()
              .center([solar.lng + 180, -solar.lat])
              .radius(89)
              .precision(3)();
            const projection = d3
              .geoEquirectangular()
              .scale(180 / Math.PI)
              .translate([0, 0])
              .precision(0);
            const rings: number[][][] = [];
            let ring: number[][] = [];
            d3.geoPath(projection, {
              beginPath() {},
              moveTo(x: number, y: number) {
                ring = [[x, -y]];
                rings.push(ring);
              },
              lineTo(x: number, y: number) {
                ring.push([x, -y]);
              },
              closePath() {
                ring.push(ring[0]);
              },
              arc() {},
            })(circle);
            map.addSource("night", {
              type: "geojson",
              data: {
                type: "FeatureCollection",
                features: rings
                  .filter((r) => r.length > 3)
                  .map((r) => ({
                    type: "Feature",
                    properties: {},
                    geometry: { type: "Polygon", coordinates: [r] },
                  })),
              },
            });
            map.addLayer(
              {
                id: "night",
                type: "fill",
                source: "night",
                paint: { "fill-color": "#081020", "fill-opacity": 0.18 },
              },
              "ind-borders"
            );
          }
        });
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Map tiles unavailable")),
            12000
          );
          map.once("load", () => {
            clearTimeout(timer);
            resolve();
          });
        });
        if (dead) return;
        onEngine("MapLibre · OpenFreeMap");
        project = (c) => {
          const center = map.getCenter();
          if (
            !flat &&
            d3.geoDistance([c.lng, c.lat], [center.lng, center.lat]) >
              Math.PI / 2
          )
            return null;
          const p = map.project([c.lng, c.lat]);
          return [p.x, p.y];
        };
        handle.current = {
          zoom: (d) =>
            map.easeTo({ zoom: map.getZoom() + d, duration: reduce ? 0 : 200 }),
          fly: (c) =>
            map.flyTo({
              center: [c.lng, c.lat],
              zoom: Math.max(map.getZoom(), 4),
              duration: reduce ? 0 : 800,
            }),
        };
        const observer = new ResizeObserver(() => map.resize());
        observer.observe(el);
        cleanup = () => {
          observer.disconnect();
          map.remove();
        };
        map.on("move", place);
        const frame = (t: number) => {
          if (dead) return;
          const dt = t - tick;
          tick = t;
          if (refs.current.spin && !flat && !reduce && !map.isMoving()) {
            const c = map.getCenter();
            map.jumpTo({ center: [c.lng - Math.min(dt, 40) * 0.004, c.lat] });
          }
          place();
          animation = requestAnimationFrame(frame);
        };
        animation = requestAnimationFrame(frame);
      } catch {
        if (dead) return;
        map?.remove();
        await canvasFallback();
      }
    }
    start().catch(() => onEngine("Map unavailable"));
    return () => {
      dead = true;
      cancelAnimationFrame(animation);
      cleanup();
      handle.current = null;
    };
  }, [flat, style, night, resolvedTheme, lightweight]);
  return (
    <div className="relative h-full w-full">
      <div
        ref={host}
        className="absolute inset-0"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
        }}
      />
      <div ref={layer} className="absolute inset-0 pointer-events-none">
        {positions.map(({ items, count, x, y }) => (
          <button
            type="button"
            key={items
              .map((p) => p.i)
              .sort()
              .join("|")}
            className={"globe-marker " + (privacy ? "blur-sm" : "")}
            style={{
              left: x,
              top: y,
              width: 48 + (Math.min(items.length, 3) - 1) * 11,
            }}
            onClick={() =>
              onSelect(
                items.map((p) => p.city),
                { x, y }
              )
            }
            aria-label={`${
              privacy ? "City" : items.map((p) => p.city.city).join(", ")
            }: ${count} active users`}
            title={`${
              privacy ? "City" : items.map((p) => p.city.city).join(", ")
            } · ${count} active users`}
          >
            {items
              .slice(0, 3)
              .reverse()
              .map(({ city: c }, i, shown) => (
                <span
                  className="globe-marker-face"
                  style={{ left: (shown.length - 1 - i) * 11 }}
                  key={c.countryId + c.city}
                >
                  <Avatar
                    city={c.city}
                    site={faces ? c.sites?.[0] : undefined}
                  />
                </span>
              ))}
          </button>
        ))}
      </div>
    </div>
  );
}
