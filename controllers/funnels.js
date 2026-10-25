const { createHash } = require('node:crypto');
const { getGA4DataClient, getGA4AlphaDataClient } = require('./ga4Service');
const { filtersFor, windowFor } = require('./rybbit');
const { createFunnelStore } = require('../lib/funnelStore');
const { cacheGetEntry, cacheSet } = require('./reportCache');

const MAX_STEPS = 10;
const MAX_VALUE = 500;
const MAX_SUMMARY_FUNNELS = 50;
const EVENT_NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const failure = (message, status = 400) => Object.assign(new Error(message), { status });
const publicError = error => /TLS|socket|network|ETIMEDOUT|ECONN|ENOTFOUND|EAI_AGAIN|DEADLINE_EXCEEDED|fetch failed/i.test(error.message || '') || error.code === 4
  ? 'Could not connect to Google Analytics. Please try again.' : error.message || 'GA4 funnel report unavailable.';
function reportStatus(reports) {
  const states = new Set(reports.map(report => report.cached ? 'cached' : 'fresh'));
  return {
    fetchedAt: reports.length ? reports.map(report => report.fetchedAt).sort()[0] : null,
    cacheStatus: states.size > 1 ? 'mixed' : states.values().next().value || 'fresh',
    ...(reports.some(report => report.revalidating) ? {
      revalidating: true, revalidateUntil: Math.max(...reports.map(report => report.revalidateUntil || 0)),
    } : {}),
  };
}

// GA4 funnel exploration accepts these dimensions on a funnel step or as the
// report-level dimensionFilter. Anything else is refused rather than dropped.
const FUNNEL_FIELDS = {
  hostname: 'hostName', country: 'countryId', region: 'region', city: 'city', language: 'languageCode',
  browser: 'browser', browser_version: 'browserVersion', operating_system: 'operatingSystem',
  operating_system_version: 'operatingSystemVersion', device_type: 'deviceCategory',
  dimensions: 'screenResolution', referrer: 'sessionSource', channel: 'sessionDefaultChannelGroup',
  utm_source: 'sessionManualSource', utm_medium: 'sessionManualMedium', utm_campaign: 'sessionManualCampaignName',
  utm_content: 'sessionManualAdContent', utm_term: 'sessionManualTerm', page_title: 'pageTitle',
};

function numberAt(row, headers, name) {
  const index = headers.indexOf(name);
  return index < 0 ? null : Number(row.metricValues?.[index]?.value);
}
function textAt(row, headers, name) {
  const index = headers.indexOf(name);
  return index < 0 ? '' : row.dimensionValues?.[index]?.value || '';
}

/** Closed-funnel users who reached each step, in order. Never an independent event count. */
function stepsFromTable(table, steps) {
  const dimensions = (table?.dimensionHeaders || []).map(header => header.name);
  const metrics = (table?.metricHeaders || []).map(header => header.name);
  if (!dimensions.includes('funnelStepName') || !metrics.includes('activeUsers')) {
    throw failure('GA4 returned a funnel table without ordered step users.', 502);
  }
  const totals = (table.rows || []).filter(row => {
    const breakdown = dimensions.filter(name => name !== 'funnelStepName' && name !== 'segment').map(name => textAt(row, dimensions, name));
    return breakdown.every(value => !value || value === 'RESERVED_TOTAL');
  });
  const parsed = steps.map((step, index) => {
    const row = totals.find(item => textAt(item, dimensions, 'funnelStepName') === `${index + 1}. ${step.name}`);
    const users = row ? numberAt(row, metrics, 'activeUsers') : null;
    if (!row || !Number.isFinite(users)) throw failure(`GA4 omitted ordered users for funnel step ${index + 1}.`, 502);
    return {
      users,
      ga4_step_completion_rate: numberAt(row, metrics, 'funnelStepCompletionRate'),
      ga4_step_abandonments: numberAt(row, metrics, 'funnelStepAbandonments'),
      ga4_step_abandonment_rate: numberAt(row, metrics, 'funnelStepAbandonmentRate'),
    };
  });
  return parsed.map((step, index) => {
    const previous = parsed[index - 1]?.users;
    const arrived = index > 0 && previous > 0 ? step.users / previous : index === 0 ? 1 : 0;
    return {
      step_number: index + 1,
      step_name: steps[index].name,
      users: step.users,
      sessions: step.users,
      conversion_rate: Math.round(arrived * 10000) / 100,
      dropoff_rate: index === 0 ? 0 : Math.round((1 - arrived) * 10000) / 100,
      ga4_step_completion_rate: step.ga4_step_completion_rate,
      ga4_step_abandonments: step.ga4_step_abandonments,
      ga4_step_abandonment_rate: step.ga4_step_abandonment_rate,
    };
  });
}

function stepName(step, index) {
  const name = String(step.name || '').trim();
  return (name || step.value || `Step ${index + 1}`).slice(0, 120);
}

function pagePattern(value) {
  const text = String(value || '').trim();
  if (!text.startsWith('/') || text.length > MAX_VALUE || /[\r\n]/.test(text)) throw failure('A page step needs a path such as /pricing.');
  if (text.includes('**')) throw failure('GA4 funnel page steps do not support ** across multiple segments.');
  if (!text.includes('*')) return { fieldName: 'pagePath', stringFilter: { matchType: 'EXACT', value: text, caseSensitive: true } };
  if ((text.match(/\*/g) || []).length !== 1 || text.includes('?') || text.includes('#')) {
    throw failure('GA4 funnel page steps support one * for a single path segment.');
  }
  const [before, after] = text.split('*');
  if (before.includes('/') === false || after.includes('/')) throw failure('Use * for exactly one path segment, for example /blog/*.');
  const escaped = part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  return { fieldName: 'pagePath', stringFilter: { matchType: 'FULL_REGEXP', value: `^${escaped(before)}[^/]+${escaped(after)}$`, caseSensitive: true } };
}

function hostnameField(hostname) {
  const values = [...new Set(String(hostname).split(',').map(value => value.trim()).filter(Boolean))];
  if (!values.length || values.length > 20) throw failure('Choose between 1 and 20 comma-separated hostnames.', 422);
  return { fieldName: 'hostName', ...(values.length === 1
    ? { stringFilter: { matchType: 'EXACT', value: values[0], caseSensitive: false } }
    : { inListFilter: { values, caseSensitive: false } }) };
}

function eventStep(step) {
  const eventName = String(step.value || '').trim();
  if (!EVENT_NAME.test(eventName)) throw failure('Choose one GA4 event name for each event step.');
  const filters = eventParameters(step);
  const event = { funnelEventFilter: { eventName, ...(filters.length ? {
    funnelParameterFilterExpression: { andGroup: { expressions: filters.map(({ key, value }) => ({
      funnelParameterFilter: { eventParameterName: key,
        ...(typeof value === 'number' ? { numericFilter: { operation: 'EQUAL', value: { doubleValue: value } } }
          : { stringFilter: { matchType: 'EXACT', value, caseSensitive: true } }),
      },
    })) } },
  } : {}) } };
  if (!step.hostname) return event;
  return { andGroup: { expressions: [event, { funnelFieldFilter: hostnameField(step.hostname) }] } };
}

function eventParameters(step) {
  const filters = [...(step.propertyFilters || [])];
  if (step.eventPropertyKey) filters.push({ key: step.eventPropertyKey, value: step.eventPropertyValue });
  if (filters.length > 10) throw failure('Use up to 10 event parameter filters per step.', 422);
  for (const filter of filters) {
    if (!filter || !/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(filter.key || '')
      || !(typeof filter.value === 'string' && filter.value.length > 0 && filter.value.length <= MAX_VALUE
        || typeof filter.value === 'number' && Number.isFinite(filter.value))) {
      throw failure('Event parameter filters need a parameter name and a string or number value.', 422);
    }
  }
  return filters.map(({ key, value }) => ({ key, value }));
}

function stepFilter(step) {
  if (step.type === 'page') {
    const filter = pagePattern(step.value);
    const parts = [filter];
    if (step.hostname) parts.push(hostnameField(step.hostname));
    const filters = Array.isArray(step.propertyFilters) ? step.propertyFilters.filter(item => item?.key) : [];
    if (filters.length || step.eventPropertyKey || step.eventPropertyValue) throw failure('This funnel supports page paths without URL parameter filters.', 422);
    const expressions = parts.map(part => ({ funnelFieldFilter: part }));
    return expressions.length === 1 ? expressions[0] : { andGroup: { expressions } };
  }
  if (step.type === 'event') return eventStep(step);
  throw failure(`GA4 funnels do not support the ${step.type} step. Choose a page path or one event name.`, 422);
}

function normalizeSteps(steps) {
  if (!Array.isArray(steps) || steps.length < 2 || steps.length > MAX_STEPS) throw failure(`Choose ${2} to ${MAX_STEPS} ordered funnel steps.`);
  return steps.map((step, index) => {
    if (!step || typeof step !== 'object' || Array.isArray(step)) throw failure('Each funnel step needs a type and value.');
    if (step.propertyFilters != null && !Array.isArray(step.propertyFilters)) throw failure('Event parameter filters must be an array.');
    const type = step.type === 'event' ? 'event' : step.type === 'page' ? 'page' : null;
    if (!type) throw failure(`GA4 funnels do not support the ${step.type || 'unknown'} step. Choose a page path or one event name.`, 422);
    const normalized = { type, value: String(step.value || '').trim(), name: stepName({ ...step, type }, index), hostname: step.hostname ? String(step.hostname).trim() : '' };
    if (normalized.value.length > MAX_VALUE || normalized.hostname.length > 253) throw failure('A funnel step value is too long.');
    return { ...normalized,
      ...(type === 'event' && eventParameters(step).length ? { propertyFilters: eventParameters(step) } : {}),
      filterExpression: stepFilter({ ...step, ...normalized }),
    };
  });
}

function reportWindow(query, timeZone, now) {
  if (require('../lib/reportWindow').hasSubday(query)) throw failure('GA4 funnel reports require whole calendar days. Choose Today or a date range.', 422);
  return windowFor(query, timeZone, now);
}

function funnelFilters(raw) {
  let filters;
  try { filters = typeof raw === 'string' ? JSON.parse(raw) : raw || []; } catch { throw failure('Invalid filters.'); }
  if (!Array.isArray(filters)) throw failure('Invalid filters.');
  for (const filter of filters) {
    if (!Object.hasOwn(FUNNEL_FIELDS, filter?.parameter)) {
      throw failure(`GA4 funnel reports cannot apply the ${filter?.parameter || 'unknown'} filter.`, 422);
    }
  }
  return filters.length ? filtersFor(JSON.stringify(filters)) : undefined;
}

function createFunnels(deps = {}) {
  const properties = deps.properties || (() => require('./apiController').ensureProperties());
  const now = deps.now || (() => new Date());
  const client = deps.client || getGA4AlphaDataClient;
  const events = deps.events || (async (propertyId, range) => {
    const [response] = await getGA4DataClient().runReport({
      property: `properties/${propertyId}`, dateRanges: [range], dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'totalUsers' }], limit: 100, orderBys: [{ metric: { metricName: 'totalUsers' }, desc: true }],
    }, { timeout: 20000, retry: null });
    return (response.rows || []).map(row => ({ eventName: row.dimensionValues?.[0]?.value || '', users: Number(row.metricValues?.[0]?.value) || 0 })).filter(row => row.eventName && row.eventName !== '(not set)');
  });
  const readEntry = deps.readEntry || cacheGetEntry;
  const write = deps.write || cacheSet;
  const pending = new Map(), refreshing = new Map(), retryAfter = new Map();
  const store = deps.store || createFunnelStore();
  const waiting = [];
  let active = 0;
  async function limited(task) {
    if (active >= 3) await new Promise(resolve => waiting.push(resolve));
    else active++;
    try { return await task(); }
    finally { if (waiting.length) waiting.shift()(); else active--; }
  }

  async function analyze(property, query, steps) {
    const range = reportWindow(query, property.timeZone || 'UTC', now());
    const dimensionFilter = funnelFilters(query.filters);
    const requestSteps = steps.map(({ filterExpression, name }) => ({ name, filterExpression }));
    const key = createHash('sha256').update(JSON.stringify({ property: property.id, range, steps: requestSteps, dimensionFilter })).digest('hex');
    // Rules, resolved calendar dates, property and audience all participate in the
    // key. Summaries and expanded/editor analyses reuse the same ordered report.
    const background = deps.backgroundRefresh !== false;
    const hit = await readEntry('funnel', key, { allowStale: background });
    const refresh = () => {
      if (!refreshing.has(key)) {
        const promise = limited(async () => {
          const [response] = await client().runFunnelReport({
            property: `properties/${property.id}`,
            dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
            funnel: { isOpenFunnel: false, steps: requestSteps },
            ...(dimensionFilter ? { dimensionFilter } : {}),
            limit: steps.length,
            returnPropertyQuota: true,
          }, { timeout: 20000, retry: null });
          const rows = stepsFromTable(response.funnelTable, steps);
          const metadata = response.funnelTable?.metadata?.samplingMetadatas || [];
          const payload = {
            data: rows, source: 'ga4-runFunnelReport', metric: 'activeUsers',
            ordered: true, openFunnel: false, startDate: range.startDate, endDate: range.endDate,
            sampled: metadata.length > 0,
            sampling: metadata.map(item => ({ samplesRead: Number(item.samplesReadCount) || 0, space: Number(item.samplingSpaceSize) || 0 })),
            cached: false, fetchedAt: now().toISOString(),
          };
          await write('funnel', key, payload, { cachedAt: payload.fetchedAt });
          retryAfter.delete(key);
          return payload;
        }).catch(error => {
          for (const [key, until] of retryAfter) if (until <= now().getTime()) retryAfter.delete(key);
          retryAfter.set(key, now().getTime() + 60_000);
          throw error;
        }).finally(() => refreshing.delete(key));
        refreshing.set(key, { promise, until: now().getTime() + 60_000 });
      }
      return refreshing.get(key);
    };
    if (hit && (!hit.stale || background)) {
      const updating = hit.stale && now().getTime() >= (retryAfter.get(key) || 0) ? refresh() : null;
      // Background failures retain the last successful report and pause refresh
      // for a minute. Polling never renews the original fetch timestamp.
      updating?.promise.catch(() => {});
      return { ...hit.data, cached: true,
        ...(updating ? { revalidating: true, revalidateUntil: updating.until } : {}),
      };
    }
    return refresh().promise;
  }

  async function summarize(property, query) {
    // Validate the window and filters even when there are no saved funnels.
    const range = reportWindow(query, property.timeZone || 'UTC', now());
    const dimensionFilter = funnelFilters(query.filters);
    const definitions = await store.list(String(property.id));
    let ids;
    if (query.funnel_ids !== undefined) {
      try { ids = JSON.parse(query.funnel_ids); } catch { throw failure('Choose valid funnel IDs.'); }
      if (!Array.isArray(ids) || ids.length > MAX_SUMMARY_FUNNELS || ids.some(id => !Number.isSafeInteger(id) || id < 1)
        || ids.some(id => !definitions.some(funnel => funnel.id === id))) throw failure('Choose saved funnel IDs belonging to this property.');
    }
    const candidates = ids ? definitions.filter(funnel => ids.includes(funnel.id)) : definitions;
    const selected = candidates.slice(0, MAX_SUMMARY_FUNNELS);
    const key = 'summary:' + createHash('sha256').update(JSON.stringify({ property: property.id, range, dimensionFilter, selected })).digest('hex');
    if (pending.has(key)) return pending.get(key);
    const promise = (async () => {
      // Each analysis uses the shared three-request limit. A slow or broken
      // funnel must not discard successful rows or prevent later ones loading.
      const results = await Promise.allSettled(selected.map(async funnel => analyze(property, query, normalizeSteps(funnel.steps))));
      const reports = [], funnels = [], errors = [];
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          errors.push({ funnel_id: selected[index].id, error: publicError(result.reason) });
          return;
        }
        reports.push(result.value);
        funnels.push({ funnel_id: selected[index].id,
          steps: result.value.data.map(step => ({ sessions: step.users, median_seconds_to_next: null })),
          median_seconds_to_convert: null,
        });
      });
      // If nothing loaded, preserve the normal HTTP error/retry behavior.
      if (selected.length && !reports.length) throw results.find(result => result.status === 'rejected').reason;
      let entries = selected.length ? undefined : 0;
      try {
        const firstSteps = [...new Map(selected.map(funnel => {
          const step = normalizeSteps(funnel.steps)[0];
          return [JSON.stringify(step.filterExpression), step];
        })).values()];
        if (firstSteps.length === 1) entries = reports[0]?.data[0]?.users;
        if (firstSteps.length > 1) {
          // Count distinct entrants in GA4; summing each funnel double-counts users.
          const filterExpression = { orGroup: { expressions: firstSteps.map(step => step.filterExpression) } };
          const union = await analyze(property, query, [
            { name: 'Any saved funnel', filterExpression }, { name: 'Repeat entry', filterExpression },
          ]);
          reports.push(union);
          entries = union.data[0].users;
        }
      } catch (error) { errors.push({ error: publicError(error) }); }
      return {
        data: {
          users_entered_any: entries, funnels, errors,
          truncated: candidates.length > selected.length,
          sampled: reports.some(report => report.sampled), metric: 'activeUsers',
        },
        reportStatus: reportStatus(reports),
      };
    })().finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
  }

  return async function handler(req, res) {
    res.set('Cache-Control', 'no-store');
    try {
      const id = String(req.params?.propertyId || '');
      if (!/^\d+$/.test(id)) throw failure('Choose a numeric property ID.');
      const { properties: all } = await properties();
      const property = all.find(item => String(item.id) === id);
      if (!property) throw failure('Property not found.', 404);
      const action = req.params?.action || 'analyze';
      if (action === 'summary') {
        if (req.method !== 'GET') throw failure('Use GET for funnel summaries.', 405);
        return res.json(await summarize(property, req.query));
      }
      if (action === 'definitions') {
        if (req.method === 'GET') return res.json({ data: await store.list(id) });
        if (req.method !== 'POST') throw failure('Use GET or POST for saved funnels.', 405);
        const name = req.body?.name;
        const reportId = req.body.reportId;
        if (reportId != null && (!Number.isSafeInteger(reportId) || reportId < 1)) throw failure('Choose a numeric funnel ID.');
        if ((reportId == null || name !== undefined) && (typeof name !== 'string' || !name.trim() || name.trim().length > 120)) throw failure('Use a funnel name of 1 to 120 characters.');
        const description = req.body.description;
        if (description !== undefined && (typeof description !== 'string' || description.length > 2000)) throw failure('Use a funnel description of up to 2000 characters.');
        if (reportId != null && name === undefined && req.body.steps === undefined && description === undefined) throw failure('Choose a funnel field to update.');
        const steps = reportId != null && req.body.steps === undefined ? undefined : normalizeSteps(req.body.steps).map(({ filterExpression, ...step }) => step);
        const saved = await store.save(id, { name: name?.trim(), steps, description, reportId });
        return res.json({ success: true, funnelId: saved.id });
      }
      if (/^[1-9]\d*$/.test(action)) {
        const funnelId = Number(action);
        if (!Number.isSafeInteger(funnelId)) throw failure('Choose a numeric funnel ID.');
        if (req.method === 'DELETE') {
          await store.remove(id, funnelId);
          return res.json({ success: true });
        }
        if (req.method === 'GET') {
          const funnel = (await store.list(id)).find(item => item.id === funnelId);
          if (!funnel) throw failure('Funnel not found.', 404);
          return res.json({ data: funnel });
        }
        throw failure('Use GET or DELETE for a saved funnel.', 405);
      }
      if (req.method === 'GET' && action === 'events') {
        const range = reportWindow(req.query, property.timeZone || 'UTC', now());
        const rows = await events(id, range);
        return res.json({ data: rows, source: 'ga4-event-users', ordered: false });
      }
      if (req.method !== 'POST' || action !== 'analyze') throw failure('This GA4 funnel endpoint only analyzes ordered steps.', 405);
      const steps = normalizeSteps(req.body?.steps);
      const result = await analyze(property, req.query, steps);
      return res.json({ ...result, reportStatus: reportStatus([result]) });
    } catch (error) {
      const status = error.status || (error.code === 7 ? 403 : error.code === 8 ? 429 : 502);
      return res.status(status).json({ error: publicError(error) });
    }
  };
}

module.exports = {
  createFunnels, normalizeSteps, stepsFromTable, pagePattern, FUNNEL_FIELDS, MAX_STEPS, MAX_SUMMARY_FUNNELS,
};
