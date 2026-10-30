/**
 * demoData.js
 * Demo mode (DEMO=1): fake GA4 Data and Admin clients that answer runRealtimeReport, runReport,
 * listAccounts, listProperties, listDataStreams and getProperty with generated rows in the
 * same shape Google returns. ga4Service hands these clients out instead of the real ones, so
 * every controller, cache and payload builder runs unchanged on top of them.
 *
 * Numbers come from a seeded PRNG: the same layout every run. Realtime totals follow each
 * property's local hour of day and drift a few percent every 20 seconds, so live views move.
 * All sites are fictional and use the reserved .example TLD.
 */

const path = require("path");

const enabled = () => /^(1|true|yes)$/i.test(process.env.DEMO || "");

/** Cache folder for this mode: demo data never mixes with a real .cache. */
function cacheDir(base) {
    return enabled() ? path.join(base, "demo") : base;
}

// ---------------------------------------------------------------------------
// Seeded randomness
// ---------------------------------------------------------------------------

function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
}

/** mulberry32: small, fast, good enough for demo numbers */
function prng(seed) {
    let a = typeof seed === "number" ? seed >>> 0 : hash(String(seed));
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** One stable number in [0, 1) for a key */
const unit = (key) => prng(key)();

function picker(items, weightOf) {
    const cum = [];
    let sum = 0;
    for (const it of items) { sum += Math.max(0, weightOf(it)); cum.push(sum); }
    return (r) => {
        const x = r * sum;
        let lo = 0, hi = cum.length - 1;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] > x) hi = mid; else lo = mid + 1; }
        return items[lo];
    };
}

// ---------------------------------------------------------------------------
// World: places, devices, sources
// ---------------------------------------------------------------------------

const COUNTRY = {
    US: "United States", IN: "India", GB: "United Kingdom", DE: "Germany", BR: "Brazil", ID: "Indonesia",
    JP: "Japan", NG: "Nigeria", AU: "Australia", CA: "Canada", FR: "France", NL: "Netherlands", MX: "Mexico",
    KE: "Kenya", ZA: "South Africa", PT: "Portugal", SG: "Singapore", KR: "South Korea", PH: "Philippines", ES: "Spain",
};

// [city, countryId, weight]. Every city is in controllers/cityCoords.ts, so it lands on the globe.
// Datacenter cities (bot: true) only appear in historical reports, never in realtime.
const CITY_REGIONS = {
    'New York': 'New York', 'Los Angeles': 'California', Chicago: 'Illinois', Houston: 'Texas', 'San Francisco': 'California',
    Seattle: 'Washington', Austin: 'Texas', Atlanta: 'Georgia', Miami: 'Florida', Boston: 'Massachusetts',
    Mumbai: 'Maharashtra', Delhi: 'Delhi', Bengaluru: 'Karnataka', Hyderabad: 'Telangana', Chennai: 'Tamil Nadu', Pune: 'Maharashtra', Kolkata: 'West Bengal',
    London: 'England', Manchester: 'England', Edinburgh: 'Scotland', Birmingham: 'England', Berlin: 'Berlin', Munich: 'Bavaria', Hamburg: 'Hamburg', Frankfurt: 'Hesse',
    'São Paulo': 'São Paulo', 'Rio de Janeiro': 'Rio de Janeiro', Curitiba: 'Paraná', Jakarta: 'Jakarta', Surabaya: 'East Java', Bandung: 'West Java',
    Tokyo: 'Tokyo', Osaka: 'Osaka', Nagoya: 'Aichi', Lagos: 'Lagos', Abuja: 'Federal Capital Territory', Sydney: 'New South Wales', Melbourne: 'Victoria', Brisbane: 'Queensland',
    Toronto: 'Ontario', Vancouver: 'British Columbia', Paris: 'Île-de-France', Amsterdam: 'North Holland', 'Mexico City': 'Mexico City', Nairobi: 'Nairobi',
    Johannesburg: 'Gauteng', Lisbon: 'Lisbon', Singapore: 'Singapore', Seoul: 'Seoul', Manila: 'Metro Manila', Madrid: 'Community of Madrid',
};
const COUNTRY_LANGUAGES = { US: 'en-us', IN: 'en-in', GB: 'en-gb', DE: 'de-de', BR: 'pt-br', ID: 'id-id', JP: 'ja-jp', NG: 'en-ng', AU: 'en-au', CA: 'en-ca', FR: 'fr-fr', NL: 'nl-nl', MX: 'es-mx', KE: 'en-ke', ZA: 'en-za', PT: 'pt-pt', SG: 'en-sg', KR: 'ko-kr', PH: 'en-ph', ES: 'es-es' };
const CITIES = [
    ["New York", "US", 9], ["Los Angeles", "US", 6], ["Chicago", "US", 4], ["Houston", "US", 3], ["San Francisco", "US", 3],
    ["Seattle", "US", 2.5], ["Austin", "US", 2], ["Atlanta", "US", 2], ["Miami", "US", 2], ["Boston", "US", 2],
    ["Mumbai", "IN", 7], ["Delhi", "IN", 6], ["Bengaluru", "IN", 6], ["Hyderabad", "IN", 4], ["Chennai", "IN", 3], ["Pune", "IN", 3], ["Kolkata", "IN", 2.5],
    ["London", "GB", 7], ["Manchester", "GB", 2], ["Edinburgh", "GB", 1.2], ["Birmingham", "GB", 1.5],
    ["Berlin", "DE", 4], ["Munich", "DE", 2.5], ["Hamburg", "DE", 2], ["Frankfurt", "DE", 1.5],
    ["São Paulo", "BR", 5], ["Rio de Janeiro", "BR", 3], ["Curitiba", "BR", 1],
    ["Jakarta", "ID", 5], ["Surabaya", "ID", 1.5], ["Bandung", "ID", 1.2],
    ["Tokyo", "JP", 6], ["Osaka", "JP", 2.5], ["Nagoya", "JP", 1],
    ["Lagos", "NG", 4], ["Abuja", "NG", 1.5],
    ["Sydney", "AU", 3.5], ["Melbourne", "AU", 3], ["Brisbane", "AU", 1.2],
    ["Toronto", "CA", 3], ["Vancouver", "CA", 1.5],
    ["Paris", "FR", 3.5], ["Amsterdam", "NL", 2], ["Mexico City", "MX", 3], ["Nairobi", "KE", 1.5],
    ["Johannesburg", "ZA", 1.5], ["Lisbon", "PT", 1.2], ["Singapore", "SG", 2], ["Seoul", "KR", 2.5],
    ["Manila", "PH", 2.5], ["Madrid", "ES", 2],
].map(([city, countryId, w]) => ({ key: `${city}|${countryId}`, city, countryId, country: COUNTRY[countryId], region: CITY_REGIONS[city] || '(not set)', w }));
CITIES.push(
    { key: "Ashburn|US", city: "Ashburn", countryId: "US", country: COUNTRY.US, w: 0.9, bot: true },
    { key: "Boardman|US", city: "Boardman", countryId: "US", country: COUNTRY.US, w: 0.5, bot: true },
);

// [category, os, browser, weight, engagement factor]
const DEVICES = [
    ["desktop", "Windows", "Chrome", 22, 1.08], ["desktop", "Macintosh", "Chrome", 7, 1.1], ["desktop", "Macintosh", "Safari", 5, 1.1],
    ["desktop", "Windows", "Edge", 5, 1.05], ["desktop", "Windows", "Firefox", 2, 1.05], ["desktop", "Linux", "Firefox", 2, 1.12],
    ["mobile", "Android", "Chrome", 30, 0.94], ["mobile", "iOS", "Safari", 17, 0.95], ["mobile", "Android", "Samsung Internet", 4, 0.9],
    ["mobile", "iOS", "Chrome", 3, 0.93], ["tablet", "iOS", "Safari", 2.5, 1], ["tablet", "Android", "Chrome", 1.5, 0.97],
].map(([category, os, browser, w, eng]) => ({ key: `${category}|${os}|${browser}`, category, os, browser, w, eng }));

// [source, medium, channel, referrer, weight, engagement factor, duration factor]
const SOURCES = [
    ["google", "organic", "Organic Search", "https://www.google.com/", 46, 1.08, 1.05],
    ["(direct)", "(none)", "Direct", "", 22, 0.9, 1],
    ["bing", "organic", "Organic Search", "https://www.bing.com/", 4, 1.05, 1],
    ["duckduckgo", "organic", "Organic Search", "https://duckduckgo.com/", 1.6, 1.08, 1.1],
    ["chatgpt.com", "referral", "Referral", "https://chatgpt.com/", 3.2, 1.2, 1.35],
    ["perplexity.ai", "referral", "Referral", "https://www.perplexity.ai/", 0.9, 1.18, 1.3],
    ["reddit.com", "referral", "Organic Social", "https://www.reddit.com/r/somethingimade/comments/1k2x9q/", 3, 0.78, 0.8],
    ["news.ycombinator.com", "referral", "Referral", "https://news.ycombinator.com/item?id=41827736", 1.2, 0.7, 0.75],
    ["t.co", "referral", "Organic Social", "https://t.co/", 1.6, 0.62, 0.6],
    ["facebook.com", "referral", "Organic Social", "https://m.facebook.com/", 1.8, 0.7, 0.7],
    ["linkedin.com", "referral", "Organic Social", "https://www.linkedin.com/", 1, 0.85, 0.9],
    ["github.com", "referral", "Referral", "https://github.com/", 0.8, 1.1, 1.2],
    ["newsletter", "email", "Email", "", 2.4, 1.25, 1.3],
    ["youtube.com", "referral", "Organic Video", "https://www.youtube.com/", 0.9, 0.8, 0.9],
].map(([source, medium, channel, referrer, w, eng, dur]) => ({ key: `${source}|${medium}`, source, medium, channel, referrer, w, eng, dur }));

const COMMON_EVENTS = [
    // [name, events per session, share of sessions with it]
    ["page_view", 2.3, 1], ["session_start", 1, 1], ["user_engagement", 1.7, 0.66], ["scroll", 0.95, 0.46],
    ["first_visit", 0.6, 0.6], ["click", 0.32, 0.22], ["view_search_results", 0.12, 0.08],
];

// ---------------------------------------------------------------------------
// Properties (all fictional, reserved .example domains)
// ---------------------------------------------------------------------------

const PROPS = [
    {
        id: "311000101", site: "Northwind Store", domain: "northwind-store.example", tz: "America/New_York", currency: "USD",
        daily: 9000, growth: 0.004, home: { US: 5, GB: 2.5, CA: 3, DE: 1.6 }, eng: 0.64, avgEng: 61, pvps: 3.4, newShare: 0.58,
        events: [["view_item", 1.2, 0.42], ["add_to_cart", 0.13, 0.09], ["begin_checkout", 0.06, 0.05], ["purchase", 0.024, 0.024, 68, true]],
        pages: [
            ["/", "Northwind Store | Everyday goods, fairly priced", 20],
            ["/collections/kitchen", "Kitchen essentials | Northwind Store", 11],
            ["/products/cast-iron-skillet-10in", "Cast iron skillet, 10 inch | Northwind Store", 9],
            ["/products/linen-apron", "Linen apron in sage | Northwind Store", 6],
            ["/collections/new-arrivals", "New arrivals | Northwind Store", 7],
            ["/cart", "Your cart | Northwind Store", 5],
            ["/checkout", "Checkout | Northwind Store", 2.5],
            ["/blog/how-to-season-cast-iron", "How to season cast iron in 4 steps | Northwind Journal", 6],
            ["/pages/shipping", "Shipping and returns | Northwind Store", 2],
        ],
    },
    {
        id: "311000102", site: "Lumen Notes", domain: "lumen-notes.example", tz: "Europe/Berlin", currency: "EUR",
        daily: 5500, growth: 0.009, home: { DE: 5, NL: 4, FR: 2.5, GB: 2, US: 1.4 }, eng: 0.7, avgEng: 94, pvps: 2.6, newShare: 0.46,
        sourceBoost: { "github.com": 4, "news.ycombinator.com": 3, "chatgpt.com": 1.6 },
        events: [["sign_up", 0.035, 0.035, 0, true], ["start_trial", 0.012, 0.012, 0, true], ["file_download", 0.08, 0.06]],
        pages: [
            ["/", "Lumen Notes, a calm place for your thinking", 18],
            ["/pricing", "Pricing | Lumen Notes", 9],
            ["/features/backlinks", "Backlinks and graph view | Lumen Notes", 7],
            ["/download", "Download for Mac, Windows and Linux | Lumen Notes", 8],
            ["/docs/getting-started", "Getting started | Lumen Notes Docs", 10],
            ["/docs/sync", "Encrypted sync | Lumen Notes Docs", 5],
            ["/blog/plain-text-forever", "Why we bet on plain text | Lumen Notes Blog", 6],
            ["/changelog", "Changelog | Lumen Notes", 4],
        ],
    },
    {
        id: "311000103", site: "Pixel Recipes", domain: "pixel-recipes.example", tz: "America/Los_Angeles", currency: "USD",
        daily: 4000, growth: 0.002, home: { US: 4, IN: 2, GB: 1.6, AU: 1.8, CA: 1.5 }, eng: 0.58, avgEng: 72, pvps: 2.2, newShare: 0.71,
        spike: 3.4, ads: 6.5, sourceBoost: { "reddit.com": 2, "facebook.com": 2.2, "youtube.com": 1.8 },
        events: [["recipe_print", 0.09, 0.07], ["newsletter_signup", 0.009, 0.009, 0, true], ["save_recipe", 0.04, 0.03, 0, true]],
        viral: "/recipes/one-pan-gochujang-noodles",
        pages: [
            ["/", "Pixel Recipes | Weeknight cooking, tested twice", 12],
            ["/recipes/one-pan-gochujang-noodles", "One-pan gochujang noodles (20 minutes) | Pixel Recipes", 7],
            ["/recipes/crispy-chickpea-bowls", "Crispy chickpea bowls | Pixel Recipes", 8],
            ["/recipes/lemon-garlic-salmon", "Lemon garlic salmon with greens | Pixel Recipes", 7],
            ["/recipes/3-ingredient-banana-bread", "3-ingredient banana bread | Pixel Recipes", 9],
            ["/collections/meal-prep", "Meal prep for the week | Pixel Recipes", 5],
            ["/recipes/masala-oats", "Savory masala oats | Pixel Recipes", 4],
            ["/about", "About the kitchen | Pixel Recipes", 1.5],
        ],
    },
    {
        id: "311000104", site: "Monsoon Weather Desk", domain: "monsoon-desk.example", tz: "Asia/Kolkata", currency: "INR",
        daily: 3200, growth: -0.006, home: { IN: 12, SG: 1.5 }, eng: 0.55, avgEng: 38, pvps: 1.9, newShare: 0.52, ads: 1.4,
        events: [["alert_subscribe", 0.012, 0.012, 0, true], ["radar_play", 0.4, 0.25]],
        pages: [
            ["/", "Monsoon Weather Desk | Live radar and rain alerts", 22],
            ["/forecast/mumbai", "Mumbai 10-day forecast | Monsoon Weather Desk", 12],
            ["/forecast/bengaluru", "Bengaluru 10-day forecast | Monsoon Weather Desk", 9],
            ["/forecast/delhi", "Delhi air quality and forecast | Monsoon Weather Desk", 10],
            ["/radar", "Live rain radar | Monsoon Weather Desk", 11],
            ["/cyclone-tracker", "Cyclone tracker | Monsoon Weather Desk", 5],
            ["/blog/reading-a-rain-radar", "How to read a rain radar | Monsoon Weather Desk", 3],
        ],
    },
    {
        id: "311000105", site: "Kestrel Maps", domain: "kestrel-maps.example", tz: "Asia/Tokyo", currency: "JPY",
        daily: 2300, growth: -0.004, home: { JP: 6, ID: 3.5, AU: 2, KR: 2, PH: 1.6, SG: 1.5 }, eng: 0.66, avgEng: 84, pvps: 2.9, newShare: 0.49,
        app: true,
        events: [["route_planned", 0.5, 0.3], ["offline_pack_download", 0.03, 0.03, 0, true]],
        pages: [
            ["/", "Kestrel Maps | Trail and transit maps that work offline", 15],
            ["/map", "Map | Kestrel Maps", 20],
            ["/routes/kyoto-philosophers-path", "Philosopher's Path walking route | Kestrel Maps", 6],
            ["/routes/bali-north-coast", "Bali north coast by scooter | Kestrel Maps", 5],
            ["/offline", "Offline packs | Kestrel Maps", 6],
            ["/pricing", "Plans | Kestrel Maps", 3],
        ],
    },
    {
        id: "311000106", site: "Harbor Jobs Board", domain: "harbor-jobs.example", tz: "Africa/Lagos", currency: "USD",
        daily: 1500, growth: 0.006, home: { NG: 9, KE: 4, ZA: 4, GB: 1.5 }, eng: 0.6, avgEng: 70, pvps: 3.1, newShare: 0.44,
        sourceBoost: { "linkedin.com": 5, "t.co": 1.5 },
        events: [["apply_click", 0.11, 0.08, 0, true], ["job_alert_created", 0.015, 0.015, 0, true]],
        pages: [
            ["/", "Harbor Jobs | Remote and local roles across Africa", 18],
            ["/jobs/remote", "Remote jobs | Harbor Jobs", 14],
            ["/jobs/lagos/frontend-developer", "Frontend developer, Lagos | Harbor Jobs", 6],
            ["/jobs/nairobi/data-analyst", "Data analyst, Nairobi | Harbor Jobs", 5],
            ["/companies", "Companies hiring now | Harbor Jobs", 6],
            ["/salary-guide", "2026 tech salary guide | Harbor Jobs", 7],
        ],
    },
    {
        id: "311000107", site: "Trailhead Gear Notes", domain: "trailhead-gear.example", tz: "Australia/Sydney", currency: "AUD",
        daily: 950, growth: -0.003, home: { AU: 8, US: 1.5, GB: 1.2 }, eng: 0.61, avgEng: 102, pvps: 2.4, newShare: 0.67, ads: 4,
        events: [["affiliate_click", 0.07, 0.06, 0, true]],
        pages: [
            ["/", "Trailhead Gear Notes | Honest gear tests", 14],
            ["/reviews/ultralight-tents-2026", "The best ultralight tents of 2026 | Trailhead Gear Notes", 11],
            ["/reviews/trail-runners", "Trail runners we actually finished in | Trailhead Gear Notes", 8],
            ["/guides/packing-list-overnight", "Overnight hike packing list | Trailhead Gear Notes", 7],
            ["/guides/water-filters", "Water filters compared | Trailhead Gear Notes", 5],
        ],
    },
    {
        id: "311000108", site: "Saudade Language Lab", domain: "saudade-lab.example", tz: "America/Sao_Paulo", currency: "BRL",
        daily: 650, growth: 0.012, home: { BR: 10, PT: 6, US: 1.2 }, eng: 0.69, avgEng: 140, pvps: 3.8, newShare: 0.38,
        sourceBoost: { "youtube.com": 4, newsletter: 2 },
        events: [["lesson_complete", 0.6, 0.35], ["sign_up", 0.03, 0.03, 0, true]],
        pages: [
            ["/", "Saudade Language Lab | Learn Portuguese by listening", 16],
            ["/lessons/a1/greetings", "A1: Greetings and small talk | Saudade Lab", 10],
            ["/lessons/a2/past-tense", "A2: The past tense without tears | Saudade Lab", 7],
            ["/podcast", "Podcast | Saudade Language Lab", 8],
            ["/pricing", "Pricing | Saudade Language Lab", 3],
        ],
    },
].map(buildProp);

function buildProp(p) {
    const geo = CITIES.map((c) => ({ ...c, w: c.w * (p.home[c.countryId] || 0.35) * (0.7 + 0.6 * unit(`${p.id}:geo:${c.key}`)) }));
    const sources = SOURCES.map((s) => ({ ...s, w: s.w * ((p.sourceBoost || {})[s.source] || 1) * (0.75 + 0.5 * unit(`${p.id}:src:${s.key}`)) }));
    const devices = DEVICES.map((d) => ({ ...d, w: d.w * (0.8 + 0.4 * unit(`${p.id}:dev:${d.key}`)) }));
    const pages = p.pages.map(([path, title, w]) => ({ key: path, path, title, w }));
    const events = [...COMMON_EVENTS, ...p.events].map(([name, rate, sess, value = 0, key = false]) => ({ key: name, name, rate, sess, value, isKey: key }));
    return { ...p, url: `https://${p.domain}/`, geo, sources, devices, pages, events };
}

const PROP_BY_ID = new Map(PROPS.map((p) => [p.id, p]));

// ---------------------------------------------------------------------------
// Time model
// ---------------------------------------------------------------------------

// Share of a day's sessions per local hour (0..23), sums to ~1
const DIURNAL = (() => {
    const raw = [1.6, 1.1, 0.8, 0.6, 0.6, 0.9, 1.6, 2.6, 3.6, 4.4, 4.9, 5.2, 5.5, 5.6, 5.5, 5.4, 5.3, 5.3, 5.5, 5.8, 5.9, 5.2, 3.9, 2.6];
    const s = raw.reduce((a, b) => a + b, 0);
    return raw.map((v) => v / s);
})();
const WEEKDAY = [0.84, 1.05, 1.08, 1.07, 1.04, 0.97, 0.86]; // Sun..Sat
const DAY_MS = 86400000;

/** Local calendar parts of `date` in a time zone */
function localParts(tz, date = new Date()) {
    const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
    const o = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
    return { ymd: `${o.year}${o.month}${o.day}`, hour: Number(o.hour) };
}

/** Day index (UTC midnight epoch days) for a YYYYMMDD string */
const dayNum = (ymd) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)) / DAY_MS;
const ymdOf = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10).replace(/-/g, "");

/** Sessions on one local day (full day; today is cut to the hours so far by the caller) */
function daySessions(p, ymd, todayNum) {
    const n = dayNum(ymd);
    const ago = todayNum - n;
    const dow = new Date(n * DAY_MS).getUTCDay();
    const noise = 0.9 + 0.2 * unit(`${p.id}:day:${ymd}`);
    // One older Reddit bump on the spiking property, so the trend line has history too
    const bump = p.spike && ago === 12 ? 1.9 : p.spike && ago === 11 ? 1.3 : 1;
    return p.daily * 1.25 * WEEKDAY[dow] * Math.exp(-p.growth * ago) * noise * bump;
}

function hourShare(p, ymd, hour) {
    return DIURNAL[hour] * (0.92 + 0.16 * unit(`${p.id}:hr:${ymd}${hour}`));
}

/** Active users in one local hour */
function hourUsers(p, ymd, hour, todayNum) {
    return daySessions(p, ymd, todayNum) * hourShare(p, ymd, hour) * 0.85;
}

/** Realtime (last 30 min) active users right now, with a slow drift every 20 s */
function realtimeUsers(p, now = new Date()) {
    const { ymd, hour } = localParts(p.tz, now);
    const base = hourUsers(p, ymd, hour, dayNum(ymd)) / 2;
    const tick = Math.floor(now.getTime() / 20000);
    const drift = 1 + 0.08 * (unit(`${p.id}:drift:${tick}`) - 0.5);
    return Math.max(1, Math.round(base * (p.spike || 1) * drift));
}

/** Resolve a GA4 date string relative to the property's today */
function resolveDate(s, todayNum) {
    if (s === "today") return todayNum;
    if (s === "yesterday") return todayNum - 1;
    const m = /^(\d+)daysAgo$/.exec(s || "");
    if (m) return todayNum - Number(m[1]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s || "")) return dayNum(s.replace(/-/g, ""));
    return todayNum;
}

// ---------------------------------------------------------------------------
// Dimension model: each GA4 dimension belongs to one entity group
// ---------------------------------------------------------------------------

const DIM_GROUP = {
    country: "geo", countryId: "geo", city: "geo", region: "geo", continent: "geo", languageCode: "geo",
    sessionSource: "src", sessionMedium: "src", sessionSourceMedium: "src", sessionDefaultChannelGroup: "src",
    sessionManualSource: "src", sessionManualMedium: "src", sessionManualCampaignName: "src", sessionManualAdContent: "src", sessionManualTerm: "src",
    pageLocation: "page",
    firstUserDefaultChannelGroup: "src", firstUserSource: "src", firstUserMedium: "src", source: "src", medium: "src", pageReferrer: "src",
    pagePath: "page", pagePathPlusQueryString: "page", landingPagePlusQueryString: "page", landingPage: "page",
    pageTitle: "page", unifiedScreenName: "page", unifiedPagePathScreen: "page",
    deviceCategory: "dev", operatingSystem: "dev", browser: "dev", platform: "dev", screenResolution: "dev",
    eventName: "evt", isKeyEvent: "evt",
    newVsReturning: "vis",
    date: "time", dateHour: "time", hour: "time", nthDay: "time", dayOfWeek: "time", minutesAgo: "time",
};

function dimValue(name, a, p) {
    switch (name) {
        case "country": return a.geo.country;
        case "countryId": return a.geo.countryId;
        case "city": return a.geo.city;
        case "region": return a.geo.region || '(not set)';
        case "continent": return "(not set)";
        case "languageCode": return COUNTRY_LANGUAGES[a.geo.countryId] || 'en';
        case "sessionSource": case "firstUserSource": case "source": return a.src.source;
        case "sessionMedium": case "firstUserMedium": case "medium": return a.src.medium;
        case "sessionSourceMedium": return `${a.src.source} / ${a.src.medium}`;
        case "sessionManualSource": return a.src.source;
        case "sessionManualMedium": return a.src.medium;
        case "sessionManualCampaignName": return a.src.medium === 'email' ? 'monthly_newsletter' : '(not set)';
        case "sessionManualAdContent": return a.src.medium === 'email' ? 'header_link' : '(not set)';
        case "sessionManualTerm": return '(not set)';
        case "sessionDefaultChannelGroup": case "firstUserDefaultChannelGroup": return a.src.channel;
        case "pageReferrer": return a.src.referrer;
        case "pagePath": case "pagePathPlusQueryString": case "landingPage": case "unifiedPagePathScreen": return a.page.path;
        case "landingPagePlusQueryString": return a.page.path;
        case "pageLocation": return `https://${p.domain}${a.page.path}` + (a.src?.medium === 'email' ? '?utm_source=newsletter&utm_medium=email&utm_campaign=monthly_newsletter&utm_content=header_link' : '');
        case "pageTitle": case "unifiedScreenName": return a.page.title;
        case "deviceCategory": return a.dev.category;
        case "operatingSystem": return a.dev.os;
        case "screenResolution": return a.dev.category === 'tablet' ? '1024x1366' : a.dev.category === 'mobile' ? (a.dev.os === 'iOS' ? '390x844' : '412x915') : a.dev.os === 'Macintosh' ? '1440x900' : '1920x1080';
        case "browser": return a.dev.browser;
        case "platform": return a.platform || "web";
        case "eventName": return a.evt.name;
        case "isKeyEvent": return String(a.evt.isKey);
        case "newVsReturning": return a.vis;
        case "date": return a.ymd;
        case "dateHour": return a.ymd + String(a.hour ?? 0).padStart(2, "0");
        case "hour": return String(a.hour ?? 0).padStart(2, "0");
        case "dayOfWeek": return String(new Date(dayNum(a.ymd) * DAY_MS).getUTCDay());
        case "minutesAgo": return String(a.minutesAgo).padStart(2, "0");
        case "streamName": return `${p.site} web`;
        case "hostName": return p.domain;
        default: return "(not set)";
    }
}

/** GA4 FilterExpression on one atom (filter, notExpression, andGroup, orGroup) */
function passes(expr, val) {
    if (!expr) return true;
    if (expr.andGroup) return (expr.andGroup.expressions || []).every((e) => passes(e, val));
    if (expr.orGroup) return (expr.orGroup.expressions || []).some((e) => passes(e, val));
    if (expr.notExpression) return !passes(expr.notExpression, val);
    const f = expr.filter;
    if (!f) return true;
    const v = String(val(f.fieldName) ?? "");
    if (f.inListFilter) return (f.inListFilter.values || []).includes(v);
    const sf = f.stringFilter;
    if (!sf) return true;
    const cs = sf.caseSensitive;
    const a = cs ? v : v.toLowerCase();
    const b = cs ? String(sf.value) : String(sf.value).toLowerCase();
    switch (sf.matchType) {
        case "CONTAINS": return a.includes(b);
        case "BEGINS_WITH": return a.startsWith(b);
        case "ENDS_WITH": return a.endsWith(b);
        case "FULL_REGEXP": try { return new RegExp(`^(?:${sf.value})$`, cs ? "" : "i").test(v); } catch { return false; }
        case "PARTIAL_REGEXP": try { return new RegExp(sf.value, cs ? "" : "i").test(v); } catch { return false; }
        default: return a === b;
    }
}

function filterFields(expr, out = new Set()) {
    if (!expr) return out;
    for (const e of [...(expr.andGroup?.expressions || []), ...(expr.orGroup?.expressions || [])]) filterFields(e, out);
    if (expr.notExpression) filterFields(expr.notExpression, out);
    if (expr.filter?.fieldName) out.add(expr.filter.fieldName);
    return out;
}

// ---------------------------------------------------------------------------
// Rows: group atoms by dimension values, sum base metrics, derive the rest
// ---------------------------------------------------------------------------

const RATIO = new Set(["engagementRate", "bounceRate", "averageSessionDuration", "screenPageViewsPerSession", "sessionsPerUser", "eventsPerSession", "userEngagementDurationPerUser"]);
const MONEY = new Set(["totalRevenue", "purchaseRevenue", "totalAdRevenue", "eventValue", "averagePurchaseRevenue", "itemRevenue"]);

function metricValue(name, m) {
    switch (name) {
        case "activeUsers": case "totalUsers": return m.users;
        case "newUsers": return m.newUsers;
        case "sessions": return m.sessions;
        case "engagedSessions": return m.engaged;
        case "screenPageViews": case "views": return m.views;
        case "userEngagementDuration": return m.duration;
        case "eventCount": return m.events;
        case "keyEvents": case "conversions": return m.keyEvents;
        case "eventValue": return m.eventValue;
        case "purchaseRevenue": case "itemRevenue": return m.purchase;
        case "totalAdRevenue": return m.adRevenue;
        case "totalRevenue": return m.purchase + m.adRevenue;
        case "publisherAdImpressions": return m.adImpressions;
        case "publisherAdClicks": return m.adClicks;
        case "transactions": case "ecommercePurchases": return m.purchases;
        case "engagementRate": return m.sessions ? m.engaged / m.sessions : 0;
        case "bounceRate": return m.sessions ? 1 - m.engaged / m.sessions : 0;
        case "averageSessionDuration": return m.sessions ? (m.duration * 1.3) / m.sessions : 0;
        case "screenPageViewsPerSession": return m.sessions ? m.views / m.sessions : 0;
        case "sessionsPerUser": return m.users ? m.sessions / m.users : 0;
        case "eventsPerSession": return m.sessions ? m.events / m.sessions : 0;
        case "userEngagementDurationPerUser": return m.users ? m.duration / m.users : 0;
        default: return 0;
    }
}

const fmt = (name, v) => (RATIO.has(name) ? String(Math.round(v * 10000) / 10000) : MONEY.has(name) ? String(Math.round(v * 100) / 100) : String(Math.round(v)));

const ZERO = () => ({ users: 0, newUsers: 0, sessions: 0, engaged: 0, views: 0, duration: 0, events: 0, keyEvents: 0, eventValue: 0, purchase: 0, purchases: 0, adRevenue: 0, adImpressions: 0, adClicks: 0 });

function addInto(t, m) { for (const k in m) t[k] += m[k]; }

function toResponse(p, atoms, dims, metrics, req) {
    const dimNames = dims.map((d) => d.name);
    const metNames = metrics.map((m) => m.name);
    const startDay = dimNames.includes("nthDay")
        ? resolveDate(req.dateRanges[0].startDate, dayNum(localParts(p.tz).ymd)) : 0;
    const groups = new Map();
    const total = ZERO();
    for (const a of atoms) {
        if (req.dimensionFilter && !passes(req.dimensionFilter, (f) => dimValue(f, a, p))) continue;
        const vals = dimNames.map((n) => n === "nthDay"
            ? String(dayNum(a.ymd) - startDay).padStart(4, "0") : dimValue(n, a, p));
        const key = vals.join("\u0001");
        if (!groups.has(key)) groups.set(key, { vals, m: ZERO() });
        addInto(groups.get(key).m, a.m);
        addInto(total, a.m);
    }
    let rows = [...groups.values()]
        .map((g) => ({ vals: g.vals, mv: metNames.map((n) => metricValue(n, g.m)) }))
        .filter((r) => r.mv.some((v) => Math.round(v * 100) !== 0));

    const order = (req.orderBys && req.orderBys.length) ? req.orderBys[0] : null;
    if (order?.dimension) {
        const i = dimNames.indexOf(order.dimension.dimensionName);
        if (i >= 0) rows.sort((a, b) => (order.desc ? -1 : 1) * a.vals[i].localeCompare(b.vals[i]));
    } else {
        const i = order?.metric ? Math.max(0, metNames.indexOf(order.metric.metricName)) : 0;
        const desc = order?.metric ? order.desc !== false : true;
        rows.sort((a, b) => (desc ? b.mv[i] - a.mv[i] : a.mv[i] - b.mv[i]));
    }
    const limit = Number(req.limit) || 10000;
    const rowCount = rows.length;
    rows = rows.slice(0, limit);
    const metricValues = (mv) => mv.map((v, i) => ({ value: fmt(metNames[i], v) }));
    return {
        dimensionHeaders: dimNames.map((name) => ({ name })),
        metricHeaders: metNames.map((name) => ({ name, type: MONEY.has(name) ? "TYPE_CURRENCY" : "TYPE_INTEGER" })),
        rows: rows.map((r) => ({ dimensionValues: r.vals.map((value) => ({ value })), metricValues: metricValues(r.mv) })),
        totals: [{ dimensionValues: [], metricValues: metricValues(metNames.map((n) => metricValue(n, total))) }],
        rowCount,
        propertyQuota: quota(p.id),
        metadata: { timeZone: p.tz },
        kind: "analyticsData#runReport",
    };
}

// ---------------------------------------------------------------------------
// Historical reports (runReport)
// ---------------------------------------------------------------------------

/** Base metrics for `s` sessions in one combination of entities */
function sessionMetrics(p, s, a) {
    const bot = a.geo?.bot;
    const engRate = Math.min(0.95, p.eng * (a.src?.eng || 1) * (a.dev?.eng || 1)) * (bot ? 0.03 : 1);
    const dur = p.avgEng * (a.src?.dur || 1) * (bot ? 0.01 : 1);
    const users = s * 0.8;
    const newShare = a.vis ? (a.vis === "new" ? 1 : 0) : p.newShare;
    const views = s * p.pvps * (bot ? 0.4 : 1);
    let events, keyEvents, eventValue, purchase, purchases;
    let sessions = s;
    if (a.evt) {
        const e = a.evt;
        sessions = s * e.sess;
        events = s * e.rate;
        keyEvents = e.isKey ? events : 0;
        eventValue = e.isKey ? events * e.value : 0;
        purchase = e.name === "purchase" ? events * e.value : 0;
        purchases = e.name === "purchase" ? events : 0;
    } else {
        events = keyEvents = eventValue = purchase = purchases = 0;
        for (const e of p.events) {
            events += s * e.rate;
            if (e.isKey) { keyEvents += s * e.rate; eventValue += s * e.rate * e.value; }
            if (e.name === "purchase") { purchase += s * e.rate * e.value; purchases += s * e.rate; }
        }
    }
    if (bot) keyEvents = eventValue = purchase = purchases = 0;
    const adImpressions = p.ads ? views * 1.8 : 0;
    return {
        users, newUsers: users * newShare, sessions, engaged: sessions * engRate, views: a.evt ? 0 : views,
        duration: sessions * dur, events, keyEvents, eventValue, purchase, purchases,
        adRevenue: p.ads ? (views * p.ads) / 1000 : 0, adImpressions, adClicks: adImpressions * 0.007,
    };
}

/** Normalized weights for one entity list, with a per-period wobble so period-over-period rows move both ways */
function weighted(list, p, group, periodKey, boost = () => 1) {
    const ws = list.map((e) => e.w * boost(e) * Math.exp(0.5 * (unit(`${p.id}:${group}:${e.key}:${periodKey}`) - 0.5)));
    const s = ws.reduce((a, b) => a + b, 0) || 1;
    return list.map((e, i) => ({ e, w: ws[i] / s }));
}

function runReport(req) {
    const id = String(req.property || "").split("/").pop();
    const p = PROP_BY_ID.get(id);
    if (!p) throw Object.assign(new Error(`Demo: unknown property ${id}`), { code: 7 });

    if (req.cohortSpec) return runCohortReport(p, req);

    const dims = req.dimensions || [];
    const metrics = req.metrics || [];
    const range = (req.dateRanges || [])[0] || { startDate: "28daysAgo", endDate: "today" };
    const now = new Date();
    const { ymd: todayYmd, hour: nowHour } = localParts(p.tz, now);
    const todayNum = dayNum(todayYmd);
    const start = resolveDate(range.startDate, todayNum);
    const end = Math.min(todayNum, resolveDate(range.endDate, todayNum));
    const periodKey = `${start}-${end}`;
    const nDays = Math.max(1, end - start + 1);

    // Explicit demo transitions; the generic source/page Cartesian product has no internal referrers.
    if (dims.map(d => d.name).join(',') === 'hostName,pageReferrer,pagePath') {
        const rows = p.pages.flatMap((from, i) => p.pages.slice(0, 3).map((to, j) => ({
            dimensionValues: [{ value: p.domain }, { value: `https://${p.domain}${from.path}` }, { value: to.path }],
            metricValues: [{ value: String(Math.max(1, Math.round(p.daily * nDays * 0.24 / ((i + 1) * (j + 1))))) }],
        }))).sort((a, b) => Number(b.metricValues[0].value) - Number(a.metricValues[0].value));
        return {
            dimensionHeaders: dims.map(d => ({ name: d.name })),
            metricHeaders: [{ name: 'screenPageViews', type: 'TYPE_INTEGER' }],
            rows: rows.slice(0, Number(req.limit) || 10000), rowCount: rows.length,
            metadata: { timeZone: p.tz, dataLossFromOtherRow: false, samplingMetadatas: [] },
        };
    }

    const names = new Set([...dims.map((d) => d.name), ...filterFields(req.dimensionFilter)]);
    const need = new Set([...names].map((n) => DIM_GROUP[n]).filter(Boolean));
    const byHour = names.has("dateHour") || names.has("hour");

    // Day (and hour) slots with their session counts
    const slots = [];
    for (let n = start; n <= end; n++) {
        const ymd = ymdOf(n);
        const day = daySessions(p, ymd, todayNum);
        const lastHour = n === todayNum ? nowHour : 23;
        if (byHour) {
            for (let h = 0; h <= lastHour; h++) {
                const spike = p.spike && n === todayNum && h >= nowHour - 1 ? p.spike : 1;
                slots.push({ ymd, hour: h, s: day * hourShare(p, ymd, h) * spike });
            }
        } else {
            let share = 1;
            if (n === todayNum) { share = 0; for (let h = 0; h <= nowHour; h++) share += hourShare(p, ymd, h); }
            slots.push({ ymd, s: day * share * (p.spike && n === todayNum ? 1.3 : 1) });
        }
    }
    const timeSlots = need.has("time") ? slots : [{ ymd: ymdOf(end), s: slots.reduce((a, x) => a + x.s, 0) }];

    // Reddit carries the spike on the spiking property, more so in short ranges that include today
    const srcBoost = (e) => (p.spike && end === todayNum && e.source === "reddit.com" ? 1 + 10 / nDays : 1);
    const pageBoost = (e) => (p.viral && end === todayNum && e.path === p.viral ? 1 + 6 / nDays : 1);
    const lists = {
        geo: weighted(p.geo, p, "geo", periodKey),
        src: weighted(p.sources, p, "src", periodKey, srcBoost),
        page: weighted(p.pages, p, "page", periodKey, pageBoost),
        dev: weighted(p.devices, p, "dev", periodKey),
        vis: [{ e: "new", w: p.newShare }, { e: "returning", w: 1 - p.newShare }],
        evt: p.events.map((e) => ({ e, w: 1 })),
    };

    // Cartesian product of the needed entity groups
    let combos = [{ a: {}, w: 1 }];
    for (const g of ["geo", "src", "page", "dev", "vis", "evt"]) {
        if (!need.has(g)) continue;
        const next = [];
        for (const c of combos) for (const { e, w } of lists[g]) next.push({ a: { ...c.a, [g]: e }, w: c.w * w });
        combos = next;
    }

    const atoms = [];
    for (const t of timeSlots) {
        for (const c of combos) {
            const a = { ...c.a, ymd: t.ymd, hour: t.hour };
            a.m = sessionMetrics(p, t.s * c.w, a);
            atoms.push(a);
        }
    }
    return toResponse(p, atoms, dims, metrics, req);
}

/** Native cohort report shape, with stable fictional first-visit cohorts. */
function runCohortReport(p, req) {
    const today = dayNum(localParts(p.tz, new Date()).ymd);
    const step = req.cohortSpec.cohortsRange.granularity === 'WEEKLY' ? 7 : 1;
    const rows = [];
    for (const cohort of req.cohortSpec.cohorts) {
        const start = dayNum(cohort.dateRange.startDate.replaceAll('-', ''));
        const end = Math.min(today, dayNum(cohort.dateRange.endDate.replaceAll('-', '')));
        let size = 0;
        for (let d = start; d <= end; d++) size += Math.round(daySessions(p, ymdOf(d), today) * .8 * p.newShare);
        const periodStart = step === 7 ? start - new Date(start * DAY_MS).getUTCDay() : start;
        for (let offset = 0; offset <= req.cohortSpec.cohortsRange.endOffset; offset++) {
            const from = periodStart + offset * step;
            if (from > today) continue;
            const maturity = Math.min(1, (today - from + .5) / step);
            const rate = offset === 0 ? 1 : (.06 + unit(`${p.id}:${start}`) * .13) * Math.pow(offset, -.55) * maturity;
            const values = { cohortActiveUsers: Math.round(size * rate), cohortTotalUsers: size };
            rows.push({
                dimensionValues: [{ value: cohort.name }, { value: String(offset).padStart(4, '0') }],
                metricValues: req.metrics.map(m => ({ value: String(values[m.name] || 0) })),
            });
        }
    }
    return {
        dimensionHeaders: req.dimensions.map(d => ({ name: d.name })),
        metricHeaders: req.metrics.map(m => ({ name: m.name, type: 'TYPE_INTEGER' })),
        rows, rowCount: rows.length, metadata: { timeZone: p.tz }, propertyQuota: quota(p.id),
    };
}

// ---------------------------------------------------------------------------
// Realtime reports (runRealtimeReport)
// ---------------------------------------------------------------------------

/** Small visitor cohorts for the last 30 minutes. The seeded sequence is stable; drift only adds or drops a few at the end. */
function cohorts(p, now = new Date()) {
    const target = realtimeUsers(p, now);
    const r = prng(`${p.id}:rt`);
    const geo = picker(p.geo.filter((g) => !g.bot), (g) => g.w);
    const dev = picker(p.devices, (d) => d.w);
    const page = picker(p.pages, (pg) => pg.w * (p.spike && pg.path === p.viral ? 6 : 1));
    const minute = picker([...Array(30).keys()], (m) => (p.spike ? 1 + 2.8 * Math.pow(1 - m / 29, 2) : 0.8 + 0.4 * unit(`${p.id}:m:${m}`)));
    const out = [];
    let total = 0;
    while (total < target) {
        const size = Math.min(target - total, 1 + Math.floor(Math.pow(r(), 3) * 5));
        const d = dev(r());
        const app = p.app && d.category !== "desktop" && r() < 0.55;
        out.push({
            geo: geo(r()), dev: d, page: page(r()), minutesAgo: minute(r()),
            platform: app ? (d.os === "iOS" ? "iOS" : "Android") : "web",
            size, views: size * (1 + Math.floor(r() * 3)), keys: r() < 0.07 ? 1 : 0,
        });
        total += size;
    }
    return out;
}

function runRealtimeReport(req) {
    const id = String(req.property || "").split("/").pop();
    const p = PROP_BY_ID.get(id);
    if (!p) throw Object.assign(new Error(`Demo: unknown property ${id}`), { code: 7 });
    const dims = req.dimensions || [];
    const metrics = req.metrics || [];
    const withEvents = dims.some((d) => d.name === "eventName") || filterFields(req.dimensionFilter).has("eventName");
    const atoms = [];
    for (const c of cohorts(p)) {
        const base = { geo: c.geo, dev: c.dev, page: c.page, minutesAgo: c.minutesAgo, platform: c.platform };
        if (!withEvents) {
            atoms.push({ ...base, m: { ...ZERO(), users: c.size, sessions: c.size, views: c.views, events: c.views * 3.2, keyEvents: c.keys } });
            continue;
        }
        for (const e of p.events) {
            const users = c.size * Math.min(1, e.sess * 1.6);
            atoms.push({ ...base, evt: e, m: { ...ZERO(), users, events: c.size * e.rate, keyEvents: e.isKey ? c.keys + c.size * e.rate * 0.5 : 0 } });
        }
    }
    const res = toResponse(p, atoms, dims, metrics, req);
    res.kind = "analyticsData#runRealtimeReport";
    return res;
}

// ---------------------------------------------------------------------------
// Quota and clients
// ---------------------------------------------------------------------------

let calls = 0;
function quota(id) {
    calls++;
    const hourUsed = 180 + (calls * 11) % 2400 + Math.round(400 * unit(`q:${id}`));
    const dayUsed = 3200 + calls * 13 + Math.round(2000 * unit(`qd:${id}`));
    return {
        tokensPerDay: { consumed: dayUsed, remaining: Math.max(0, 200000 - dayUsed) },
        tokensPerHour: { consumed: hourUsed, remaining: Math.max(0, 40000 - hourUsed) },
        concurrentRequests: { consumed: 0, remaining: 10 },
        serverErrorsPerProjectPerHour: { consumed: 0, remaining: 10 },
        potentiallyThresholdedRequestsPerHour: { consumed: 0, remaining: 120 },
        tokensPerProjectPerHour: { consumed: Math.round(hourUsed / 3), remaining: Math.max(0, 14000 - Math.round(hourUsed / 3)) },
    };
}

const wait = () => new Promise((r) => setTimeout(r, 20 + Math.floor(Math.random() * 60)));

function dataClient() {
    return {
        async getPropertyQuotasSnapshot({ name }) {
            await wait();
            const id = /^properties\/(\d+)\/propertyQuotasSnapshot$/.exec(name || '')?.[1];
            if (!PROP_BY_ID.has(id)) throw Object.assign(new Error('Demo: unknown property'), { code: 7 });
            return [{ name, corePropertyQuota: quota(id), realtimePropertyQuota: quota(id), funnelPropertyQuota: quota(id) }];
        },
        async runRealtimeReport(req) { await wait(); return [runRealtimeReport(req)]; },
        async runReport(req) { await wait(); return [runReport(req)]; },
        async runFunnelReport(req) { await wait(); return [runFunnelReport(req)]; },
    };
}

/** Closed funnel: each step keeps a stable, name-seeded share of the previous step's users */
function runFunnelReport({ property, dateRanges = [], funnel = {} }) {
    const id = String(property || "").split("/").pop();
    const p = PROP_BY_ID.get(id);
    if (!p) throw Object.assign(new Error("Demo: unknown property"), { code: 5 });
    const range = dateRanges[0] || {};
    const steps = funnel.steps || [];
    const days = Math.max(1, Math.round((Date.parse(range.endDate) - Date.parse(range.startDate)) / DAY_MS) + 1 || 30);
    let users = Math.round(p.daily * days * 0.42 * (0.9 + 0.2 * unit(`${id}:funnel:${steps[0]?.name}`)));
    const rows = steps.map((step, index) => {
        if (index > 0) users = Math.round(users * (0.32 + 0.4 * unit(`${id}:funnel:${index}:${step.name}`)));
        return { name: `${index + 1}. ${step.name}`, users };
    });
    const v = (x) => ({ value: String(x) });
    return {
        funnelTable: {
            dimensionHeaders: [{ name: "funnelStepName" }],
            metricHeaders: ["activeUsers", "funnelStepCompletionRate", "funnelStepAbandonments", "funnelStepAbandonmentRate"].map((name) => ({ name })),
            rows: rows.map((row, i) => {
                const next = rows[i + 1]?.users ?? row.users;
                const rate = row.users ? next / row.users : 0;
                return { dimensionValues: [v(row.name)], metricValues: [v(row.users), v(rate), v(row.users - next), v(1 - rate)] };
            }),
            metadata: { samplingMetadatas: [] },
        },
    };
}

function adminClient() {
    const asProperty = (p) => ({
        name: `properties/${p.id}`, displayName: p.site, currencyCode: p.currency, timeZone: p.tz,
        parent: "accounts/2900001", propertyType: "PROPERTY_TYPE_ORDINARY",
    });
    return {
        async listAccounts() { return [[{ name: "accounts/2900001", displayName: "Demo workspace" }]]; },
        async listProperties() { return [PROPS.map(asProperty)]; },
        async listDataStreams({ parent }) {
            const p = PROP_BY_ID.get(String(parent).split("/").pop());
            return [p ? [{ name: `${parent}/dataStreams/1`, type: "WEB_DATA_STREAM", displayName: `${p.site} web`, webStreamData: { defaultUri: `https://${p.domain}` } }] : []];
        },
        async getProperty({ name }) {
            const p = PROP_BY_ID.get(String(name).split("/").pop());
            if (!p) throw Object.assign(new Error("Demo: unknown property"), { code: 5 });
            return [asProperty(p)];
        },
    };
}

module.exports = {
    enabled,
    cacheDir,
    dataClient,
    adminClient,
    PROPERTIES: PROPS.map(({ id, site, domain, url, currency }) => ({ id, site, domain, url, currencyCode: currency })),
    _internal: { realtimeUsers, cohorts, runReport, runRealtimeReport, localParts,
        journeyPages: id => (PROP_BY_ID.get(String(id))?.pages || []).map(page => page.path) },
};
