const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const demo = require("../../controllers/demoData");

const CACHE_DIR = path.join(__dirname, "..", ".cache");

// TTL tiers — historical data barely changes, realtime data changes every minute.
const TTL_SECONDS = {
	realtime: Number(process.env.CACHE_TTL_REALTIME_SEC) || 60,
	report: Number(process.env.CACHE_TTL_REPORT_SEC) || 3600,
	metadata: Number(process.env.CACHE_TTL_METADATA_SEC) || 21600,
	properties: Number(process.env.CACHE_TTL_PROPERTIES_SEC) || 300,
	// PSI runs a real Lighthouse pass — expensive and noisy run-to-run, so cache
	// longer than a report but short enough to catch a post-deploy regression.
	psi: Number(process.env.CACHE_TTL_PSI_SEC) || 1800,
};

const mem = new Map(); // key -> { tier, params, toolName, value, cachedAt }

function keyFor(toolName, params) {
	const hash = crypto
		.createHash("sha1")
		.update(JSON.stringify(params))
		.digest("hex")
		.slice(0, 16);
	return `${demo.enabled() ? "demo_" : ""}${toolName}_${hash}`;
}

function filePathFor(key) {
	return path.join(demo.cacheDir(CACHE_DIR), `${key}.json`);
}

function isFresh(entry, tier) {
	return Date.now() - entry.cachedAt < TTL_SECONDS[tier] * 1000;
}

/** Returns { value, ageSeconds, ttlSeconds } if a fresh entry exists, else null. */
function get(toolName, params, tier) {
	const key = keyFor(toolName, params);
	let entry = mem.get(key);

	if (!entry) {
		try {
			entry = JSON.parse(fs.readFileSync(filePathFor(key), "utf8"));
			mem.set(key, entry);
		} catch {
			return null;
		}
	}

	if (!isFresh(entry, tier)) return null;
	return {
		value: entry.value,
		ageSeconds: Math.round((Date.now() - entry.cachedAt) / 1000),
		ttlSeconds: TTL_SECONDS[tier],
	};
}

function set(toolName, params, tier, value) {
	const key = keyFor(toolName, params);
	const entry = { toolName, params, tier, value, cachedAt: Date.now() };
	mem.set(key, entry);
	fs.mkdirSync(demo.cacheDir(CACHE_DIR), { recursive: true });
	fs.writeFileSync(filePathFor(key), JSON.stringify(entry));
}

/** Lists every cache entry currently on disk + in memory, fresh or stale, no API calls. */
function status() {
	const directory = demo.cacheDir(CACHE_DIR);
	fs.mkdirSync(directory, { recursive: true });
	const files = fs.readdirSync(directory).filter((f) => f.endsWith(".json"));
	return files.map((f) => {
		const key = f.replace(/\.json$/, "");
		let entry = mem.get(key);
		if (!entry) {
			entry = JSON.parse(fs.readFileSync(filePathFor(key), "utf8"));
		}
		const ageSeconds = Math.round((Date.now() - entry.cachedAt) / 1000);
		const ttlSeconds = TTL_SECONDS[entry.tier];
		return {
			toolName: entry.toolName,
			params: entry.params,
			ageSeconds,
			ttlSeconds,
			fresh: ageSeconds < ttlSeconds,
		};
	});
}

module.exports = { get, set, status, TTL_SECONDS };
