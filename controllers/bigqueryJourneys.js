/** Optional GA4 export source. All population/path aggregation runs in BigQuery;
 * no report is reconstructed from referrer pairs or a truncated event sample. */
const { createHash } = require('node:crypto');
const { DateTime } = require('luxon');
const { createBigQuery, sourceFor, failure } = require('../lib/bigquery');
const { optionsFor } = require('./sessionJourneys');
const DAY = 86400000;
const json = (value, fallback) => { try { return value == null ? fallback : typeof value === 'string' ? JSON.parse(value) : value; } catch { throw failure('Invalid journey filters.', 400); } };
const integer = (value, fallback, min, max) => {
  const n = value == null ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw failure(`Expected an integer between ${min} and ${max}.`, 400);
  return n;
};
const glob = pattern => '^' + pattern.split(/(\*\*|\*)/).map(s => s === '**' ? '.*' : s === '*' ? '[^/]*' : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('') + '$';
const parameter = key => `(SELECT COALESCE(value.string_value, CAST(value.int_value AS STRING), CAST(value.double_value AS STRING), CAST(value.float_value AS STRING)) FROM UNNEST(event_params) WHERE key=${key} LIMIT 1)`;
const ep = key => parameter(`'${key}'`);
const countries = [];
const display = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
  const code = String.fromCharCode(a, b), name = display.of(code);
  if (name) countries.push({ code, name });
}
countries.push({ code: 'US', name: 'United States' }, { code: 'KR', name: 'South Korea' }, { code: 'TR', name: 'Türkiye' });
const regionNames = require('../public/subdivision-names.generated.json');

function period(range, timeZone) {
  const start = range.startDateTime ? DateTime.fromISO(range.startDateTime) : DateTime.fromISO(range.startDate, { zone: timeZone }).startOf('day');
  const end = range.endDateTime ? DateTime.fromISO(range.endDateTime) : DateTime.fromISO(range.endDate, { zone: timeZone }).plus({ days: 1 }).startOf('day');
  if (!start.isValid || !end.isValid || end <= start || end.diff(start, 'days').days > 31 || end.toMillis() - start.toMillis() > 32 * DAY)
    throw failure('BigQuery Journeys supports up to 31 days per report. Choose a shorter period.', 400);
  return { start: start.toMillis(), end: end.toMillis(), startDate: start.setZone(timeZone).toISODate(), endDate: end.minus({ milliseconds: 1 }).setZone(timeZone).toISODate() };
}
function audience(raw, bind) {
  const filters = json(raw, []);
  if (!Array.isArray(filters) || filters.length > 20) throw failure('Choose up to 20 audience filters.', 400);
  const fields = new Set(['user_id', 'country', 'region', 'city', 'language', 'device_type', 'browser', 'browser_version', 'operating_system', 'operating_system_version', 'referrer', 'hostname', 'entry_page', 'exit_page', 'page_title', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']);
  return filters.map(filter => {
    const { parameter: field, type, value } = filter || {};
    const op = String(type).replace(/^not_/, '');
    if (!fields.has(field) || !['equals', 'contains', 'starts_with', 'ends_with'].includes(op) || !Array.isArray(value) || !value.length || value.length > 100)
      throw failure(`BigQuery Journeys does not support this audience filter: ${field || 'unknown'}.`, 400);
    const alternatives = value.map(item => {
      if (!['string', 'number'].includes(typeof item) || String(item).length > 2048) throw failure('Invalid audience filter value.', 400);
      let text = String(item), country, region;
      if (field === 'region' && regionNames[text]) { country = text.split('-')[0]; text = regionNames[text]; }
      if (field === 'city') {
        const code = Object.keys(regionNames).find(code => text.startsWith(code + '-'));
        if (code) { country = code.split('-')[0]; region = regionNames[code]; text = text.slice(code.length + 1); }
        else if (/^[A-Z]{2}--/.test(text)) { country = text.slice(0, 2); text = text.slice(4); }
      }
      const param = bind(text), col = `COALESCE(${field}, '')`;
      const match = op === 'equals' ? `${col}=${param}` : op === 'contains' ? `STRPOS(${col}, ${param})>0` : `${op === 'starts_with' ? 'STARTS_WITH' : 'ENDS_WITH'}(${col}, ${param})`;
      return '(' + [match, country && `country=${bind(country)}`, region && `region=${bind(region)}`].filter(Boolean).join(' AND ') + ')';
    });
    return `${type.startsWith('not_') ? 'NOT ' : ''}(${alternatives.join(' OR ')})`;
  }).join(' AND ') || 'TRUE';
}
function goalExpression(goal, bind) {
  if (!goal) return 'FALSE';
  const config = goal.config || {}, clauses = [];
  if (goal.goalType === 'path') clauses.push(`event_name='page_view'`, `REGEXP_CONTAINS(pathname, ${bind(glob(config.pathPattern))})`);
  else {
    const name = goal.goalType === 'event' ? config.eventName : { outbound: 'click', button_click: 'button_click', form_submit: 'form_submit', copy: 'copy' }[goal.goalType];
    if (!name) throw failure('This goal cannot be evaluated in GA4 export data.', 400);
    clauses.push(`event_name=${bind(name)}`);
    if (config.valuePattern) clauses.push(`REGEXP_CONTAINS(COALESCE(${parameter(bind(goal.goalType === 'outbound' ? 'link_url' : goal.goalType === 'form_submit' ? 'form_name' : 'text'))}, ''), ${bind(glob(config.valuePattern))})`);
  }
  const properties = [...(config.propertyFilters || []), ...(config.eventPropertyKey ? [{ key: config.eventPropertyKey, value: config.eventPropertyValue }] : [])];
  for (const { key, value } of properties) {
    if (goal.goalType === 'path') {
      const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      clauses.push(`REGEXP_CONTAINS(COALESCE(page_location, ''), ${bind(`[?&]${escape(encodeURIComponent(key))}=${escape(encodeURIComponent(String(value)))}(?:&|$)`)})`);
    } else clauses.push(`COALESCE(${parameter(bind(key))}, '')=${bind(String(value))}`);
  }
  return clauses.join(' AND ');
}
const attributes = ['country', 'region', 'city', 'language', 'device_type', 'browser', 'browser_version', 'operating_system', 'operating_system_version', 'referrer', 'hostname', 'page_title', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
function compile({ source, window, suffixes, schema, query = {}, goal, action = 'bundle', sessionHash }) {
  // Query values are always named parameters; identifiers come only from validated server config / table metadata.
  const params = { start_us: window.start * 1000, end_us: window.end * 1000, country_codes: JSON.stringify(countries) };
  const bind = value => { const name = `p${Object.keys(params).length}`; params[name] = value; return '@' + name; };
  const options = optionsFor({ ...query, stepFilters: typeof query.stepFilters === 'object' ? JSON.stringify(query.stepFilters) : query.stepFilters });
  const has = name => schema.has(name);
  const order = ['event_timestamp', ...['batch_page_id', 'batch_ordering_id', 'batch_event_index', 'event_bundle_sequence_id'].filter(has), 'event_name', 'page_location'];
  const optional = ['batch_page_id', 'batch_ordering_id', 'batch_event_index', 'event_bundle_sequence_id'].filter(has);
  const selectedSuffixes = suffixes.map(s => { if (!/^(?:intraday_)?\d{8}$/.test(s)) throw failure('Invalid export table.'); return `'${s}'`; });
  const sourceFields = has('collected_traffic_source') ? { utm_source: 'manual_source', utm_medium: 'manual_medium', utm_campaign: 'manual_campaign_name', utm_term: 'manual_term', utm_content: 'manual_content' } : {};
  const attrSql = [
    `COALESCE((SELECT JSON_VALUE(c, '$.code') FROM UNNEST(JSON_QUERY_ARRAY(@country_codes)) c WHERE JSON_VALUE(c, '$.name')=geo.country LIMIT 1), '') AS country`,
    `geo.region AS region`, `geo.city AS city`, `device.language AS language`, `device.category AS device_type`,
    `device.web_info.browser AS browser`, `device.web_info.browser_version AS browser_version`,
    `device.operating_system AS operating_system`, `device.operating_system_version AS operating_system_version`,
    `${ep('page_referrer')} AS referrer`, `NET.HOST(${ep('page_location')}) AS hostname`, `${ep('page_title')} AS page_title`,
    ...['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].map(field => `${sourceFields[field] ? `COALESCE(collected_traffic_source.${sourceFields[field]}, ${ep(field)})` : ep(field)} AS ${field}`),
  ];
  const section = options.groupBy === 'section' ? "REGEXP_REPLACE(pathname, r'^(/[^/]+)/.+', r'\\1/**')" : 'pathname';
  const sessionPredicate = sessionHash ? ` AND session_key=${bind(sessionHash)}` : '';
  const base = `WITH raw AS (
    SELECT event_timestamp, event_name, event_params, ${optional.map(s => s + ', ').join('')}
      TO_HEX(SHA256(TO_JSON_STRING(STRUCT(stream_id, user_pseudo_id, ${ep('ga_session_id')} AS session_id)))) AS session_key,
      TO_HEX(SHA256(user_pseudo_id)) AS user_id,
      ${ep('page_location')} AS page_location, ${attrSql.join(',\n      ')}
    FROM \`${source.projectId}.${source.datasetId}.events_*\`
    WHERE _TABLE_SUFFIX IN (${selectedSuffixes.join(',')}) AND event_timestamp>=@start_us AND event_timestamp<@end_us
      AND user_pseudo_id IS NOT NULL AND stream_id IS NOT NULL AND ${ep('ga_session_id')} IS NOT NULL
  ), located AS (
    SELECT *, COALESCE(REGEXP_EXTRACT(page_location, r'^(?:https?://[^/?#]+)?(/[^?#]*)'), '/') AS pathname FROM raw
  ), events AS (
    SELECT *, ROW_NUMBER() OVER(PARTITION BY session_key ORDER BY ${order.join(', ')}) AS event_order,
      (${goalExpression(goal, bind)}) AS converted FROM located
  ), views AS (
    SELECT *, ${section} AS grouped_page, LAG(pathname) OVER(PARTITION BY session_key ORDER BY event_order) AS previous_page
    FROM events WHERE event_name='page_view' AND page_location IS NOT NULL
  ), grouped_views AS (
    SELECT *, LAG(grouped_page) OVER(PARTITION BY session_key ORDER BY event_order) AS previous_group FROM views
  ), page_sessions AS (
    SELECT session_key, ARRAY_AGG(IF(previous_page IS DISTINCT FROM pathname, pathname, NULL) IGNORE NULLS ORDER BY event_order) AS pages,
      ARRAY_AGG(IF(previous_group IS DISTINCT FROM grouped_page, grouped_page, NULL) IGNORE NULLS ORDER BY event_order) AS grouped_pages,
      COUNT(*) AS pageviews, ${attributes.map(a => `(ARRAY_AGG(STRUCT(${a} AS value) ORDER BY event_order LIMIT 1))[OFFSET(0)].value AS ${a}`).join(',\n      ')}
    FROM grouped_views GROUP BY session_key
  ), session_events AS (
    SELECT session_key, ANY_VALUE(user_id) AS user_id, MIN(event_timestamp) AS start_us, MAX(event_timestamp) AS end_us,
      COUNTIF(event_name NOT IN ('page_view','session_start','first_visit','user_engagement')) AS events,
      COUNTIF(event_name='click') AS outbound, COUNTIF(event_name='form_submit') AS form_submits,
      COUNTIF(event_name='button_click') AS button_clicks, COUNTIF(event_name='copy') AS copies, LOGICAL_OR(converted) AS converted
    FROM events WHERE TRUE${sessionPredicate} GROUP BY session_key
  ), population AS (
    SELECT *, pages[SAFE_OFFSET(0)] AS entry_page, pages[SAFE_OFFSET(ARRAY_LENGTH(pages)-1)] AS exit_page
    FROM page_sessions JOIN session_events USING(session_key)
  ), filtered AS (SELECT * FROM population WHERE ${audience(query.filters, bind)}),
  multi AS (SELECT * FROM filtered WHERE ARRAY_LENGTH(pages)>=2),
  candidates AS (SELECT *, ARRAY(SELECT page FROM UNNEST(grouped_pages) page WITH OFFSET i WHERE i<${options.steps} ORDER BY i) AS candidate FROM multi),
  shaped AS (SELECT * EXCEPT(candidate), ${options.endsAt ? `ARRAY(SELECT page FROM UNNEST(candidate) page WITH OFFSET i WHERE i<=(SELECT MIN(j) FROM UNNEST(candidate) p WITH OFFSET j WHERE j>=1 AND REGEXP_CONTAINS(p, ${bind(glob(options.endsAt))})) ORDER BY i)` : 'candidate'} AS path FROM candidates),
  selected AS (SELECT * FROM shaped WHERE ARRAY_LENGTH(path)>=1${Object.entries(json(query.stepFilters, {})).filter(([key, value]) => value && Number(key) < options.steps).map(([key, value]) => ` AND COALESCE(REGEXP_CONTAINS(path[SAFE_OFFSET(${Number(key)})], ${bind(glob(value))}), FALSE)`).join('')})`;
  const idPrefix = `bq-${source.datasetId.slice(10)}-${window.start}-${window.end}-`;
  const card = `CONCAT(${bind(idPrefix)}, session_key) AS session_id, user_id, ${attributes.join(', ')},
    FORMAT_TIMESTAMP('%F %T', TIMESTAMP_MICROS(start_us), 'UTC') AS session_start,
    FORMAT_TIMESTAMP('%F %T', TIMESTAMP_MICROS(end_us), 'UTC') AS session_end,
    (end_us-start_us)/1000000 AS session_duration, entry_page, exit_page, pageviews, events, outbound, form_submits, button_clicks, copies,
    0 AS has_replay, 0 AS errors, 0 AS input_changes`;
  let select;
  if (action === 'sessions') {
    const path = json(query.path, null);
    if (!Array.isArray(path) || path.length < 1 || path.length > 10 || path.some(s => typeof s !== 'string' || s.length > 2048)) throw failure('Invalid journey path.', 400);
    const offset = integer(query.offset, 0, 0, 100000), limit = integer(query.limit, 25, 1, 100);
    select = `SELECT TO_JSON_STRING(STRUCT(ARRAY(SELECT AS STRUCT ${card} FROM selected WHERE TO_JSON_STRING(path)=${bind(JSON.stringify(path))}${query.replays_only === 'true' ? ' AND FALSE' : ''} ORDER BY end_us DESC, session_key LIMIT ${limit} OFFSET ${offset}) AS sessions))`;
  } else if (action === 'details') {
    const offset = integer(query.offset, 0, 0, 100000), limit = integer(query.limit, 100, 1, 100);
    const key = bind(sessionHash);
    select = `SELECT TO_JSON_STRING(STRUCT(
      (SELECT AS STRUCT ${card} FROM filtered LIMIT 1) AS session,
      ARRAY(SELECT AS STRUCT FORMAT_TIMESTAMP('%F %T', TIMESTAMP_MICROS(event_timestamp), 'UTC') AS timestamp,
        CASE WHEN event_name='page_view' THEN 'pageview' WHEN event_name='click' THEN 'outbound' WHEN event_name IN ('button_click','form_submit','copy') THEN event_name ELSE 'custom_event' END AS type,
        event_name, pathname, hostname, page_title, referrer, COALESCE(REGEXP_EXTRACT(page_location, r'\\?([^#]*)'), '') AS querystring
        FROM events WHERE session_key=${key} ORDER BY event_order LIMIT ${limit} OFFSET ${offset}) AS events,
      (SELECT AS STRUCT COUNT(*) AS total, ${limit} AS limit, ${offset} AS offset, COUNT(*)>${limit + offset} AS hasMore FROM events WHERE session_key=${key}) AS pagination))`;
  } else {
    select = `, counts AS (SELECT path, COUNT(*) AS count, COUNTIF(converted) AS conversions FROM selected GROUP BY path)
    SELECT TO_JSON_STRING(STRUCT(
      (SELECT AS STRUCT ARRAY(SELECT AS STRUCT path, count, SAFE_DIVIDE(count*100.0,(SELECT COUNT(*) FROM multi)) AS percentage${goal ? ', conversions' : ''} FROM counts ORDER BY count DESC, TO_JSON_STRING(path) LIMIT 500) AS journeys, (SELECT COUNT(*) FROM multi) AS totalSessions) AS paths,
      (SELECT AS STRUCT COUNT(*) AS sessions, COALESCE(AVG(ARRAY_LENGTH(pages)),0) AS avgPathLength, ${goal ? 'COUNTIF(converted)' : 'CAST(NULL AS INT64)'} AS conversions,
        (SELECT AS STRUCT exit_page AS page, COUNT(*) AS sessions FROM multi GROUP BY exit_page ORDER BY sessions DESC, exit_page LIMIT 1) AS topExit FROM multi) AS summary,
      (SELECT AS STRUCT COUNT(*) AS sessions, (SELECT AS STRUCT entry_page AS value, COUNT(*) AS count, SAFE_DIVIDE(COUNT(*)*100.0,(SELECT COUNT(*) FROM filtered)) AS percentage FROM filtered GROUP BY entry_page ORDER BY count DESC, entry_page LIMIT 1) AS topEntry${goal ? ', COUNTIF(converted) AS conversions' : ''} FROM filtered) AS context))`;
  }
  return { sql: base + '\n' + select, params };
}

function createBigQueryJourneys({ env = process.env, client = createBigQuery({ env }), now = () => Date.now() } = {}) {
  const cache = new Map(), pending = new Map();
  let cacheBytes = 0;
  const cached = async (key, ttl, load) => {
    const hit = cache.get(key); if (hit && hit.expires > now()) return { ...hit.value, localCacheHit: true };
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= 16) throw failure('BigQuery is busy. Try again shortly.', 429);
    const promise = Promise.resolve().then(load).then(value => {
      cacheBytes -= cache.get(key)?.bytes || 0;
      const bytes = Buffer.byteLength(JSON.stringify(value));
      cache.delete(key); cache.set(key, { expires: now() + ttl, value, bytes }); cacheBytes += bytes;
      while (cache.size > 100 || cacheBytes > 32 * 1024 * 1024) {
        const oldest = cache.keys().next().value;
        cacheBytes -= cache.get(oldest).bytes; cache.delete(oldest);
      }
      return value;
    }).finally(() => pending.delete(key));
    pending.set(key, promise); return promise;
  };
  const metadata = source => cached(`metadata:${JSON.stringify(source)}`, 60000, async () => {
    const root = `projects/${source.projectId}/datasets/${source.datasetId}`;
    const dataset = await client.call('GET', root);
    if (dataset.location?.toLowerCase() !== source.location.toLowerCase()) throw failure('BigQuery dataset location does not match its configuration.');
    let pageToken, tables = [], pages = 0;
    do {
      const result = await client.call('GET', `${root}/tables`, undefined, { maxResults: 1000, ...(pageToken ? { pageToken } : {}) });
      tables.push(...(result.tables || []).filter(t => /^events_(?:intraday_)?\d{8}$/.test(t.tableReference?.tableId || '')));
      pageToken = result.nextPageToken;
      if (++pages >= 10 && pageToken) throw failure('BigQuery export table catalog is too large.');
    } while (pageToken);
    if (!tables.length) return { suffixes: [], schema: new Set(), availableFrom: null, availableThrough: null };
    const table = tables.slice().sort((a, b) => Number(b.creationTime || 0) - Number(a.creationTime || 0))[0];
    const schema = new Set((await client.call('GET', `${root}/tables/${table.tableReference.tableId}`)).schema?.fields?.map(f => f.name) || []);
    for (const field of ['event_timestamp', 'event_name', 'event_params', 'user_pseudo_id', 'stream_id', 'geo', 'device']) if (!schema.has(field)) throw failure('BigQuery dataset is missing the GA4 event export schema.');
    const daily = new Set(tables.map(t => t.tableReference.tableId).filter(t => /^events_\d{8}$/.test(t)).map(t => t.slice(7)));
    const suffixes = tables.map(t => t.tableReference.tableId.slice(7)).filter(s => !s.startsWith('intraday_') || !daily.has(s.slice(9))).sort();
    const dates = suffixes.map(s => s.replace('intraday_', '')).sort();
    const date = s => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    return { suffixes, schema, availableFrom: date(dates[0]), availableThrough: date(dates.at(-1)) };
  });
  return {
    configured: propertyId => !!sourceFor(propertyId, env),
    async capabilities(propertyId) {
      const source = sourceFor(propertyId, env);
      if (!source) return { available: false, source: null, reason: 'not_configured' };
      try {
        const meta = await metadata(source);
        return { available: !!meta.suffixes.length, source: meta.suffixes.length ? 'bigquery' : null, reason: meta.suffixes.length ? undefined : 'export_pending', availableFrom: meta.availableFrom, availableThrough: meta.availableThrough, maxDays: 31 };
      } catch (error) { return { available: false, source: null, reason: 'bigquery_unavailable', message: error.message }; }
    },
    async report({ property, dateRange, timeZone, query = {}, action = 'paths', goal, sessionId }) {
      const source = sourceFor(property.id, env);
      if (!source) throw failure('Configure the GA4 BigQuery export for this property.', 422, 'journey_source_required');
      let window, sessionHash;
      if (sessionId) {
        const match = /^bq-(\d+)-(\d{12,14})-(\d{12,14})-([A-Fa-f0-9]{64})$/.exec(sessionId);
        if (!match || match[1] !== String(property.id)) throw failure('Session not found.', 404);
        window = period({ startDateTime: new Date(Number(match[2])).toISOString(), endDateTime: new Date(Number(match[3])).toISOString() }, timeZone);
        sessionHash = match[4].toUpperCase();
      } else window = period(dateRange, timeZone);
      const meta = await metadata(source);
      if (!meta.suffixes.length) throw failure('GA4 export tables are not available yet. Use Page transitions until the first export arrives.', 422, 'bigquery_export_pending');
      if (window.startDate < meta.availableFrom) throw failure(`GA4 exports start on ${meta.availableFrom}. Choose a period from that date.`, 422, 'bigquery_export_coverage');
      const suffixes = meta.suffixes.filter(s => { const date = s.replace('intraday_', ''); return date >= window.startDate.replaceAll('-', '') && date <= window.endDate.replaceAll('-', ''); });
      const expectedDays = Math.round((Date.parse(window.endDate) - Date.parse(window.startDate)) / DAY) + 1;
      const coverage = { availableFrom: meta.availableFrom, availableThrough: meta.availableThrough, partial: suffixes.length < expectedDays, intraday: suffixes.some(s => s.startsWith('intraday_')), window: { start: new Date(window.start).toISOString(), end: new Date(window.end).toISOString() } };
      if (!suffixes.length) throw failure('No GA4 export tables cover this period yet. Use an earlier period or Page transitions.', 422, 'bigquery_export_coverage');
      const limit = action === 'paths' ? integer(query.limit, 100, 1, 500) : null;
      const normalized = { ...query };
      // Summary/context share one default-shaped bundle with the default page load.
      if (['summary', 'context'].includes(action)) { delete normalized.steps; delete normalized.stepFilters; delete normalized.endsAt; delete normalized.groupBy; }
      if (action !== 'sessions' && action !== 'details') { delete normalized.limit; normalized.steps ??= 4; }
      const compiled = compile({ source, window, suffixes, schema: meta.schema, query: normalized, goal, action: ['sessions', 'details'].includes(action) ? action : 'bundle', sessionHash });
      const key = createHash('sha256').update(JSON.stringify([source, compiled.sql, compiled.params])).digest('hex');
      const result = await cached(`report:${key}`, 300000, () => client.query(source, compiled.sql, compiled.params));
      let data = action === 'paths' ? { ...result.data.paths, journeys: result.data.paths.journeys.slice(0, limit) } : ['sessions', 'details'].includes(action) ? action === 'sessions' ? result.data.sessions : result.data : result.data[action];
      if (action === 'details' && !data.session) throw failure('Session not found.', 404);
      const card = row => Object.assign({ traits: null, identified_user_id: '', channel: '', querystring: '', ip: '', screen_width: 0, screen_height: 0, lat: 0, lon: 0 }, Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value ?? ''])));
      if (action === 'sessions') data = data.map(card);
      if (action === 'details') data = { ...data, session: card(data.session) };
      return { data, source: 'bigquery', reportStatus: { fetchedAt: result.fetchedAt, cacheStatus: result.localCacheHit ? 'cached' : 'fresh' }, coverage,
        queryUsage: { bytesBilled: result.bytesBilled, cacheHit: result.cacheHit, localCacheHit: !!result.localCacheHit } };
    },
  };
}
let singleton;
const getBigQueryJourneys = () => singleton ||= createBigQueryJourneys();
module.exports = { createBigQueryJourneys, getBigQueryJourneys, compile, period, glob };
