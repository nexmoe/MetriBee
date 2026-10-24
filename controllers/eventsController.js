const { runSafeHistoricalReport } = require('./ga4Service');
const { cacheGet, cacheSet, shouldBypass } = require('./reportCache');

const RANGES = { today: 1, '7d': 7, '28d': 28, '30d': 30, '90d': 90 };
const TYPES = [
  { id: 'other', label: 'Custom & other', names: [] },
  { id: 'outbound', label: 'Outbound links', names: ['click'] },
  { id: 'forms', label: 'Forms', names: ['form_start', 'form_submit'] },
  { id: 'downloads', label: 'Downloads', names: ['file_download'] },
  { id: 'engagement', label: 'Engagement', names: ['scroll', 'user_engagement', 'video_start', 'video_progress', 'video_complete'] },
  { id: 'sessions', label: 'Session & acquisition', names: ['session_start', 'first_visit', 'first_open'] },
  { id: 'pageviews', label: 'Pageviews', names: ['page_view', 'screen_view'] },
];
const eventType = name => TYPES.find(t => t.names.includes(name))?.id || 'other';
const value = (row, i) => Number(row?.metricValues?.[i]?.value) || 0;
const dim = (row, i) => row.dimensionValues?.[i]?.value || '(not set)';
const relative = days => days ? `${days}daysAgo` : 'today';

function parseQuery(req) {
  const propertyId = req.params.propertyId;
  const range = req.query.range ?? '30d';
  const offset = req.query.offset ?? '0';
  if (!/^\d+$/.test(propertyId || '') || typeof range !== 'string' || !Object.hasOwn(RANGES, range) ||
      typeof offset !== 'string' || !/^\d{1,3}$/.test(offset) || Number(offset) > 365) return null;
  if (req.query.event !== undefined && (typeof req.query.event !== 'string' || !req.query.event.length || req.query.event.length > 100)) return null;
  const days = RANGES[range];
  const end = Number(offset);
  return { propertyId, range, offset: end, days,
    current: { startDate: relative(end + days - 1), endDate: relative(end) },
    previous: { startDate: relative(end + 2 * days - 1), endDate: relative(end + days) } };
}

function datesFor(query, timeZone, now) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = type => parts.find(p => p.type === type).value;
  const today = Date.UTC(Number(part('year')), Number(part('month')) - 1, Number(part('day')));
  return Array.from({ length: query.days }, (_, i) => new Date(today - (query.offset + query.days - 1 - i) * 86400000).toISOString().slice(0, 10));
}

function summary(report) {
  const row = report.rows[0];
  return { events: value(row, 0), users: value(row, 1), sessions: value(row, 2), keyEvents: value(row, 3), perSession: value(row, 4) };
}

function createEventsHandlers(deps = {}) {
  const run = deps.run || runSafeHistoricalReport;
  const read = deps.read || cacheGet;
  const write = deps.write || cacheSet;
  const bypass = deps.bypass || shouldBypass;
  const now = deps.now || (() => new Date());
  const loadProperties = deps.loadProperties || (() => require('./apiController').ensureProperties());
  const pending = new Map();

  async function checked(query) {
    const report = await run(query);
    if (!report.ok) throw new Error(report.error || 'GA4 report unavailable');
    return report;
  }

  async function overview(q) {
    const base = { propertyId: q.propertyId, dateRange: q.current };
    const totals = { ...base, dimensions: [], metrics: ['eventCount', 'totalUsers', 'sessions', 'keyEvents', 'eventsPerSession'].map(name => ({ name })), limit: 1 };
    const names = { ...base, dimensions: [{ name: 'eventName' }], metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }], limit: 10000 };
    // Keep at most three GA4 requests in flight for this page.
    const [current, previous, currentNames] = await Promise.all([
      checked(totals), checked({ ...totals, dateRange: q.previous }), checked(names),
    ]);
    const [previousNames, daily] = await Promise.all([
      checked({ ...names, dateRange: q.previous }),
      checked({ ...names, dimensions: [{ name: 'date' }, { name: 'eventName' }], metrics: [{ name: 'eventCount' }], limit: 100000,
        orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }] }),
    ]);
    const timeZone = current.metadata?.timeZone || 'UTC';
    const dates = datesFor(q, timeZone, now());
    const dateIndex = new Map(dates.map((date, i) => [date.replaceAll('-', ''), i]));
    const prevByName = new Map(previousNames.rows.map(row => [dim(row, 0), value(row, 0)]));
    const events = currentNames.rows.map(row => ({ name: dim(row, 0), type: eventType(dim(row, 0)),
      events: value(row, 0), users: value(row, 1), previous: prevByName.get(dim(row, 0)) || 0, series: Array(q.days).fill(0), latestDay: null }));
    const byName = new Map(events.map(e => [e.name, e]));
    for (const row of daily.rows) {
      const index = dateIndex.get(dim(row, 0));
      const event = byName.get(dim(row, 1));
      if (!event || index === undefined) continue;
      event.series[index] += value(row, 0);
      if (value(row, 0) && (!event.latestDay || dates[index] > event.latestDay)) event.latestDay = dates[index];
    }
    const types = TYPES.map(t => ({ id: t.id, label: t.label, events: 0, previous: 0, names: 0, series: Array(q.days).fill(0) }));
    for (const event of events) {
      const type = types.find(t => t.id === event.type);
      type.events += event.events;
      type.names++;
      event.series.forEach((n, i) => { type.series[i] += n; });
    }
    for (const row of previousNames.rows) types.find(t => t.id === eventType(dim(row, 0))).previous += value(row, 0);
    const reports = [current, previous, currentNames, previousNames, daily];
    return { totals: summary(current), previous: summary(previous), dates, timeZone, types, events,
      eventNames: currentNames.rowCount ?? events.length,
      previousEventNames: previousNames.rowCount ?? previousNames.rows.length,
      newNames: events.filter(e => !prevByName.has(e.name)).length,
      limited: reports.some(r => (r.rowCount || 0) > r.rows.length || r.metadata?.dataLossFromOtherRow),
      thresholded: reports.some(r => r.metadata?.subjectToThresholding),
      sampled: reports.some(r => r.metadata?.samplingMetadatas?.length),
      fetchedAt: now().getTime() };
  }

  async function activity(q, event) {
    const report = await checked({ propertyId: q.propertyId, dateRange: q.current,
      dimensions: ['dateHour', 'eventName', 'pagePath', 'deviceCategory'].map(name => ({ name })),
      metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }], limit: 100,
      orderBys: [{ dimension: { dimensionName: 'dateHour' }, desc: true }, { metric: { metricName: 'eventCount' }, desc: true }],
      ...(event ? { dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: event, caseSensitive: true } } } } : {}),
    });
    return { rows: report.rows.map(row => ({ hour: dim(row, 0), name: dim(row, 1), type: eventType(dim(row, 1)),
      page: dim(row, 2), device: dim(row, 3), events: value(row, 0), users: value(row, 1) })),
      rowCount: report.rowCount ?? report.rows.length, timeZone: report.metadata?.timeZone || 'UTC',
      thresholded: !!report.metadata?.subjectToThresholding, sampled: !!report.metadata?.samplingMetadatas?.length,
      fetchedAt: now().getTime() };
  }

  function api(kind) {
    return async (req, res) => {
      const q = parseQuery(req);
      if (!q) return res.status(400).json({ error: 'Choose a numeric property, a supported range and an offset from 0 to 365 days.' });
      try {
        const { properties } = await loadProperties();
        if (!properties.some(p => String(p.id) === q.propertyId)) return res.status(404).json({ error: 'Property not found' });
        // Hash event names so cache filenames cannot collide after filename sanitization.
        const event = kind === 'activity' ? req.query.event : undefined;
        const hash = require('crypto').createHash('sha256').update(event || '').digest('hex').slice(0, 20);
        const key = `v1:${q.propertyId}:${q.range}:${q.offset}:${kind}:${hash}:${now().toISOString().slice(0, 10)}`;
        const fresh = req.query.fresh === '1' && bypass(`events:${key}`);
        if (!fresh) {
          const cached = await read('events', key);
          if (cached) return res.json({ ...cached, cached: true });
        }
        if (!pending.has(key)) {
          const request = (kind === 'overview' ? overview(q) : activity(q, event)).then(async data => {
            const payload = { ok: true, propertyId: q.propertyId, range: q.range, offset: q.offset, ...data };
            await write('events', key, payload);
            return payload;
          }).finally(() => pending.delete(key));
          pending.set(key, request);
        }
        res.json(await pending.get(key));
      } catch (err) {
        res.status(502).json({ error: err.message || 'GA4 events unavailable' });
      }
    };
  }

  return {
    overview: api('overview'), activity: api('activity'),
    view: async (req, res) => {
      const { properties } = await loadProperties();
      res.render('events', { properties, head: { title: 'MetriBee · Events', description: 'Event trends and activity from Google Analytics 4' } });
    },
  };
}

module.exports = { createEventsHandlers, parseQuery, datesFor, eventType };
