/* Globe users: pure helpers for /api/globe-users (row-to-payload builder, quota-aware refresh interval).
   No I/O here so mocha can test it without GA4 credentials. */

const tzLookup = require("tz-lookup");

const NOT_SET = "(not set)";
const FEED_MAX = 40;

/** Standard GA4 hourly token limits. 360 properties get 10x; detected from the remaining count. */
const STD_PROJECT_HOUR = 14000;
const STD_PROPERTY_HOUR = 40000;

const dim = (row, i) => row?.dimensionValues?.[i]?.value ?? "";
const met = (row, i) => Number.parseInt(row?.metricValues?.[i]?.value || "0", 10) || 0;

function seedColor(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return `hsl(${h % 360},65%,55%)`;
}

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
/** English country name from a GA4 countryId (ISO 3166-1 alpha-2). */
function countryName(id) {
    if (id === "(other)") return "Other";
    if (!/^[A-Z]{2}$/.test(id)) return NOT_SET;
    try { return regionNames.of(id) || id; } catch { return id; }
}

/** IANA time zone for a coordinate, offline (tz-lookup). Null when the lookup fails. */
function defaultTz(lat, lng) {
    try { return tzLookup(lat, lng) || null; } catch { return null; }
}

const topKey = (counts) => {
    let best = null, n = -1;
    for (const [k, v] of counts) if (v > n) { best = k; n = v; }
    return best;
};

/**
 * Builds the /api/globe-users payload from raw realtime rows.
 * GA4 realtime allows 4 dimensions per request and rejects unifiedScreenName with eventName, so:
 * query 1 has no country name (taken from countryId), query 2 has no countryId (rows join the biggest
 * city with that name) and no eventName (the feed is page views per minute, flagged when key events fired).
 * @param {Array<{prop, rows}>} userResults query 1 per property: city, countryId, deviceCategory, platform | activeUsers, screenPageViews, keyEvents
 * @param {Array<{prop, rows}>} eventResults query 2 per property: city, unifiedScreenName, minutesAgo | screenPageViews, keyEvents
 * @param {(city: string) => [number, number] | null} getCoords
 * @param {(lat: number, lng: number) => string | null} [getTz] IANA zone for a coordinate (offline lookup)
 */
function buildGlobeUsersPayload(userResults, eventResults, getCoords, getTz = defaultTz) {
    const cityMap = new Map();
    const countryMap = new Map();
    const deviceMap = new Map();
    const platformMap = new Map();
    const propMap = new Map();
    let total = 0;
    let keyEvents = 0;

    for (const { prop, rows } of userResults || []) {
        for (const row of rows || []) {
            const city = dim(row, 0) || NOT_SET;
            const ctryId = dim(row, 1) || NOT_SET;
            const country = countryName(ctryId);
            const device = (dim(row, 2) || "desktop").toLowerCase();
            const platform = (dim(row, 3) || NOT_SET).toLowerCase();
            const users = met(row, 0);
            const views = met(row, 1);
            const keys = met(row, 2);
            if (!users) continue;
            total += users;
            keyEvents += keys;

            const coords = city !== NOT_SET ? getCoords(city) : null;
            if (coords) {
                const key = `${city}||${ctryId}`;
                if (!cityMap.has(key)) {
                    cityMap.set(key, {
                        city, country, countryId: ctryId, lat: coords[0], lng: coords[1],
                        tz: getTz(coords[0], coords[1]),
                        count: 0, views: 0, keyEvents: 0,
                        devices: { mobile: 0, desktop: 0, tablet: 0 },
                        color: seedColor(`${city}${ctryId}`),
                        _sites: new Map(), _pages: new Map(),
                    });
                }
                const c = cityMap.get(key);
                c.count += users;
                c.views += views;
                c.keyEvents += keys;
                if (device in c.devices) c.devices[device] += users;
                if (!c._sites.has(prop.site)) c._sites.set(prop.site, { id: prop.id, name: prop.site, users: 0, views: 0, keyEvents: 0, _pages: new Map() });
                const s = c._sites.get(prop.site);
                s.users += users;
                s.views += views;
                s.keyEvents += keys;
            }

            if (!countryMap.has(ctryId)) countryMap.set(ctryId, { name: country, id: ctryId, count: 0 });
            countryMap.get(ctryId).count += users;

            const devLabel = device.charAt(0).toUpperCase() + device.slice(1);
            deviceMap.set(devLabel, (deviceMap.get(devLabel) || 0) + users);
            platformMap.set(platform, (platformMap.get(platform) || 0) + users);

            if (!propMap.has(prop.site)) {
                propMap.set(prop.site, { id: prop.id, site: prop.site, domain: prop.domain || null, url: prop.url || null, count: 0 });
            }
            propMap.get(prop.site).count += users;
        }
    }

    // Query 2: per-city top page, plus the feed.
    const feed = [];
    const cityByName = new Map();
    for (const c of cityMap.values()) {
        const prev = cityByName.get(c.city);
        if (!prev || c.count > prev.count) cityByName.set(c.city, c);
    }
    for (const { prop, rows } of eventResults || []) {
        for (const row of rows || []) {
            const city = dim(row, 0) || NOT_SET;
            const page = dim(row, 1) || NOT_SET;
            const minutesAgo = Number.parseInt(dim(row, 2) || "0", 10) || 0;
            const count = met(row, 0);
            const keys = met(row, 1);
            if (!count) continue;
            const c = cityByName.get(city);
            if (c) {
                c._pages.set(page, (c._pages.get(page) || 0) + count);
                c.lastSeen = Math.min(c.lastSeen ?? minutesAgo, minutesAgo);
                const s = c._sites.get(prop.site);
                if (s) s._pages.set(page, (s._pages.get(page) || 0) + count);
            }
            // "(other)" is GA4's high-cardinality bucket, not a place or page.
            if (city !== "(other)" && page !== "(other)") feed.push({ city, countryId: c ? c.countryId : NOT_SET, site: prop.site, page, event: "page_view", isKey: keys > 0, minutesAgo, count });
        }
    }
    feed.sort((a, b) => a.minutesAgo - b.minutesAgo || b.count - a.count);

    const users = [...cityMap.values()].map(({ _sites, _pages, ...c }) => {
        const d = c.devices;
        const device = d.mobile >= d.desktop && d.mobile >= d.tablet ? "mobile" : d.desktop >= d.tablet ? "desktop" : "tablet";
        const sites = [..._sites.values()]
            .map(({ _pages: sp, ...s }) => ({ ...s, topPage: topKey(sp) }))
            .sort((a, b) => b.users - a.users);
        const topSite = sites[0]?.name ?? null;
        return { ...c, device, topSite, prop: topSite, topPage: topKey(_pages), sites };
    }).sort((a, b) => b.count - a.count);

    const byCount = (a, b) => b.count - a.count;
    const toList = (m) => [...m.entries()].map(([name, count]) => ({ name, count })).sort(byCount);

    return {
        users,
        cities: users.slice(0, 8).map((u) => ({ city: u.city, country: u.country, id: u.countryId, count: u.count })),
        countries: [...countryMap.values()].sort(byCount).slice(0, 10),
        devices: toList(deviceMap),
        platforms: toList(platformMap),
        properties: [...propMap.values()].sort(byCount),
        totalActiveUsers: total,
        keyEvents,
        feed: feed.slice(0, FEED_MAX),
    };
}

/**
 * Poll interval that keeps the globe under 25% of the hourly budget left.
 * ceil(3600 * tokensPerPoll / (0.25 * remaining)), rounded up to 15 s, clamped 30..300 s.
 */
function autoInterval({ tokensPerPoll, remaining }) {
    if (!(tokensPerPoll > 0) || !(remaining > 0)) return remaining === 0 ? 300 : 30;
    const raw = Math.ceil((3600 * tokensPerPoll) / (0.25 * remaining));
    return Math.min(300, Math.max(30, Math.ceil(raw / 15) * 15));
}

const qn = (v) => Number(v) || 0;

/** Hourly limit for a quota bucket, from what is left (360 properties have 10x the standard limit). */
function hourLimit(bucket, std) {
    const seen = qn(bucket?.consumed) + qn(bucket?.remaining);
    return seen > std ? std * 10 : std;
}

/**
 * Project-per-property hour bucket for one property. Buckets are per property, so all math is per property.
 * When the client omits tokensPerProjectPerHour, assume the project limit and count every token the
 * property spent this hour as ours (conservative). Never reports the 40,000 property cap.
 */
function projectBucket(q) {
    const pph = q?.tokensPerProjectPerHour;
    if (pph) return { limit: hourLimit(pph, STD_PROJECT_HOUR), remaining: qn(pph.remaining) };
    const ph = q?.tokensPerHour;
    if (!ph) return null;
    const phLimit = hourLimit(ph, STD_PROPERTY_HOUR);
    const limit = phLimit > STD_PROPERTY_HOUR ? STD_PROJECT_HOUR * 10 : STD_PROJECT_HOUR;
    return { limit, remaining: Math.max(0, limit - (phLimit - qn(ph.remaining))) };
}

/**
 * Refresh block for the payload from the last propertyQuota per property.
 * @param {Map<string, object>} quotas propertyId -> propertyQuota
 * @param {Map<string, number>} costs propertyId -> tokens one globe poll costs that property
 */
function refreshInfo(quotas, costs = new Map()) {
    let busiest = null;
    let autoSec = 0;
    let throttled = false;
    for (const [id, q] of quotas) {
        const b = projectBucket(q);
        if (!b) continue;
        const used = b.limit - b.remaining;
        if (b.remaining < 0.1 * b.limit) throttled = true;
        const ph = q.tokensPerHour;
        if (ph && qn(ph.remaining) < 0.1 * hourLimit(ph, STD_PROPERTY_HOUR)) throttled = true;
        autoSec = Math.max(autoSec, autoInterval({ tokensPerPoll: costs.get(id) || 0, remaining: b.remaining }));
        if (!busiest || used > busiest.used) busiest = { id, used, limit: b.limit };
    }
    if (!busiest) return null;
    return {
        autoSec,
        usedThisHour: Math.max(0, busiest.used),
        perHour: busiest.limit,
        busiestPropertyId: busiest.id,
        tokensPerPoll: Math.max(0, ...costs.values()),
        throttled,
    };
}

module.exports = { buildGlobeUsersPayload, autoInterval, refreshInfo, NOT_SET };
