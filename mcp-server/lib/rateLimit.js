// Simple per-API-family token bucket. Requests over the limit are delayed
// (queued), never dropped: that's the "throttle automatically" behavior.
const LIMITS = {
	admin: Number(process.env.RATE_LIMIT_ADMIN_RPS) || 2,
	data: Number(process.env.RATE_LIMIT_DATA_RPS) || 8,
	realtime: Number(process.env.RATE_LIMIT_REALTIME_RPS) || 4,
	alpha: Number(process.env.RATE_LIMIT_ALPHA_RPS) || 2,
	psi: Number(process.env.RATE_LIMIT_PSI_RPS) || 1,
	// Indexing API's real cap is ~200 requests/day, not requests/sec — this is
	// just a local safety throttle against bursts; Google's daily cap still applies.
	indexing: Number(process.env.RATE_LIMIT_INDEXING_RPS) || 0.1,
};

const buckets = {};
for (const [family, rps] of Object.entries(LIMITS)) {
	// Burst capacity must hold at least 1 token, even for sub-1-rps families
	// (e.g. indexing at 0.1 rps) — otherwise tokens can never reach the 1
	// needed to release a request and acquire() waits forever.
	const capacity = Math.max(1, rps);
	buckets[family] = { tokens: capacity, capacity, refillPerMs: rps / 1000, lastRefill: Date.now() };
}

function refill(bucket) {
	const now = Date.now();
	const elapsed = now - bucket.lastRefill;
	bucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsed * bucket.refillPerMs);
	bucket.lastRefill = now;
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolves once a token is available for `family`, consuming it. */
async function acquire(family) {
	const bucket = buckets[family];
	if (!bucket) throw new Error(`Unknown rate-limit family: ${family}`);

	while (true) {
		refill(bucket);
		if (bucket.tokens >= 1) {
			bucket.tokens -= 1;
			return;
		}
		const waitMs = Math.ceil((1 - bucket.tokens) / bucket.refillPerMs);
		await sleep(waitMs);
	}
}

const httpStatus = (err) => err?.status ?? err?.response?.status ?? (err?.code >= 400 ? err.code : undefined);

/**
 * Whether a failed call is worth one retry. GA4 RESOURCE_EXHAUSTED (8) means tokens are gone unless
 * it is about concurrent requests, so only that case retries. UNAVAILABLE (14) and HTTP 500/503 retry
 * once (Google allows only 10 server errors per project per hour). PSI maps its 429 to 8: retry once.
 */
function shouldRetry(family, err) {
	if (err?.code === 8) return family === "psi" || /concurren/i.test(err.message || "");
	if (err?.code === 14) return true;
	const status = httpStatus(err);
	return status === 500 || status === 503;
}

/** Throttles to the family's RPS, then calls fn, retrying once on the errors shouldRetry allows. */
async function withRateLimit(family, fn, { maxRetries = 1, baseMs = 500 } = {}) {
	await acquire(family);
	let attempt = 0;
	while (true) {
		try {
			return await fn();
		} catch (err) {
			if (!shouldRetry(family, err) || attempt >= maxRetries) throw err;
			const backoffMs = baseMs * 2 ** attempt + Math.random() * (baseMs * 0.4);
			console.error(`[rate-limit] ${family} hit code ${err.code ?? httpStatus(err)}, retrying in ${Math.round(backoffMs)}ms`);
			await sleep(backoffMs);
			attempt += 1;
		}
	}
}

function status() {
	const out = {};
	for (const [family, bucket] of Object.entries(buckets)) {
		refill(bucket);
		out[family] = {
			limitPerSecond: bucket.capacity,
			tokensAvailable: Math.floor(bucket.tokens * 10) / 10,
		};
	}
	return out;
}

module.exports = { withRateLimit, shouldRetry, status };
