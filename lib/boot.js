// Boot sequence for the web server: numbered steps, one log line each, and a gate that makes
// early requests wait until the data pages need is ready (so any page works on first boot).

/** Resolves true when `ms` passes before `promise` settles, false otherwise. Never rejects. */
function withTimeout(promise, ms) {
	let timer;
	const timeout = new Promise((resolve) => {
		timer = setTimeout(() => resolve(true), ms);
		timer.unref?.();
	});
	return Promise.race([Promise.resolve(promise).then(() => false, () => false), timeout]).finally(() => clearTimeout(timer));
}

const fmtMs = (ms) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

/**
 * Run steps in order. Each step is { name, run }, where run() returns a message, or
 * { msg, stop: true } to end the sequence there. A step that throws is logged as a warning
 * and the sequence goes on. Returns { warm, done }: `warm` settles after step `gateAfter`
 * (or when the sequence ends earlier), `done` after the last step.
 */
function runBoot(steps, { gateAfter = steps.length, log = console.log, warn = console.warn, now = Date.now, slowMs = 2000 } = {}) {
	let openGate;
	// Live state for the boot page: one row per step, state wait | run | done | fail.
	const progress = steps.map(({ name }) => ({ name, state: "wait", msg: "", ms: 0 }));
	const warm = new Promise((resolve) => { openGate = resolve; });
	const total = steps.length;
	const done = (async () => {
		try {
			for (let i = 0; i < total; i++) {
				const { name, run } = steps[i];
				const head = `${i + 1}/${total} ${name.padEnd(11)}`;
				const t = now();
				const row = progress[i];
				row.state = "run";
				// A step that runs long gets one "still running" line, so the console never looks stuck.
				const slow = setTimeout(() => log(`[boot] ${head} still running...`), slowMs);
				slow.unref?.();
				let out;
				try {
					out = await run();
					row.state = "done";
				} catch (err) {
					warn(`[boot] ${head} failed: ${err.message}  ${fmtMs(now() - t)}`);
					row.state = "fail";
					row.msg = err.message;
					out = null;
				} finally {
					clearTimeout(slow);
				}
				row.ms = now() - t;
				const res = typeof out === "object" && out !== null ? out : { msg: out };
				if (res.msg != null) row.msg = res.msg;
				if (res.msg != null) log(`[boot] ${head} ${res.msg}  ${fmtMs(row.ms)}`);
				if (i + 1 === gateAfter) openGate();
				if (res.stop) break;
			}
		} finally {
			openGate();
		}
	})();
	return { warm, done, progress };
}

const NO_WAIT = new Set(["/healthz", "/setup", "/api/setup/status", "/api/boot/status"]);

/**
 * Fastify preHandler: while `getWarm()` returns a pending promise, a browser page request gets
 * `page` (a progress page that reloads itself when boot ends), and other requests wait until it
 * settles or `timeoutMs` passes. Setup and health routes never wait. Sets `req.bootWaitMs`.
 */
function bootGate(getWarm, { timeoutMs = 30000, page } = {}) {
	return async (req, res) => {
		const warm = getWarm();
		if (!warm || NO_WAIT.has(req.path) || req.path.startsWith("/livereload")) return;
		if (page && req.method === "GET" && !req.path.startsWith("/api/") && req.headers?.accept?.includes("text/html")) {
			return page(req, res);
		}
		const t = Date.now();
		await withTimeout(warm, timeoutMs);
		req.bootWaitMs = Date.now() - t;
	};
}

module.exports = { runBoot, bootGate, withTimeout, fmtMs, NO_WAIT };
