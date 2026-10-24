const { DateTime } = require('luxon');
const { todayInZone, validDate } = require('../controllers/retention');
const DAY = 86400000;
const failure = message => Object.assign(new Error(message), { status: 400 });
const hasSubday = query => query.past_minutes_start !== undefined || query.past_minutes_end !== undefined || query.start_datetime !== undefined || query.end_datetime !== undefined;

function exactWindow(start, end, timeZone) {
  if (!start.isValid || !end.isValid || end <= start || end.diff(start, 'days').days > 6000 || start.year < 2015) throw failure('Choose a valid time window.');
  const from = start.setZone(timeZone), to = end.minus({ milliseconds: 1 }).setZone(timeZone);
  if (!from.isValid || !to.isValid) throw failure('Choose a valid timezone.');
  // GA4 groups repeated daylight-saving minutes under the same local key.
  if (from.getPossibleOffsets().length > 1 || to.getPossibleOffsets().length > 1) throw failure('GA4 cannot separate repeated daylight-saving minutes. Choose a window with unambiguous boundaries.');
  return { startDate: from.toISODate(), endDate: to.toISODate(), startDateTime: start.toUTC().toISO(), endDateTime: end.toUTC().toISO(), timeZone };
}

function windowFor(query, timeZone = 'UTC', now = new Date()) {
  if (hasSubday(query)) {
    const anchor = DateTime.fromJSDate(now, { zone: 'UTC' }).startOf('minute');
    let start, end;
    if (query.past_minutes_start !== undefined || query.past_minutes_end !== undefined) {
      if (query.start_datetime !== undefined || query.end_datetime !== undefined) throw failure('Choose one time-window format.');
      const from = Number(query.past_minutes_start), to = Number(query.past_minutes_end ?? 0);
      if (!/^\d+$/.test(String(query.past_minutes_start)) || !/^\d+$/.test(String(query.past_minutes_end ?? 0)) || !Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from <= to || to < 0 || from > 6000 * 1440) throw failure('Choose a valid number of past minutes.');
      start = anchor.minus({ minutes: from }); end = anchor.minus({ minutes: to });
    } else {
      const parse = value => {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)) return DateTime.invalid('Invalid timestamp');
        return DateTime.fromISO(value.replace(' ', 'T'), { zone: 'UTC' });
      };
      start = parse(query.start_datetime); end = parse(query.end_datetime);
      if (!start.isValid || !end.isValid || start.second || start.millisecond || end.second || end.millisecond) throw failure('GA4 time windows require whole-minute boundaries.');
      if (end > anchor) end = anchor;
    }
    return exactWindow(start, end, timeZone);
  }
  const today = todayInZone(now, timeZone);
  const startDate = query.start_date || '2015-08-14', endDate = query.end_date || today;
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate || startDate < '2015-01-01' || (Date.parse(endDate) - Date.parse(startDate)) / DAY > 6000) throw failure('Choose a valid calendar date range.');
  const clampedEnd = endDate > today ? today : endDate;
  if (startDate > clampedEnd) throw failure('Choose a range that has already started.');
  return { startDate, endDate: clampedEnd };
}

// A compact RE2-compatible decimal interval. YYYYMMDDHHmm sorts chronologically;
// nonexistent calendar keys inside the interval have no matching GA4 events.
function decimalPattern(low, high) {
  if (low === high) return low;
  let shared = 0;
  while (low[shared] === high[shared]) shared++;
  if (shared) return low.slice(0, shared) + decimalPattern(low.slice(shared), high.slice(shared));
  const rest = low.length - 1, a = Number(low[0]), b = Number(high[0]);
  if (!rest) return a === b ? String(a) : `[${a}-${b}]`;
  if (/^0+$/.test(low) && /^9+$/.test(high)) return rest ? `[0-9]{${low.length}}` : '[0-9]';
  const any = rest === 1 ? '[0-9]' : `[0-9]{${rest}}`;
  const parts = [String(a) + decimalPattern(low.slice(1), '9'.repeat(rest))];
  if (b > a + 1) parts.push((b === a + 2 ? String(a + 1) : `[${a + 1}-${b - 1}]`) + any);
  parts.push(String(b) + decimalPattern('0'.repeat(rest), high.slice(1)));
  return `(?:${parts.join('|')})`;
}

function windowFilter(range) {
  if (!range.startDateTime) return null;
  const key = date => date.setZone(range.timeZone).toFormat('yyyyMMddHHmm');
  const from = key(DateTime.fromISO(range.startDateTime)), to = key(DateTime.fromISO(range.endDateTime).minus({ minutes: 1 }));
  return { filter: { fieldName: 'dateHourMinute', stringFilter: { matchType: 'FULL_REGEXP', value: decimalPattern(from, to), caseSensitive: true } } };
}

function previousWindow(range) {
  if (range.startDateTime) {
    const start = DateTime.fromISO(range.startDateTime), end = DateTime.fromISO(range.endDateTime);
    return exactWindow(start.minus(end.diff(start)), start, range.timeZone);
  }
  const days = Math.round((Date.parse(range.endDate) - Date.parse(range.startDate)) / DAY) + 1;
  const iso = value => new Date(value).toISOString().slice(0, 10);
  return { startDate: iso(Date.parse(range.startDate) - days * DAY), endDate: iso(Date.parse(range.startDate) - DAY) };
}

const calendarRange = ({ startDate, endDate }) => ({ startDate, endDate });
module.exports = { windowFor, windowFilter, hasSubday, calendarRange, previousWindow, decimalPattern };
