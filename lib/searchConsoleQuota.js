const TIME_ZONE = 'America/Los_Angeles';
const LIMITS = {
  searchAnalytics: { siteMinute: 1200, userMinute: 1200, projectMinute: 40000, projectDay: 30000000 },
  other: { userSecond: 20, userMinute: 200, projectDay: 100000000 },
};
const DOCUMENTATION_URL = 'https://developers.google.com/webmaster-tools/limits';
const dayAt = at => new Date(at).toLocaleDateString('en-CA', { timeZone: TIME_ZONE });
const empty = () => ({ queries: 0, siteLists: 0, cacheHits: 0, errors: 0, rateLimited: 0 });

// Advisory observations for this process, not Google's project-wide quota ledger.
// Keep daily totals and at most 61 second buckets per observed site; no query data is retained.
function createSearchConsoleUsage(now) {
  const startedAt = now().getTime(), sites = new Map();
  function counter() { return { day: dayAt(now().getTime()), today: empty(), seconds: new Map(), lastRequestAt: null }; }
  const total = counter();
  function prune(value, at) {
    const day = dayAt(at);
    if (value.day !== day) { value.day = day; value.today = empty(); }
    for (const second of value.seconds.keys()) if (second <= Math.floor(at / 1000) - 60) value.seconds.delete(second);
  }
  function add(value, kind, at) {
    prune(value, at);
    const second = Math.floor(at / 1000);
    if (!value.seconds.has(second)) value.seconds.set(second, empty());
    value.seconds.get(second)[kind]++;
    value.today[kind]++;
    if (kind === 'queries' || kind === 'siteLists') value.lastRequestAt = new Date(at).toISOString();
  }
  function record(kind, siteUrl = null) {
    const at = now().getTime();
    add(total, kind, at);
    if (siteUrl) {
      if (!sites.has(siteUrl)) sites.set(siteUrl, counter());
      add(sites.get(siteUrl), kind, at);
    }
  }
  function summarize(value, at) {
    prune(value, at);
    const minute = empty();
    for (const bucket of value.seconds.values()) for (const key of Object.keys(minute)) minute[key] += bucket[key];
    return { minute, today: { ...value.today }, lastRequestAt: value.lastRequestAt };
  }
  return {
    record,
    snapshot(siteUrls = []) {
      const at = now().getTime();
      return { scope: 'process', observedSince: new Date(startedAt).toISOString(), fetchedAt: new Date(at).toISOString(),
        day: dayAt(at), timeZone: TIME_ZONE, ...summarize(total, at),
        sites: siteUrls.map(siteUrl => ({ siteUrl, ...summarize(sites.get(siteUrl) || counter(), at) })) };
    },
  };
}

module.exports = { createSearchConsoleUsage, LIMITS, DOCUMENTATION_URL };
