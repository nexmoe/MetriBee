const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ledger-")), "ledger.json");
process.env.QUOTA_LEDGER_FILE = file;
delete require.cache[require.resolve("../lib/quotaLedger")];
const ledger = require("../lib/quotaLedger");

const q = (projectHourLeft, hourLeft = 39000, dayLeft = 190000, cost = 12) => ({
	tokensPerDay: { consumed: cost, remaining: dayLeft },
	tokensPerHour: { consumed: cost, remaining: hourLeft },
	tokensPerProjectPerHour: { consumed: cost, remaining: projectHourLeft },
});

describe("quotaLedger", () => {
	it("records and summarizes a healthy pool", () => {
		ledger.record("1", "core", q(13000), "mcp");
		const s = ledger.status("1", "core");
		assert.strictEqual(s.status, "ok");
		assert.strictEqual(s.cost, 12);
		assert.strictEqual(s.projectHourLeft, 13000);
	});

	it("is low under the 30% project-hour reserve, critical under 10%", () => {
		ledger.record("2", "core", q(4000), "dashboard");
		assert.strictEqual(ledger.status("2", "core").status, "low");
		ledger.record("2", "core", q(1000), "dashboard");
		assert.strictEqual(ledger.status("2", "core").status, "critical");
	});

	it("keeps pools apart and ignores missing quota", () => {
		ledger.record("1", "realtime", null, "mcp");
		assert.strictEqual(ledger.status("1", "realtime").status, "unknown");
		assert.strictEqual(ledger.status("1", "core").status, "ok");
	});

	it("treats hourly numbers older than an hour as unknown", () => {
		ledger.record("3", "core", q(500, 500, 500), "mcp");
		const later = Date.now() + 2 * 3600 * 1000;
		const s = ledger.status("3", "core", later);
		assert.strictEqual(s.projectHourLeft, null);
		assert.strictEqual(s.hourLeft, null);
	});

	it("scales limits for 360 properties", () => {
		ledger.record("4", "core", q(100000, 300000, 1900000), "mcp");
		assert.strictEqual(ledger.status("4", "core").status, "ok");
	});

	it("puts the daily reset at a future Pacific midnight", () => {
		const reset = ledger.nextDailyReset();
		assert.ok(reset.getTime() > Date.now());
		assert.ok(reset.getTime() - Date.now() <= 25 * 3600 * 1000);
		const hh = reset.toLocaleString("en-US", { timeZone: "America/Los_Angeles", hour: "2-digit", hour12: false });
		assert.ok(hh === "24" || hh === "00", hh);
	});

	it("lists all entries", () => {
		assert.ok(ledger.list().length >= 4);
	});
});
