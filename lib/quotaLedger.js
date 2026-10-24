/**
 * Shared GA4 quota ledger: the last `propertyQuota` Google returned, per property and quota pool.
 * The dashboard and the MCP server run as separate processes on the same GCP project, so both
 * write here (.data/quota-ledger.json) and both read it before spending tokens.
 * In each QuotaStatus, `consumed` is the cost of that one request, `remaining` is what is left after it.
 */
const fs = require("fs");
const path = require("path");

const FILE = process.env.QUOTA_LEDGER_FILE || path.join(__dirname, "..", ".data", "quota-ledger.json");

// Google's published limits (developers.google.com/analytics/devguides/reporting/data/v1/quotas).
// Core, realtime and funnel are separate pools with the same numbers. 360 properties get x10.
const STANDARD = { day: 200000, hour: 40000, projectHour: 14000 };
const POOLS = ["core", "realtime", "funnel"];

const pct = (name, fallback) => {
	const n = Number(process.env[name]);
	return Number.isFinite(n) && n >= 0 && n <= 100 ? n / 100 : fallback;
};
// Below these shares of the limit a pool is "low": callers that can wait (the MCP) stop spending.
const RESERVE = {
	projectHour: pct("QUOTA_RESERVE_PROJECT_HOUR_PCT", 0.3),
	hour: pct("QUOTA_RESERVE_HOUR_PCT", 0.2),
	day: pct("QUOTA_RESERVE_DAY_PCT", 0.2),
};
const CRITICAL = 0.1;
const HOUR_MS = 3600 * 1000;

function readAll() {
	try {
		return JSON.parse(fs.readFileSync(FILE, "utf8"));
	} catch {
		return {};
	}
}

const left = (q, key) => {
	const n = Number(q?.[key]?.remaining);
	return Number.isFinite(n) ? n : null;
};
const spent = (q, key) => {
	const n = Number(q?.[key]?.consumed);
	return Number.isFinite(n) ? n : null;
};

/** Store one response's propertyQuota. No-op when Google sent none. */
function record(propertyId, pool, propertyQuota, source) {
	if (!propertyQuota || !POOLS.includes(pool)) return;
	const all = readAll(); // ponytail: read-merge-write, last writer wins per key; fine at a few writes a minute
	// Keep only consumed/remaining per quota: protobuf objects also carry `_consumed`-style keys.
	const quota = {};
	for (const [k, v] of Object.entries(propertyQuota)) {
		if (v && typeof v === "object") quota[k] = { consumed: v.consumed, remaining: v.remaining };
	}
	all[`${propertyId}:${pool}`] = { propertyId: String(propertyId), pool, source, at: Date.now(), quota };
	writeAll(all); // Ledger is advisory: a failed write must never fail the GA4 call that produced it.
}

/** Next midnight America/Los_Angeles, when Google resets daily quotas. */
function nextDailyReset(now = Date.now()) {
	const pt = new Date(new Date(now).toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
	const offsetMs = now - pt.getTime();
	const midnight = new Date(pt);
	midnight.setHours(24, 0, 0, 0);
	return new Date(midnight.getTime() + offsetMs);
}

/**
 * Compact view of one ledger entry: what the last call cost, what is left, and a status.
 * Hourly numbers older than an hour and daily numbers from before the last Pacific midnight are
 * reported as null (unknown), since Google has refilled them since.
 */
function summarize(entry, now = Date.now()) {
	if (!entry) return { status: "unknown" };
	const q = entry.quota;
	const ageMs = now - entry.at;
	const hourFresh = ageMs < HOUR_MS;
	const dayFresh = nextDailyReset(entry.at).getTime() > now;
	const scale = (left(q, "tokensPerDay") || 0) > STANDARD.day ? 10 : 1; // 360 property
	const out = {
		cost: spent(q, "tokensPerHour"),
		projectHourLeft: hourFresh ? left(q, "tokensPerProjectPerHour") : null,
		hourLeft: hourFresh ? left(q, "tokensPerHour") : null,
		dayLeft: dayFresh ? left(q, "tokensPerDay") : null,
		ageSec: Math.round(ageMs / 1000),
	};
	const ratio = (v, limit) => (v == null ? 1 : v / (limit * scale));
	const r = {
		projectHour: ratio(out.projectHourLeft, STANDARD.projectHour),
		hour: ratio(out.hourLeft, STANDARD.hour),
		day: ratio(out.dayLeft, STANDARD.day),
	};
	if (out.projectHourLeft == null && out.hourLeft == null && out.dayLeft == null) out.status = "unknown";
	else if (Math.min(r.projectHour, r.hour, r.day) < CRITICAL) out.status = "critical";
	else if (r.projectHour < RESERVE.projectHour || r.hour < RESERVE.hour || r.day < RESERVE.day) out.status = "low";
	else out.status = "ok";
	return out;
}

function get(propertyId, pool) {
	return readAll()[`${propertyId}:${pool}`] || null;
}

/** summarize() for one property and pool, read from disk. */
function status(propertyId, pool, now = Date.now()) {
	return summarize(get(propertyId, pool), now);
}

/** Every entry, summarized, for status tools and the console quota line. */
function list(now = Date.now()) {
	return Object.values(readAll()).filter((e) => e?.quota).map((e) => ({ propertyId: e.propertyId, pool: e.pool, source: e.source, ...summarize(e, now) }));
}

/** GCP project of the service account, from GA4_CLIENT_EMAIL (name@<project>.iam.gserviceaccount.com). */
function gcpProject(env = process.env) {
	return /@([^.]+)\.iam\.gserviceaccount\.com/.exec(env.GA4_CLIENT_EMAIL || "")?.[1] || "unknown";
}

const SERVER_ERROR_CODES = new Set([2, 13, 14, 500, 502, 503, 504]); // gRPC UNKNOWN/INTERNAL/UNAVAILABLE + HTTP 5xx
const MIN_MS = 60 * 1000;

function writeAll(all) {
	try {
		fs.mkdirSync(path.dirname(FILE), { recursive: true });
		const tmp = `${FILE}.${process.pid}.tmp`;
		fs.writeFileSync(tmp, JSON.stringify(all));
		fs.renameSync(tmp, FILE);
	} catch {
		// advisory, same as record()
	}
}

/**
 * After a GA4 rate-limit or server error, store a cooldown so the dashboard and the MCP stop
 * sending until it ends. Quota errors (gRPC 8 / HTTP 429) pause that property and pool, or the
 * whole GCP project when the per-project hourly budget ran out. Server errors count toward
 * Google's 10-per-project-per-hour limit: 1 min pause each, 1 h pause from the 5th in an hour.
 * Returns the cooldown, or null for errors that are not rate-limit or server errors.
 */
function block(propertyId, pool, err, source, now = Date.now()) {
	const code = err?.code ?? err?.status;
	const msg = String(err?.message || "");
	// No GA4 response exists when DNS or the TLS connection failed locally.
	if (code === 14 && /No connection established|Name resolution failed|before secure TLS connection was established/i.test(msg)) return null;
	const all = readAll();
	let scope, until, reason;
	if (code === 8 || code === 429) {
		reason = `rate limited: ${msg.slice(0, 200)}`;
		if (/concurren/i.test(msg)) [scope, until] = [`${propertyId}:${pool}`, now + 15 * 1000];
		else if (/day|daily/i.test(msg)) [scope, until] = [`${propertyId}:${pool}`, nextDailyReset(now).getTime()];
		else if (/project/i.test(msg)) [scope, until] = ["project", now + HOUR_MS];
		else [scope, until] = [`${propertyId}:${pool}`, now + HOUR_MS];
	} else if (SERVER_ERROR_CODES.has(code)) {
		const recent = (all["serverErrors"] || []).filter((t) => now - t < HOUR_MS).concat(now);
		all["serverErrors"] = recent;
		scope = "project";
		until = recent.length >= 5 ? recent[0] + HOUR_MS : now + MIN_MS;
		reason = `${recent.length} GA4 server error(s) in the last hour (limit 10 per project): ${msg.slice(0, 200)}`;
	} else return null;
	const entry = { scope, gcpProject: gcpProject(), propertyId: String(propertyId), pool, until, reason, source, at: now };
	all[`cooldown:${scope}`] = entry;
	writeAll(all);
	return entry;
}

/** Active cooldown that applies to this property and pool (project-wide first), or null. */
function blocked(propertyId, pool, now = Date.now()) {
	const all = readAll();
	return [all["cooldown:project"], all[`cooldown:${propertyId}:${pool}`]].find((c) => c && c.until > now) || null;
}

/** Every active cooldown, for status tools. */
function cooldowns(now = Date.now()) {
	return Object.entries(readAll())
		.filter(([k, c]) => k.startsWith("cooldown:") && c.until > now)
		.map(([, c]) => ({ ...c, until: new Date(c.until).toISOString() }));
}

/** Error thrown instead of calling GA4 during a cooldown. code 8 so callers treat it as rate-limited. */
function blockedError(c) {
	const err = new Error(
		`GA4 paused for GCP project ${c.gcpProject} (${c.scope === "project" ? "whole project" : `property ${c.propertyId} ${c.pool}`}) ` +
			`until ${new Date(c.until).toISOString()}: ${c.reason}. No request sent.`,
	);
	err.code = 8;
	err.cooldown = c;
	return err;
}

module.exports = { record, get, status, list, summarize, nextDailyReset, block, blocked, blockedError, cooldowns, gcpProject, STANDARD, RESERVE, POOLS, FILE };
