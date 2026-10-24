// Guardrails that run before the MCP server spends GA4 tokens. Pure functions plus small
// in-memory state, no Google calls, so they can be unit tested.
const ledger = require("./ledger");

const num = (name, fallback) => {
	const n = Number(process.env[name]);
	return Number.isFinite(n) && n > 0 ? n : fallback;
};

const MAX_PROPERTIES = num("MCP_MAX_PROPERTIES_PER_WINDOW", 3);
const WINDOW_MS = num("MCP_PROPERTY_WINDOW_MIN", 10) * 60 * 1000;
const MAX_INFLIGHT = num("MCP_MAX_INFLIGHT_PER_PROPERTY", 3);
const MAX_RESULT_BYTES = num("MCP_MAX_RESULT_BYTES", 12000);

const LIMITS = { dims: 4, metrics: 6, limit: 250, days: 93, highCardLimit: 50 };
const HIGH_CARD_EXACT = new Set(["pagePath", "pageLocation", "pageTitle"]);
const HIGH_CARD_PREFIX = ["landingPage", "customEvent:", "customUser:"];

/** ISO time of the next daily quota reset, rounded to the minute. */
const dailyResetIso = (now = Date.now()) => new Date(Math.round(ledger.nextDailyReset(now).getTime() / 60000) * 60000).toISOString();

/**
 * Maps a RESOURCE_EXHAUSTED thrown by GA4 (the gate passed, but the dashboard or another
 * client spent the budget first) to a tool result. Concurrency errors are not mapped:
 * rateLimit already retried them once. Returns null for any other error.
 */
function exhaustedError(propertyId, pool, err) {
	if (err?.code !== 8 || /concurren/i.test(err.message || "")) return null;
	const daily = /day|daily/i.test(err.message || "");
	return {
		error: "quota_exhausted",
		propertyId,
		pool,
		retryAfter: daily ? dailyResetIso() : "within the hour",
		hint: "GA4 refused: this property's quota is used up. Do not retry. Tell the user when it resets.",
	};
}

/** Refuses a GA4 call when the shared ledger says this property and pool are low or critical. */
function checkQuota(propertyId, pool) {
	const quota = ledger.status(propertyId, pool);
	if (quota.status !== "low" && quota.status !== "critical") return null;
	const scale = (quota.dayLeft || 0) > ledger.STANDARD.day ? 10 : 1;
	const under = (v, limit, reserve) => v != null && v / (limit * scale) < reserve;
	const hourly =
		under(quota.projectHourLeft, ledger.STANDARD.projectHour, ledger.RESERVE.projectHour) ||
		under(quota.hourLeft, ledger.STANDARD.hour, ledger.RESERVE.hour);
	return {
		error: "quota_low",
		propertyId: String(propertyId),
		pool,
		quota,
		retryAfter: hourly ? "within the hour" : dailyResetIso(),
		hint: "Do not retry. Finish with the data you have and tell the user when quota resets.",
	};
}

// propertyId -> last time it was used, for the distinct-properties sliding window.
const seen = new Map();

/** Refuses a call that would touch more than MAX_PROPERTIES distinct properties in WINDOW_MS. */
function checkPropertySpread(propertyId, now = Date.now()) {
	const id = String(propertyId);
	for (const [key, at] of seen) if (now - at > WINDOW_MS) seen.delete(key);
	if (!seen.has(id) && seen.size >= MAX_PROPERTIES) {
		return { error: "too_many_properties", seen: [...seen.keys()], hint: "Pick one property; ask the user which." };
	}
	seen.set(id, now);
	return null;
}

const DAY_MS = 86400 * 1000;

/** Day number (days since epoch, UTC) for a GA4 date string, or null when it cannot be parsed. */
function dayNumber(value, now = Date.now()) {
	const today = Math.floor(now / DAY_MS);
	if (value === "today") return today;
	if (value === "yesterday") return today - 1;
	const ago = /^(\d+)daysAgo$/.exec(value || "");
	if (ago) return today - Number(ago[1]);
	if (/^\d{4}-\d{2}-\d{2}$/.test(value || "")) {
		const t = Date.parse(`${value}T00:00:00Z`);
		return Number.isFinite(t) ? Math.floor(t / DAY_MS) : null;
	}
	return null;
}

const isHighCard = (dim) => HIGH_CARD_EXACT.has(dim) || HIGH_CARD_PREFIX.some((p) => dim.startsWith(p));

/** Refuses report requests that would cost many tokens or return far more rows than needed. */
function validateReport({ dimensions = [], metrics = [], limit, startDate, endDate, orderBys } = {}, now = Date.now()) {
	const tooBig = (reason, hint) => ({ error: "report_too_big", reason, hint });
	if (dimensions.length > LIMITS.dims) {
		return tooBig(`${dimensions.length} dimensions, max ${LIMITS.dims}`, "Drop dimensions or split the question.");
	}
	if (metrics.length > LIMITS.metrics) {
		return tooBig(`${metrics.length} metrics, max ${LIMITS.metrics}`, "Ask only for the metrics the answer needs.");
	}
	if (limit != null && limit > LIMITS.limit) {
		return tooBig(`limit ${limit}, max ${LIMITS.limit}`, "Use orderBys with a smaller limit.");
	}
	const start = dayNumber(startDate, now);
	const end = dayNumber(endDate, now);
	if (start != null && end != null && end - start + 1 > LIMITS.days) {
		return tooBig(`date range ${end - start + 1} days, max ${LIMITS.days}`, "Use the shortest date range that answers.");
	}
	const highCard = dimensions.filter(isHighCard);
	if (highCard.length && (!orderBys || !orderBys.length || limit == null || limit > LIMITS.highCardLimit)) {
		return tooBig(
			`high-cardinality dimension ${highCard.join(", ")} needs orderBys and limit at most ${LIMITS.highCardLimit}`,
			"Add orderBys (e.g. a metric, desc) and a limit of 50 or less, or a dimensionFilter.",
		);
	}
	return null;
}

// propertyId -> { active, queue } for the per-property concurrency cap.
const slots = new Map();

/** Runs fn with at most MAX_INFLIGHT concurrent calls per property; the rest wait in order. */
async function inflight(propertyId, fn, max = MAX_INFLIGHT) {
	const id = String(propertyId);
	let slot = slots.get(id);
	if (!slot) slots.set(id, (slot = { active: 0, queue: [] }));
	if (slot.active >= max) await new Promise((resolve) => slot.queue.push(resolve));
	else slot.active += 1;
	try {
		return await fn();
	} finally {
		const next = slot.queue.shift();
		if (next) next(); // hand the slot straight to the next caller, active stays the same
		else {
			slot.active -= 1;
			if (!slot.active) slots.delete(id);
		}
	}
}

/**
 * Fits a tool result into maxBytes of compact JSON by dropping rows from the end.
 * Returns the JSON text. Sets truncated, returned and a hint when rows were dropped.
 */
function fitResult(value, maxBytes = MAX_RESULT_BYTES) {
	let text = JSON.stringify(value);
	if (Buffer.byteLength(text) <= maxBytes) return text;
	if (Array.isArray(value?.rows) && value.rows.length) {
		const build = (n) => ({
			...value,
			rows: value.rows.slice(0, n),
			returned: n,
			truncated: true,
			hint: "Narrow with dimensionFilter, orderBys or a smaller limit.",
		});
		let lo = 0;
		let hi = value.rows.length - 1;
		while (lo < hi) {
			const mid = Math.ceil((lo + hi) / 2);
			if (Buffer.byteLength(JSON.stringify(build(mid))) <= maxBytes) lo = mid;
			else hi = mid - 1;
		}
		text = JSON.stringify(build(lo));
		if (Buffer.byteLength(text) <= maxBytes) return text;
	}
	// Dashboard responses contain nested event arrays, cohorts, series and account lists.
	// Trim whole records, preserving each retained record's fields and all scalar summaries.
	const out = JSON.parse(text);
	out.truncated = true;
	out.hint = "Result shortened to the MCP output budget. Narrow dates/filters or request a smaller page.";
	const removed = new Map();
	for (let attempt = 0; attempt < 128; attempt++) {
		const arrays = [];
		function collect(object, path = "") {
			if (!object || typeof object !== "object") return;
			for (const [key, item] of Object.entries(object)) {
				if (key === "_truncation") continue;
				const name = path ? `${path}.${key}` : key;
				if (Array.isArray(item) && item.length) arrays.push({ object, key, name, size: Buffer.byteLength(JSON.stringify(item)) });
				else if (!Array.isArray(item)) collect(item, name);
			}
		}
		collect(out);
		const largest = arrays.sort((a, b) => b.size - a.size)[0];
		if (!largest) break;
		const before = largest.object[largest.key];
		const count = Math.floor(before.length / 2);
		largest.object[largest.key] = before.slice(0, count);
		removed.set(largest.name, (removed.get(largest.name) || 0) + before.length - count);
		out._truncation = [...removed].slice(0, 12).map(([path, omitted]) => ({ path, omitted }));
		if (largest.name === "rows") out.returned = count;
		text = JSON.stringify(out);
		if (Buffer.byteLength(text) <= maxBytes) return text;
	}
	// A giant scalar cannot be meaningfully shortened without changing its meaning.
	return JSON.stringify({ error: "result_too_large", truncated: true, hint: "Choose a narrower report; scalar metadata exceeds the output budget." });
}

function _reset() {
	seen.clear();
	slots.clear();
}

module.exports = {
	checkQuota,
	exhaustedError,
	checkPropertySpread,
	validateReport,
	inflight,
	fitResult,
	dailyResetIso,
	dayNumber,
	isHighCard,
	LIMITS,
	MAX_PROPERTIES,
	WINDOW_MS,
	MAX_INFLIGHT,
	MAX_RESULT_BYTES,
	_reset,
};
