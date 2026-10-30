const { GoogleAuth } = require('google-auth-library');
const { randomUUID } = require('node:crypto');
const { getCredentials } = require('./credentials');
const { storage } = require('./requestContext');
const { openDatabase } = require('./database');

const KEYS = ['GA4_BIGQUERY_SOURCES', 'BIGQUERY_CLIENT_EMAIL', 'BIGQUERY_PRIVATE_KEY', 'BIGQUERY_MAX_BYTES_BILLED', 'BIGQUERY_DAILY_BYTES', 'BIGQUERY_DAILY_QUERIES'];
const failure = (message, status = 422, code = 'bigquery_unavailable') => Object.assign(new Error(message), { status, code });
const projectPattern = /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/;
function settings(env = process.env) {
  let sources;
  try { sources = JSON.parse(env.GA4_BIGQUERY_SOURCES || '{}'); } catch { throw failure('GA4_BIGQUERY_SOURCES must be a JSON object.'); }
  if (!sources || typeof sources !== 'object' || Array.isArray(sources) || Object.keys(sources).length > 2000) throw failure('Choose a property-to-BigQuery project mapping.');
  for (const [id, source] of Object.entries(sources)) {
    if (!/^\d+$/.test(id) || !source || Object.keys(source).some(key => !['projectId', 'billingProjectId', 'location'].includes(key)) ||
      !projectPattern.test(source.projectId) || source.billingProjectId !== undefined && !projectPattern.test(source.billingProjectId) ||
      typeof source.location !== 'string' || !/^[A-Za-z][A-Za-z0-9-]{0,62}$/.test(source.location)) throw failure('Each BigQuery property needs a valid projectId and dataset location.');
  }
  const bytes = (key, fallback, maximum) => {
    const value = env[key] || String(fallback);
    if (!/^\d+$/.test(value) || BigInt(value) < 1n || BigInt(value) > BigInt(maximum)) throw failure(`${key} must be a positive integer no greater than ${maximum}.`);
    return Number(value);
  };
  return { sources, maxBytes: bytes('BIGQUERY_MAX_BYTES_BILLED', 1073741824, 1099511627776), dailyBytes: bytes('BIGQUERY_DAILY_BYTES', 10737418240, 10995116277760), dailyQueries: bytes('BIGQUERY_DAILY_QUERIES', 100, 10000) };
}
function sourceFor(propertyId, env = process.env) {
  const config = settings(env), source = config.sources[String(propertyId)];
  return source ? { ...source, billingProjectId: source.billingProjectId || source.projectId, datasetId: `analytics_${propertyId}`, ...config, sources: undefined } : null;
}
function configurationStatus(env = process.env) {
  try { return { configured: Object.keys(settings(env).sources).length > 0, valid: true, availability: 'per-property; export tables and IAM access must be verified', maxDays: 31 }; }
  catch { return { configured: false, valid: false, reason: 'invalid_bigquery_configuration' }; }
}
function reserve(db, source, jobId, now) {
  const day = now.toISOString().slice(0, 10), key = `${source.billingProjectId}:${day}`;
  const update = db.transaction(() => {
    const row = db.prepare("SELECT payload FROM app_document WHERE kind='bigquery-budget' AND propertyId=?").get(key);
    const ledger = row ? JSON.parse(row.payload) : { bytes: 0, jobs: {} };
    if (ledger.bytes + source.maxBytes > source.dailyBytes || Object.keys(ledger.jobs).length >= source.dailyQueries)
      throw failure('BigQuery daily budget reached. Try again tomorrow or use a cached report.', 429, 'bigquery_budget_exhausted');
    ledger.bytes += source.maxBytes;
    ledger.jobs[jobId] = source.maxBytes;
    db.prepare('INSERT INTO app_document VALUES(?,?,?,?) ON CONFLICT(kind,propertyId) DO UPDATE SET payload=excluded.payload,updatedAt=excluded.updatedAt')
      .run('bigquery-budget', key, JSON.stringify(ledger), now.toISOString());
    db.prepare("DELETE FROM app_document WHERE kind='bigquery-budget' AND updatedAt < ?").run(new Date(now.getTime() - 7 * 86400000).toISOString());
  });
  update.immediate();
  return actual => db.transaction(() => {
    if (!Number.isSafeInteger(actual) || actual < 0 || actual > source.maxBytes) return;
    const ledger = JSON.parse(db.prepare("SELECT payload FROM app_document WHERE kind='bigquery-budget' AND propertyId=?").get(key)?.payload || 'null');
    if (!ledger || ledger.jobs[jobId] === undefined) return;
    ledger.bytes += actual - ledger.jobs[jobId]; ledger.jobs[jobId] = actual;
    db.prepare("UPDATE app_document SET payload=? WHERE kind='bigquery-budget' AND propertyId=?").run(JSON.stringify(ledger), key);
  }).immediate();
}
const queryParameters = params => Object.entries(params).map(([name, value]) => ({ name,
  parameterType: { type: typeof value === 'number' ? 'INT64' : 'STRING' }, parameterValue: { value: String(value) } }));

function createBigQuery({ env = process.env, request, db, now = () => new Date(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let client, credentialKey;
  const call = async (method, path, data, params) => {
    if (require('../controllers/demoData').enabled()) throw failure('Demo never calls BigQuery.', 503);
    try {
      if (request) return await request({ method, path, data, params });
      const alternate = !!(env.BIGQUERY_CLIENT_EMAIL || env.BIGQUERY_PRIVATE_KEY);
      const credentials = getCredentials(alternate ? { GA4_CLIENT_EMAIL: env.BIGQUERY_CLIENT_EMAIL, GA4_PRIVATE_KEY: env.BIGQUERY_PRIVATE_KEY } : env);
      if (!credentials) throw failure('Configure BigQuery credentials, or grant the GA4 service account access.');
      const key = `${credentials.client_email}:${credentials.private_key}`;
      if (!client || credentialKey !== key) {
        client = await new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/bigquery'] }).getClient();
        credentialKey = key;
      }
      return (await client.request({ method, url: `https://bigquery.googleapis.com/bigquery/v2/${path}`, data, params, timeout: 10000, retry: false })).data;
    } catch (error) {
      if (String(error.code).startsWith('bigquery_')) throw error;
      const status = error.response?.status;
      throw failure(status === 403 ? 'BigQuery access denied. Grant dataset Data Viewer and billing-project Job User access.'
        : status === 404 ? 'BigQuery dataset or export table was not found.'
          : status === 429 ? 'BigQuery is rate limited. Try again later.' : 'BigQuery request failed. Check its configuration and query budget.', status === 429 ? 429 : 502);
    }
  };
  let active = 0;
  const waiting = [];
  return {
    call,
    async query(source, sql, params) {
      if (active >= 2) {
        if (waiting.length >= 8) throw failure('BigQuery is busy. Try again shortly.', 429);
        await new Promise(resolve => waiting.push(resolve));
      } else active++;
      const jobId = `metribee_${randomUUID().replace(/-/g, '')}`;
      const reference = { projectId: source.billingProjectId, location: source.location, jobId };
      const root = `projects/${encodeURIComponent(source.billingProjectId)}/jobs`;
      let release, submitted = false;
      try {
        const query = { query: sql, useLegacySql: false, parameterMode: 'NAMED', queryParameters: queryParameters(params),
          useQueryCache: true, maximumBytesBilled: String(source.maxBytes) };
        const dry = await call('POST', root, { jobReference: reference, configuration: { dryRun: true, query } });
        const estimate = Number(dry.statistics?.query?.totalBytesProcessed);
        if (!Number.isSafeInteger(estimate) || estimate < 0 || estimate > source.maxBytes) throw failure('This BigQuery report exceeds the per-query scan limit. Choose a shorter period.', 422, 'bigquery_scan_limit');
        release = reserve(db || storage.getStore()?.access?.db || openDatabase(), source, jobId, now());
        submitted = true;
        await call('POST', root, { jobReference: reference, configuration: { jobTimeoutMs: '30000', query, labels: { application: 'metribee', report: 'journeys' } } });
        let result;
        const deadline = Date.now() + 30000;
        for (let attempt = 0; attempt < 12; attempt++) {
          result = await call('GET', `projects/${encodeURIComponent(source.billingProjectId)}/queries/${jobId}`, undefined, { location: source.location, timeoutMs: 1000, maxResults: 1 });
          if (result.errors?.length) throw failure('BigQuery could not run this report. Check its schema and query budget.', 502);
          if (result.jobComplete) break;
          if (attempt === 11 || Date.now() >= deadline) throw failure('BigQuery report timed out. Choose a shorter period.', 504);
          await sleep(250);
        }
        if (result.pageToken || Number(result.totalRows) > 1) throw failure('BigQuery returned an incomplete report.', 502);
        const stats = await call('GET', `${root}/${jobId}`, undefined, { location: source.location });
        const billed = Number(stats.statistics?.query?.totalBytesBilled);
        release(billed);
        const value = result.rows?.[0]?.f?.[0]?.v;
        if (typeof value !== 'string' || Buffer.byteLength(value) > 10 * 1024 * 1024) throw failure('BigQuery report exceeds its output limit.', 422);
        let data;
        try { data = JSON.parse(value); } catch { throw failure('BigQuery returned an invalid report.', 502); }
        return { data, fetchedAt: now().toISOString(), bytesBilled: Number.isSafeInteger(billed) ? billed : null, cacheHit: !!stats.statistics?.query?.cacheHit };
      } catch (error) {
        // On ambiguous failures retain the full reservation, and never resubmit a job.
        if (submitted) await call('POST', `${root}/${jobId}/cancel`, {}, { location: source.location }).catch(() => {});
        throw error;
      } finally {
        if (waiting.length) waiting.shift()(); else active--;
      }
    },
  };
}

module.exports = { createBigQuery, sourceFor, settings, configurationStatus, KEYS, failure };
