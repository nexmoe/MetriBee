const { createHash } = require('node:crypto');
const { createEmbedStore } = require('../lib/embedStore');
const { cacheGet, cacheSet } = require('./reportCache');
const { getGA4DataClient, getGA4AdminClient, runSafeHistoricalReport } = require('./ga4Service');

const ALLOWED_MINUTES = new Set([30, 1440, 10080]);
const failure = (message, status = 400) => Object.assign(new Error(message), { status });
const metric = row => Number(row?.metricValues?.[0]?.value) || 0;
const dimension = row => row?.dimensionValues?.[0]?.value || '';

function localStamp(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}`;
}
const dateOf = stamp => `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
function utcForStamp(stamp, timeZone) {
  const epoch = value => Date.UTC(+value.slice(0, 4), +value.slice(4, 6) - 1, +value.slice(6, 8), +value.slice(8, 10) || 0, +value.slice(10, 12) || 0);
  const target = epoch(stamp);
  let time = target;
  for (let i = 0; i < 3; i++) {
    const offset = target - epoch(localStamp(new Date(time), timeZone));
    if (!offset) break;
    time += offset;
  }
  return new Date(time).toISOString().slice(0, 19).replace('T', ' ');
}

function createEmbedHandlers(deps = {}) {
  const store = deps.store || createEmbedStore();
  const properties = deps.properties || (() => require('./apiController').ensureProperties());
  const client = deps.client || getGA4DataClient;
  const admin = deps.admin || getGA4AdminClient;
  const run = deps.run || runSafeHistoricalReport;
  const read = deps.read || cacheGet, write = deps.write || cacheSet;
  const now = deps.now || (() => new Date());
  const pending = new Map(), waiting = [];
  let active = 0;
  async function cached(key, task) {
    const hash = 'widget-v1:' + createHash('sha256').update(key).digest('hex');
    if (!pending.has(hash)) {
      const work = (async () => {
        const hit = await read('embed', hash);
        if (hit) return hit;
        if (active >= 3) await new Promise(resolve => waiting.push(resolve));
        else active++;
        try {
          const value = await task();
          await write('embed', hash, value);
          return value;
        } finally { if (waiting.length) waiting.shift()(); else active--; }
      })().finally(() => pending.delete(hash));
      pending.set(hash, work);
    }
    return pending.get(hash);
  }
  async function propertyFor(id) {
    if (!/^\d+$/.test(String(id))) throw failure('Choose a numeric property ID.');
    const property = (await properties()).properties.find(item => String(item.id) === String(id));
    if (!property) throw failure('Property not found.', 404);
    return property;
  }
  async function timeZoneFor(property) {
    if (property.timeZone) return property.timeZone;
    const metadata = await read('retention-meta', String(property.id));
    if (metadata?.timeZone) return metadata.timeZone;
    const [data] = await admin().getProperty({ name: `properties/${property.id}` });
    if (!data.timeZone) throw failure('Property time zone is unavailable.', 502);
    await write('retention-meta', String(property.id), { timeZone: data.timeZone });
    return data.timeZone;
  }
  const handle = task => async (req, res) => {
    res.header('Cache-Control', 'no-store');
    try { return await task(req, res); }
    catch (error) { return res.status(error.status || (error.code === 8 ? 429 : 502)).send({ error: error.message || 'Embed unavailable.' }); }
  };
  const management = task => handle(async (req, res) => {
    if (req.headers?.['x-private-key'] || req.headers?.['x-private-site']) throw failure('Shared dashboards are read-only.', 403);
    const property = await propertyFor(req.params.siteId);
    return task(req, res, String(property.id));
  });
  return {
    store,
    propertyFor,
    timeZoneFor,
    config: management(async (req, res, id) => {
      if (req.body && Object.keys(req.body).length === 1 && typeof req.body.public === 'boolean') {
        return res.send({ success: true, ...await store.setPublic(id, req.body.public) });
      }
      if (!req.body || Object.keys(req.body).length !== 1 || typeof req.body.embedEnabled !== 'boolean') throw failure('Choose one boolean public or embedEnabled setting.');
      const config = await store.setEnabled(id, req.body.embedEnabled);
      return res.send({ success: true, embedEnabled: config.embedEnabled });
    }),
    privateLink: management(async (req, res, id) => {
      const data = req.method === 'GET' ? { privateLinkKey: (await store.get(id)).privateLinkKey }
        : await store.privateLink(id, req.body?.action);
      return res.send({ success: true, data });
    }),
    widget: handle(async (req, res) => {
      const property = await propertyFor(req.params.siteId);
      if (!(await store.get(property.id)).embedEnabled) throw failure('Embed widget is not enabled for this site.', 403);
      const { renderWidget } = require('./rybbitWidget');
      res.headers({ 'Content-Security-Policy': 'frame-ancestors *', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      return res.type('html').send(renderWidget(String(property.id), req.query));
    }),
    stats: handle(async (req, res) => {
      const property = await propertyFor(req.params.siteId), id = String(property.id);
      const minutes = Number(req.query.minutes ?? 30);
      if (!ALLOWED_MINUTES.has(minutes)) throw failure('Invalid minutes. Allowed: 30, 1440, 10080.');
      if (!(await store.get(id)).embedEnabled) throw failure('Embed widget is not enabled for this site.', 403);
      const chart = req.query.chart === 'true', countries = req.query.countries === 'true';
      const date = now(), start = new Date(date.getTime() - minutes * 60000);
      let report, timeZone = 'UTC';
      if (minutes === 30) {
        report = dimensions => cached(JSON.stringify({ id, minutes, dimensions }), async () => {
          const [result] = await client().runRealtimeReport({ property: `properties/${id}`,
            dimensions: dimensions.map(name => ({ name })), metrics: [{ name: 'activeUsers' }],
            minuteRanges: [{ startMinutesAgo: 29, endMinutesAgo: 0 }], limit: 100,
            orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
            returnPropertyQuota: true });
          return result;
        });
      } else {
        timeZone = await timeZoneFor(property);
        const from = localStamp(start, timeZone), to = localStamp(date, timeZone);
        const dateRange = { startDate: dateOf(from), endDate: dateOf(to) };
        const dimensionFilter = { filter: { fieldName: 'dateHourMinute', betweenFilter: {
          fromValue: { int64Value: from }, toValue: { int64Value: to },
        } } };
        report = dimensions => cached(JSON.stringify({ id, minutes, dimensions, timeZone }), async () => {
          const result = await run({ propertyId: id, dateRange, dimensions: dimensions.map(name => ({ name })),
            metrics: [{ name: 'activeUsers' }], dimensionFilter, limit: 100 });
          if (!result.ok) throw failure(result.error || 'GA4 report unavailable.', result.errorCode === 8 ? 429 : 502);
          return result;
        });
      }
      const bucket = minutes === 30 ? 'minutesAgo' : minutes === 1440 ? 'dateHour' : 'date';
      const [total, timeline, countryReport] = await Promise.all([
        report([]), chart ? report([bucket]) : null, countries ? report(['countryId']) : null,
      ]);
      let series = [];
      if (chart) {
        const byTime = new Map((timeline.rows || []).map(row => [dimension(row), metric(row)]));
        if (minutes === 30) {
          const minute = Math.floor(date.getTime() / 60000) * 60000;
          series = Array.from({ length: 30 }, (_, i) => ({
            time: new Date(minute - (29 - i) * 60000).toISOString().slice(0, 19).replace('T', ' '),
            users: byTime.get(String(29 - i)) || byTime.get(String(29 - i).padStart(2, '0')) || 0,
          }));
        } else {
          const keys = new Set();
          for (let time = start.getTime(); time <= date.getTime(); time += 30 * 60000) {
            keys.add(localStamp(new Date(time), timeZone).slice(0, minutes === 1440 ? 10 : 8));
          }
          series = [...keys].sort().map(key => ({ time: utcForStamp(key.padEnd(12, '0'), timeZone), users: byTime.get(key) || 0 }));
        }
      }
      const topCountries = (countryReport?.rows || []).map(row => ({ country: dimension(row), users: metric(row) }))
        .filter(row => /^[A-Z]{2}$/.test(row.country)).sort((a, b) => b.users - a.users).slice(0, 5);
      res.header('Cache-Control', 'public, max-age=60');
      return res.send({ count: (total.rows || []).reduce((sum, row) => sum + metric(row), 0), series, topCountries });
    }),
    dashboard: handle(async (req, res) => {
      const property = await propertyFor(req.params.siteId);
      if (!await store.validate(property.id, req.params.privateKey)) throw failure('Private dashboard link is invalid or has been revoked.', 404);
      res.headers({ 'Content-Security-Policy': 'frame-ancestors *', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' });
      req.sharedProperty = property;
      return require('./workspace').workspaceView(req, res, error => { throw error; });
    }),
  };
}

const handlers = createEmbedHandlers();
module.exports = { createEmbedHandlers, handlers, localStamp, utcForStamp };
