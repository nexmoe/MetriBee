const { DateTime } = require('luxon');

/** Resolve comparisons before any report call; each calendar window is validated separately. */
function comparisonWindow(window, comparison, validate) {
  if (!comparison) return null;
  if (!['previous_period', 'previous_year'].includes(comparison) && (typeof comparison !== 'object' || !comparison.startDate || !comparison.endDate)) throw new Error('Choose a valid comparison preset or explicit startDate/endDate.');
  if (window.past_minutes_start != null) {
    if (comparison !== 'previous_period') throw new Error('Rolling windows support previous_period comparison only.');
    const duration = window.past_minutes_start - window.past_minutes_end;
    return { past_minutes_start: window.past_minutes_start + duration, past_minutes_end: window.past_minutes_start };
  }
  const start = DateTime.fromISO(window.start_date, { zone: 'UTC' });
  const end = DateTime.fromISO(window.end_date, { zone: 'UTC' });
  const dates = comparison === 'previous_period'
    ? { startDate: start.minus({ days: end.diff(start, 'days').days + 1 }).toISODate(), endDate: start.minus({ days: 1 }).toISODate() }
    : comparison === 'previous_year'
      ? { startDate: start.minus({ years: 1 }).toISODate(), endDate: end.minus({ years: 1 }).toISODate() }
      : comparison;
  return validate(dates);
}

/** Differences use matching records only. Missing top rows remain unknown, never zero. */
function metricChanges(current, previous) {
  if (!current || !previous || typeof current !== 'object' || typeof previous !== 'object') return undefined;
  if (Array.isArray(current)) return undefined;
  const out = {};
  for (const [key, value] of Object.entries(current)) {
    const before = previous[key];
    if (['id', 'funnel_id', 'step_number', 'offset', 'returned', 'totalCount', 'rowCount'].includes(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value) && typeof before === 'number' && Number.isFinite(before)) {
      out[key] = { current: value, previous: before, difference: value - before, percentChange: before === 0 ? (value === 0 ? 0 : null) : (value - before) / Math.abs(before) * 100 };
    } else if (Array.isArray(value) && Array.isArray(before) && key === 'rows') {
      const identity = row => Array.isArray(row.dims) ? JSON.stringify(row.dims) : row.key ?? row.page ?? row.eventName;
      const prior = new Map(before.filter(row => identity(row) != null).map(row => [identity(row), row]));
      out.rows = value.filter(row => prior.has(identity(row))).map(row => {
        const previousRow = prior.get(identity(row));
        return { key: identity(row), changes: Array.isArray(row.metrics)
          ? row.metrics.map((metric, index) => metricChanges({ value: metric }, { value: previousRow.metrics?.[index] })?.value ?? null)
          : metricChanges(row, previousRow) };
      });
    } else if (value && before && typeof value === 'object' && !Array.isArray(value)) {
      const changes = metricChanges(value, before);
      if (changes && Object.keys(changes).length) out[key] = changes;
    }
  }
  return out;
}

const COLLECTIONS = new Set(['rows', 'data', 'sources', 'pages', 'timeline', 'personas', 'flagged', 'changes', 'journeys', 'events', 'funnels', 'sites', 'properties', 'steps']);
function paginateReport(result, { offset = 0, limit = 20, collection } = {}) {
  const out = structuredClone(result);
  const candidates = [];
  const collect = (object, prefix = '') => {
    if (!object || typeof object !== 'object' || Array.isArray(object)) return;
    for (const [key, value] of Object.entries(object)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (Array.isArray(value) && COLLECTIONS.has(key)) candidates.push({ object, key, path });
      else if (key === 'data' || ['countries', 'devices', 'pages'].includes(key)) collect(value, path);
    }
  };
  collect(out);
  const selected = collection ? candidates.filter(item => item.path === collection || item.path === `data.${collection}`) : candidates;
  if (collection && !selected.length) throw new Error('Choose a collection returned by this report.');
  if (!selected.length && offset) throw new Error('This report has no pageable collection.');
  out._pagination = selected.map(({ object, key, path }) => {
    const rows = object[key], totalAvailable = rows.length;
    const upstreamTotal = Number(object.rowCount ?? object.totalCount ?? out.rowCount);
    const sourceTruncated = !!object.truncated || !!out.truncated || upstreamTotal > totalAvailable;
    object[key] = rows.slice(offset, offset + limit);
    if (key === 'rows') {
      object.returned = object[key].length;
      object.truncated = sourceTruncated || offset + object[key].length < totalAvailable;
    }
    return { path, offset, returned: object[key].length, totalAvailable, sourceTruncated,
      nextOffset: offset + object[key].length < totalAvailable ? offset + object[key].length : null };
  });
  return syncPagination(out);
}

/** Recalculate continuation after the transport shortens a page to its byte budget. */
function syncPagination(out) {
  for (const page of out._pagination || []) {
    const rows = page.path.split('.').reduce((value, key) => value?.[key], out);
    if (!Array.isArray(rows)) continue;
    page.returned = rows.length;
    page.nextOffset = page.offset + rows.length < page.totalAvailable ? page.offset + rows.length : null;
    // An empty page after output trimming cannot advance. Ask for one smaller record.
    if (!rows.length && page.offset < page.totalAvailable) {
      page.nextOffset = null;
      page.recordTooLarge = true;
      page.hint = 'No record fits this response. Use a detail tool or narrower fields; retrying the same offset cannot advance.';
      out.truncated = true;
    }
    if (page.path.endsWith('.rows')) {
      const owner = page.path.split('.').slice(0, -1).reduce((value, key) => value?.[key], out);
      if (owner) { owner.returned = rows.length; owner.nextOffset = page.nextOffset; }
    }
    out.truncated ||= page.sourceTruncated || page.nextOffset != null;
  }
  if (out._pagination?.length === 1) {
    const page = out._pagination[0];
    out.offset = page.offset; out.returned = page.returned; out.nextOffset = page.nextOffset;
  }
  return out;
}

module.exports = { comparisonWindow, metricChanges, paginateReport, syncPagination };
