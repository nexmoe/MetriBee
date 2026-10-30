const fs = require("fs/promises");
const path = require("path");
const { getCityCoords } = require("./cityCoords");
const {
    getAnalyticsCardConfig,
    getAnalyticsCardCacheKey,
    getAnalyticsCatalog,
    getDateRange,
    getPreviousDateRange,
    attachPrev,
} = require("./analyticsRecipes");
const { runSafeHistoricalReport, runSafeRealtimeReport, getGA4DataClient, getGA4AdminClient } = require("./ga4Service");
const demo = require("./demoData");
const { stripSensitiveGlobeUsersPayload } = require("./privacy");
const { buildGlobeUsersPayload, refreshInfo } = require("./globeUsers");
const { favicon } = require("./favicons");
const flags = require("./flags");
const { letterTile } = require("../public/js/letterTile");
const { withPropertyAccounts, matchesPropertySet } = require("../public/js/homeAccounts");
const { cacheGet, cacheSet, cacheCleanup, shouldBypass } = require("./reportCache");

/** ?fresh=1 skips the cache read (the result is still cached), at most once per minute per key. */
function wantFresh(req, namespace, key) {
    return req.query.fresh === "1" && shouldBypass(`${namespace}:${key}`);
}
const { analyticsUrl, websiteUrl } = require("./propertyActions");
const { runExtraCard } = require("./reportExtras");

const CACHE_DIR = demo.cacheDir(path.join(__dirname, "..", ".cache"));
const PROPERTIES_CACHE_PATH = path.join(CACHE_DIR, "properties.json");

/** Names/account metadata refresh independently of analytics report caches. */
const PROPERTIES_TTL_MS = 5 * 60 * 1000;

/** Latest property quota snapshot – updated on every realtime batch fetch */
let latestQuota = null;
const propertyCurrencyMemCache = new Map();

/** In-memory realtime cache – prevents re-fetching on every page reload */
const REALTIME_MEM_TTL = 2 * 60 * 1000; // 2 minutes
let realtimeMemCache = null;   // { data, quota, fetchDurationMs, cachedAt }
let realtimeMemCachedAt = 0;
/** Disk copy of the realtime cache, so a quick restart reuses it instead of a new 43-property batch. */
const REALTIME_DISK_PATH = path.join(CACHE_DIR, "realtime_all.json");
const REALTIME_RESTART_REUSE_MS = 60 * 1000;
let realtimeInFlight = null;

function realtimeTtl(entry) {
    const failed = entry?.data?.filter(row => row.error).length || 0;
    return failed ? (failed === entry.data.length ? 10_000 : 30_000) : REALTIME_MEM_TTL;
}

const connectionErrors = new Set(["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "EPIPE"]);
function realtimeErrorMessage(error) {
    if (connectionErrors.has(error.code)) return "Could not connect to GA4. The connection was interrupted; please try again.";
    if (error.code === 7) return "Access to this GA4 property was denied. Check its Viewer permissions.";
    return error.details || error.message || "GA4 realtime data is temporarily unavailable.";
}

function setRealtimeMem(entry, properties) {
    entry = { ...entry, propertyIds: properties.map(p => String(p.id)).sort() };
    realtimeMemCache = entry;
    realtimeMemCachedAt = Date.now();
    // Keep failures briefly in memory to prevent request storms, never as a successful disk snapshot.
    if (!entry.data.length || entry.data.some(row => !row.error)) {
        const snapshot = JSON.stringify({ at: realtimeMemCachedAt, entry });
        fs.mkdir(CACHE_DIR, { recursive: true })
            .then(() => fs.writeFile(REALTIME_DISK_PATH, snapshot))
            .catch(() => {}); // advisory: a failed write only costs one batch on the next restart
    }
    return { entry, fetchedAt: realtimeMemCachedAt };
}

async function refreshRealtime(properties) {
    const key = properties.map(property => String(property.id)).sort().join(",");
    if (realtimeInFlight?.key === key) return realtimeInFlight.promise;
    const pending = { key, promise: null };
    pending.promise = (async () => {
        const start = Date.now();
        const result = await batchRealtimeReport({ properties });
        return setRealtimeMem({ ...result, fetchDurationMs: Date.now() - start }, properties);
    })();
    realtimeInFlight = pending;
    try { return await pending.promise; }
    finally { if (realtimeInFlight === pending) realtimeInFlight = null; }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractDomain(url) {
    try {
        const u = new URL(url);
        return u.hostname.replace(/^www\./, "");
    } catch {
        return null;
    }
}

function isCacheStale(cache) {
    if (!cache || !cache.lastUpdated) return true;
    // Upgrade property caches written before account grouping was introduced.
    if (cache.properties?.some(p => !p.accountId || !p.accountName)) return true;
    const ageMs = Date.now() - new Date(cache.lastUpdated).getTime();
    return !Number.isFinite(ageMs) || ageMs >= PROPERTIES_TTL_MS;
}

// ---------------------------------------------------------------------------
// Cache IO
// ---------------------------------------------------------------------------

/**
 * Reads the cache file.
 * Supports both old format (plain array) and new format ({ properties, lastUpdated }).
 */
async function getCachedProperties() {
    try {
        const raw = await fs.readFile(PROPERTIES_CACHE_PATH, "utf8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            // Migrate old format – treat as stale so it will refresh
            return { properties: parsed, lastUpdated: null };
        }
        return parsed; // { properties: [...], lastUpdated: ISO }
    } catch {
        return null;
    }
}
// Read-only metadata access for cache-only MCP portfolio reports; never schedules Google work.
exports.readCachedProperties = async () => { const result = await getCachedProperties(); return result ? { ...result, properties: require('../lib/requestContext').filterProperties(result.properties || []) } : result; };

async function savePropertiesToCache(properties) {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(
        PROPERTIES_CACHE_PATH,
        JSON.stringify(
            { properties, lastUpdated: new Date().toISOString() },
            null,
            2,
        ),
    );
}

// ---------------------------------------------------------------------------
// GA4 Admin – list properties + domains
// ---------------------------------------------------------------------------

async function getAnalyticsProperties() {
    const analyticsAdmin = getAnalyticsAdminClient();

    const [accounts] = await analyticsAdmin.listAccounts();
    if (!accounts || accounts.length === 0) throw new Error("No accounts found");

    let allProperties = [];

    for (const account of accounts) {
        let properties = [];
        try {
            [properties] = await analyticsAdmin.listProperties({
                filter: `parent:${account.name}`,
            });
        } catch (err) {
            console.warn(
                `[admin] Could not list properties for account ${account.name}: ${err.message}`,
            );
            continue;
        }

        const formatted = properties
            .filter((p) => p && p.name)
            .map((p) => ({
                id: p.name.split("/").pop(),
                site: p.displayName,
                accountId: account.name.split("/").pop(),
                accountName: account.displayName || account.name,
                url: null,
                domain: null,
                currencyCode: p.currencyCode || null,
                timeZone: p.timeZone || null,
                createTime: p.createTime || null,
            }));

        allProperties = [...allProperties, ...formatted];
    }

    // Fetch web data streams in parallel to get domain URLs
    const enriched = await Promise.all(
        allProperties.map(async (prop) => {
            try {
                const [streams] = await analyticsAdmin.listDataStreams({
                    parent: `properties/${prop.id}`,
                });
                const webStream = streams.find((s) => s.type === "WEB_DATA_STREAM");
                const rawUrl = webStream?.webStreamData?.defaultUri ?? null;
                const domain = rawUrl ? extractDomain(rawUrl) : null;
                return { ...prop, url: rawUrl, domain };
            } catch {
                // Permission denied or no streams – skip enrichment
                return prop;
            }
        }),
    );

    return enriched;
}

function getAnalyticsAdminClient() {
    return getGA4AdminClient(); // cached in ga4Service, reset when credentials change
}

async function getPropertyCurrencyCode(propertyId) {
    if (!propertyId) return "USD";

    if (propertyCurrencyMemCache.has(propertyId)) {
        return propertyCurrencyMemCache.get(propertyId);
    }

    const cache = await getCachedProperties();
    const cachedProperty = (cache?.properties || []).find(
        (prop) => String(prop.id) === String(propertyId),
    );
    if (cachedProperty?.currencyCode) {
        propertyCurrencyMemCache.set(propertyId, cachedProperty.currencyCode);
        return cachedProperty.currencyCode;
    }

    try {
        const analyticsAdmin = getAnalyticsAdminClient();
        const [property] = await analyticsAdmin.getProperty({
            name: `properties/${propertyId}`,
        });
        const currencyCode = property?.currencyCode || "USD";
        propertyCurrencyMemCache.set(propertyId, currencyCode);
        return currencyCode;
    } catch (err) {
        console.warn(
            `[analytics-card] currency lookup failed for ${propertyId}: ${err.message}`,
        );
        return "USD";
    }
}

// ---------------------------------------------------------------------------
// Public: refresh cache (called on startup or via API endpoint)
// ---------------------------------------------------------------------------

exports.refreshPropertiesCache = async function refreshPropertiesCache() {
    const properties = await getAnalyticsProperties();
    await savePropertiesToCache(properties);
    return properties;
};

let propertiesInFlight = null;
let propertiesRetryAfter = 0;
let propertiesRevalidateUntil = 0;

/**
 * Properties list for any page or API: the cache file, fetched from GA4 Admin when missing.
 * Stale metadata is returned immediately and refreshed in the background; force waits for a refresh.
 * A failed fetch falls back to the stale cache. One fetch at a time, shared by concurrent callers.
 * Returns { properties, source: "cached" | "fetched" | "stale" | "none" }.
 */
async function ensureProperties({ refreshStale = true, force = false } = {}) {
    const cache = await getCachedProperties();
    const missing = !cache?.properties?.length;
    if (!force && !missing && !(refreshStale && isCacheStale(cache))) {
        return { properties: cache.properties, source: "cached" };
    }
    if (!force && Date.now() < propertiesRetryAfter) {
        return { properties: cache?.properties ?? [], source: missing ? "none" : "stale" };
    }
    if (!propertiesInFlight) {
        propertiesRevalidateUntil = Date.now() + 60_000;
        propertiesInFlight = exports.refreshPropertiesCache().then(properties => {
            propertiesRetryAfter = 0;
            return { properties, source: "fetched" };
        }).catch(err => {
            propertiesRetryAfter = Date.now() + 60_000;
            console.error("[cache] Properties refresh failed" + (missing ? "" : ", using stale cache") + ":", err.message);
            return { properties: cache?.properties ?? [], source: missing ? "none" : "stale" };
        }).finally(() => { propertiesInFlight = null; });
    }
    if (!force && !missing) return { properties: cache.properties, source: "stale", revalidateUntil: propertiesRevalidateUntil };
    return propertiesInFlight;
};

exports.ensureProperties = async options => {
    const result = await ensureProperties(options);
    const context = require('../lib/requestContext').storage.getStore();
    context?.access?.syncProperties(result.properties);
    return { ...result, properties: require('../lib/requestContext').filterProperties(result.properties) };
};
const loadProperties = async () => (await exports.ensureProperties()).properties;

// ---------------------------------------------------------------------------
// GA4 Data API – batch realtime report
// ---------------------------------------------------------------------------

async function batchRealtimeReport({ properties }) {
    const analyticsDataClient = getGA4DataClient();

    // Capture quota from the first successful response (project-level pool is shared)
    let quotaAggregate = null;

    const results = await Promise.all(
        properties.map(async (property) => {
            const request = {
                property: `properties/${property.id}`,
                dimensions: [{ name: "streamName" }],
                metrics: [
                    { name: "activeUsers" },
                    { name: "screenPageViews" },
                ],
                minuteRanges: [{ startMinutesAgo: 29, endMinutesAgo: 0 }],
                returnPropertyQuota: true,
            };

            try {
                let response;
                try {
                    [response] = await analyticsDataClient.runRealtimeReport(request);
                } catch (error) {
                    // One retry for local transport failures only; never bypass GA4 quota/access decisions.
                    if (!connectionErrors.has(error.code)) throw error;
                    await new Promise(resolve => setTimeout(resolve, 200));
                    [response] = await analyticsDataClient.runRealtimeReport(request);
                }

                // Capture quota (first response that has it wins)
                if (response.propertyQuota && !quotaAggregate) {
                    const q = response.propertyQuota;
                    quotaAggregate = {
                        tokensPerDay: q.tokensPerDay,
                        tokensPerHour: q.tokensPerHour,
                        tokensPerProjectPerHour: q.tokensPerProjectPerHour,
                        concurrentRequests: q.concurrentRequests,
                        updatedAt: new Date().toISOString(),
                    };
                    latestQuota = quotaAggregate; // persist for /api/quota endpoint
                }

                if (!response.rows || response.rows.length === 0) {
                    return {
                        propertyId: property.id,
                        siteName: property.site,
                        domain: property.domain,
                        url: property.url,
                        activeUsers: 0,
                        pageViews: 0,
                        dashboardUrl: `https://analytics.google.com/analytics/web/#/p${property.id}/reports/intelligenthome`,
                    };
                }

                const totalActiveUsers = response.rows.reduce(
                    (sum, row) =>
                        sum + parseInt(row.metricValues?.[0]?.value || "0", 10),
                    0,
                );
                const totalPageViews = response.rows.reduce(
                    (sum, row) =>
                        sum + parseInt(row.metricValues?.[1]?.value || "0", 10),
                    0,
                );

                return {
                    propertyId: property.id,
                    siteName: property.site,
                    domain: property.domain,
                    url: property.url,
                    activeUsers: totalActiveUsers,
                    pageViews: totalPageViews,
                    dashboardUrl: `https://analytics.google.com/analytics/web/#/p${property.id}/reports/intelligenthome`,
                };
            } catch (error) {
                if (error.code === 7) {
                    // Keep the property visible as unavailable rather than silently dropping it.
                    console.warn(
                        `[SKIP] No access to "${property.site}" (id: ${property.id}). Grant Viewer access in GA4.`,
                    );
                } else console.error(
                    `[error] Property "${property.site}" [code ${error.code}]: ${error.message}`,
                );
                return {
                    error: true,
                    propertyId: property.id,
                    siteName: property.site,
                    domain: property.domain,
                    url: property.url,
                    activeUsers: null,
                    pageViews: null,
                    errorCode: error.code,
                    errorMessage: realtimeErrorMessage(error),
                    dashboardUrl: `https://analytics.google.com/analytics/web/#/p${property.id}/reports/intelligenthome`,
                };
            }
        }),
    );

    const data = await Promise.all(withPropertyAccounts(results.filter((r) => r !== null), properties).map(addLiveDetail));
    return { data, quota: quotaAggregate };
}

// Per-minute active users (30 points, oldest first) and the usual-traffic baseline.
// Quiet properties have a flat series; failed properties have no minute data.
async function addLiveDetail(row) {
    const series = Array(30).fill(0);
    if (row.error || !row.activeUsers) return { ...row, series: row.error ? null : series, baseline: null, baselineSd: null, baselineKind: null };
    const { propertyBaseline } = require("./spikeDetector");
    const [rt, base] = await Promise.all([
        runSafeRealtimeReport({
            propertyId: row.propertyId,
            dimensions: [{ name: "minutesAgo" }],
            metrics: [{ name: "activeUsers" }],
            limit: 30,
        }),
        propertyBaseline({ id: row.propertyId }).catch(() => null),
    ]);
    for (const r of (rt.ok && rt.rows) || []) {
        const m = parseInt(r.dimensionValues?.[0]?.value, 10);
        if (m >= 0 && m < 30) series[29 - m] = parseInt(r.metricValues?.[0]?.value || "0", 10);
    }
    return { ...row, series: rt.ok ? series : null, baseline: base ? base.baseline : null, baselineSd: base ? base.sd : null, baselineKind: base ? base.kind : null };
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

exports.allrealtime = async (req, res) => {
    try {
        const { properties } = await exports.ensureProperties({ refreshStale: true });
        const cache = await getCachedProperties();

        // A refreshed account list may discover new properties while metrics are still cached.
        if (realtimeMemCache && !matchesPropertySet(realtimeMemCache, properties)) {
            await refreshRealtime(properties);
        }

        // ---- in-memory short-term cache: skip GA4 API if fresh enough ----
        const memAge = Date.now() - realtimeMemCachedAt;
        let batchData, quota, fetchDurationMs;

        if (realtimeMemCache && memAge < realtimeTtl(realtimeMemCache)) {
            ({ data: batchData, quota, fetchDurationMs } = realtimeMemCache);
        } else if (realtimeMemCache) {
            // Memory cache exists but stale - serve memory cache instantly, refresh in background
            ({ data: batchData, quota, fetchDurationMs } = realtimeMemCache);
            (async () => {
                try {
                    await refreshRealtime(properties);
                } catch (e) {
                    console.warn('[mem-cache] Background refresh failed:', e.message);
                }
            })();
        } else {
            // Cold start - render instantly with cached properties structure, fetch live data in background
            batchData = properties.map((p) => ({
                propertyId: p.id,
                siteName: p.site,
                domain: p.domain || null,
                url: p.url || null,
                activeUsers: 0,
                pageViews: 0,
                dashboardUrl: `https://analytics.google.com/analytics/web/#/p${p.id}/reports/intelligenthome`,
            }));
            quota = null;
            fetchDurationMs = 0;

            // Trigger background fetch to warm memory cache
            (async () => {
                try {
                    await refreshRealtime(properties);
                } catch (e) {
                    console.warn('[mem-cache] Cold start background fetch failed:', e.message);
                }
            })();
        }
        // ---------------------------------------------------------------------

        const accessible = batchData.filter((r) => !r.error);
        const errors = batchData.filter((r) => r.error);

        const totalActiveUsers = accessible.reduce((s, r) => s + r.activeUsers, 0);
        const totalPageViews = accessible.reduce((s, r) => s + r.pageViews, 0);

        const formattedData = withPropertyAccounts(batchData, properties).map((r) => ({
            propertyId: r.propertyId,
            siteName: r.siteName,
            accountId: r.accountId,
            accountName: r.accountName,
            domain: r.domain || null,
            url: r.url || null,
            activeUsers: r.activeUsers,
            pageViews: r.pageViews,
            error: r.error ? r.errorMessage : null,
            dashboardUrl: r.dashboardUrl,
            analyticsUrl: analyticsUrl(r.propertyId),
            websiteUrl: websiteUrl(r.url),
            series: r.series || null,
            baseline: r.baseline ?? null,
            baselineSd: r.baselineSd ?? null,
            baselineKind: r.baselineKind ?? null,
        }));

        res.status(200).view("home", {
            data: formattedData,
            quota: quota ?? null,
            cacheAge: cache?.lastUpdated ?? null,
            fetchDurationMs,
            totalActiveUsers,
            totalPageViews,
            accessibleCount: accessible.length,
            errorCount: errors.length,
            head: {
                title: "MetriBee · Live Monitor",
                description: "Real-time Analytics Dashboard",
                image: "",
                url: "",
            },
        });
    } catch (err) {
        console.error("[route] Fatal error:", err.message);
        res.status(500).send(err.message);
    }
};

/**
 * Boot: one realtime batch for every property into the in-memory cache that "/", /api/realtime-all
 * and the analytics live strip read. Returns { sites, activeUsers }, or "cached" when it is fresh.
 */
exports.warmRealtime = async function warmRealtime() {
    if (realtimeMemCache && Date.now() - realtimeMemCachedAt < realtimeTtl(realtimeMemCache)) return "cached";
    const disk = await fs.readFile(REALTIME_DISK_PATH, "utf8").then(JSON.parse).catch(() => null);
    if (disk?.entry?.data?.some(row => !row.error) && Date.now() - disk.at < REALTIME_RESTART_REUSE_MS) {
        realtimeMemCache = disk.entry;
        realtimeMemCachedAt = disk.at;
        latestQuota = disk.entry.quota || latestQuota;
        return "cached";
    }
    const properties = await loadProperties();
    const { entry: { data } } = await refreshRealtime(properties);
    const ok = data.filter((r) => !r.error);
    return { sites: ok.length, activeUsers: ok.reduce((s, r) => s + (r.activeUsers || 0), 0) };
};

/** GET /api/realtime-all – returns live realtime stats for all properties (async hydration endpoint) */
exports.realtimeAllApi = async (req, res) => {
    try {
        const properties = await loadProperties();
        const memAge = Date.now() - realtimeMemCachedAt;
        const cached = !!(realtimeMemCache && memAge < realtimeTtl(realtimeMemCache) && matchesPropertySet(realtimeMemCache, properties));
        const { entry, fetchedAt } = cached
            ? { entry: realtimeMemCache, fetchedAt: realtimeMemCachedAt }
            : await refreshRealtime(properties);
        const failed = entry.data.filter(row => row.error);
        const unavailable = failed.length > 0 && failed.length === entry.data.length;
        res.header("Cache-Control", "no-store");
        if (unavailable) res.header("Retry-After", "10");
        res.status(unavailable ? 503 : 200).send({
            ...entry,
            ok: !unavailable,
            status: unavailable ? "unavailable" : failed.length ? "partial" : "ready",
            code: unavailable ? "ga4_unavailable" : undefined,
            error: unavailable ? (failed.every(row => connectionErrors.has(row.errorCode))
                ? "Could not connect to GA4. The connection was interrupted; please try again."
                : "GA4 realtime data is unavailable. Check property access or API quota and try again.") : undefined,
            cached,
            fetchedAt: unavailable ? null : fetchedAt,
            attemptedAt: fetchedAt,
            ...require("./dashboardModels").scoreRealtime(withPropertyAccounts(entry.data, properties), req.query),
        });
    } catch (err) {
        res.status(500).send({ ok: false, error: err.message });
    }
};

/** GET /api/quota – returns the latest quota snapshot from the last realtime fetch */
/** Compatibility property URL; use the same native domain favicon service as the UI. */
exports.favicon = async (req, res) => {
    const id = req.params.propertyId;
    if (!/^\d+$/.test(id)) return res.code(400).send();
    const cache = await getCachedProperties();
    const prop = cache?.properties?.find((p) => p.id === id);
    if (!prop) return res.code(404).send();
    if (demo.enabled()) {
        // No icon found: same letter tile the client draws, so the <img> never errors.
        const { letter, color } = letterTile(prop.site, Number(id));
        res.headers({ "Cache-Control": "max-age=3600", "X-Content-Type-Options": "nosniff" }).type("image/svg+xml");
        return res.send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect width="20" height="20" fill="${color}"/><text x="10" y="14.5" font-family="system-ui,sans-serif" font-size="11" font-weight="700" fill="#fff" text-anchor="middle">${letter}</text></svg>`);
    }
    let domain = prop.domain;
    try { domain = new URL(prop.url).hostname; } catch { /* Use the cached domain. */ }
    return favicon({ query: { domain } }, res);
};

/** GET /api/flag/:cc: country flag SVG (lowercase ISO code), cached forever in .data/flags */
exports.flag = async (req, res) => {
    const cc = req.params.cc;
    if (!flags.isCc(cc)) return res.code(400).send();
    const svg = await flags.getFlag(cc).catch(() => null);
    res.headers({
        "Cache-Control": svg ? "max-age=604800" : "no-store",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
        "X-Content-Type-Options": "nosniff",
    }).type("image/svg+xml");
    res.send(svg || flags.FALLBACK);
};

exports.quotaData = (req, res) => {
    if (!latestQuota) {
        return res.send({ ok: false, quota: null, message: "No quota data yet. Reload the dashboard first." });
    }
    res.send({ ok: true, quota: latestQuota });
};

/** GET /api/nav-index: sites and report names for the navbar jump palette */
exports.navIndex = async (req, res) => {
    const props = await loadProperties();
    res.send({
        ok: true,
        sites: props.map((p) => ({ id: String(p.id), name: p.site || p.domain || String(p.id), domain: p.domain || "" })),
        reports: getAnalyticsCatalog().map((c) => ({ id: c.type, name: c.title, group: c.group })),
    });
};

/** GET /api/spikes – detects traffic spikes and analyzes referral sources */
exports.trafficSpikes = async (req, res) => {
    try {
        const { detectAllSpikes, parseSpikeOpts, selectSpikeProperties } = require("./spikeDetector");
        const opts = parseSpikeOpts(req.query);
        const properties = selectSpikeProperties(await loadProperties(), req.query.propertyIds);
        // Viewer drill-downs query only the displayed spikes, not every property.
        const scope = properties.map(property => String(property.id)).sort().join(',');
        const cacheKey = `${scope}:z${opts.z}:l${opts.lift}`;
        const cached = wantFresh(req, "spike", cacheKey) ? null : await cacheGet("spike", cacheKey);
        if (cached) {
            return res.send({ ...cached, cached: true });
        }

        const spikes = await detectAllSpikes(properties, opts);
        const payload = { ok: true, count: spikes.length, rule: opts, spikes };
        cacheSet("spike", cacheKey, payload).catch(() => {});
        res.send(payload);
    } catch (err) {
        console.error("[spikes] Error detecting traffic spikes:", err.message);
        res.status(err.status || 500).send({ ok: false, error: err.message });
    }
};

/** GET /api/property-detail/:propertyId – per-card detail: top countries, sources, pages */
exports.propertyDetail = async (req, res) => {
    const { propertyId } = req.params;
    if (!propertyId || !/^\d+$/.test(propertyId)) {
        return res.status(400).send({ error: "Invalid propertyId" });
    }
    try {
        // Run three focused realtime reports in parallel (each isolated so one failure doesn't break the rest)
        // NOTE: firstUserSource / sessionSource are NOT valid realtime dimensions.
        //       Use eventName for top events instead.
        const [countryRes, eventRes, pageRes] = await Promise.all([
            runSafeRealtimeReport({
                propertyId,
                dimensions: [{ name: "country" }, { name: "countryId" }],
                metrics: [{ name: "activeUsers" }],
                minuteRanges: [{ startMinutesAgo: 29, endMinutesAgo: 0 }],
            }),
            runSafeRealtimeReport({
                propertyId,
                dimensions: [{ name: "eventName" }],
                metrics: [{ name: "activeUsers" }],
                minuteRanges: [{ startMinutesAgo: 29, endMinutesAgo: 0 }],
            }),
            runSafeRealtimeReport({
                propertyId,
                dimensions: [{ name: "unifiedScreenName" }],
                metrics: [{ name: "screenPageViews" }],
                fallbackMetrics: [{ name: "activeUsers" }],
                minuteRanges: [{ startMinutesAgo: 29, endMinutesAgo: 0 }],
            }),
        ]);

        const countries = (countryRes.rows || []).map(r => ({
            name: r.dimensionValues?.[0]?.value ?? "Unknown",
            id:   r.dimensionValues?.[1]?.value ?? "ZZ",
            users: parseInt(r.metricValues?.[0]?.value || "0", 10),
        })).filter(r => r.users > 0);

        const events = (eventRes.rows || []).map(r => ({
            name:  r.dimensionValues?.[0]?.value ?? "(unknown)",
            users: parseInt(r.metricValues?.[0]?.value || "0", 10),
        })).filter(r => r.users > 0).slice(0, 8);

        const pages = (pageRes.rows || []).map(r => ({
            path:  r.dimensionValues?.[0]?.value ?? "/",
            views: parseInt(r.metricValues?.[0]?.value || "0", 10),
        })).filter(r => r.views > 0).slice(0, 8);

        res.send({ ok: true, countries, events, pages });
    } catch (err) {
        if (err.code === 7) {
            return res.status(403).send({ error: "Permission denied for this property" });
        }
        res.status(500).send({ error: err.message });
    }
};

/** GET /api/visitor-insights/:propertyId?range=today|7d|28d – aggregate visitor personas */
exports.visitorInsights = async (req, res) => {
    const { propertyId } = req.params;
    if (!propertyId || !/^\d+$/.test(propertyId)) {
        return res.status(400).send({ error: "Invalid propertyId" });
    }
    try {
        const { getVisitorInsights } = require("./visitorInsights");
        const range = req.query.range || "28d";
        const insights = await getVisitorInsights(propertyId, range);
        res.send(insights);
    } catch (err) {
        console.error(`[visitor-insights] ${propertyId}:`, err.message);
        res.status(500).send({ ok: false, error: err.message });
    }
};

/** POST /api/refresh-cache – force a properties cache refresh */
exports.refreshCache = async (req, res) => {
    try {
        const result = await exports.ensureProperties({ force: true });
        if (result.source !== "fetched") return res.status(502).send({ ok: false, error: "Could not sync properties from GA4. The previous property list has been kept. Try again." });
        const properties = result.properties;
        res.send({
            ok: true,
            count: properties.length,
            updatedAt: new Date().toISOString(),
            properties,
        });
    } catch (err) {
        res.status(500).send({ ok: false, error: err.message });
    }
};

// ---------------------------------------------------------------------------
// Globe data – country-level realtime aggregation
// ---------------------------------------------------------------------------

const GLOBE_CACHE_PATH = path.join(CACHE_DIR, "globe.json");
const GLOBE_CACHE_TTL_SEC = 60; // 1 minute

async function getCachedGlobeData() {
    try {
        const raw = await fs.readFile(scopedGlobePath(GLOBE_CACHE_PATH), "utf8");
        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.fetchedAt) return null;
        const ageMs = Date.now() - new Date(parsed.fetchedAt).getTime();
        if (ageMs > GLOBE_CACHE_TTL_SEC * 1000) return null;
        return parsed;
    } catch {
        return null;
    }
}

async function saveGlobeDataToCache(payload) {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(scopedGlobePath(GLOBE_CACHE_PATH), JSON.stringify(payload, null, 2));
}

async function fetchGlobeCountryData(properties) {
    const client = getGA4DataClient();

    // One report per property with country + countryId dimensions
    const results = await Promise.all(
        properties.map(async (prop) => {
            try {
                const [response] = await client.runRealtimeReport({
                    property: `properties/${prop.id}`,
                    dimensions: [{ name: "country" }, { name: "countryId" }],
                    metrics: [{ name: "activeUsers" }],
                    minuteRanges: [{ startMinutesAgo: 29, endMinutesAgo: 0 }],
                });
                return { prop, rows: response.rows || [] };
            } catch (err) {
                if (err.code !== 7) {
                    console.warn(`[globe] ${prop.site}: ${err.message}`);
                }
                return { prop, rows: [] };
            }
        }),
    );

    // Aggregate by countryId across all properties
    const byCountry = new Map();
    for (const { prop, rows } of results) {
        for (const row of rows) {
            const countryName = row.dimensionValues?.[0]?.value ?? "Unknown";
            const countryId   = row.dimensionValues?.[1]?.value ?? "ZZ";
            const users       = parseInt(row.metricValues?.[0]?.value || "0", 10);
            if (!users) continue;

            if (!byCountry.has(countryId)) {
                byCountry.set(countryId, {
                    countryId,
                    country: countryName,
                    totalUsers: 0,
                    properties: [],
                });
            }
            const entry = byCountry.get(countryId);
            entry.totalUsers += users;
            entry.properties.push({
                name:   prop.site,
                domain: prop.domain ?? null,
                users,
            });
        }
    }

    // Sort properties within each country
    const countries = [...byCountry.values()].sort((a, b) => b.totalUsers - a.totalUsers);
    countries.forEach(c => c.properties.sort((a, b) => b.users - a.users));

    return countries;
}

// ---------------------------------------------------------------------------
// Globe users – city-level realtime data for avatar map
// ---------------------------------------------------------------------------

const GLOBE_USERS_CACHE_PATH = path.join(CACHE_DIR, "globe_users.json");
/* Bump when the payload shape changes: an older build's cache file (no per-city sites, no feed) is then refetched, not served */
const GLOBE_USERS_CACHE_V = 3; // 3: per-city IANA tz
const GLOBE_USERS_TTL_SEC = 30;
const GLOBE_USERS_MAX_AGE_SEC = 300;

/** Last propertyQuota per property and the measured token cost of one globe poll per property. */
const globeQuotas = new Map();
const globeCosts = new Map();
const globeFetchInFlight = new Map();
function scopedGlobePath(file) { const scope = require('../lib/requestContext').cacheScope(); return scope === 'all' ? file : file.replace(/\.json$/, `-${scope}.json`); }

async function getCachedGlobeUsers(maxAgeSec = GLOBE_USERS_TTL_SEC) {
    try {
        const raw  = await fs.readFile(scopedGlobePath(GLOBE_USERS_CACHE_PATH), "utf8");
        const parsed = JSON.parse(raw);
        if (!parsed?.fetchedAt || parsed.v !== GLOBE_USERS_CACHE_V) return null;
        const ageMs = Date.now() - new Date(parsed.fetchedAt).getTime();
        if (ageMs > maxAgeSec * 1000) return null;
        return parsed;
    } catch { return null; }
}

async function saveGlobeUsersToCache(payload) {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(scopedGlobePath(GLOBE_USERS_CACHE_PATH), JSON.stringify(payload, null, 2));
}

async function fetchGlobeUsersData(properties) {
    const minuteRanges = [{ startMinutesAgo: 29, endMinutesAgo: 0 }];
    const results = await Promise.all(
        properties.map(async (prop) => {
            const users = await runSafeRealtimeReport({
                    propertyId: prop.id,
                    dimensions: [
                        // Realtime allows 4 dimensions: the country name comes from countryId in buildGlobeUsersPayload.
                        { name: "city" }, { name: "countryId" },
                        { name: "deviceCategory" }, { name: "platform" },
                    ],
                    metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }, { name: "keyEvents" }],
                    fallbackMetrics: [{ name: "activeUsers" }],
                    minuteRanges,
                    // High-cardinality breakdown: the default limit (50) undercounted busy properties.
                    limit: 10000,
                });
            // Each realtime call costs ~40 tokens even when empty: skip the feed query for idle properties.
            const events = users.ok && users.rows?.length ? await runSafeRealtimeReport({
                    propertyId: prop.id,
                    dimensions: [
                        // Realtime rejects unifiedScreenName with eventName, so the feed is page views per minute.
                        { name: "city" }, { name: "unifiedScreenName" }, { name: "minutesAgo" },
                    ],
                    metrics: [{ name: "screenPageViews" }, { name: "keyEvents" }],
                    fallbackMetrics: [{ name: "screenPageViews" }],
                    minuteRanges,
                    limit: 10000,
                }) : { ok: true, rows: [], quota: null };
            return { prop, users, events };
        })
    );

    let feedFailures = 0;
    for (const { prop, users, events } of results) {
        let cost = 0;
        for (const r of [users, events]) {
            if (r.quota) {
                globeQuotas.set(prop.id, r.quota);
                // @google-analytics/data 6.1.0 v1beta does return tokensPerProjectPerHour. tokensPerHour stays as the
                // fallback because GA4 can leave a QuotaStatus out of a response, and a missing one reads as null here.
                cost += Number((r.quota.tokensPerProjectPerHour || r.quota.tokensPerHour)?.consumed) || 0;
            }
        }
        if (cost > 0) globeCosts.set(prop.id, cost);
        if (!events.ok && !events.isPermissionDenied) feedFailures++;
    }
    if (feedFailures) console.warn(`[globe-users] event feed query failed for ${feedFailures} properties, feed is partial`);

    return buildGlobeUsersPayload(
        results.map(({ prop, users }) => ({ prop, rows: users.rows })),
        results.map(({ prop, events }) => ({ prop, rows: events.ok ? events.rows : [] })),
        getCityCoords,
    );
}

/** Fetch city-level users for every property and write the cache file. One fetch at a time. */
function loadGlobeUsers() {
    const scope = require('../lib/requestContext').cacheScope();
    if (!globeFetchInFlight.has(scope)) {
        globeFetchInFlight.set(scope, (async () => {
            const properties = await loadProperties();
            const payload = await fetchGlobeUsersData(properties);
            payload.fetchedAt = new Date().toISOString();
            payload.v = GLOBE_USERS_CACHE_V;
            payload.refresh = refreshInfo(globeQuotas, globeCosts);
            const publicPayload = stripSensitiveGlobeUsersPayload(payload);
            // No properties yet (first boot, Admin API failed): do not cache an empty globe for the TTL.
            if (properties.length) await saveGlobeUsersToCache(publicPayload);
            return publicPayload;
        })().finally(() => { globeFetchInFlight.delete(scope); }));
    }
    return globeFetchInFlight.get(scope);
}

/** Boot warm-up: "cached" when the globe cache is fresh, else fetch it and return the active user count. */
exports.warmGlobeUsers = async function warmGlobeUsers() {
    if (await getCachedGlobeUsers(60)) return "cached"; // a restart within a minute reuses the last poll
    const payload = await loadGlobeUsers();
    return payload.totalActiveUsers ?? 0;
};

/** GET /api/globe-users?maxAge=N – city-level users, event feed, quota-aware refresh (N seconds, 0..300) */
exports.globeUsers = async (req, res) => {
    try {
        const asked = Number.parseInt(req.query.maxAge, 10);
        let maxAge = Number.isFinite(asked) ? Math.min(GLOBE_USERS_MAX_AGE_SEC, Math.max(0, asked)) : GLOBE_USERS_TTL_SEC;
        const before = refreshInfo(globeQuotas, globeCosts);
        if (before?.throttled) maxAge = GLOBE_USERS_MAX_AGE_SEC;

        const send = (payload, cached) => {
            const refresh = refreshInfo(globeQuotas, globeCosts) || payload.refresh || null;
            res.send(stripSensitiveGlobeUsersPayload({ ...payload, refresh, cached }));
        };

        const cached = await getCachedGlobeUsers(maxAge);
        if (cached) return send(cached, true);

        send(await loadGlobeUsers(), false);
    } catch (err) {
        console.error("[globe-users] Fatal:", err.message);
        res.status(500).send({ error: err.message });
    }
};

/** GET /api/globe-data – JSON endpoint for the 3D globe */
exports.globeData = async (req, res) => {
    try {
        const cached = await getCachedGlobeData();
        if (cached) {
            return res.send(cached);
        }

        const properties = await loadProperties();

        const countries  = await fetchGlobeCountryData(properties);
        const payload    = { fetchedAt: new Date().toISOString(), countries };

        await saveGlobeDataToCache(payload);
        res.send(payload);
    } catch (err) {
        console.error("[globe] Fatal:", err.message);
        res.status(500).send({ error: err.message });
    }
};

/** GET /globe – renders the 3D globe view (uses main layout for nav) */
exports.globeView = (req, res) => {
    res.view("globe", {
        head: {
            title: "MetriBee · Globe",
            description: "3D real-time active user globe",
            image: "",
            url: "",
        },
    });
};

// ---------------------------------------------------------------------------
// Analytics page
// ---------------------------------------------------------------------------

/** GET /analytics – renders analytics dashboard view */
exports.analyticsView = async (req, res) => {
    try {
        const properties = await loadProperties();
        res.view("analytics", {
            properties,
            analyticsCatalog: getAnalyticsCatalog(),
            head: {
                title: "MetriBee · Analytics",
                description: "In-depth analytics dashboard",
                image: "",
                url: "",
            },
        });
    } catch (err) {
        console.error("[analytics] View error:", err.message);
        res.status(500).send(err.message);
    }
};

/** GET /api/analytics-card/:propertyId/:type?range=today|7d|28d */
exports.analyticsCard = async (req, res) => {
    const { propertyId, type } = req.params;
    if (!propertyId || !/^\d+$/.test(propertyId)) {
        return res.status(400).send({ error: "Invalid propertyId" });
    }
    const range  = req.query.range || "28d";
    const cfg    = getAnalyticsCardConfig(type);
    if (!cfg) return res.status(400).send({ error: `Unknown card type: ${type}` });

    // Split cards take ?seg= (one cached query per segment)
    const seg = cfg.segments
        ? (cfg.segments[req.query.seg] ? req.query.seg : Object.keys(cfg.segments)[0])
        : null;

    // ── Check cache first (skip caching for realtime-summary-like queries) ──
    const cacheKey = getAnalyticsCardCacheKey(propertyId, type, range, seg) + ":inclusive-v2";
    const cached = wantFresh(req, "card", cacheKey) ? null : await cacheGet("card", cacheKey);
    if (cached) {
        return res.send({ ...cached, cached: true });
    }

    const dateRange = getDateRange(range);

    if (cfg.kind) {
        try {
            const currencyCode = await getPropertyCurrencyCode(propertyId);
            const props = (await getCachedProperties())?.properties || [];
            const prop = props.find(p => String(p.id) === String(propertyId));
            let ownHost = prop?.domain || "";
            if (!ownHost && prop?.url) {
                try { ownHost = new URL(prop.url).hostname; } catch { ownHost = ""; }
            }
            const extra = await runExtraCard({
                cfg, type, propertyId, dateRange, seg, ownHost, run: runSafeHistoricalReport,
            });
            const payload = { ...extra, type, range, timeSeries: false, currencyCode, fetchedAt: Date.now() };
            cacheSet("card", cacheKey, payload).catch(() => {});
            return res.send(payload);
        } catch (err) {
            console.error(`[analytics-card] ${type}:`, err.message);
            return res.status(500).send({ error: err.message });
        }
    }

    // Inclusive periods match the shared workspace date picker.
    const days = { today: 1, "7d": 7, "28d": 28, "30d": 30, "90d": 90 }[range] || 28;
    const limit = cfg.timeSeries
        ? (cfg.dimensions[0] === "dateHour" ? days * 24 : days)
        : cfg.limit;

    try {
        const currencyCode = await getPropertyCurrencyCode(propertyId);
        const metricObjects = cfg.metrics.map(name => ({ name }));
        const fallbackMetricObjects = cfg.fallbackMetrics?.map(name => ({ name })) || null;
        const orderBys = cfg.timeSeries
            ? [{ dimension: { dimensionName: cfg.dimensions[0] || "date" }, desc: false }]
            : [{ metric: { metricName: cfg.metrics[0] }, desc: true }];

        const query = {
            propertyId,
            dimensions: cfg.dimensions.map(name => ({ name })),
            metrics: metricObjects,
            fallbackMetrics: fallbackMetricObjects,
            dateRange,
            limit,
            orderBys,
            metricAggregations: ["TOTAL"],
        };
        // Previous period runs alongside; a wider table limit so rows that fell in rank still match.
        const [response, prevResponse] = await Promise.all([
            runSafeHistoricalReport(query),
            runSafeHistoricalReport({
                ...query,
                dateRange: getPreviousDateRange(range),
                limit: cfg.timeSeries ? limit : Math.max(cfg.limit * 5, 50),
            }).catch(err => ({ ok: false, error: err.message })),
        ]);

        if (!response.ok) throw new Error(response.error || "Report query failed");

        const metricHeaders = (response.usedMetrics || metricObjects).map(metric => metric.name);

        const rows = (response.rows || []).map(row => ({
            dims:    row.dimensionValues.map(d => d.value),
            metrics: row.metricValues.map(m => parseFloat(m.value || "0")),
        }));

        // GA4's own totals cover every row, not only the top `limit`; row sum is the fallback.
        const gaTotals = response.totals?.[0]?.metricValues;
        const totals = gaTotals
            ? gaTotals.map(m => parseFloat(m.value || "0"))
            : rows.reduce((acc, r) => {
                r.metrics.forEach((v, i) => { acc[i] = (acc[i] || 0) + v; });
                return acc;
            }, []);

        const payload = {
            ok: true, type, rows, totals, range,
            timeSeries: !!cfg.timeSeries,
            dimensionHeaders: cfg.dimensions,
            metricHeaders,
            currencyCode,
            fetchedAt: Date.now(),
        };

        if (prevResponse.ok) {
            const prevRows = (prevResponse.rows || []).map(row => ({
                dims:    row.dimensionValues.map(d => d.value),
                metrics: row.metricValues.map(m => parseFloat(m.value || "0")),
            }));
            if (cfg.timeSeries) payload.prevRows = prevRows;
            else payload.rows = attachPrev(rows, prevRows);
            const prevTotals = prevResponse.totals?.[0]?.metricValues;
            if (prevTotals) payload.prevTotals = prevTotals.map(m => parseFloat(m.value || "0"));
        } else {
            console.warn(`[analytics-card] ${type} previous period:`, prevResponse.error);
        }

        // Cache asynchronously (don't block response)
        cacheSet("card", cacheKey, payload).catch(() => {});

        res.send(payload);
    } catch (err) {
        console.error(`[analytics-card] ${type}:`, err.message);
        res.status(500).send({ error: err.message });
    }
};

/** GET /api/realtime-summary/:propertyId – pulls live data from in-memory realtime cache */
exports.realtimeSummary = (req, res) => {
    if (!realtimeMemCache) {
        return res.send({ ok: false, message: "No realtime data cached. Load the dashboard first." });
    }
    const { propertyId } = req.params;
    if (!propertyId || !/^\d+$/.test(propertyId)) {
        return res.status(400).send({ error: "Invalid propertyId" });
    }
    const prop = (realtimeMemCache.data || []).find(r => String(r.propertyId) === String(propertyId));
    if (!prop) return res.send({ ok: false, message: "Property not in cache" });
    res.send({
        ok: true,
        activeUsers: prop.activeUsers,
        pageViews:   prop.pageViews,
        cachedAgo:   Math.round((Date.now() - realtimeMemCachedAt) / 1000),
    });
};

// ---------------------------------------------------------------------------
// Reports section – aggregated report data with spike annotations
// ---------------------------------------------------------------------------

/**
 * GET /api/analytics-reports/:propertyId?range=28d
 * Returns a curated report bundle:
 *   - dayOfWeek: sessions/users aggregated by weekday for the period
 *   - topSources: top session sources with session counts
 *   - topPages: top pages by views & engagement time
 *   - spikeAnnotations: detected traffic anomalies with source cause
 *   - hourlyPattern: traffic by hour
 */
exports.analyticsReports = async (req, res) => {
    const { propertyId } = req.params;
    if (!propertyId || !/^\d+$/.test(propertyId)) {
        return res.status(400).send({ error: "Invalid propertyId" });
    }
    const range = req.query.range || "28d";

    // ── Check disk cache first ──
    const cacheKey = `${propertyId}:reports:${range}`;
    const cached = wantFresh(req, "report", cacheKey) ? null : await cacheGet("report", cacheKey);
    if (cached) {
        return res.send({ ...cached, cached: true });
    }

    const dateRange = getDateRange(range);

    try {
        const { classifyReferralSource } = require("./spikeDetector");

        // 1. Day-of-week pattern: fetch last 28 days, group by weekday client-side
        const dowPromise = runSafeHistoricalReport({
            propertyId,
            dimensions: [{ name: "date" }],
            metrics: [{ name: "sessions" }, { name: "activeUsers" }],
            dateRange,
            limit: range === "28d" ? 28 : range === "7d" ? 7 : 1,
            orderBys: [{ dimension: { dimensionName: "date" }, desc: false }],
        });

        // 2. Top referral sources (traffic anomalies)
        const sourcesPromise = runSafeHistoricalReport({
            propertyId,
            dimensions: [{ name: "sessionSource" }, { name: "sessionMedium" }],
            metrics: [{ name: "sessions" }, { name: "activeUsers" }],
            dateRange,
            limit: 15,
        });

        // 3. Top pages by views & users
        const pagesPromise = runSafeHistoricalReport({
            propertyId,
            dimensions: [{ name: "pagePath" }],
            metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }],
            dateRange,
            limit: 10,
        });

        // 4. Landing pages per source (to correlate viral sources with entry pages)
        const landingPagePromise = runSafeHistoricalReport({
            propertyId,
            dimensions: [{ name: "sessionSource" }, { name: "landingPagePlusQueryString" }],
            metrics: [{ name: "sessions" }],
            dateRange,
            limit: 20,
        });

        // 5. Top page referrers (actual referral URLs)
        const referrerPromise = runSafeHistoricalReport({
            propertyId,
            dimensions: [{ name: "pageReferrer" }],
            metrics: [{ name: "sessions" }],
            dateRange,
            limit: 15,
        });

        // 6. Hourly pattern (last 48 hours)
        const hourlyPromise = runSafeHistoricalReport({
            propertyId,
            dimensions: [{ name: "dateHour" }],
            metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }],
            dateRange: { startDate: "7daysAgo", endDate: "today" },
            limit: 48,
        });

        const [dowRes, sourcesRes, pagesRes, landingPageRes, referrerRes, hourlyRes] = await Promise.all([
            dowPromise, sourcesPromise, pagesPromise, landingPagePromise, referrerPromise, hourlyPromise
        ]);

        // -- Day of week aggregation --
        const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const dayBuckets = dayNames.map(d => ({ day: d, sessions: 0, users: 0, count: 0 }));
        if (dowRes.ok) {
            (dowRes.rows || []).forEach(r => {
                const dateStr = r.dimensionValues?.[0]?.value || "";
                const year = parseInt(dateStr.slice(0, 4), 10);
                const month = parseInt(dateStr.slice(4, 6), 10) - 1;
                const day = parseInt(dateStr.slice(6, 8), 10);
                if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
                    const dow = new Date(year, month, day).getDay();
                    dayBuckets[dow].sessions += parseInt(r.metricValues?.[0]?.value || "0", 10);
                    dayBuckets[dow].users += parseInt(r.metricValues?.[1]?.value || "0", 10);
                    dayBuckets[dow].count++;
                }
            });
        }
        const dayOfWeek = dayBuckets.map(b => ({
            day: b.day,
            sessions: b.sessions,
            users: b.users,
            avgSessions: b.count > 0 ? Math.round(b.sessions / b.count) : 0,
        }));

        // -- Top sources with anomaly classification --
        const topSources = (sourcesRes.rows || [])
            .map(r => {
                const src = r.dimensionValues?.[0]?.value || "(direct)";
                const med = r.dimensionValues?.[1]?.value || "";
                const sessions = parseInt(r.metricValues?.[0]?.value || "0", 10);
                const users = parseInt(r.metricValues?.[1]?.value || "0", 10);
                const classified = classifyReferralSource(src);
                return {
                    source: src,
                    medium: med,
                    sessions,
                    users,
                    classifiedName: classified.name,
                    category: classified.category,
                    shape: classified.shape,
                };
            })
            .filter(r => r.sessions > 0)
            .sort((a, b) => b.sessions - a.sessions)
            .slice(0, 12);

        // -- Top pages --
        const topPages = (pagesRes.rows || [])
            .map(r => ({
                path: r.dimensionValues?.[0]?.value || "/",
                views: parseInt(r.metricValues?.[0]?.value || "0", 10),
                users: parseInt(r.metricValues?.[1]?.value || "0", 10),
            }))
            .filter(r => r.views > 0)
            .sort((a, b) => b.views - a.views)
            .slice(0, 10);

        // -- Hourly pattern (for last 48h or up to limit) --
        const hourlyPattern = (hourlyRes.rows || [])
            .map(r => ({
                hour: r.dimensionValues?.[0]?.value || "",
                users: parseInt(r.metricValues?.[0]?.value || "0", 10),
                views: parseInt(r.metricValues?.[1]?.value || "0", 10),
            }))
            .filter(r => r.users > 0 || r.views > 0)
            .sort((a, b) => a.hour.localeCompare(b.hour))
            .slice(-48);

        // -- Build source → landing pages map from landingPageRes --
        const sourceToLandingPages = new Map();
        if (landingPageRes.ok) {
            (landingPageRes.rows || []).forEach(r => {
                const src = r.dimensionValues?.[0]?.value || "(direct)";
                const lp = r.dimensionValues?.[1]?.value || "/";
                const sessions = parseInt(r.metricValues?.[0]?.value || "0", 10);
                if (!sessions) return;
                if (!sourceToLandingPages.has(src)) {
                    sourceToLandingPages.set(src, []);
                }
                sourceToLandingPages.get(src).push({ landingPage: lp, sessions });
            });
            // Sort each source's landing pages by sessions descending
            sourceToLandingPages.forEach((pages, key) => {
                sourceToLandingPages.set(key, pages.sort((a, b) => b.sessions - a.sessions).slice(0, 5));
            });
        }

        // -- Top referring URLs --
        const topReferrers = (referrerRes.rows || [])
            .map(r => ({
                referrer: r.dimensionValues?.[0]?.value || "(direct)",
                sessions: parseInt(r.metricValues?.[0]?.value || "0", 10),
            }))
            .filter(r => r.sessions > 0 && r.referrer !== "(direct)" && r.referrer !== "")
            .sort((a, b) => b.sessions - a.sessions)
            .slice(0, 10);

        // -- Search URL mappings for viral platforms --
        // Get domain from cached property if available
        let siteDomain = "";
        try {
            const cache = await getCachedProperties();
            const propMeta = (cache?.properties || []).find(p => String(p.id) === String(propertyId));
            if (propMeta?.domain) siteDomain = propMeta.domain;
        } catch { /* ignore */ }

        function buildSearchUrl(category, domain) {
            const encoded = encodeURIComponent(domain ? `site:${domain}` : domain || "");
            const encodedRaw = encodeURIComponent(domain || "");
            const urls = {
                twitter: domain ? `https://twitter.com/search?q=${encodeURIComponent(`site:${domain}`)}&src=typed_query&f=live` : null,
                reddit: domain ? `https://www.reddit.com/search/?q=${encodeURIComponent(`site:${domain}`)}` : null,
                hn: domain ? `https://hn.algolia.com/?query=${encodeURIComponent(`site:${domain}`)}&sort=byDate&type=story` : null,
                instagram: domain ? `https://www.instagram.com/explore/search/keyword/?q=${encodedRaw}` : null,
                tiktok: null,
                discord: null,
                telegram: null,
                whatsapp: null,
                producthunt: domain ? `https://www.producthunt.com/search?q=${encodedRaw}` : null,
                github: domain ? `https://github.com/search?q=${encodedRaw}&type=repositories` : null,
                linkedin: domain ? `https://www.linkedin.com/search/results/content/?keywords=${encodedRaw}` : null,
                youtube: domain ? `https://www.youtube.com/results?search_query=${encodeURIComponent(domain)}` : null,
                facebook: domain ? `https://www.facebook.com/search/top?q=${encodeURIComponent(domain)}` : null,
                perplexity: domain ? `https://www.perplexity.ai/search?q=${encodeURIComponent(domain)}` : null,
                claude: null,
                chatgpt: null,
                pinterest: domain ? `https://www.pinterest.com/search/pins/?q=${encodedRaw}` : null,
                medium: domain ? `https://medium.com/search?q=${encodedRaw}` : null,
                quora: domain ? `https://www.quora.com/search?q=${encodeURIComponent(domain)}` : null,
                stackoverflow: domain ? `https://stackoverflow.com/search?q=${encodedRaw}` : null,
                bing: null,
                duckduckgo: null,
            };
            return urls[category] || null;
        }

        // -- Spike annotations (detect anomalies from sources data) --
        const spikeAnnotations = topSources
            .filter(s => {
                // Anomalies: social, AI chatbot, or news aggregator sources with notable traffic
                const anomalyCategories = ["chatgpt", "twitter", "reddit", "hn", "instagram", "tiktok", "discord", "perplexity", "claude", "facebook", "producthunt"];
                return anomalyCategories.includes(s.category) && s.sessions >= 2;
            })
            .map(s => {
                // Find landing pages for this source
                const srcLandingPages = (sourceToLandingPages.get(s.source) || []).slice(0, 3);
                // Find matching referrers (by checking if referrer URL contains the source domain pattern)
                const matchingReferrers = topReferrers.filter(r => {
                    const refLower = r.referrer.toLowerCase();
                    const srcLower = s.source.toLowerCase();
                    const categoryPatterns = {
                        twitter: /t\.co|twitter|x\.com/i,
                        reddit: /reddit/i,
                        hn: /ycombinator|news\.ycombinator/i,
                        instagram: /instagram/i,
                        facebook: /facebook/i,
                        producthunt: /producthunt/i,
                        github: /github/i,
                        linkedin: /linkedin/i,
                        youtube: /youtube/i,
                        pinterest: /pinterest/i,
                        medium: /medium/i,
                        quora: /quora/i,
                        stackoverflow: /stackoverflow|stackexchange/i,
                    };
                    const pattern = categoryPatterns[s.category];
                    return pattern ? pattern.test(refLower) : refLower.includes(srcLower);
                }).slice(0, 2);

                const searchUrl = buildSearchUrl(s.category, siteDomain);

                return {
                    shape: s.shape,
                    source: s.classifiedName,
                    category: s.category,
                    sessions: s.sessions,
                    users: s.users,
                    annotation: `Traffic from ${s.classifiedName}: ${s.sessions} sessions, ${s.users} users`,
                    landingPages: srcLandingPages,
                    referrers: matchingReferrers,
                    searchUrl,
                    searchLabel: searchUrl ? `Search on ${s.classifiedName}` : null,
                };
            })
            .sort((a, b) => b.sessions - a.sessions);

        // Look for unusual source patterns (high-volume single source dominating)
        const totalSourceSessions = topSources.reduce((sum, s) => sum + s.sessions, 0) || 1;
        const unusualSources = topSources
            .filter(s => {
                const share = s.sessions / totalSourceSessions;
                return share > 0.3 && s.category !== "google" && s.category !== "direct";
            })
            .map(s => {
                const srcLandingPages = (sourceToLandingPages.get(s.source) || []).slice(0, 2);
                const searchUrl = buildSearchUrl(s.category, siteDomain);
                return {
                    shape: s.shape,
                    source: s.classifiedName,
                    share: Math.round((s.sessions / totalSourceSessions) * 100),
                    sessions: s.sessions,
                    annotation: `${s.classifiedName} accounts for ${Math.round((s.sessions / totalSourceSessions) * 100)}% of all traffic`,
                    landingPages: srcLandingPages,
                    searchUrl,
                    searchLabel: searchUrl ? `Search on ${s.classifiedName}` : null,
                };
            });

        const payload = {
            ok: true,
            propertyId,
            range,
            dayOfWeek,
            topSources,
            topPages,
            hourlyPattern,
            spikeAnnotations,
            unusualSources,
            totals: {
                totalSessions: topSources.reduce((s, x) => s + x.sessions, 0),
                totalUsers: topSources.reduce((s, x) => s + x.users, 0),
                totalPageviews: topPages.reduce((s, x) => s + x.views, 0),
            },
        };

        // Cache asynchronously (don't block response)
        cacheSet("report", cacheKey, payload).catch(() => {});

        res.send(payload);
    } catch (err) {
        console.error(`[analytics-reports] ${propertyId}:`, err.message);
        res.status(500).send({ ok: false, error: err.message });
    }
};
