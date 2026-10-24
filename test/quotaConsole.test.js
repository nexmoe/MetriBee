const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Never touch the real ledger in .data/
process.env.QUOTA_LEDGER_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "qc-")), "ledger.json");
delete require.cache[require.resolve("../lib/quotaLedger")];
const { quotaLines, quotaWarnings, addSpent, takeSpent } = require("../lib/quotaConsole");

const e = (propertyId, pool, projectHourLeft, dayLeft, status = "ok", ageSec = 60) =>
	({ propertyId, pool, source: "dashboard", cost: 10, projectHourLeft, hourLeft: 39000, dayLeft, ageSec, status });

describe("quota console", () => {
	it("prints one line per pool with sites, spend, lowest project-hour and day minimum", () => {
		const lines = quotaLines([
			e("1", "core", 9800, 182000),
			e("2", "core", 12000, 190000),
			e("1", "realtime", 13900, 199000),
			e("3", "core", 100, 1000, "critical", 7200), // older than an hour: left out
		], { names: { 1: "Site One" }, spent: { core: 1240 } });
		assert.deepStrictEqual(lines, [
			"core      2 sites  spent 1,240 tok since last  lowest project-hour 9,800/14,000 (Site One)  day left min 182,000",
			"realtime  1 site  spent 0 tok since last  lowest project-hour 13,900/14,000 (Site One)  day left min 199,000",
		]);
	});

	it("warns once per property, pool and status, and again after the entry recovers", () => {
		const seen = new Set();
		const low = [e("1", "core", 2000, 150000, "low")];
		const first = quotaWarnings(low, seen, { names: { 1: "Site One" } });
		assert.strictEqual(first.length, 1);
		assert.match(first[0], /^Site One core quota low: project-hour 2,000, hour 39,000, day 150,000 left, resets within the hour$/);
		assert.deepStrictEqual(quotaWarnings(low, seen), []);
		assert.strictEqual(quotaWarnings([e("1", "core", 500, 150000, "critical")], seen).length, 1);
		quotaWarnings([e("1", "core", 13000, 150000, "ok")], seen);
		assert.strictEqual(quotaWarnings(low, seen).length, 1);
		const dayShort = quotaWarnings([e("2", "funnel", 9000, 5000, "critical")], seen)[0];
		assert.match(dayShort, /daily reset at \d\d:\d\d$/);
	});

	it("counts spent tokens per pool and resets on take", () => {
		takeSpent();
		addSpent("core", 12);
		addSpent("core", "8");
		addSpent("nope", 5);
		addSpent("realtime", null);
		assert.strictEqual(takeSpent().core, 20);
		assert.strictEqual(takeSpent().core, 0);
	});

	it("ledger wrapper asks GA4 for quota on every call and records it under the right pool", async () => {
		delete require.cache[require.resolve("../controllers/ga4Service")];
		const { withQuotaLedger } = require("../controllers/ga4Service");
		const ledger = require("../lib/quotaLedger");
		const pq = { tokensPerDay: { consumed: 7, remaining: 190000 }, tokensPerHour: { consumed: 7, remaining: 39000 }, tokensPerProjectPerHour: { consumed: 7, remaining: 13000 } };
		const seen = [];
		const fake = {
			runReport: async (req) => { seen.push(req); return [{ rows: [], propertyQuota: pq }]; },
			runRealtimeReport: async (req) => { seen.push(req); return [{ rows: [], propertyQuota: pq }]; },
		};
		takeSpent();
		const client = withQuotaLedger(fake);
		await client.runReport({ property: "properties/42" });
		await client.runRealtimeReport({ property: "properties/42" });
		assert.ok(seen.every((r) => r.returnPropertyQuota === true));
		assert.strictEqual(ledger.get("42", "core").quota.tokensPerProjectPerHour.remaining, 13000);
		assert.strictEqual(ledger.get("42", "realtime").source, "dashboard");
		assert.strictEqual(takeSpent().core, 7);
	});
});
