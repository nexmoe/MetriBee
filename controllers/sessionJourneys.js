/** Ordered-session Journey semantics adapted from Rybbit (AGPL-3.0-only).
 * Referrer aggregates are deliberately never an input to this module.
 */
const { DateTime } = require('luxon');

const failure = message => Object.assign(new Error(message), { status: 400 });
const compact = pages => pages.filter((page, index) => index === 0 || page !== pages[index - 1]);
const sectionOf = page => { const match = /^(\/[^/]+)\/.+/.exec(page); return match ? `${match[1]}/**` : page; };
// Match the native glob grammar without a backtracking regular expression.
// Repeated wildcards must remain bounded even on a public demo endpoint.
function patternOf(pattern) {
  const tokens = pattern.match(/\*\*|\*|[^*]/g) || [];
  return { test(value) {
    let previous = new Uint8Array(value.length + 1);
    previous[0] = 1;
    for (const token of tokens) {
      const next = new Uint8Array(value.length + 1);
      if (token === '**') next[0] = previous[0];
      for (let i = 1; i <= value.length; i++) {
        next[i] = token === '**' ? previous[i] || (value[i - 1] !== '\n' && next[i - 1])
          : token === '*' ? value[i - 1] !== '/' && (previous[i - 1] || next[i - 1])
            : previous[i - 1] && value[i - 1] === token;
      }
      previous = next;
    }
    return !!previous[value.length];
  } };
}
const integer = (value, fallback, min, max) => {
  const parsed = value == null ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw failure(`Expected an integer between ${min} and ${max}.`);
  return parsed;
};
const json = (value, fallback) => { try { return value == null ? fallback : JSON.parse(value); } catch { throw failure('Invalid journey filters.'); } };

function optionsFor(query) {
  const steps = integer(query.steps, 3, 2, 10);
  const filters = json(query.stepFilters, {});
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)
    || Object.entries(filters).some(([key, value]) => !/^\d+$/.test(key) || typeof value !== 'string' || value.length > 2048)) throw failure('Invalid stepFilters format.');
  const groupBy = query.groupBy || 'path';
  if (!['path', 'section'].includes(groupBy)) throw failure('Invalid journey grouping.');
  if (query.endsAt != null && (typeof query.endsAt !== 'string' || query.endsAt.length > 2048)) throw failure('Invalid end-page pattern.');
  const endsAt = query.endsAt?.trim() || '';
  return { steps, groupBy, endsAt, endPattern: endsAt ? patternOf(endsAt) : null,
    patterns: Object.entries(filters).filter(([key, value]) => value && Number(key) < steps).map(([key, value]) => [Number(key), patternOf(value)]),
    goalId: query.goalId == null ? null : integer(query.goalId, null, 1, Number.MAX_SAFE_INTEGER) };
}

function sessionRows(sessions, query) {
  const filters = json(query.filters, []);
  if (!Array.isArray(filters) || filters.length > 20) throw failure('Invalid audience filters.');
  return sessions.map(session => {
    const views = (session.events || []).filter(event => event.type === 'pageview')
      .slice().sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const pages = compact(views.map(event => event.pathname));
    const entry = pages[0] || '', exit = pages.at(-1) || '';
    const fields = { ...session, entry_page: entry, exit_page: exit };
    for (const filter of filters) {
      const { parameter, type, value } = filter || {};
      if (typeof parameter !== 'string' || !Array.isArray(value) || value.length === 0
        || !['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'not_starts_with', 'ends_with', 'not_ends_with'].includes(type)) throw failure('Unsupported session audience filter.');
      const actual = String(fields[parameter] ?? '');
      const negative = type.startsWith('not_'), operation = negative ? type.slice(4) : type;
      const matches = value.some(expected => operation === 'equals' ? actual === String(expected)
        : operation === 'contains' ? actual.includes(String(expected))
          : operation === 'starts_with' ? actual.startsWith(String(expected)) : actual.endsWith(String(expected)));
      if (negative ? matches : !matches) return null;
    }
    return { session, pages, views };
  }).filter(Boolean).filter(row => row.pages.length > 0);
}

function shapedPath(pages, options) {
  const grouped = options.groupBy === 'section' ? compact(pages.map(sectionOf)) : pages;
  let path = grouped.slice(0, options.steps);
  if (options.endsAt) {
    const end = grouped.findIndex((page, index) => index >= 1 && options.endPattern.test(page));
    if (end < 1 || end >= options.steps) return null;
    path = grouped.slice(0, end + 1);
  }
  for (const [step, pattern] of options.patterns) {
    if (step >= path.length || !pattern.test(path[step])) return null;
  }
  return path;
}

function sessionCard({ session, pages, views }) {
  const card = { session_id: session.session_id, traits: session.traits || null };
  for (const field of ['user_id', 'identified_user_id', 'country', 'region', 'city', 'language', 'device_type', 'browser', 'browser_version', 'operating_system', 'operating_system_version', 'referrer', 'channel', 'hostname', 'page_title', 'querystring', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ip']) card[field] = session[field] || '';
  for (const field of ['screen_width', 'screen_height', 'lat', 'lon', 'has_replay']) card[field] = Number(session[field]) || 0;
  const events = [...session.events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  card.session_start = events[0].timestamp;
  card.session_end = events.at(-1).timestamp;
  card.session_duration = Math.max(0, (DateTime.fromSQL(card.session_end).toMillis() - DateTime.fromSQL(card.session_start).toMillis()) / 1000);
  card.entry_page = pages[0]; card.exit_page = pages.at(-1); card.pageviews = views.length;
  for (const [field, type] of Object.entries({ events: 'custom_event', errors: 'error', outbound: 'outbound', button_clicks: 'button_click', copies: 'copy', form_submits: 'form_submit', input_changes: 'input_change' })) card[field] = events.filter(event => event.type === type).length;
  return card;
}

function journeyReport(sessions, query = {}, action = 'paths') {
  const options = optionsFor(query);
  const all = sessionRows(sessions, query);
  const multi = all.filter(row => row.pages.length >= 2);
  const converted = row => options.goalId !== null && (row.session.goal_ids || []).includes(options.goalId);
  const top = rows => [...rows.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (action === 'context') {
    const entries = new Map();
    for (const row of all) entries.set(row.pages[0], (entries.get(row.pages[0]) || 0) + 1);
    const entry = top(entries);
    return { sessions: all.length, topEntry: entry ? { value: entry[0], count: entry[1], percentage: entry[1] * 100 / all.length } : null,
      ...(options.goalId === null ? {} : { conversions: all.filter(converted).length }) };
  }
  if (action === 'summary') {
    const exits = new Map();
    for (const row of multi) exits.set(row.pages.at(-1), (exits.get(row.pages.at(-1)) || 0) + 1);
    const exit = top(exits);
    return { sessions: multi.length, avgPathLength: multi.length ? multi.reduce((sum, row) => sum + row.pages.length, 0) / multi.length : 0,
      conversions: options.goalId === null ? null : multi.filter(converted).length,
      topExit: exit ? { page: exit[0], sessions: exit[1] } : null };
  }
  const selected = multi.map(row => ({ ...row, path: shapedPath(row.pages, options) })).filter(row => row.path !== null);
  if (action === 'sessions') {
    const path = json(query.path, null);
    if (!Array.isArray(path) || path.length < 1 || path.length > 10 || path.some(page => typeof page !== 'string' || page.length > 2048)) throw failure('Invalid journey path.');
    const key = JSON.stringify(path), offset = integer(query.offset, 0, 0, 100000), limit = integer(query.limit, 25, 1, 100);
    return selected.filter(row => JSON.stringify(row.path) === key && (query.replays_only !== 'true' || row.session.has_replay))
      .map(sessionCard).sort((a, b) => b.session_end.localeCompare(a.session_end) || a.session_id.localeCompare(b.session_id)).slice(offset, offset + limit);
  }
  const limit = integer(query.limit, 100, 1, 500);
  const paths = new Map();
  for (const row of selected) {
    const key = JSON.stringify(row.path), item = paths.get(key) || { path: row.path, count: 0, ...(options.goalId === null ? {} : { conversions: 0 }) };
    item.count++;
    if (options.goalId !== null && converted(row)) item.conversions++;
    paths.set(key, item);
  }
  return { journeys: [...paths.values()].sort((a, b) => b.count - a.count || JSON.stringify(a.path).localeCompare(JSON.stringify(b.path)))
    .slice(0, limit).map(row => ({ ...row, percentage: row.count * 100 / multi.length })), totalSessions: multi.length };
}

/** Native session expansion shows the original events, including repeated views. */
function journeySessionDetails(session, query = {}) {
  const row = sessionRows([session], {})[0];
  if (!row) throw Object.assign(new Error('Session not found.'), { status: 404 });
  const offset = integer(query.offset, 0, 0, 100000), limit = integer(query.limit, 100, 1, 100);
  const events = [...session.events].sort((a, b) => a.timestamp.localeCompare(b.timestamp)).map(event => ({
    hostname: session.hostname || '', querystring: '', page_title: event.pathname, referrer: session.referrer || '', ...event,
  }));
  return { session: sessionCard(row), events: events.slice(offset, offset + limit),
    pagination: { total: events.length, limit, offset, hasMore: events.length > offset + limit } };
}

/** Explicitly synthetic session events, separate from demo GA4 aggregate caches. */
function demoJourneySessions(property, range, timeZone = 'UTC') {
  const pages = require('./demoData')._internal.journeyPages(property.id);
  const page = index => pages[index % pages.length];
  const sequences = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 0], [0, 1, 2, 3, 4], [0, 1, 2, 3], [0, 1, 2], [0, 1], [0, 2, 3],
    [1, 2], [0, 1, 1, 2, 3], [0], [0, 3, 4, 5], [2, 3, 4], [0, 2, 1, 3, 4, 5],
    ...Array.from({ length: 12 }, (_, i) => [i % pages.length, (i + 2) % pages.length, (i + 4) % pages.length, (i + 1) % pages.length]),
  ];
  const weights = [36, 22, 16, 12, 10, 8, 6, 5, 5, 4, 3, 2];
  const start = range.startDateTime ? DateTime.fromISO(range.startDateTime) : DateTime.fromISO(range.startDate, { zone: timeZone }).startOf('day');
  const end = range.endDateTime ? DateTime.fromISO(range.endDateTime) : DateTime.fromISO(range.endDate, { zone: timeZone }).endOf('day');
  if (!start.isValid || !end.isValid || end < start || !pages.length) throw failure('Invalid demo journey period.');
  const duration = end.toMillis() - start.toMillis(), step = Math.max(1, Math.min(12000, duration / 3000));
  const patterns = sequences.flatMap((sequence, index) => Array.from({ length: weights[index] || 1 }, () => sequence));
  return patterns.map((sequence, index) => {
    const base = start.toMillis() + (index + 1) / (patterns.length + 1) * Math.max(0, duration - step * 11);
    const events = sequence.map((value, position) => ({ type: 'pageview', pathname: page(value), timestamp: DateTime.fromMillis(base + position * step).toUTC().toFormat('yyyy-MM-dd HH:mm:ss') }));
    return { session_id: `demo-${property.id}-${start.toMillis()}-${end.toMillis()}-${index}`, user_id: `demo-visitor-${Math.floor(index / 2)}`,
      hostname: property.domain, country: index % 3 ? 'US' : 'CN', city: index % 3 ? 'New York' : 'Shanghai', language: index % 3 ? 'en' : 'zh',
      browser: index % 2 ? 'Chrome' : 'Safari', operating_system: index % 2 ? 'Windows' : 'Mac OS', device_type: index % 4 ? 'desktop' : 'mobile',
      channel: 'Organic Search', referrer: 'google.com', screen_width: 1440, screen_height: 900, has_replay: 0,
      events, goal_ids: events.some(event => event.pathname === page(3)) ? [1] : [] };
  });
}

/** Reconstruct one synthetic session without persisting it or reading live caches. */
function demoJourneySession(property, id) {
  const match = /^demo-(\d+)-(\d{12,14})-(\d{12,14})-(\d{1,3})$/.exec(id);
  if (!match || match[1] !== String(property.id)) return null;
  const start = Number(match[2]), end = Number(match[3]);
  if (end < start || end - start > 6001 * 86400000) return null;
  return demoJourneySessions(property, { startDateTime: DateTime.fromMillis(start).toISO(), endDateTime: DateTime.fromMillis(end).toISO() })[Number(match[4])] || null;
}

module.exports = { journeyReport, journeySessionDetails, demoJourneySessions, demoJourneySession, patternOf };
