import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePrivacy } from "../privacy/Privacy";
import { useTheme } from "next-themes";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronUp,
  Expand,
  EyeOff,
  Globe as GlobeIcon,
  Grid2X2,
  Leaf,
  List,
  Map as MapIcon,
  Minus,
  Moon,
  Plus,
  RefreshCw,
  Sun,
  UserRound,
  X,
} from "lucide-react";
import {
  get,
  Choice,
  Button,
  StatBand,
  Card,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Tabs,
  TabsList,
  TabsTrigger,
  fmt,
} from "./shared";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../rybbit/src/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../../rybbit/src/components/ui/dialog";
import { AppSidebar } from "../../rybbit/src/components/AppSidebar";
import { GlobeMap, type City, type MapHandle } from "../globe/Map";
import { Avatar } from "../globe/Avatar";
import { useExtracted } from "../extracted";
import { DataFreshness } from "../overview/ReportFreshness";
import "../globe/globe.css";

const globeQueryKey = ["ga4", "/api/globe-users"] as const;

const read = (key: string, fallback: string) => {
  try {
    return localStorage.getItem(`globe.${key}`) || fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(`globe.${key}`, value);
  } catch {}
};
function Tool({
  label,
  active,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string; active?: boolean }) {
  return (
    <Button
      size="smIcon"
      variant={active ? "secondary" : "ghost"}
      title={label}
      aria-label={label}
      aria-pressed={active}
      {...props}
    >
      {children}
    </Button>
  );
}
function Flag({ code }: { code: string }) {
  const [broken, setBroken] = useState(false);
  return /^[A-Z]{2}$/i.test(code) && !broken ? (
    <img
      className="globe-flag"
      src={`/api/flag/${code.toLowerCase()}`}
      alt=""
      onError={() => setBroken(true)}
    />
  ) : (
    <span className="globe-flag" aria-hidden="true" />
  );
}

export default function Globe() {
  const t = useExtracted();
  const { resolvedTheme, setTheme } = useTheme();
  const [refresh, setRefresh] = useState(() => read("refresh", "auto"));
  const [flat, setFlat] = useState(() => read("proj", "3d") === "2d");
  const [style, setStyle] = useState(() => read("style", "minimal"));
  const [night, setNight] = useState(() => read("night", "on") !== "off");
  const [lightweight, setLightweight] = useState(
    () => read("engine", "ml") === "canvas"
  );
  const [spin, setSpin] = useState(false);
  const [privacy, setPrivacy] = usePrivacy();
  const [faces, setFaces] = useState(
    () => read("avatar", "people") === "sites"
  );
  const [feed, setFeed] = useState(true);
  const [panel, setPanel] = useState(
    () =>
      !matchMedia("(max-width: 860px)").matches &&
      read("panel", "open") !== "min"
  );
  const [engine, setEngine] = useState("Loading map");
  const [summaries, setSummaries] = useState(false);
  const [tab, setTab] = useState("cities");
  const [site, setSite] = useState(
    () => new URLSearchParams(location.search).get("prop") || "all"
  );
  const [country, setCountry] = useState("all");
  const [device, setDevice] = useState("all");
  const [selection, setSelection] = useState<{
    cities: City[];
    x: number;
    y: number;
  } | null>(null);
  const [interval, setIntervalMs] = useState(() => {
    const seconds = Number(refresh);
    return Number.isFinite(seconds) && seconds > 0
      ? Math.min(300, Math.max(30, seconds)) * 1000
      : 60000;
  });
  const stage = useRef<HTMLDivElement>(null);
  const cityCard = useRef<HTMLElement>(null);
  const selectedTrigger = useRef<HTMLElement | null>(null);
  const handle = useRef<MapHandle | null>(null);
  const queryClient = useQueryClient();
  const forceRefresh = useRef(false);
  const query = useQuery<any, Error>({
    queryKey: globeQueryKey,
    queryFn: () => {
      const maxAge = forceRefresh.current ? 0 : interval / 1000;
      forceRefresh.current = false;
      return get(`/api/globe-users?maxAge=${maxAge}`);
    },
    refetchInterval: refresh === "off" ? false : interval,
    staleTime: interval,
  });
  const d = query.data;
  const autoSec = d?.refresh?.autoSec || 60;
  useEffect(() => {
    const sec = refresh === "auto" ? autoSec : Number(refresh);
    if (refresh !== "off")
      setIntervalMs(
        Math.min(300, Math.max(30, Number.isFinite(sec) ? sec : autoSec)) * 1000
      );
  }, [refresh, autoSec]);
  function refreshNow() {
    if (!queryClient.isFetching({ queryKey: globeQueryKey, exact: true }))
      forceRefresh.current = true;
    return query.refetch({ cancelRefetch: false });
  }
  useEffect(() => {
    const settings = {
      refresh,
      proj: flat ? "2d" : "3d",
      style,
      night: night ? "on" : "off",
      engine: lightweight ? "canvas" : "ml",
      avatar: faces ? "sites" : "people",
      panel: panel ? "open" : "min",
    };
    Object.entries(settings).forEach(([key, value]) => write(key, value));
  }, [refresh, flat, style, night, lightweight, faces, panel]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        e.repeat ||
        (e.target as HTMLElement).closest(
          "input,select,textarea,[contenteditable=true],[role=dialog],[role=combobox]"
        )
      )
        return;
      if (e.key.toLowerCase() === "m") setFeed((v) => !v);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!selection) return;
    cityCard.current?.focus({ preventScroll: true });
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        setSelection(null);
        selectedTrigger.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [selection]);
  useEffect(() => setSelection(null), [site, country, device]);
  useLayoutEffect(() => {
    if (!selection || !stage.current || !cityCard.current) return;
    const place = () => {
      const host = stage.current!,
        card = cityCard.current!;
      if (matchMedia("(max-width: 860px)").matches) return; // Mobile uses a bottom sheet.
      const origin = host.getBoundingClientRect();
      const width = card.offsetWidth,
        height = card.offsetHeight;
      const obstacles = [
        ...host.querySelectorAll(".globe-summary,.globe-bottom-right"),
      ].map((el) => {
        const r = el.getBoundingClientRect();
        return {
          left: r.left - origin.left,
          top: r.top - origin.top,
          right: r.right - origin.left,
          bottom: r.bottom - origin.top,
        };
      });
      const xs = [
        selection.x,
        selection.x - width - 48,
        344,
        host.clientWidth - width - 12,
        12,
      ];
      const ys = [
        selection.y,
        12,
        host.clientHeight - height - 12,
        ...obstacles.map((r) => r.top - height - 12),
      ];
      const candidates = xs.flatMap((x) =>
        ys.map((y) => ({
          x: Math.max(12, Math.min(x, host.clientWidth - width - 12)),
          y: Math.max(12, Math.min(y, host.clientHeight - height - 12)),
        }))
      );
      const score = ({ x, y }: { x: number; y: number }) =>
        obstacles.reduce(
          (n, r) =>
            n +
            Math.max(
              0,
              Math.min(x + width + 8, r.right) - Math.max(x - 8, r.left)
            ) *
              Math.max(
                0,
                Math.min(y + height + 8, r.bottom) - Math.max(y - 8, r.top)
              ),
          0
        ) *
          1000 +
        Math.hypot(x - selection.x, y - selection.y);
      const best = candidates.sort((a, b) => score(a) - score(b))[0];
      card.style.left = `${best.x}px`;
      card.style.top = `${best.y}px`;
    };
    const observer = new ResizeObserver(place);
    observer.observe(stage.current);
    observer.observe(cityCard.current);
    place();
    return () => observer.disconnect();
  }, [selection, panel, feed]);

  const users = (d?.users || []) as City[];
  const props = d?.properties || [];
  // City site rows carry only id and name; the property list has the domain.
  const domainOf = (id: string) => props.find((p: any) => String(p.id) === String(id))?.domain || "";
  const withDomains = (rows: any[]) => rows?.map((s) => ({ ...s, domain: domainOf(s.id) }));
  // Site/device intersections aren't reported by GA4; retain the whole matching city aggregate.
  const cities = users
    .filter(
      (c) =>
        (site === "all" || c.sites?.some((s) => String(s.id) === site)) &&
        (country === "all" || c.countryId === country) &&
        (device === "all" || (c.devices?.[device] || 0) > 0)
    )
    .map((c) => {
      if (site === "all") return { ...c, sites: withDomains(c.sites) };
      const s = c.sites.find((s) => String(s.id) === site)!;
      return {
        ...c,
        count: s.users,
        views: s.views,
        keyEvents: s.keyEvents,
        topPage: s.topPage,
        topSite: s.name,
        sites: withDomains([s]),
      };
    });
  const filtered = site !== "all" || country !== "all" || device !== "all";
  const active = filtered
    ? cities.reduce((n, c) => n + c.count, 0)
    : d?.totalActiveUsers;
  const feedRows = (d?.feed || []).filter(
    (r: any) =>
      (site === "all" ||
        String(r.prop || r.propertyId) === site ||
        props.find((p: any) => String(p.id) === site)?.site === r.site) &&
      (country === "all" || r.countryId === country)
  );
  const countryTotals = new Map<
    string,
    { id: string; name: string; count: number }
  >();
  if (filtered)
    cities.forEach((c) => {
      const row = countryTotals.get(c.countryId) || {
        id: c.countryId,
        name: c.country,
        count: 0,
      };
      row.count += c.count;
      countryTotals.set(c.countryId, row);
    });
  const countries = filtered
    ? [...countryTotals.values()].sort((a, b) => b.count - a.count)
    : d?.countries || [];
  const selected =
    selection?.cities.length === 1
      ? cities.find(
          (c) =>
            c.countryId === selection.cities[0].countryId &&
            c.city === selection.cities[0].city
        ) || selection.cities[0]
      : null;
  const cityActivity = selected
    ? [
        selected.devices?.mobile > 0
          ? t("Mobile {count}", { count: fmt(selected.devices.mobile) })
          : null,
        selected.devices?.desktop > 0
          ? t("Desktop {count}", { count: fmt(selected.devices.desktop) })
          : null,
        selected.devices?.tablet > 0
          ? t("Tablet {count}", { count: fmt(selected.devices.tablet) })
          : null,
        selected.lastSeen == null
          ? null
          : selected.lastSeen === 0
            ? t("Last seen now")
            : t("Last seen {minutes} min ago", { minutes: selected.lastSeen }),
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  const privateClass = privacy ? "globe-private" : "";
  function selectCities(list: City[], point?: { x: number; y: number }) {
    selectedTrigger.current = document.activeElement as HTMLElement;
    const width = stage.current?.clientWidth || innerWidth;
    const height = stage.current?.clientHeight || innerHeight;
    const x = point?.x || width / 2;
    let left = x + 44;
    if (left + 300 > width - 12) left = x - 344;
    if (panel && left < 344 && width > 860) left = 344;
    let top = Math.max(
      12,
      Math.min((point?.y || height / 2) - 80, height - 410)
    );
    if (feed && left + 300 > width - 444 && top + 380 > height - 232)
      top = Math.max(12, height - 632);
    setSelection({
      cities: list,
      x: Math.max(12, Math.min(left, width - 312)),
      y: top,
    });
  }
  const closeCard = () => {
    setSelection(null);
    selectedTrigger.current?.focus({ preventScroll: true });
  };

  return (
    <div className={`globe-page ${privacy ? "globe-privacy" : ""}`}>
      <div className="globe-sidebars">
        <AppSidebar />
      </div>
      <main ref={stage} className="globe-stage" aria-label="Live visitor map">
        <GlobeMap
          cities={cities}
          flat={flat}
          style={style}
          night={night}
          spin={spin && !selection}
          privacy={privacy}
          faces={faces}
          lightweight={lightweight}
          onSelect={selectCities}
          handle={handle}
          onEngine={setEngine}
        />
        <Card className="globe-summary globe-overlay" aria-label="Live summary">
          <div className="globe-summary-header">
            <span className="globe-live-dot" aria-hidden="true" />
            <strong className="globe-total">{fmt(active)}</strong>
            <span className="globe-muted globe-active-label">
              {query.isPending
                ? "Loading live visitors"
                : query.isError && !d
                ? "Data unavailable"
                : filtered
                ? "active, filtered"
                : "active now"}
            </span>
            <Tool
              label={panel ? "Collapse panel" : "Expand panel"}
              aria-expanded={panel}
              aria-controls="globe-summary-body"
              onClick={() => setPanel(!panel)}
            >
              {panel ? <ChevronUp /> : <ChevronDown />}
            </Tool>
          </div>
          <DataFreshness status={d ? { fetchedAt: d.fetchedAt, cacheStatus: typeof d.cached === "boolean" ? d.cached ? "cached" : "fresh" : "unknown" } : null} updating={query.isFetching} className="justify-start px-3 pb-2" />
          {panel && (
            <div id="globe-summary-body">
              <div className="globe-summary-body">
                <div
                  className="globe-tools"
                  role="toolbar"
                  aria-label="Map controls"
                >
                  <Tool
                    label={flat ? "Switch to 3D globe" : "Switch to 2D map"}
                    active={flat}
                    onClick={() => setFlat(!flat)}
                  >
                    {flat ? <GlobeIcon /> : <MapIcon />}
                  </Tool>
                  <Tool
                    label={`Map style: ${
                      style === "minimal"
                        ? "Minimal (switch to Outdoors)"
                        : "Outdoors (switch to Minimal)"
                    }`}
                    active={style === "outdoors"}
                    onClick={() =>
                      setStyle(style === "minimal" ? "outdoors" : "minimal")
                    }
                  >
                    <Leaf />
                  </Tool>
                  <Tool
                    label="Light or dark map"
                    onClick={() =>
                      setTheme(resolvedTheme === "dark" ? "light" : "dark")
                    }
                  >
                    {resolvedTheme === "dark" ? <Moon /> : <Sun />}
                  </Tool>
                  <span className="globe-tool-separator" />
                  <Tool
                    label={
                      faces
                        ? "Avatars: Sites (switch to People)"
                        : "Avatars: People (switch to Sites)"
                    }
                    active={faces}
                    onClick={() => setFaces(!faces)}
                  >
                    {faces ? <Grid2X2 /> : <UserRound />}
                  </Tool>
                  <Tool
                    label="Event feed (M)"
                    active={feed}
                    onClick={() => setFeed(!feed)}
                  >
                    <List />
                  </Tool>
                  <Tool
                    label="Hide names and domains (P)"
                    active={privacy}
                    onClick={() => setPrivacy(!privacy)}
                  >
                    <EyeOff />
                  </Tool>
                  <span className="globe-tool-separator" />
                  <Popover>
                    <PopoverTrigger asChild>
                      <Tool label="Refresh">
                        <RefreshCw />
                      </Tool>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-72 space-y-3 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <strong>Refresh</strong>
                        <Button
                          size="xs"
                          loading={query.isFetching}
                          onClick={refreshNow}
                        >
                          {t("Fetch latest data from GA4")}
                        </Button>
                      </div>
                      <Choice
                        label="Refresh interval"
                        value={refresh}
                        onChange={setRefresh}
                        options={[
                          { value: "auto", label: `Auto · ${autoSec}s` },
                          { value: "30", label: "30 seconds" },
                          { value: "60", label: "1 minute" },
                          { value: "120", label: "2 minutes" },
                          { value: "300", label: "5 minutes" },
                          { value: "off", label: "Paused" },
                        ]}
                      />
                      <p className="globe-muted">
                        Automatic refresh follows the GA4 quota budget.
                      </p>
                      <p className="globe-muted">
                        {fmt(d?.refresh?.usedThisHour)} /{" "}
                        {fmt(d?.refresh?.perHour)} tokens this hour ·{" "}
                        {fmt(d?.refresh?.tokensPerPoll)} per poll
                        {d?.refresh?.throttled ? " · Quota limited" : ""}
                      </p>
                      {(
                        [
                          ["Day and night shade", night, setNight],
                          ["Lightweight map", lightweight, setLightweight],
                          ["Rotate globe", spin, setSpin],
                        ] as [string, boolean, (v: boolean) => void][]
                      ).map(([label, checked, change]) => (
                        <label
                          key={label}
                          className="flex cursor-pointer items-center gap-2"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => change(e.target.checked)}
                          />
                          {label}
                        </label>
                      ))}
                    </PopoverContent>
                  </Popover>
                  <Tool
                    label="Fullscreen map"
                    onClick={() => {
                      const action = document.fullscreenElement
                        ? document.exitFullscreen()
                        : document.documentElement.requestFullscreen();
                      action.catch(() => {});
                    }}
                  >
                    <Expand />
                  </Tool>
                </div>
                <div className="globe-filters">
                  <Filter
                    label="Site"
                    value={site}
                    onChange={setSite}
                    options={props.map((p: any) => ({
                      value: String(p.id),
                      label: p.name || p.site || p.id,
                    }))}
                    privateClass={privateClass}
                  />
                  <Filter
                    label="Country"
                    value={country}
                    onChange={setCountry}
                    options={(d?.countries || []).map((c: any) => ({
                      value: c.id,
                      label: c.name,
                    }))}
                  />
                  <Filter
                    label="Device"
                    value={device}
                    onChange={setDevice}
                    options={(d?.devices || []).map((c: any) => ({
                      value: c.name.toLowerCase(),
                      label: c.name,
                    }))}
                  />
                </div>
                {query.isError && (
                  <p
                    role="alert"
                    className="text-xs text-red-600 dark:text-red-400"
                  >
                    {d ? "Showing the last successful report. " : ""}
                    {query.error.message}{" "}
                    <button
                      className="underline"
                      onClick={() => query.refetch()}
                    >
                      Retry
                    </button>
                  </p>
                )}
                {device !== "all" && (
                  <p className="globe-muted text-xs">
                    Counts include all users in matching cities. Device and site
                    intersections are unavailable; the event feed is grouped
                    separately.
                  </p>
                )}
                <SummaryRows title="Top countries">
                  {countries.slice(0, 5).map((c: any) => (
                    <div className="globe-summary-row" key={c.id}>
                      <Flag code={c.id} />
                      <span>{c.name === "(not set)" ? "Unknown" : c.name}</span>
                      <span className="globe-row-count">{fmt(c.count)}</span>
                    </div>
                  ))}
                </SummaryRows>
                <SummaryRows
                  title={
                    <>
                      <span>Sites</span>
                      {!!d?.keyEvents && (
                        <span className="text-emerald-700 dark:text-emerald-400">
                          {fmt(d.keyEvents)} key events
                        </span>
                      )}
                    </>
                  }
                >
                  {props
                    .filter((p: any) => p.count > 0)
                    .slice(0, 5)
                    .map((p: any) => (
                      <div className="globe-summary-row" key={p.id}>
                        <Avatar
                          city={p.site}
                          site={p}
                          className={privateClass}
                        />
                        <Link
                          href={`/analytics?prop=${p.id}`}
                          className={privateClass}
                        >
                          {p.site}
                        </Link>
                        <span className="globe-row-count">{fmt(p.count)}</span>
                      </div>
                    ))}
                </SummaryRows>
                {!query.isPending && !query.isError && !cities.length && (
                  <p className="globe-muted text-xs">
                    No live cities in this filter.
                  </p>
                )}
              </div>
              <div className="globe-summary-footer">
                <p>
                  {faces ? "Icon = top site in a city." : "Avatar = city."}{" "}
                  Stack = nearby cities, click to open.
                </p>
                <Button
                  variant="link"
                  size="xs"
                  onClick={() => setSummaries(true)}
                >
                  All summaries
                </Button>
              </div>
            </div>
          )}
        </Card>
        <div className="globe-attribution" role="status">
          {engine === "Loading map" ? (
            "Loading map…"
          ) : engine === "Map unavailable" ? (
            "Map unavailable. Check the connection and reload."
          ) : engine.startsWith("MapLibre") ? (
            <>
              <a
                href="https://openfreemap.org"
                target="_blank"
                rel="noreferrer"
              >
                © OpenFreeMap
              </a>{" "}
              <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noreferrer"
              >
                © OpenStreetMap
              </a>
            </>
          ) : (
            "Lightweight map · Natural Earth"
          )}
        </div>
        <div className="globe-bottom-right">
          <div className="globe-zoom" role="group" aria-label="Zoom">
            <Button
              size="smIcon"
              aria-label="Zoom in"
              title="Zoom in"
              onClick={() => handle.current?.zoom(1)}
            >
              <Plus />
            </Button>
            <Button
              size="smIcon"
              aria-label="Zoom out"
              title="Zoom out"
              onClick={() => handle.current?.zoom(-1)}
            >
              <Minus />
            </Button>
          </div>
          {feed && (
            <Card className="globe-feed globe-overlay" aria-label="Live events">
              <div className="globe-feed-header">
                <strong>Live events</strong>
                <button
                  className="globe-muted"
                  onClick={() => setFeed(false)}
                  title="Hide event feed"
                >
                  Press M to hide
                </button>
              </div>
              <ul aria-live="polite" aria-relevant="additions text">
                {feedRows.slice(0, 100).map((r: any, i: number) => (
                  <li
                    key={`${r.site}|${r.city}|${r.page}|${r.minutesAgo}|${i}`}
                  >
                    <Avatar city={r.city} className={privateClass} />
                    <div className={privateClass}>
                      Visitors in <b>{r.city}</b>{" "}
                      {r.event === "page_view" ? "viewed" : r.event} {r.page}{" "}
                      {fmt(r.count)} {r.count === 1 ? "time" : "times"}
                      <small>
                        {r.site}
                        {r.isKey && (
                          <span className="text-emerald-700 dark:text-emerald-400">
                            {" "}
                            · Key event
                          </span>
                        )}
                      </small>
                    </div>
                    <time>
                      {r.minutesAgo === 0 ? "now" : `${r.minutesAgo}m ago`}
                    </time>
                  </li>
                ))}
                {!feedRows.length && (
                  <li className="globe-feed-empty">
                    {query.isPending
                      ? "Loading activity…"
                      : "No activity in this filter."}
                  </li>
                )}
              </ul>
            </Card>
          )}
        </div>
        {selection && (
          <section
            ref={cityCard}
            tabIndex={-1}
            role="dialog"
            aria-modal="false"
            aria-labelledby="globe-city-title"
            className="globe-city-card globe-overlay"
            style={{ left: selection.x, top: selection.y }}
          >
            <Tool
              className="globe-city-close"
              label="Close city details"
              onClick={closeCard}
            >
              <X />
            </Tool>
            <div className="globe-city-heading">
              <Flag code={selection.cities[0].countryId} />
              <div>
                <h2 id="globe-city-title" className={privateClass}>
                  {selected
                    ? selected.city
                    : `${selection.cities.length} nearby cities`}
                </h2>
                <p className="globe-muted">
                  {selected ? (
                    <span className={privateClass}>
                      {selected.country}
                      {selected.tz &&
                        ` · ${new Date().toLocaleTimeString([], {
                          timeZone: selected.tz,
                          hour: "2-digit",
                          minute: "2-digit",
                        })}`}
                    </span>
                  ) : (
                    "Choose a city to see its live activity"
                  )}
                </p>
              </div>
            </div>
            {selected ? (
              <div className="globe-city-body">
                <StatBand
                  columns={3}
                  cells={[
                    { label: "Active users", value: fmt(selected.count) },
                    { label: "Pageviews", value: fmt(selected.views) },
                    { label: "Key events", value: fmt(selected.keyEvents) },
                  ]}
                />
                <div>
                  <small className="globe-muted">Top page</small>
                  <p
                    className={`truncate ${privateClass}`}
                    title={privacy ? undefined : selected.topPage}
                  >
                    {selected.topPage || "No page reported"}
                  </p>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Site</TableHead>
                      <TableHead>Users</TableHead>
                      <TableHead>Views</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selected.sites?.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>
                          <Link
                            href={`/analytics?prop=${s.id}`}
                            className={`globe-city-site ${privateClass}`}
                          >
                            <Avatar city={s.name} site={s} />
                            {s.name}
                          </Link>
                          <p
                            className={`globe-muted max-w-36 truncate text-xs ${privateClass}`}
                          >
                            {s.topPage}
                          </p>
                        </TableCell>
                        <TableCell>{fmt(s.users)}</TableCell>
                        <TableCell>{fmt(s.views)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {cityActivity && (
                  <p className="globe-muted text-xs tabular-nums">
                    {cityActivity}
                  </p>
                )}
              </div>
            ) : (
              <ul className="globe-city-list">
                {selection.cities.map((c) => (
                  <li key={c.countryId + c.city}>
                    <button
                      onClick={() => {
                        handle.current?.fly(c);
                        setSelection({ ...selection, cities: [c] });
                      }}
                    >
                      <Avatar
                        city={c.city}
                        site={faces ? c.sites?.[0] : undefined}
                      />
                      <span className={privateClass}>{c.city}</span>
                      <span className="globe-muted">{fmt(c.count)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </main>
      <Dialog open={summaries} onOpenChange={setSummaries}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Live summaries</DialogTitle>
            <DialogDescription>
              City aggregates from the last 30 minutes, including locations
              behind the globe. Device and platform totals are reported
              separately across all properties.
            </DialogDescription>
          </DialogHeader>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              {["cities", "countries", "devices", "platforms"].map((t) => (
                <TabsTrigger value={t} key={t}>
                  {t[0].toUpperCase() + t.slice(1)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="max-h-[60dvh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tab === "cities" ? "City" : "Name"}</TableHead>
                  <TableHead>Active users</TableHead>
                  {tab === "cities" && (
                    <>
                      <TableHead>Views</TableHead>
                      <TableHead>Top site / page</TableHead>
                    </>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {tab === "cities"
                  ? cities.map((c) => (
                      <TableRow key={c.countryId + c.city}>
                        <TableCell>
                          <button
                            className={privateClass}
                            onClick={() => {
                              setSummaries(false);
                              handle.current?.fly(c);
                              selectCities([c]);
                            }}
                          >
                            {c.city}, {c.country}
                          </button>
                        </TableCell>
                        <TableCell>{fmt(c.count)}</TableCell>
                        <TableCell>{fmt(c.views)}</TableCell>
                        <TableCell className={`text-xs ${privateClass}`}>
                          {c.topSite} · {c.topPage}
                        </TableCell>
                      </TableRow>
                    ))
                  : (d?.[tab] || []).map((r: any) => (
                      <TableRow key={r.id || r.name}>
                        <TableCell>{r.name}</TableCell>
                        <TableCell>{fmt(r.count)}</TableCell>
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
function Filter({
  label,
  value,
  onChange,
  options,
  privateClass = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  privateClass?: string;
}) {
  return (
    <div
      className={`globe-filter ${
        value !== "all" ? "globe-filter-set" : ""
      } ${privateClass}`}
    >
      <span>{label}</span>
      <Choice
        label={`Filter by ${label.toLowerCase()}`}
        value={value}
        onChange={onChange}
        options={[{ value: "all", label: "All" }, ...options]}
      />
    </div>
  );
}
function SummaryRows({
  title,
  children,
}: {
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="globe-summary-rows">
      <div className="globe-summary-label">{title}</div>
      {children}
    </div>
  );
}
