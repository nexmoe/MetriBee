const { createHash } = require('node:crypto');
const { runSafeHistoricalReport, getGA4DataClient } = require('./ga4Service');
const { cacheGet, cacheGetEntry, cacheSet } = require('./reportCache');
const { todayInZone, validDate } = require('./retention');
const { buildTransitions } = require('./journeys');
const { DateTime } = require('luxon');
const { windowFor, windowFilter, hasSubday, calendarRange } = require('../lib/reportWindow');

const DAY = 86400000;
const iso = date => new Date(date).toISOString().slice(0, 10);
const n = (row, i) => Number(row?.metricValues?.[i]?.value) || 0;
const d = (row, i) => row?.dimensionValues?.[i]?.value || '';
const failure = (message, status = 400) => Object.assign(new Error(message), { status });
const and = (...expressions) => {
  const items = expressions.filter(Boolean);
  return items.length > 1 ? { andGroup: { expressions: items } } : items[0];
};
const exact = (fieldName, value) => ({ filter: { fieldName, stringFilter: { matchType: 'EXACT', value, caseSensitive: true } } });
const DIMENSIONS = {
  pathname: 'pagePath', page_title: 'pageTitle', entry_page: 'landingPagePlusQueryString', hostname: 'hostName',
  country: 'countryId', region: 'region', city: 'city', language: 'languageCode',
  browser: 'browser', browser_version: 'browserVersion', operating_system: 'operatingSystem', operating_system_version: 'operatingSystemVersion',
  device_type: 'deviceCategory', dimensions: 'screenResolution', referrer: 'sessionSource',
  channel: 'sessionDefaultChannelGroup', utm_source: 'sessionManualSource', utm_medium: 'sessionManualMedium',
  utm_campaign: 'sessionManualCampaignName', utm_content: 'sessionManualAdContent', utm_term: 'sessionManualTerm', event_name: 'eventName',
};
const AUTO_EVENTS = new Set(['page_view', 'screen_view', 'first_visit', 'first_open', 'session_start', 'user_engagement', 'scroll', 'click', 'file_download', 'form_start', 'form_submit', 'video_start', 'video_progress', 'video_complete']);
function eventType(name) {
  if (['page_view', 'screen_view'].includes(name)) return 'pageview';
  if (name === 'click') return 'outbound';
  if (/copy|copied|clipboard/i.test(name)) return 'copy';
  if (/button|cta.*click|click.*cta/i.test(name)) return 'button_click';
  if (name === 'form_submit') return 'form_submit';
  return 'custom_event';
}

function filtersFor(raw) {
  let filters;
  try { filters = typeof raw === 'string' ? JSON.parse(raw) : raw || []; } catch { throw failure('Invalid filters.'); }
  if (!Array.isArray(filters) || filters.length > 20) throw failure('Choose up to 20 filters.');
  return and(...filters.map(item => {
    const fieldName = DIMENSIONS[item.parameter];
    if (!fieldName) throw failure(`GA4 does not expose the ${item.parameter} filter.`);
    if (!Array.isArray(item.value) || !item.value.length || item.value.length > 100) throw failure('Invalid filter values.');
    const matchTypes = { equals: 'EXACT', contains: 'CONTAINS', starts_with: 'BEGINS_WITH', ends_with: 'ENDS_WITH', regex: 'FULL_REGEXP', matches: 'FULL_REGEXP' };
    const positive = String(item.type).replace(/^not_/, '').replace(/^is$/, 'equals').replace(/^is_not$/, 'equals');
    const matchType = matchTypes[positive];
    if (!matchType) throw failure(`Unsupported GA4 filter operator: ${item.type}`);
    const expressions = item.value.map(value => {
      let text = String(value), country = null, region = null;
      if (item.parameter === 'region' && regionNames[text]) {
        country = text.split('-')[0]; text = regionNames[text];
      } else if (item.parameter === 'city') {
        const code = Object.keys(regionNames).find(code => text.startsWith(code + '-'));
        if (code) { country = code.split('-')[0]; region = regionNames[code]; text = text.slice(code.length + 1); }
        else if (/^[A-Z]{2}--/.test(text)) { country = text.slice(0, 2); text = text.slice(4); }
      }
      return and({ filter: { fieldName, stringFilter: { matchType, value: text, caseSensitive: false } } }, country && exact('countryId', country), region && exact('region', region));
    });
    const expression = expressions.length > 1 ? { orGroup: { expressions } } : expressions[0];
    return item.type.startsWith('not_') || item.type === 'is_not' ? { notExpression: expression } : expression;
  }));
}

const OVERVIEW_METRICS = ['sessions', 'screenPageViews', 'totalUsers', 'screenPageViewsPerSession', 'bounceRate', 'averageSessionDuration', 'newUsers', 'totalRevenue', 'keyEvents', 'activeUsers'];
function overview(row, metadata) { return { sessions: n(row, 0), pageviews: n(row, 1), users: n(row, 2), pages_per_session: n(row, 3), bounce_rate: n(row, 4) * 100, session_duration: n(row, 5), new_users: n(row, 6), revenue: n(row, 7), key_events: n(row, 8), active_users: n(row, 9), currency_code: metadata?.currencyCode }; }
function timeDimension(bucket) { return ({ minute: 'dateHourMinute', hour: 'dateHour', day: 'date', week: 'isoYearIsoWeek', month: 'yearMonth', year: 'year' })[bucket] || 'dateHour'; }
function timeValue(value, bucket, timeZone) {
  if (timeZone && ['hour', 'minute'].includes(bucket)) return DateTime.fromFormat(value, bucket === 'minute' ? 'yyyyMMddHHmm' : 'yyyyMMddHH', { zone: timeZone }).toUTC().toFormat('yyyy-MM-dd HH:mm:ss');
  const year = value.slice(0, 4), month = value.slice(4, 6), day = value.slice(6, 8);
  if (bucket === 'year') return `${year}-01-01 00:00:00`;
  if (bucket === 'week') {
    const fourth = new Date(`${year}-01-04T00:00:00Z`), weekday = (fourth.getUTCDay() + 6) % 7;
    return `${iso(fourth.getTime() - weekday * DAY + (Number(month) - 1) * 7 * DAY)} 00:00:00`;
  }
  return `${year}-${month}-${bucket === 'month' ? '01' : day}${bucket === 'hour' || bucket === 'minute' ? ` ${value.slice(8, 10)}:${bucket === 'minute' ? value.slice(10, 12) : '00'}:00` : ' 00:00:00'}`;
}
const sectionOf = path => path.startsWith('/') && path.split('/').filter(Boolean).length > 1 ? '/' + path.split('/').filter(Boolean)[0] : path;
function combineReportStatus(observations) {
  if (!observations.length) return undefined;
  const times = observations.map(status => status.fetchedAt == null ? NaN : new Date(status.fetchedAt).getTime());
  const cacheStates = new Set(observations.map(status => status.cacheStatus));
  return {
    fetchedAt: times.every(Number.isFinite) ? new Date(Math.min(...times)).toISOString() : null,
    cacheStatus: cacheStates.size === 1 ? observations[0].cacheStatus : 'mixed',
  };
}
const regionNames = require('../public/subdivision-names.generated.json');
const regionCodes = new Map(Object.entries(regionNames).map(([code, name]) => [`${code.split('-')[0]}:${name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')}`, code]));
const regionCode = (country, name) => regionCodes.get(`${country}:${name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')}`) || '';

function createRybbitHandler(deps = {}) {
  const embeds = deps.embeds || require('./embeds').handlers;
  const run = deps.run || runSafeHistoricalReport;
  const properties = deps.properties || (() => require('./apiController').ensureProperties());
  const read = deps.read || cacheGet, write = deps.write || cacheSet;
  const readEntry = deps.readEntry || (deps.read ? async (namespace, key) => {
    const data = await read(namespace, key);
    return data ? { data, cachedAt: null } : null;
  } : cacheGetEntry);
  const now = deps.now || (() => new Date());
  const retention = deps.retention || require('./retention').createRetentionHandler();
  const favicon = deps.favicon || require('./favicons').favicon;
  // One handler owns the shared in-flight funnel map across HTTP requests.
  let funnels = deps.funnels;
  const pending = new Map(), waiting = [];
  let active = 0;
  async function limited(task) {
    if (active >= 3) await new Promise(resolve => waiting.push(resolve));
    else active++;
    try { return await task(); } finally { if (waiting.length) waiting.shift()(); else active--; }
  }
  async function cached(key, task, namespace = 'report', observe) {
    key = 'rybbit-v1:' + createHash('sha256').update(key).digest('hex');
    if (!pending.has(key)) {
      const promise = (async () => {
        const hit = await readEntry(namespace, key);
        if (hit) return { value: hit.data, status: { fetchedAt: hit.cachedAt, cacheStatus: 'cached' } };
        const value = await task();
        const fetchedAt = now().toISOString();
        await write(namespace, key, value, { cachedAt: fetchedAt });
        return { value, status: { fetchedAt, cacheStatus: 'fresh' } };
      })().finally(() => pending.delete(key));
      pending.set(key, promise);
    }
    const result = await pending.get(key);
    observe?.(result.status);
    return result.value;
  }
  function siteInfo(property) { return { id: null, siteId: Number(property.id), name: property.site || property.domain || property.id, domain: property.domain || '', accountId: property.accountId || null, accountName: property.accountName || null, type: 'web', organizationId: 'ga4', public: false, isOwner: false, role: 'viewer', permissions: ['funnels:write'], blockBots: false, saltUserIds: false, sessionReplay: false, trackErrors: false, webVitals: false, requiresPlan: false, createdAt: '2020-01-01T00:00:00Z', updatedAt: now().toISOString() }; }

  const metadataFor = property => cached(`property-time-zone:${property.id}`, async () => {
    const existing = await read('retention-meta', String(property.id));
    if (existing?.timeZone) return existing;
    const [data] = await (deps.admin || require('./ga4Service').getGA4AdminClient)().getProperty({ name: `properties/${property.id}` });
    return { timeZone: data.timeZone, createTime: data.createTime };
  });

  // The toolbar and its drawer share dimensionless totals. Distinct users in page
  // groups overlap, so summing those rows would overstate the number online.
  const liveReport = (propertyId, minutes, dimensions, asOf, observe) => cached(
    JSON.stringify({ live: 2, propertyId, minutes, dimensions, minute: Math.floor(asOf.getTime() / 60000) }),
    () => limited(async () => {
      try {
        const [data] = await (deps.client || getGA4DataClient)().runRealtimeReport({
          property: `properties/${propertyId}`,
          dimensions: dimensions.map(name => ({ name })),
          metrics: (dimensions.length ? ['activeUsers'] : ['activeUsers', 'screenPageViews']).map(name => ({ name })),
          minuteRanges: [{ startMinutesAgo: minutes - 1, endMinutesAgo: 0 }],
          orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
          limit: 50,
          returnPropertyQuota: true,
        });
        return data;
      } catch (error) {
        throw failure(error.message || 'GA4 realtime report unavailable.', error.status || (error.code === 8 ? 429 : error.code === 7 ? 403 : 502));
      }
    }), 'home', observe,
  );

  return async function gateway(req, res, requestTime) {
    const asOf = requestTime instanceof Date ? requestTime : now();
    try {
      const path = req.path.replace(/^\/api\/rybbit/, '');
      // Favicons belong to source domains too, independently of GA4 properties.
      if (path === '/favicon' && req.method === 'GET') return await favicon(req, res);
      let { properties: all } = await properties();
      const sharedKey = req.headers?.['x-private-key'];
      const sharedSite = req.headers?.['x-private-site'];
      const shared = !!(sharedKey || sharedSite);
      if (shared) {
        if (!sharedSite || !/^\d+$/.test(sharedSite) || !await embeds.store.validate(sharedSite, sharedKey)) throw failure('Private dashboard link is invalid or has been revoked.', 403);
        all = all.filter(property => String(property.id) === sharedSite);
        if (!all.length) throw failure('Property not found.', 404);
        const scoped = /^\/sites\/(\d+)(?:\/|$)/.exec(path);
        if (scoped && scoped[1] !== sharedSite) throw failure('This private link belongs to a different property.', 403);
        if (req.method !== 'GET' && !(req.method === 'POST' && /^\/sites\/\d+\/funnels\/analyze$/.test(path))) throw failure('Shared dashboards are read-only.', 403);
      }
      const cards = /^\/organizations\/[^/]+\/site-cards(?:-lite)?$/.test(path);
      const homeSites = /^\/organizations\/[^/]+\/site-status$/.test(path);
      const funnelAnalyze = /^\/sites\/\d+\/funnels\/analyze$/.test(path);
      const funnelSave = /^\/sites\/\d+\/funnels$/.test(path) && req.method === 'POST';
      const funnelDelete = /^\/sites\/\d+\/funnels\/[1-9]\d*$/.test(path) && req.method === 'DELETE';
      if (req.method !== 'GET' && !funnelSave && !funnelDelete && !(req.method === 'POST' && (cards || homeSites || funnelAnalyze))) throw failure('This GA4 connection provides read-only analytics.', 405);
      if (path === '/config') return res.json({ disableSignup: true, mapboxToken: '', liteDashboard: false });
      if (cards || homeSites) {
        const observations = [];
        const ids = req.body?.siteIds;
        if (!Array.isArray(ids) || ids.length > (homeSites ? all.length : 20) || ids.some(id => !all.some(property => String(property.id) === String(id)))) throw failure(homeSites ? 'Choose connected properties.' : 'Choose up to 20 connected properties.');
        const range = homeSites ? windowFor(req.query, req.query.time_zone || 'UTC', asOf) : null;
        if (homeSites && req.body.comparison != null && (typeof req.body.comparison !== 'object' || Array.isArray(req.body.comparison))) throw failure('Choose a valid comparison period.');
        const comparison = homeSites && req.body.comparison ? windowFor(req.body.comparison, req.query.time_zone || 'UTC', asOf) : null;
        const bucket = homeSites ? require('./homeSites').reportBucket(range, req.query.bucket) : req.query.bucket || 'day';
        const call = (id, action, query, observed) => new Promise((resolve, reject) => gateway({ method: 'GET', path: `/sites/${id}/${action}`, query }, { status(code) { this.code = code; return this; }, json(payload) {
          if (this.code >= 400) return reject(failure(payload.error, this.code));
          if (payload.reportStatus) observed.push(payload.reportStatus);
          resolve(payload.data);
        } }, asOf).catch(reject));
        const loadSite = async id => {
          const observed = [];
          try {
            const current = await call(id, 'overview', req.query, observed);
            let comparisonUnavailable = false;
            const previous = req.body.comparison ? await call(id, 'overview', req.body.comparison, observed).catch(() => { comparisonUnavailable = true; return null; }) : null;
            const series = await call(id, 'overview/time-series', { ...req.query, bucket }, observed);
            observations.push(...observed);
            return [id, { current, previous, series, ...(homeSites ? { comparisonUnavailable } : {}) }];
          } catch (err) { return [id, { error: err.message }]; }
        };
        const uniqueIds = [...new Set(ids)], results = [];
        let next = 0;
        // Limit both property fan-out and the underlying shared GA4 report queue.
        await Promise.all(Array.from({ length: Math.min(3, uniqueIds.length) }, async () => {
          while (next < uniqueIds.length) results.push(await loadSite(uniqueIds[next++]));
        }));
        if (homeSites) {
          const saved = await (deps.snapshot || require('./sitesController').loadSitesSnapshot)();
          const data = require('./homeSites').buildHomeSites({ range, comparison, bucket,
            properties: all.filter(property => ids.some(id => String(id) === String(property.id))),
            metrics: Object.fromEntries(results), ...saved, now: now() });
          return res.json({ data, reportStatus: combineReportStatus(observations) });
        }
        return res.json({ data: Object.fromEntries(results), reportStatus: combineReportStatus(observations) });
      }
      if (/^\/organizations\/[^/]+\/sites$/.test(path)) return res.json({ sites: all.map(property => ({ ...siteInfo(property), ...(shared ? { permissions: [] } : {}) })), organization: { id: 'ga4', name: 'Google Analytics 4' }, permissions: [], role: 'viewer', subscription: null });
      if (/^\/organizations\/[^/]+\/teams$/.test(path)) return res.json({ teams: [] });
      if (path === '/user/organizations') return res.json([{ id: 'ga4', name: 'Google Analytics 4', permissions: [], role: 'viewer', assignableRoles: [] }]);
      const match = path.match(/^\/sites\/(\d+)(?:\/(.*))?$/);
      if (!match) throw failure('GA4 data endpoint not available.', 404);
      const property = all.find(p => String(p.id) === match[1]);
      if (!property) throw failure('Property not found.', 404);
      const action = match[2] || '', q = req.query, propertyId = String(property.id);
      if (!action) {
        const metadata = await metadataFor(property);
        const config = shared ? {} : await embeds.store.get(propertyId);
        return res.json({ ...siteInfo(property), ...(!shared ? { embedEnabled: config.embedEnabled, permissions: ['funnels:write', 'sites:configure'] } : { permissions: [] }),
          timeZone: metadata.timeZone, createdAt: metadata.createTime || undefined });
      }
      if (action === 'has-data') return res.json({ hasData: true });
      if (action === 'is-public') return res.json({ isPublic: false });
      if (action.startsWith('gsc/')) {
        if (shared) return res.json({ connected: false, gscPropertyUrl: null, reason: 'private_workspace_only', data: null });
        require('../lib/setupCheck').syncEnvFile();
        const gsc = deps.gsc || require('./searchConsole').getSearchConsole();
        if (action === 'gsc/connection' || action === 'gsc/status') {
          const { match, ...connection } = await gsc.connection(property);
          return res.json(connection);
        }
        return res.json(await gsc.report(property, action.slice(4), q));
      }
      if (action === 'funnels' || /^funnels\/(analyze|summary|events|[1-9]\d*)$/.test(action)) {
        funnels ||= require('./funnels').createFunnels();
        return funnels({
          method: req.method, query: req.query, body: req.body,
          params: { propertyId, action: action === 'funnels' ? 'definitions' : action.slice('funnels/'.length) },
        }, res);
      }
      if (action === 'annotations' || action === 'segments' || action === 'dashboards') return res.json({ data: [] });
      if (action === 'goals') return res.json({ data: [], totalCount: 0 });
      // Realtime aggregates have their own window, independent of historical
      // dates, audience filters and the property's timezone metadata.
      if (action === 'live-user-count' || action === 'ga4/live-users') {
        const minutes = action === 'live-user-count' ? Math.floor(Math.min(30, Math.max(1, Number(q.minutes) || 5))) : 5;
        const observations = [], observe = status => observations.push(status);
        const total = await liveReport(propertyId, minutes, [], asOf, observe);
        const activeUsers = n(total.rows?.[0], 0);
        if (action === 'live-user-count') return res.json({ count: activeUsers });
        const groups = [
          ['countries', ['country', 'countryId']],
          ['devices', ['deviceCategory']],
          ['pages', ['unifiedScreenName']],
        ];
        const sections = await Promise.all(groups.map(async ([key, dimensions]) => {
          const result = activeUsers ? await liveReport(propertyId, minutes, dimensions, asOf, observe) : { rows: [], rowCount: 0 };
          const rows = (result.rows || []).map(row => ({ name: d(row, 0), ...(key === 'countries' ? { countryCode: d(row, 1) } : {}), users: n(row, 0) }));
          const totalCount = Number(result.rowCount) || rows.length;
          return [key, { rows, totalCount, truncated: totalCount > rows.length }];
        }));
        return res.json({ data: { activeUsers, pageviews: n(total.rows?.[0], 1), ...Object.fromEntries(sections) },
          reportStatus: combineReportStatus(observations) });
      }
      // Like the official analytics screen, live spikes cover the whole property in the
      // last 30 minutes. Keep them independent of historical dates/audience filters.
      if (action === 'ga4/live-spike') {
        const observations = [];
        const data = await cached(`overview-live-spike-v1:${propertyId}`, () => limited(async () => {
          const { propertyBaseline, scoreSpike } = require('./spikeDetector');
          const realtime = deps.realtime || require('./ga4Service').runSafeRealtimeReport;
          const [live, baseline] = await Promise.all([
            realtime({ propertyId, dimensions: [], metrics: [{ name: 'activeUsers' }], minuteRanges: [{ startMinutesAgo: 29, endMinutesAgo: 0 }] }),
            (deps.baseline || propertyBaseline)(property),
          ]);
          if (!live.ok) throw failure(live.error || 'GA4 realtime report unavailable.', live.errorCode === 8 ? 429 : 502);
          if (!baseline) throw failure('GA4 traffic baseline unavailable.', 502);
          const activeUsers = live.rows.reduce((sum, row) => sum + n(row, 0), 0);
          const score = scoreSpike(activeUsers, baseline.baseline, baseline.sd);
          if (!score.isSpike) return { spike: null };
          const pages = await realtime({ propertyId, dimensions: [{ name: 'unifiedScreenName' }], metrics: [{ name: 'activeUsers' }], limit: 1 });
          return { spike: { activeUsers, baselineUsers: baseline.baseline, ratio: score.ratio,
            topPage: pages.ok ? d(pages.rows?.[0], 0) : '' } };
        }), 'spike', status => observations.push(status));
        return res.json({ data, reportStatus: combineReportStatus(observations) });
      }
      const timeZone = property.timeZone || (hasSubday(q) ? (await metadataFor(property)).timeZone : 'UTC');
      const dateRange = windowFor(q, timeZone, asOf);
      const pointTime = (value, bucket) => timeValue(value, bucket, dateRange.startDateTime ? timeZone : undefined);
      const dimensionFilter = filtersFor(q.filters);
      const observations = [];
      const report = async (dimensions, metrics, filter, extra = {}) => cached(JSON.stringify({ propertyId, dateRange, dimensions, metrics, dimensionFilter, filter, extra }), () => limited(async () => {
        const { dateRange: selectedRange = dateRange, ...options } = extra;
        const response = await run({ propertyId, dateRange: calendarRange(selectedRange), dimensions: dimensions.map(name => ({ name })), metrics: metrics.map(name => ({ name })), dimensionFilter: and(dimensionFilter, windowFilter(selectedRange), filter), limit: 10000, ...options });
        if (!response.ok) throw failure(response.error || 'GA4 report unavailable.', response.errorCode === 8 ? 429 : 502);
        return response;
      }), 'report', status => observations.push(status));
      const send = data => {
        return res.json({ data, source: 'ga4', timeZone: property.timeZone || 'property',
          reportStatus: combineReportStatus(observations),
        });
      };

      if (action.startsWith('ga4/')) {
        const data = await require('./overviewReports').overviewReport({ type: action.slice(4), report, dateRange, propertyId, ownHost: property.domain || '', segment: q.segment, propertyCurrency: property.currencyCode });
        return send(data);
      }
      if (action === 'overview' || action === 'overview-lite') {
        const result = await report([], OVERVIEW_METRICS);
        return send(overview(result.rows[0], result.metadata));
      }
      if (action === 'overview/time-series' || action === 'overview-bucketed-lite') {
        const bucket = ['minute', 'hour', 'day', 'week', 'month', 'year'].includes(q.bucket) ? q.bucket : 'hour', dimension = timeDimension(bucket);
        const result = await report([dimension], OVERVIEW_METRICS, null, { orderBys: [{ dimension: { dimensionName: dimension }, desc: false }] });
        return send(result.rows.map(row => ({ time: pointTime(d(row, 0), bucket), ...overview(row, result.metadata) })));
      }
      if (action === 'metric' || action === 'metric-lite' || action === 'page-titles') {
        const parameter = action === 'page-titles' ? 'page_title' : q.parameter;
        const dimension = DIMENSIONS[parameter];
        if (!dimension) throw failure(`GA4 does not expose the ${parameter} dimension.`, 422);
        const countMetric = 'sessions';
        const dimensions = parameter === 'region' ? ['region', 'countryId'] : parameter === 'city' ? ['city', 'region', 'countryId'] : [dimension];
        const result = await report(dimensions, [countMetric, 'screenPageViews', 'bounceRate', 'userEngagementDuration', 'activeUsers']);
        const total = (await report([], [countMetric, 'screenPageViews'])).rows[0];
        const items = result.rows.map(row => ({ value: parameter === 'region' ? regionCode(d(row, 1), d(row, 0)) || `${d(row, 1)}-${d(row, 0)}` : parameter === 'city' ? `${regionCode(d(row, 2), d(row, 1)) || d(row, 2) + '-'}-${d(row, 0)}` : d(row, 0), count: n(row, 0), percentage: n(total, 0) ? n(row, 0) / n(total, 0) * 100 : 0, pageviews: n(row, 1), pageviews_percentage: n(total, 1) ? n(row, 1) / n(total, 1) * 100 : 0, bounce_rate: n(row, 2) * 100, time_on_page_seconds: n(row, 1) ? n(row, 3) / n(row, 1) : null, active_users: n(row, 4) })).sort((a, b) => b.count - a.count);
        const limit = Math.min(10000, Math.max(1, Number(q.limit) || 100)), offset = Math.max(0, (Number(q.page) || 1) - 1) * limit;
        return send({ data: items.slice(offset, offset + limit), totalCount: result.rowCount });
      }
      if (action.startsWith('pages')) {
        const metrics = ['screenPageViews', 'sessions', 'bounceRate', 'userEngagementDuration'];
        const base = await report(['pagePath'], metrics);
        const entries = await report(['landingPage'], ['sessions']);
        const byEntry = new Map(entries.rows.map(row => [d(row, 0), n(row, 0)]));
        const titles = await report(['pagePath', 'pageTitle'], ['screenPageViews']);
        const titleMap = new Map();
        for (const row of titles.rows) if (!titleMap.has(d(row, 0))) titleMap.set(d(row, 0), d(row, 1));
        const rows = base.rows.map(row => ({ kind: 'page', key: d(row, 0), title: titleMap.get(d(row, 0)) || '', section: sectionOf(d(row, 0)), pages: 1, pageviews: n(row, 0), sessions: n(row, 1), entries: byEntry.get(d(row, 0)) || 0, exits: null, bounced_entries: null, bounce_rate: n(row, 2) * 100, time_on_page_seconds: n(row, 0) ? n(row, 3) / n(row, 0) : null }));
        const sections = new Map();
        for (const row of rows) { const key = row.section; if (!sections.has(key)) sections.set(key, []); sections.get(key).push(row); }
        if (action === 'pages/summary') {
          const totals = (await report([], metrics)).rows[0];
          return send({ pageviews: n(totals, 0), sessions: n(totals, 1), pages: base.rowCount, bounced_sessions: Math.round(n(totals, 1) * n(totals, 2)), bounce_rate: n(totals, 2) * 100, time_on_page_seconds: n(totals, 0) ? n(totals, 3) / n(totals, 0) : null, views_per_session: n(totals, 1) ? n(totals, 0) / n(totals, 1) : null, sections: [...sections].map(([section, items]) => ({ section, pageviews: items.reduce((sum, row) => sum + row.pageviews, 0), pages: items.length })).sort((a, b) => b.pageviews - a.pageviews), sectionCount: sections.size });
        }
        if (action === 'pages/trends') {
          const parse = raw => { try { const value = JSON.parse(raw || '[]'); return Array.isArray(value) ? value.slice(0, 50) : []; } catch { throw failure('Invalid trend paths.'); } };
          const paths = parse(q.paths), groups = parse(q.sections), bucket = ['minute', 'hour', 'day', 'week', 'month'].includes(q.bucket) ? q.bucket : 'day', dimension = timeDimension(bucket);
          const result = await report(['pagePath', dimension], ['screenPageViews'], null, { limit: 100000 });
          if (result.rowCount > result.rows.length) throw failure('GA4 truncated this page trend report. Choose a shorter date range.', 422);
          return send([...paths.map(key => ({ key, kind: 'page' })), ...groups.map(key => ({ key, kind: 'section' }))].map(({ key, kind }) => {
            const points = new Map();
            for (const row of result.rows) if (kind === 'page' ? d(row, 0) === key : sectionOf(d(row, 0)) === key) { const time = pointTime(d(row, 1), bucket); points.set(time, (points.get(time) || 0) + n(row, 0)); }
            const series = [...points].map(([time, pageviews]) => ({ time, pageviews })).sort((a, b) => a.time.localeCompare(b.time));
            return { key, kind, pageviews: series.reduce((sum, point) => sum + point.pageviews, 0), series };
          }));
        }
        if (q.mode === 'exit') throw failure('GA4 Data API does not expose exit pages.', 422);
        let items = rows.filter(row => (!q.section || row.section === q.section) && (q.mode !== 'entry' || row.entries > 0) && (!q.search || `${row.key} ${row.title}`.toLowerCase().includes(String(q.search).toLowerCase())));
        if (q.group === 'section' && !q.search) items = await Promise.all([...sections].map(async ([section, members]) => {
          if (members.length === 1) return members[0];
          const filter = { filter: { fieldName: 'pagePath', inListFilter: { values: members.map(row => row.key) } } };
          const total = (await report([], metrics, filter)).rows[0];
          return { kind: 'section', key: section, title: '', section, pages: members.length, pageviews: members.reduce((sum, row) => sum + row.pageviews, 0), sessions: n(total, 1), entries: members.reduce((sum, row) => sum + row.entries, 0), exits: null, bounced_entries: null, bounce_rate: n(total, 2) * 100, time_on_page_seconds: n(total, 0) ? n(total, 3) / n(total, 0) : null };
        }));
        let searchConsole;
        if (String(q.include_gsc) === '1' && !shared) {
          try {
            require('../lib/setupCheck').syncEnvFile();
            const gsc = deps.gsc || require('./searchConsole').getSearchConsole();
            // Two cached GSC reports serve every row, section, sort and page.
            const [pages, summary] = await Promise.all([gsc.report(property, 'data', { ...q, dimensions: 'page' }), gsc.report(property, 'summary', q)]);
            const available = Array.isArray(pages.data) && summary.data != null;
            searchConsole = { available, truncated: !!pages.truncated, summary: summary.data, timeZone: pages.timeZone,
              range: pages.range, property: pages.connection?.gscPropertyUrl, source: 'gsc' };
            if (available) {
              const lookup = require('./searchConsoleRows').pageSearchLookup(pages.data, summary.data, pages.truncated);
              items = items.map(row => ({ ...row, search: lookup(row) }));
            }
          } catch (error) {
            searchConsole = { available: false, source: 'gsc', error: [400, 422, 429, 503].includes(error.status)
              ? error.message : 'Google Search data could not be loaded.' };
          }
        }
        const searchSort = { search_clicks: 'clicks', search_impressions: 'impressions', search_ctr: 'ctr', search_position: 'position' }[q.sort];
        const sort = { time_on_page: 'time_on_page_seconds' }[q.sort] || (['pageviews', 'sessions', 'entries', 'bounce_rate'].includes(q.sort) ? q.sort : 'pageviews');
        items.sort((a, b) => {
          const x = searchSort ? a.search?.[searchSort] : a[sort], y = searchSort ? b.search?.[searchSort] : b[sort];
          if (x == null || y == null) return x == null ? y == null ? 0 : 1 : -1;
          return (x - y) * (q.order === 'asc' ? 1 : -1) || a.key.localeCompare(b.key);
        });
        const limit = Math.min(100, Math.max(1, Number(q.limit) || 25)), offset = Math.max(0, (Number(q.page) || 1) - 1) * limit;
        return send({ data: items.slice(offset, offset + limit), totalCount: items.length, ...(searchConsole ? { searchConsole } : {}) });
      }
      if (action === 'journeys' || action === 'journeys/summary') {
        const transition = buildTransitions(await report(['hostName', 'pageReferrer', 'pagePath'], ['screenPageViews'], exact('eventName', 'page_view')));
        if (action.endsWith('/summary')) return send({ sessions: transition.internalViews, avgPathLength: 2, conversions: null, topExit: transition.topDestination ? { page: transition.topDestination.path, sessions: transition.topDestination.views } : null });
        let stepFilters; try { stepFilters = JSON.parse(q.stepFilters || '{}'); } catch { throw failure('Invalid step filters.'); }
        const matches = (value, pattern) => { if (!pattern) return true; const escaped = String(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*'); return new RegExp(`^${escaped}$`).test(value); };
        const grouped = new Map();
        for (const row of transition.rows) {
          const path = [row.from, row.to].map(path => q.groupBy === 'section' ? sectionOf(path) : path);
          if (!matches(path[0], stepFilters[0]) || !matches(path[1], stepFilters[1]) || !matches(path[1], q.endsAt)) continue;
          const key = JSON.stringify(path); const item = grouped.get(key) || { path, count: 0, percentage: 0 }; item.count += row.views; grouped.set(key, item);
        }
        const journeys = [...grouped.values()].sort((a, b) => b.count - a.count).slice(0, Math.min(500, Number(q.limit) || 15)).map(item => ({ ...item, percentage: transition.internalViews ? item.count / transition.internalViews * 100 : 0 }));
        return res.json({ journeys, totalSessions: transition.internalViews, source: 'ga4-referrer-pageviews', steps: 2, exitsKnown: false, reportStatus: combineReportStatus(observations) });
      }
      if (action === 'retention') {
        if (dateRange.startDateTime) throw failure('GA4 retention requires whole calendar days. Choose Today or a date range.', 422);
        if (dimensionFilter) throw failure('GA4 cohort reports cannot apply these report filters. Clear filters to view retention.', 422);
        const days = Math.round((Date.parse(dateRange.endDate) - Date.parse(dateRange.startDate)) / DAY) + 1;
        if (days > 90) throw failure('GA4 cohort reports support up to 90 days here. Choose a shorter range.', 422);
        const handler = retention;
        const data = await new Promise((resolve, reject) => handler({ params: { propertyId }, query: { start: dateRange.startDate, end: dateRange.endDate, bucket: q.mode || 'week', range: '30d' } }, { status(code) { this.code = code; return this; }, json(payload) { this.code >= 400 ? reject(failure(payload.error, this.code)) : resolve(payload); } }).catch(reject));
        const cohorts = Object.fromEntries(data.cohorts.map(cohort => [cohort.periodStart, { size: cohort.size, counts: [cohort.size, ...cohort.cells.map(cell => cell.users)], percentages: [100, ...cohort.cells.map(cell => cell.rate == null ? null : cell.rate * 100)] }]));
        observations.push({ fetchedAt: data.fetchedAt || null, cacheStatus: data.cached ? 'cached' : 'fresh' });
        return send({ cohorts, maxPeriods: data.periods + 1, periods: data.cohorts.map(cohort => cohort.periodStart), mode: data.bucket, range: days, windowStart: data.startDate, windowEnd: data.endDate, timeZone: data.timeZone, firstPeriodPartial: data.cohorts[0]?.startDate !== data.cohorts[0]?.periodStart, lastPeriodPartial: data.cohorts.at(-1)?.endDate !== data.cohorts.at(-1)?.periodEnd, lastPeriodInProgress: data.endDate >= data.today, truncated: false, lookbackDays: days });
      }
      if (action.startsWith('events')) {
        const names = await report(['eventName'], ['eventCount', 'totalUsers']);
        const custom = names.rows.filter(row => !AUTO_EVENTS.has(d(row, 0)));
        if (action === 'events/names') return send(custom.map(row => ({ eventName: d(row, 0), count: n(row, 0) })));
        if (action === 'events/silent') return send([]);
        if (action === 'events/overview') {
          const eventFilter = custom.length ? { filter: { fieldName: 'eventName', inListFilter: { values: custom.map(row => d(row, 0)) } } } : null;
          const totals = (await report([], ['totalUsers', 'sessions'])).rows[0];
          const events = custom.length ? (await report([], ['eventCount', 'totalUsers', 'sessions'], eventFilter)).rows[0] : null;
          return send({ events: n(events, 0), users_with_events: n(events, 1), sessions_with_events: n(events, 2), users: n(totals, 0), sessions: n(totals, 1), event_names: custom.length, autocaptured: undefined });
        }
        if (action === 'events/names/stats' || action === 'events/time-series' || action === 'events/count') {
          const bucket = ['minute', 'hour', 'day', 'week', 'month'].includes(q.trend_bucket || q.bucket) ? q.trend_bucket || q.bucket : 'day', dimension = timeDimension(bucket);
          const result = await report(['eventName', dimension], ['eventCount']);
          const buckets = [...new Set(result.rows.map(row => pointTime(d(row, 1), bucket)))].sort();
          const customNames = new Set(custom.map(row => d(row, 0)));
          if (action === 'events/names/stats') return send({ buckets, events: custom.map(row => {
            const name = d(row, 0), byTime = new Map(result.rows.filter(point => d(point, 0) === name).map(point => [pointTime(d(point, 1), bucket), n(point, 0)]));
            return { eventName: name, count: n(row, 0), users: n(row, 1), lastSeen: '', trend: buckets.map(time => byTime.get(time) || 0) };
          }) });
          if (action === 'events/time-series') { const top = new Set(custom.slice(0, Math.min(10, Number(q.limit) || 5)).map(row => d(row, 0))); return send(result.rows.filter(row => top.has(d(row, 0))).map(row => ({ event_name: d(row, 0), time: pointTime(d(row, 1), bucket), event_count: n(row, 0) }))); }
          const points = new Map(buckets.map(time => [time, { time, pageview_count: 0, custom_event_count: 0, outbound_count: 0, error_count: 0, performance_count: 0, button_click_count: 0, copy_count: 0, form_submit_count: 0, input_change_count: 0, event_count: 0 }]));
          for (const row of result.rows) { const name = d(row, 0), type = eventType(name), point = points.get(pointTime(d(row, 1), bucket)); if (type === 'custom_event' && !customNames.has(name)) continue; point[`${type}_count`] += n(row, 0); point.event_count += n(row, 0); }
          return send([...points.values()]);
        }
        if (action === 'events/outbound') {
          const result = await report(['linkUrl'], ['eventCount'], exact('eventName', 'click'));
          return send(result.rows.filter(row => /^https?:\/\//.test(d(row, 0))).map(row => ({ url: d(row, 0), count: n(row, 0), lastClicked: null })));
        }
        if (action === 'events/autocapture') return send(names.rows.filter(row => eventType(d(row, 0)) === q.type).map(row => ({ value: d(row, 0), count: n(row, 0), lastOccurred: null })));
        if (action === 'events/properties') throw failure('GA4 exposes registered custom dimensions rather than raw event parameters. Parameter details are unavailable for this report.', 422);
        throw failure('GA4 Data API supplies aggregated events, not individual event or session logs.', 422);
      }
      throw failure('This Rybbit feature requires individual collector data that GA4 Data API does not expose.', 422);
    } catch (error) { return res.status(error.status || 502).json({ error: error.message || 'GA4 report unavailable.' }); }
  };
}
module.exports = { createRybbitHandler, filtersFor, windowFor, overview, timeValue, eventType };
