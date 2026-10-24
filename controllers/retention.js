const { getGA4DataClient, getGA4AdminClient } = require('./ga4Service');
const { cacheGet, cacheSet, shouldBypass } = require('./reportCache');

const DAY = 86400000;
const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90 };
const dateNumber = date => Date.parse(`${date}T00:00:00Z`) / DAY;
const dateString = day => new Date(day * DAY).toISOString().slice(0, 10);
const validDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
  && Number.isFinite(dateNumber(date)) && dateString(dateNumber(date)) === date;

function todayInZone(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = type => parts.find(p => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function planReport(query, today) {
  const bucket = query.bucket || 'week';
  const range = query.range || '30d';
  if (!['day', 'week'].includes(bucket) || !Object.hasOwn(RANGE_DAYS, range)) {
    throw Object.assign(new Error('Choose day/week and a 7d, 30d or 90d range.'), { status: 400 });
  }
  if (query.end !== undefined && !validDate(query.end)) {
    throw Object.assign(new Error('Use YYYY-MM-DD for the end date.'), { status: 400 });
  }
  const endDate = query.end || today;
  if (endDate > today || endDate < '2015-01-01') {
    throw Object.assign(new Error('Choose an end date between 2015-01-01 and today.'), { status: 400 });
  }
  if (query.start !== undefined && !validDate(query.start)) throw Object.assign(new Error('Use YYYY-MM-DD for the start date.'), { status: 400 });
  const days = query.start === undefined ? RANGE_DAYS[range] : dateNumber(endDate) - dateNumber(query.start) + 1;
  if (!Number.isInteger(days) || days < 1 || days > 90) throw Object.assign(new Error('Choose a cohort range of 1–90 days.'), { status: 400 });
  const step = bucket === 'week' ? 7 : 1;
  const end = dateNumber(endDate), start = end - days + 1;
  const firstSunday = start - new Date(start * DAY).getUTCDay();
  const periods = bucket === 'week' ? Math.max(1, Math.floor((end - firstSunday) / 7)) : Math.min(30, days - 1);
  const makeCohorts = (from, to, prefix) => {
    // GA4's cohortNthWeek uses calendar weeks, Sunday through Saturday.
    const first = step === 7 ? from - new Date(from * DAY).getUTCDay() : from;
    const cohorts = [];
    for (let day = first; day <= to; day += step) {
      cohorts.push({
        name: `${prefix}${dateString(day).replaceAll('-', '')}`,
        periodStart: dateString(day), periodEnd: dateString(day + step - 1),
        startDate: dateString(Math.max(day, from)), endDate: dateString(Math.min(day + step - 1, to)),
      });
    }
    return cohorts;
  };
  const previousEnd = start - 1, previousStart = start - days;
  return {
    bucket, range, days, step, periods, today,
    startDate: dateString(start), endDate,
    previousStartDate: dateString(previousStart), previousEndDate: dateString(previousEnd),
    cohorts: makeCohorts(start, end, 'current'),
    previousCohorts: makeCohorts(previousStart, previousEnd, 'previous'),
  };
}

function buildCohorts(definitions, rows, plan, endDate) {
  const byName = new Map(definitions.map(c => [c.name, { ...c, size: 0, values: new Map() }]));
  for (const row of rows) {
    const cohort = byName.get(row.dimensionValues?.[0]?.value);
    const offset = Number(row.dimensionValues?.[1]?.value);
    if (!cohort || !Number.isInteger(offset) || offset < 0 || offset > plan.periods) continue;
    const active = Number(row.metricValues?.[0]?.value) || 0;
    const total = Number(row.metricValues?.[1]?.value) || 0;
    cohort.size = Math.max(cohort.size, total);
    cohort.values.set(offset, active);
  }
  return [...byName.values()].map(({ values, ...c }) => ({
    ...c,
    partial: c.startDate !== c.periodStart || c.endDate !== c.periodEnd || c.periodEnd >= plan.today,
    cells: Array.from({ length: plan.periods }, (_, i) => {
      const offset = i + 1;
      const from = dateNumber(c.periodStart) + offset * plan.step;
      const to = from + plan.step - 1;
      const startDate = dateString(from), targetEnd = dateString(to);
      // A historical range ending mid-week cannot expose activity after its end.
      // GA4 doesn't provide an as-of cutoff for a partial cohort week, so omit it.
      const unavailable = startDate > endDate || (targetEnd > endDate && endDate < plan.today);
      const status = unavailable ? 'future' : targetEnd >= plan.today ? 'partial' : 'complete';
      const users = unavailable || !c.size ? null : values.get(offset) || 0;
      return { offset, startDate, endDate: targetEnd, status, users, rate: users === null ? null : users / c.size };
    }),
  }));
}

function summarize(cohorts, periods) {
  const cells = Array.from({ length: periods }, (_, i) => {
    const eligible = cohorts.filter(c => c.size > 0 && c.cells[i].status === 'complete');
    const size = eligible.reduce((sum, c) => sum + c.size, 0);
    const users = eligible.reduce((sum, c) => sum + c.cells[i].users, 0);
    return { offset: i + 1, users, size, rate: size ? users / size : null, cohorts: eligible.length };
  });
  const complete = cohorts.filter(c => !c.partial);
  const best = cohorts.filter(c => c.cells[0]?.status === 'complete' && c.size > 0)
    .sort((a, b) => b.cells[0].rate - a.cells[0].rate)[0];
  return {
    cells, totalUsers: cohorts.reduce((sum, c) => sum + c.size, 0),
    averageSize: complete.length ? complete.reduce((sum, c) => sum + c.size, 0) / complete.length : null,
    bestCohort: best?.name || null,
  };
}

function createRetentionHandler(deps = {}) {
  const loadProperties = deps.loadProperties || (() => require('./apiController').ensureProperties());
  const read = deps.read || cacheGet, write = deps.write || cacheSet;
  const dataClient = deps.dataClient || getGA4DataClient;
  const adminClient = deps.adminClient || getGA4AdminClient;
  const now = deps.now || (() => new Date());
  const inFlight = new Map(), metaInFlight = new Map();

  async function timeZoneFor(property) {
    if (property.timeZone) return property.timeZone;
    if (metaInFlight.has(property.id)) return metaInFlight.get(property.id);
    const pending = (async () => {
      const cached = await read('retention-meta', property.id);
      if (cached?.timeZone) return cached.timeZone;
      const [meta] = await adminClient().getProperty({ name: `properties/${property.id}` });
      if (!meta.timeZone) throw new Error('Property time zone is unavailable.');
      await write('retention-meta', property.id, { timeZone: meta.timeZone });
      return meta.timeZone;
    })();
    metaInFlight.set(property.id, pending);
    try { return await pending; } finally { metaInFlight.delete(property.id); }
  }

  async function report(property, plan, timeZone, fresh) {
    const key = `v2:${property.id}:${plan.bucket}:${plan.startDate}:${plan.endDate}:${plan.today}`;
    if (inFlight.has(key)) return inFlight.get(key);
    const pending = (async () => {
      const bypass = fresh && shouldBypass(`retention:${key}`);
      const cached = !bypass && await read('retention', key);
      if (cached) return { ...cached, cached: true };
      const all = [...plan.cohorts, ...plan.previousCohorts], rows = [];
      let thresholded = false, sampled = false;
      // Small sequential batches bound request size and concurrent quota use.
      for (let i = 0; i < all.length; i += 12) {
        const batch = all.slice(i, i + 12);
        const [response] = await dataClient().runReport({
          property: `properties/${property.id}`,
          dimensions: [{ name: 'cohort' }, { name: plan.bucket === 'week' ? 'cohortNthWeek' : 'cohortNthDay' }],
          metrics: [{ name: 'cohortActiveUsers' }, { name: 'cohortTotalUsers' }],
          cohortSpec: {
            cohorts: batch.map(c => ({ name: c.name, dimension: 'firstSessionDate', dateRange: { startDate: c.startDate, endDate: c.endDate } })),
            cohortsRange: { granularity: plan.bucket === 'week' ? 'WEEKLY' : 'DAILY', startOffset: 0, endOffset: plan.periods },
          },
          limit: batch.length * (plan.periods + 1),
          returnPropertyQuota: true,
        });
        if (Number(response.rowCount) > (response.rows || []).length) throw new Error('GA4 returned an incomplete cohort report.');
        rows.push(...(response.rows || []));
        thresholded ||= !!response.metadata?.subjectToThresholding;
        sampled ||= !!response.metadata?.samplingMetadatas?.length;
      }
      const cohorts = buildCohorts(plan.cohorts, rows, plan, plan.endDate);
      const previous = buildCohorts(plan.previousCohorts, rows, plan, plan.previousEndDate);
      const payload = {
        ok: true, propertyId: property.id, site: property.site, timeZone,
        bucket: plan.bucket, range: plan.range, days: plan.days, periods: plan.periods, today: plan.today,
        startDate: plan.startDate, endDate: plan.endDate,
        cohorts, summary: summarize(cohorts, plan.periods),
        previous: { startDate: plan.previousStartDate, endDate: plan.previousEndDate, summary: summarize(previous, plan.periods) },
        thresholded, sampled, fetchedAt: now().toISOString(), cached: false,
      };
      await write('retention', key, payload);
      return payload;
    })();
    inFlight.set(key, pending);
    try { return await pending; } finally { inFlight.delete(key); }
  }

  return async (req, res) => {
    try {
      // Validate before consulting properties, credentials or GA4.
      const date = now();
      // UTC+14 may already be on the next calendar day. Validate the exact
      // future cutoff once the property's zone is available.
      planReport(req.query, todayInZone(new Date(date.getTime() + DAY), 'UTC'));
      if (!/^\d+$/.test(req.params.propertyId || '')) return res.status(400).json({ ok: false, error: 'Choose a numeric property ID.' });
      const { properties } = await loadProperties();
      const property = properties.find(p => String(p.id) === req.params.propertyId);
      if (!property) return res.status(404).json({ ok: false, error: 'Property not found.' });
      const timeZone = await timeZoneFor(property);
      const plan = planReport(req.query, todayInZone(date, timeZone));
      return res.json(await report(property, plan, timeZone, req.query.fresh === '1'));
    } catch (err) {
      const status = err.status || (err.code === 7 ? 403 : err.code === 8 ? 429 : 502);
      return res.status(status).json({ ok: false, error: err.message || 'Could not load retention data.' });
    }
  };
}

async function retentionView(req, res, next) {
  try {
    const { properties } = await require('./apiController').ensureProperties();
    res.render('retention', {
      properties,
      head: { title: 'MetriBee · Retention', description: 'User retention by first-visit cohort' },
    });
  } catch (err) { next(err); }
}

module.exports = { todayInZone, validDate, planReport, buildCohorts, summarize, createRetentionHandler, retentionView };
