const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.QUOTA_LEDGER_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mcp-guard-")), "ledger.json");
delete require.cache[require.resolve("../lib/quotaLedger")];
delete require.cache[require.resolve("../mcp-server/lib/guard")];
// Match the guard's live ledger facade when other suites reload the underlying module.
const ledger = require("../mcp-server/lib/ledger");
const guard = require("../mcp-server/lib/guard");
const rateLimit = require("../mcp-server/lib/rateLimit");

const q = (projectHourLeft, hourLeft = 39000, dayLeft = 190000, cost = 12) => ({
	tokensPerDay: { consumed: cost, remaining: dayLeft },
	tokensPerHour: { consumed: cost, remaining: hourLeft },
	tokensPerProjectPerHour: { consumed: cost, remaining: projectHourLeft },
});

describe("mcp guard: quota gate", () => {
	it("passes when the pool is ok", () => {
		ledger.record("g1", "core", q(13000), "dashboard");
		assert.strictEqual(guard.checkQuota("g1", "core"), null);
	});

	it("passes when nothing is known yet", () => {
		assert.strictEqual(guard.checkQuota("g-none", "core"), null);
	});

	it("refuses on low project-hour quota, retry within the hour", () => {
		ledger.record("g2", "core", q(3000), "dashboard");
		const err = guard.checkQuota("g2", "core");
		assert.strictEqual(err.error, "quota_low");
		assert.strictEqual(err.pool, "core");
		assert.strictEqual(err.quota.status, "low");
		assert.strictEqual(err.retryAfter, "within the hour");
		assert.ok(err.hint);
	});

	it("refuses on critical quota", () => {
		ledger.record("g3", "realtime", q(500), "mcp");
		assert.strictEqual(guard.checkQuota("g3", "realtime").quota.status, "critical");
	});

	it("points to the daily reset when only the day budget is low", () => {
		ledger.record("g4", "core", q(13000, 39000, 20000), "mcp");
		const err = guard.checkQuota("g4", "core");
		assert.strictEqual(err.error, "quota_low");
		assert.ok(!Number.isNaN(Date.parse(err.retryAfter)));
	});
});

describe("mcp guard: property spread", () => {
	beforeEach(() => guard._reset());

	it("allows 3 distinct properties, refuses the 4th, allows a repeat", () => {
		const now = 1_000_000;
		assert.strictEqual(guard.checkPropertySpread("a", now), null);
		assert.strictEqual(guard.checkPropertySpread("b", now + 1), null);
		assert.strictEqual(guard.checkPropertySpread("c", now + 2), null);
		const err = guard.checkPropertySpread("d", now + 3);
		assert.strictEqual(err.error, "too_many_properties");
		assert.deepStrictEqual(err.seen, ["a", "b", "c"]);
		assert.strictEqual(guard.checkPropertySpread("b", now + 4), null);
	});

	it("frees a slot once the window passes", () => {
		const now = 1_000_000;
		["a", "b", "c"].forEach((p) => guard.checkPropertySpread(p, now));
		assert.strictEqual(guard.checkPropertySpread("d", now + guard.WINDOW_MS + 1), null);
	});
});

describe("mcp guard: validateReport", () => {
	const base = { dimensions: ["country"], metrics: ["sessions"], limit: 10, startDate: "28daysAgo", endDate: "today" };
	const reason = (over) => guard.validateReport({ ...base, ...over })?.reason || null;

	it("passes a small report", () => assert.strictEqual(reason({}), null));
	it("refuses more than 4 dimensions", () => assert.match(reason({ dimensions: ["a", "b", "c", "d", "e"] }), /dimensions/));
	it("refuses more than 6 metrics", () => assert.match(reason({ metrics: ["1", "2", "3", "4", "5", "6", "7"] }), /metrics/));
	it("refuses limit over 250", () => assert.match(reason({ limit: 251 }), /limit/));
	it("refuses a range over 93 days", () => {
		assert.match(reason({ startDate: "100daysAgo" }), /date range/);
		assert.match(reason({ startDate: "2026-01-01", endDate: "2026-06-30" }), /date range/);
		assert.strictEqual(reason({ startDate: "92daysAgo", endDate: "today" }), null);
		assert.strictEqual(reason({ startDate: "93daysAgo", endDate: "yesterday" }), null);
	});
	it("passes dates it cannot parse", () => assert.strictEqual(reason({ startDate: "lastMonth" }), null));
	it("needs orderBys and limit <= 50 for high-cardinality dimensions", () => {
		const orderBys = [{ metric: "sessions", desc: true }];
		assert.match(reason({ dimensions: ["pagePath"] }), /high-cardinality/);
		assert.match(reason({ dimensions: ["customEvent:foo"], orderBys, limit: 51 }), /high-cardinality/);
		assert.match(reason({ dimensions: ["landingPagePlusQueryString"], orderBys: [] }), /high-cardinality/);
		assert.strictEqual(reason({ dimensions: ["pagePath"], orderBys, limit: 50 }), null);
	});
	it("returns the report_too_big shape", () => {
		const err = guard.validateReport({ ...base, limit: 999 });
		assert.strictEqual(err.error, "report_too_big");
		assert.ok(err.hint);
	});
});

describe("mcp guard: inflight", () => {
	it("never runs more than the cap at once per property", async () => {
		let active = 0;
		let peak = 0;
		const task = () =>
			guard.inflight("p-inflight", async () => {
				active += 1;
				peak = Math.max(peak, active);
				await new Promise((r) => setTimeout(r, 5));
				active -= 1;
			}, 3);
		await Promise.all(Array.from({ length: 10 }, task));
		assert.strictEqual(peak, 3);
		assert.strictEqual(active, 0);
	});

	it("releases the slot when fn throws", async () => {
		await assert.rejects(guard.inflight("p-throw", async () => { throw new Error("x"); }, 1));
		assert.strictEqual(await guard.inflight("p-throw", async () => "ok", 1), "ok");
	});
});

describe("mcp guard: fitResult", () => {
	it("fits nested dashboard arrays while preserving scalar summaries and complete records", () => {
		const source = { data: { summary: { users: 500 }, events: Array.from({ length: 200 }, (_, index) => ({ name: `event-${index}`, series: [{ time: "2026-10-22", count: index }] })) }, quota: { status: "ok" } };
		const text = guard.fitResult(source, 1000);
		const out = JSON.parse(text);
		assert.ok(Buffer.byteLength(text) <= 1000);
		assert.deepStrictEqual(out.data.summary, { users: 500 });
		assert.deepStrictEqual(out.quota, { status: "ok" });
		assert.deepStrictEqual(out.data.events[0], source.data.events[0]);
		assert.equal(out.truncated, true);
		assert.equal(out._truncation[0].path, "data.events");
		assert.equal(source.data.events.length, 200);
	});
	it("returns a bounded error for oversized scalar metadata", () => {
		const text = guard.fitResult({ message: "x".repeat(20000) }, 1000);
		assert.ok(Buffer.byteLength(text) <= 1000);
		assert.equal(JSON.parse(text).error, "result_too_large");
	});
	it("drops rows from the end until the text fits", () => {
		const rows = Array.from({ length: 200 }, (_, i) => [`/page-${i}`, String(i)]);
		const text = guard.fitResult({ headers: ["pagePath", "views"], rows, returned: 200 }, 1000);
		const out = JSON.parse(text);
		assert.ok(Buffer.byteLength(text) <= 1000);
		assert.strictEqual(out.truncated, true);
		assert.strictEqual(out.returned, out.rows.length);
		assert.deepStrictEqual(out.rows[0], ["/page-0", "0"]);
		assert.ok(out.hint);
	});
});

describe("mcp rate limit: retry policy", () => {
	let errLog;
	before(() => {
		errLog = console.error;
		console.error = () => {};
	});
	after(() => {
		console.error = errLog;
	});

	const failing = (err, times) => {
		let calls = 0;
		const fn = async () => {
			calls += 1;
			if (calls <= times) throw err;
			return "ok";
		};
		return { fn, calls: () => calls };
	};
	const grpc = (code, message) => Object.assign(new Error(message), { code });

	it("does not retry token exhaustion", async () => {
		const f = failing(grpc(8, "Exhausted property tokens per hour"), 5);
		await assert.rejects(rateLimit.withRateLimit("data", f.fn, { baseMs: 1 }));
		assert.strictEqual(f.calls(), 1);
	});

	it("retries concurrency exhaustion once", async () => {
		const ok = failing(grpc(8, "Exhausted concurrent requests quota"), 1);
		assert.strictEqual(await rateLimit.withRateLimit("data", ok.fn, { baseMs: 1 }), "ok");
		assert.strictEqual(ok.calls(), 2);
		const fails = failing(grpc(8, "Exhausted concurrent requests quota"), 5);
		await assert.rejects(rateLimit.withRateLimit("data", fails.fn, { baseMs: 1 }));
		assert.strictEqual(fails.calls(), 2);
	});

	it("retries UNAVAILABLE and HTTP 503 at most once", async () => {
		const unavailable = failing(grpc(14, "unavailable"), 5);
		await assert.rejects(rateLimit.withRateLimit("data", unavailable.fn, { baseMs: 1 }));
		assert.strictEqual(unavailable.calls(), 2);
		const http = failing(Object.assign(new Error("503"), { status: 503 }), 1);
		assert.strictEqual(await rateLimit.withRateLimit("data", http.fn, { baseMs: 1 }), "ok");
	});

	it("keeps the PSI 429 retry", () => {
		assert.strictEqual(rateLimit.shouldRetry("psi", grpc(8, "Quota exceeded")), true);
		assert.strictEqual(rateLimit.shouldRetry("data", grpc(3, "bad request")), false);
	});
});

describe("exhaustedError", () => {
	it("maps token exhaustion, skips concurrency and other errors", () => {
		const hourly = guard.exhaustedError("1", "core", { code: 8, message: "Exhausted property tokens per hour" });
		assert.strictEqual(hourly.error, "quota_exhausted");
		assert.strictEqual(hourly.retryAfter, "within the hour");
		const daily = guard.exhaustedError("1", "core", { code: 8, message: "Exhausted property tokens per day" });
		assert.ok(!Number.isNaN(Date.parse(daily.retryAfter)));
		assert.strictEqual(guard.exhaustedError("1", "core", { code: 8, message: "Exhausted concurrent requests" }), null);
		assert.strictEqual(guard.exhaustedError("1", "core", { code: 14, message: "unavailable" }), null);
	});
});
