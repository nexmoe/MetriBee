const { createHash } = require('node:crypto');
const { JWT } = require('google-auth-library');
const { cacheGetEntry, cacheSet } = require('./reportCache');
const { todayInZone, validDate } = require('./retention');
const { getCredentials } = require('../lib/credentials');
const { createSearchConsoleUsage, LIMITS, DOCUMENTATION_URL } = require('../lib/searchConsoleQuota');

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const TIME_ZONE = 'America/Los_Angeles';
const GSC_KEYS = ['GSC_CLIENT_EMAIL', 'GSC_PRIVATE_KEY', 'GSC_WEBSITE_URLS'];
const DIMENSIONS = ['query', 'page', 'country', 'device'];
const LIMIT = 500;
const failure = (message, status = 400) => Object.assign(new Error(message), { status });
const hash = value => createHash('sha256').update(value).digest('hex');
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let countryCodes;
function countryCode3(code) {
  countryCode('USA');
  return [...countryCodes].find(([alpha3, alpha2]) => alpha2 === String(code).toUpperCase() && /^[A-Z]{3}$/.test(alpha3))?.[0];
}
function countryCode(code) {
  countryCodes ||= new Map(require('../public/countries.json').features.map(({ properties }) => [properties.ISO_A3, properties.ISO_A2]));
  const value = countryCodes.get(String(code).toUpperCase());
  return /^[A-Z]{2}$/.test(value || '') ? value : null;
}

function credentials(env = process.env) {
  const parsed = getCredentials({ GA4_CLIENT_EMAIL: env.GSC_CLIENT_EMAIL, GA4_PRIVATE_KEY: env.GSC_PRIVATE_KEY });
  return parsed ? { email: parsed.client_email, key: parsed.private_key, fingerprint: hash(parsed.client_email + '\n' + parsed.private_key) } : null;
}

function propertyUrl(property) {
  try {
    const value = property.url || property.domain;
    if (typeof value !== 'string' || !value.trim()) return null;
    const url = new URL(/^https?:\/\//i.test(value) ? value : 'https://' + value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url : null;
  } catch { return null; }
}

/** Choose the narrowest authorized property. A hostname boundary also scopes Domain properties. */
function matchProperty(property, sites, fallbackUrls = {}) {
  const target = propertyUrl(property) || propertyUrl({ url: fallbackUrls[String(property.id)] });
  if (!target) return null;
  const host = target.hostname.toLowerCase();
  const candidates = sites.filter(site => ['siteOwner', 'siteFullUser', 'siteRestrictedUser'].includes(site.permissionLevel)).flatMap(site => {
    if (site.siteUrl.startsWith('sc-domain:')) {
      const domain = site.siteUrl.slice(10).toLowerCase();
      return host === domain || host.endsWith('.' + domain) ? [{ ...site, score: domain.length }] : [];
    }
    try {
      const prefix = new URL(site.siteUrl);
      // A path-prefix property cannot describe a whole-host GA4 property.
      return prefix.origin === target.origin && prefix.pathname === '/' && !prefix.search
        ? [{ ...site, score: 10000 + site.siteUrl.length }] : [];
    } catch { return []; }
  }).sort((a, b) => b.score - a.score || a.siteUrl.localeCompare(b.siteUrl));
  if (!candidates.length) return null;
  return { siteUrl: candidates[0].siteUrl, hostname: host,
    hostFilter: { dimension: 'page', operator: 'includingRegex', expression: '^https?://' + escapeRegex(host) + '(?::[0-9]+)?/' } };
}

function websiteUrls(env = process.env) {
  if (!env.GSC_WEBSITE_URLS) return {};
  try {
    const value = JSON.parse(env.GSC_WEBSITE_URLS);
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.entries(value).some(([id, url]) => !/^\d+$/.test(id) || typeof url !== 'string' || !propertyUrl({ url }))) throw new Error();
    return value;
  } catch { throw failure('GSC_WEBSITE_URLS must map numeric GA4 property IDs to website URLs.', 503); }
}

function rangeFor(query, now) {
  if (query.start_datetime || query.end_datetime || query.past_minutes_start !== undefined) throw failure('Search Console supports whole calendar days.');
  const today = todayInZone(now, TIME_ZONE);
  const earliestDate = new Date(today + 'T00:00:00Z');
  const day = earliestDate.getUTCDate();
  earliestDate.setUTCDate(1);
  earliestDate.setUTCMonth(earliestDate.getUTCMonth() - 16);
  const lastDay = new Date(Date.UTC(earliestDate.getUTCFullYear(), earliestDate.getUTCMonth() + 1, 0)).getUTCDate();
  earliestDate.setUTCDate(Math.min(day, lastDay));
  const earliest = earliestDate.toISOString().slice(0, 10);
  const requestedStart = query.start_date || earliest, requestedEnd = query.end_date || today;
  if (!validDate(requestedStart) || !validDate(requestedEnd) || requestedStart > requestedEnd) throw failure('Choose valid Search Console dates.');
  const startDate = requestedStart < earliest ? earliest : requestedStart;
  const endDate = requestedEnd > today ? today : requestedEnd;
  return { startDate, endDate, requestedStart, requestedEnd, clipped: startDate !== requestedStart || endDate !== requestedEnd, empty: startDate > endDate };
}

/** Only filters with equivalent GSC meaning are applied. Never silently ignore a GA4 audience filter. */
function searchFilters(raw, match) {
  let filters;
  try { filters = typeof raw === 'string' ? JSON.parse(raw) : raw || []; } catch { throw failure('Invalid filters.'); }
  if (!Array.isArray(filters) || filters.length > 20) throw failure('Choose up to 20 filters.');
  const result = [match.hostFilter];
  for (const filter of filters) {
    if (!['pathname', 'hostname', 'device_type', 'country'].includes(filter.parameter)) throw failure('This GA4 audience filter is unavailable in Search Console. Clear filters to view Google Search data.', 422);
    if (!['equals', 'not_equals', 'contains', 'not_contains', 'regex', 'not_regex'].includes(filter.type)
      || !Array.isArray(filter.value) || !filter.value.length || filter.value.length > 100
      || filter.value.some(value => typeof value !== 'string' || !value || value.length > 500)) throw failure('Unsupported Search Console filter.', 422);
    const negative = filter.type.startsWith('not_'), operation = filter.type.replace(/^not_/, '');
    const expressions = filter.value.map(value => {
      if (filter.parameter === 'country') {
        const code = countryCode3(value);
        if (operation !== 'equals' || !code) throw failure('Search Console supports exact country filters only.', 422);
        return '^' + [...code].map(letter => '[' + letter.toLowerCase() + letter + ']').join('') + '$';
      }
      if (filter.parameter === 'device_type') {
        if (operation !== 'equals' || !['desktop', 'mobile', 'tablet'].includes(value.toLowerCase())) throw failure('Search Console supports exact device filters only.', 422);
        return '^' + value.toUpperCase() + '$';
      }
      if (filter.parameter === 'hostname') {
        if (operation !== 'equals' || !/^[a-zA-Z0-9.-]+$/.test(value)) throw failure('Search Console supports exact hostname filters only.', 422);
        return '^https?://' + escapeRegex(value.toLowerCase()) + '(?::[0-9]+)?/';
      }
      if (operation === 'regex') throw failure('Path regular expressions cannot be translated to Search Console URLs. Use an exact path or contains filter.', 422);
      if (operation === 'equals') {
        if (!value.startsWith('/')) throw failure('Choose an absolute page path.', 422);
        return '^https?://[^/]+' + escapeRegex(value) + '(?:[?#].*)?$';
      }
      // Match the path, rather than accidentally matching the hostname or query string.
      return '^https?://[^/]+' + (value.startsWith('/') ? '[^?#]*' : '/[^?#]*') + escapeRegex(value);
    });
    const expression = expressions.map(value => '(?:' + value + ')').join('|');
    if (expression.length > 4096) throw failure('Search Console filter is too long.', 422);
    result.push({ dimension: filter.parameter === 'device_type' ? 'device' : filter.parameter === 'country' ? 'country' : 'page', operator: negative ? 'excludingRegex' : 'includingRegex', expression });
  }
  return result;
}

function createSearchConsole(deps = {}) {
  const config = deps.credentials || credentials, now = deps.now || (() => new Date());
  const read = deps.readEntry || cacheGetEntry, write = deps.write || cacheSet;
  const pending = new Map(), waiting = [];
  let active = 0, current;
  const isDemo = deps.isDemo || require('./demoData').enabled;
  const cacheKey = (settings, identity) => 'gsc-v1:' + hash(settings.fingerprint + ':' + JSON.stringify(identity));
  function state(settings) {
    if (!current || current.fingerprint !== settings.fingerprint) current = {
      fingerprint: settings.fingerprint, usage: createSearchConsoleUsage(now), blockedUntil: 0,
    };
    return current;
  }
  async function limited(task) {
    if (active >= 2) await new Promise(resolve => waiting.push(resolve)); else active++;
    try { return await task(); } finally { if (waiting.length) waiting.shift()(); else active--; }
  }
  async function request(path, body) {
    const settings = config();
    if (!settings) throw failure('Search Console credentials are not configured.', 503);
    const tracker = state(settings);
    const siteUrl = body ? decodeURIComponent(path.split('/')[1]) : null;
    return limited(async () => {
      // Refusals in the local queue are not upstream requests or additional Google errors.
      if (now().getTime() < tracker.blockedUntil) throw failure('Search Console is temporarily rate limited. Try again in a minute.', 429);
      tracker.auth ||= new JWT({ email: settings.email, key: settings.key, scopes: [SCOPE] });
      tracker.usage.record(body ? 'queries' : 'siteLists', siteUrl);
      try {
        if (deps.request) return await deps.request(path, body);
        const response = await tracker.auth.request({ url: 'https://www.googleapis.com/webmasters/v3/' + path,
          method: body ? 'POST' : 'GET', ...(body ? { data: body } : {}), timeout: 20000, retry: false });
        return response.data;
      } catch (error) {
        const code = Number(error.response?.status || error.status);
        const rateLimited = code === 429 || (code === 403 && error.response?.data?.error?.errors?.some(
          item => ['quotaExceeded', 'rateLimitExceeded', 'userRateLimitExceeded'].includes(item.reason)));
        tracker.usage.record('errors', siteUrl);
        if (rateLimited) { tracker.blockedUntil = now().getTime() + 60000; tracker.usage.record('rateLimited', siteUrl); }
        // Google errors can carry request headers and credentials: return only a local explanation.
        throw failure(rateLimited ? 'Search Console is temporarily rate limited. Try again in a minute.'
          : code === 403 ? 'Search Console denied access. Check the service account property permissions and API enablement.'
          : 'Search Console could not load this report. Retry later.', rateLimited ? 429 : 502);
      }
    });
  }
  async function cached(namespace, identity, load) {
    const settings = config(), tracker = state(settings), key = cacheKey(settings, identity);
    if (!pending.has(key)) pending.set(key, (async () => {
      const hit = await read(namespace, key);
      if (hit) {
        if (namespace === 'gsc') tracker.usage.record('cacheHits', identity[0]);
        return { value: hit.data, status: { fetchedAt: hit.cachedAt, cacheStatus: 'cached' } };
      }
      const value = await load(), fetchedAt = now().toISOString();
      await write(namespace, key, value, { cachedAt: fetchedAt });
      return { value, status: { fetchedAt, cacheStatus: 'fresh' } };
    })().finally(() => pending.delete(key)));
    return pending.get(key);
  }
  async function connection(property) {
    if (isDemo()) return { connected: false, gscPropertyUrl: null, reason: 'demo' };
    if (!config()) return { connected: false, gscPropertyUrl: null, reason: 'not_configured' };
    const { value } = await cached('gsc-sites', 'sites', () => request('sites'));
    state(config()).knownSites = value.siteEntry || [];
    const match = matchProperty(property, value.siteEntry || [], (deps.websiteUrls || websiteUrls)());
    return { connected: !!match, gscPropertyUrl: match?.siteUrl || null, reason: match ? null : 'property_not_accessible', match };
  }
  async function report(property, action, query = {}) {
    const status = await connection(property);
    if (!status.connected) return { data: null, connection: status, source: 'gsc', timeZone: TIME_ZONE };
    const range = rangeFor(query, now()), filters = searchFilters(query.filters, status.match);
    const dimension = action === 'time-series' ? 'date' : action === 'data' ? query.dimensions || 'query' : null;
    if (!['summary', 'data', 'time-series'].includes(action) || (dimension && ![...DIMENSIONS, 'date'].includes(dimension))) throw failure('Unknown Search Console report.');
    const body = { startDate: range.startDate, endDate: range.endDate, type: 'web', dataState: 'final', aggregationType: 'byPage',
      dimensions: dimension ? [dimension] : [], rowLimit: LIMIT + 1, dimensionFilterGroups: [{ groupType: 'and', filters }] };
    const result = range.empty ? { value: { rows: [] }, status: { fetchedAt: null, cacheStatus: 'unknown' } }
      : await cached('gsc', [status.gscPropertyUrl, body], () => request('sites/' + encodeURIComponent(status.gscPropertyUrl) + '/searchAnalytics/query', body));
    const rows = result.value.rows || [];
    const numeric = row => ({ clicks: Number(row?.clicks) || 0, impressions: Number(row?.impressions) || 0,
      ctr: row?.impressions > 0 ? Number(row.ctr) || 0 : null, position: row?.impressions > 0 ? Number(row.position) || null : null });
    const data = range.empty ? null : dimension ? rows.slice(0, LIMIT).map(row => ({ [dimension]: row.keys?.[0] || '', ...numeric(row),
      ...(dimension === 'country' ? { countryCode: countryCode(row.keys?.[0]) } : {}) })) : numeric(rows[0]);
    return { data, connection: { connected: true, gscPropertyUrl: status.gscPropertyUrl }, source: 'gsc', timeZone: TIME_ZONE,
      range, truncated: rows.length > LIMIT, rowLimit: LIMIT, dataState: 'final', reportStatus: result.status,
      aggregationType: 'byPage', hostname: status.match.hostname,
      limitations: ['Google Search web results; clicks are not GA4 sessions.', 'Scoped to the website hostname. Impressions count each result page, rather than combining result pages into one property impression.', 'Search Console uses Pacific calendar days and publishes final data with a delay.',
        ...(dimension && dimension !== 'date' ? ['Top rows only. Private queries and Google internal limits mean dimension rows do not sum to the property total.'] : []),
        ...(range.clipped || range.empty ? ['The requested dates exceed Search Console history or the current Pacific day.'] : [])] };
  }
  async function quota(properties, { demo = isDemo() } = {}) {
    const base = { limits: LIMITS, documentationUrl: DOCUMENTATION_URL, remaining: null, loadQuota: null };
    if (demo) return { ...base, configured: false, reason: 'demo' };
    const settings = config();
    if (!settings) { current = null; return { ...base, configured: false, reason: 'not_configured' }; }
    const tracker = state(settings);
    // Reading quota never sends a Google request, including sites.list.
    const hit = await read('gsc-sites', cacheKey(settings, 'sites'));
    if (hit) tracker.knownSites = hit.data?.siteEntry || [];
    const siteUrls = [...new Set(properties.map(property => matchProperty(property, tracker.knownSites || [], (deps.websiteUrls || websiteUrls)())?.siteUrl).filter(Boolean))].sort();
    return { ...base, configured: true, ...tracker.usage.snapshot(siteUrls),
      activeRequests: active, queuedRequests: waiting.length, maxConcurrentRequests: 2,
      cooldownUntil: tracker.blockedUntil > now().getTime() ? new Date(tracker.blockedUntil).toISOString() : null };
  }
  return { connection, report, quota };
}

let singleton;
function getSearchConsole() { return singleton ||= createSearchConsole(); }
module.exports = { SCOPE, TIME_ZONE, GSC_KEYS, credentials, propertyUrl, matchProperty, rangeFor, searchFilters, createSearchConsole, getSearchConsole };
