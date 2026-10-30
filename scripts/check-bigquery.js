#!/usr/bin/env node
// Configuration inspection is offline. --verify PROPERTY reads only table metadata,
// never submits a query job, enables an export, or changes IAM permissions.
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env'), quiet: true });
const { settings, sourceFor } = require('../lib/bigquery');
(async () => {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--verify' || !/^\d+$/.test(args[1]))) throw new Error('Usage: node scripts/check-bigquery.js [--verify PROPERTY_ID]');
  const config = settings();
  console.log(JSON.stringify({ configuredProperties: Object.keys(config.sources).length, maxBytesPerQuery: config.maxBytes, dailyBytes: config.dailyBytes, dailyQueries: config.dailyQueries, maxDays: 31, queryJobsSubmitted: 0 }));
  if (!args.length) return;
  if (!sourceFor(args[1])) throw new Error('This property has no GA4_BIGQUERY_SOURCES mapping.');
  const result = await require('../controllers/bigqueryJourneys').getBigQueryJourneys().capabilities(args[1]);
  console.log(JSON.stringify(result));
  if (!result.available) process.exitCode = 1;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
