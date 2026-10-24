// Console view of the shared GA4 quota ledger (lib/quotaLedger.js): one line per pool, warn lines once.
// Pure formatting plus a per-process counter of tokens the dashboard spent since the last line.
const { POOLS, STANDARD, RESERVE, nextDailyReset } = require("./quotaLedger");

const HOUR_SEC = 3600;
const spent = Object.fromEntries(POOLS.map((p) => [p, 0]));

/** Count tokens one dashboard GA4 call spent (cost of that request), by pool. */
function addSpent(pool, n) {
	const v = Number(n);
	if (pool in spent && Number.isFinite(v) && v > 0) spent[pool] += v;
}

/** Tokens spent since the last call, by pool, then reset to 0. */
function takeSpent() {
	const out = { ...spent };
	for (const p of POOLS) spent[p] = 0;
	return out;
}

const nf = (n) => Math.round(Number(n)).toLocaleString("en-US");
// 360 properties have 10x the limits; the ledger shows that through a day balance above the standard day.
const scaleOf = (e) => ((e.dayLeft || 0) > STANDARD.day ? 10 : 1);
const nameOf = (names, id) => names[id] || String(id);

/**
 * One line per pool with entries newer than an hour, for example
 * "core      12 sites  spent 1,240 tok since last  lowest project-hour 9,800/14,000 (Site)  day left min 182,000".
 */
function quotaLines(entries, { names = {}, spent: used = {} } = {}) {
	const fresh = entries.filter((e) => e.ageSec != null && e.ageSec < HOUR_SEC);
	const lines = [];
	for (const pool of POOLS) {
		const rows = fresh.filter((e) => e.pool === pool);
		if (!rows.length) continue;
		const sites = new Set(rows.map((e) => e.propertyId)).size;
		const parts = [pool.padEnd(8), `${sites} site${sites === 1 ? "" : "s"}`, `spent ${nf(used[pool] || 0)} tok since last`];
		const ph = rows.filter((e) => e.projectHourLeft != null).sort((a, b) => a.projectHourLeft - b.projectHourLeft)[0];
		if (ph) parts.push(`lowest project-hour ${nf(ph.projectHourLeft)}/${nf(STANDARD.projectHour * scaleOf(ph))} (${nameOf(names, ph.propertyId)})`);
		const days = rows.map((e) => e.dayLeft).filter((v) => v != null);
		if (days.length) parts.push(`day left min ${nf(Math.min(...days))}`);
		lines.push(parts.join("  "));
	}
	return lines;
}

const fmtTime = (d) => d.toTimeString().slice(0, 5);

/**
 * Warn lines for entries that turned low or critical, once per property, pool and status.
 * `seen` is a Set the caller keeps between calls; an entry back to ok clears its keys so a later drop warns again.
 */
function quotaWarnings(entries, seen, { names = {}, now = Date.now() } = {}) {
	const out = [];
	for (const e of entries) {
		const base = `${e.propertyId}:${e.pool}:`;
		if (e.status !== "low" && e.status !== "critical") {
			if (e.status === "ok") for (const k of [...seen]) if (k.startsWith(base)) seen.delete(k);
			continue;
		}
		const key = base + e.status;
		if (seen.has(key)) continue;
		seen.add(key);
		const dayShort = e.dayLeft != null && e.dayLeft / (STANDARD.day * scaleOf(e)) < RESERVE.day;
		const reset = dayShort ? `daily reset at ${fmtTime(nextDailyReset(now))}` : "resets within the hour";
		const left = [
			e.projectHourLeft != null && `project-hour ${nf(e.projectHourLeft)}`,
			e.hourLeft != null && `hour ${nf(e.hourLeft)}`,
			e.dayLeft != null && `day ${nf(e.dayLeft)}`,
		].filter(Boolean).join(", ");
		out.push(`${nameOf(names, e.propertyId)} ${e.pool} quota ${e.status}: ${left} left, ${reset}`);
	}
	return out;
}

module.exports = { addSpent, takeSpent, quotaLines, quotaWarnings };
