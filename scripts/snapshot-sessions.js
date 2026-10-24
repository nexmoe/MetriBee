#!/usr/bin/env node
/* pnpm snapshot:sessions. Daily sessions for the last 14 days, every GA4 property the
   service account can see. Writes data/snapshots/sessions-YYYY-MM-DD.json and latest.json.
   One small runReport per property, sequential with a pause (GA4 core quota: 10 concurrent).
   Run daily by the ga4-snapshot.timer systemd user unit. */
process.noDeprecation = true;
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { createAdminClient, createDataClient } = require("../lib/supplementalAuth");

const OUT_DIR = path.join(__dirname, "..", "data", "snapshots");
const PAUSE_MS = 400;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
	const admin = createAdminClient();
	const data = createDataClient();

	const [summaries] = await admin.listAccountSummaries({});
	const props = summaries.flatMap((s) =>
		(s.propertySummaries || []).map((p) => ({ id: p.property.replace("properties/", ""), name: p.displayName })),
	);

	const properties = [];
	const errors = [];
	for (const p of props) {
		const entry = { id: p.id, name: p.name, daily: {} };
		try {
			const [res] = await data.runReport({
				property: `properties/${p.id}`,
				dateRanges: [{ startDate: "14daysAgo", endDate: "yesterday" }],
				dimensions: [{ name: "date" }],
				metrics: [{ name: "sessions" }],
				orderBys: [{ dimension: { dimensionName: "date" } }],
				limit: 20,
			});
			for (const row of res.rows || []) entry.daily[row.dimensionValues[0].value] = Number(row.metricValues[0].value);
		} catch (err) {
			entry.error = String(err.message || err).slice(0, 200);
			errors.push(`${p.id} ${p.name}: ${entry.error}`);
		}
		properties.push(entry);
		await sleep(PAUSE_MS);
	}

	const generatedAt = new Date().toISOString();
	const out = JSON.stringify({ generatedAt, properties }, null, 1);
	fs.mkdirSync(OUT_DIR, { recursive: true });
	const day = new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD
	fs.writeFileSync(path.join(OUT_DIR, `sessions-${day}.json`), out);
	fs.writeFileSync(path.join(OUT_DIR, "latest.json"), out);

	console.log(`${properties.length} properties, ${errors.length} errors -> data/snapshots/sessions-${day}.json`);
	for (const e of errors) console.log(`error ${e}`);
	process.exit(errors.length === properties.length && properties.length ? 1 : 0);
})().catch((err) => {
	console.error(`snapshot failed: ${err.message || err}`);
	process.exit(1);
});
