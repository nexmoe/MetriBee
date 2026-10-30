const assert = require("assert");
const { runBoot, bootGate, withTimeout } = require("../lib/boot");

const tick = () => new Promise((r) => setImmediate(r));

describe("boot sequence", () => {
	it("withTimeout reports a timeout, and a settled promise as no timeout", async () => {
		assert.strictEqual(await withTimeout(new Promise(() => {}), 10), true);
		assert.strictEqual(await withTimeout(Promise.resolve(1), 1000), false);
		assert.strictEqual(await withTimeout(Promise.reject(new Error("x")), 1000), false);
	});

	it("logs one numbered line per step and opens the gate after gateAfter", async () => {
		const lines = [];
		let release;
		const slow = new Promise((r) => { release = r; });
		let warmOpen = false;
		const { warm, done } = runBoot([
			{ name: "config", run: () => "ok" },
			{ name: "warm", run: () => "warmed" },
			{ name: "live", run: () => slow.then(() => "3 active") },
		], { gateAfter: 2, log: (l) => lines.push(l), warn: (l) => lines.push(l) });
		warm.then(() => { warmOpen = true; });
		await tick(); await tick();
		assert.strictEqual(warmOpen, true, "gate opens before the slow last step");
		release();
		await done;
		assert.strictEqual(lines.length, 3);
		assert.match(lines[0], /^\[boot\] 1\/3 config\s+ok  \d+ ms$/);
		assert.match(lines[2], /^\[boot\] 3\/3 live\s+3 active/);
	});

	it("stop ends the sequence and opens the gate; a failed step warns and goes on", async () => {
		const lines = [];
		const opts = { log: (l) => lines.push("log " + l), warn: (l) => lines.push("warn " + l) };
		const a = runBoot([{ name: "config", run: () => ({ msg: "waiting for setup", stop: true }) }, { name: "never", run: () => "x" }], { ...opts, gateAfter: 2 });
		await a.warm; await a.done;
		assert.deepStrictEqual(lines.map((l) => l.split(" ")[0]), ["log"]);
		lines.length = 0;
		const b = runBoot([{ name: "props", run: () => { throw new Error("boom"); } }, { name: "ready", run: () => "ready" }], opts);
		await b.done;
		assert.match(lines[0], /^warn \[boot\] 1\/2 props\s+failed: boom/);
		assert.match(lines[1], /^log \[boot\] 2\/2 ready/);
	});

	it("gate holds requests until warm, never holds setup and health routes, and gives up after the timeout", async () => {
		let release;
		const warm = new Promise((r) => { release = r; });
		const passed = [];
		const run = (gate, path) => gate({ path }, {}).then(() => passed.push(path));
		const gate = bootGate(() => warm, { timeoutMs: 1000 });
		run(gate, "/analytics");
		run(gate, "/healthz");
		run(gate, "/api/setup/status");
		await tick();
		assert.deepStrictEqual(passed, ["/healthz", "/api/setup/status"]);
		release();
		await tick(); await tick();
		assert.deepStrictEqual(passed.slice(2), ["/analytics"]);

		const stuck = bootGate(() => new Promise(() => {}), { timeoutMs: 20 });
		const t = Date.now();
		await stuck({ path: "/globe" }, {});
		assert.ok(Date.now() - t >= 15);
	});

	it("tracks step progress and serves the boot page to browser page requests only", async () => {
		const { progress, done } = runBoot([{ name: "a", run: () => "ok" }, { name: "b", run: () => { throw new Error("x"); } }], { log() {}, warn() {} });
		await done;
		assert.deepStrictEqual(progress.map((p) => [p.name, p.state, p.msg]), [["a", "done", "ok"], ["b", "fail", "x"]]);

		const served = [];
		const passed = [];
		const gate = bootGate(() => new Promise(() => {}), { timeoutMs: 10, page: (req) => served.push(req.path) });
		const req = (path, type) => ({ path, method: "GET", headers: { accept: type === "html" ? "text/html" : "application/json" } });
		await gate(req("/globe", "html"), {});
		await gate(req("/api/x", "json"), {});
		passed.push("/api/x");
		assert.deepStrictEqual(served, ["/globe"]);
		assert.deepStrictEqual(passed, ["/api/x"]);
	});
});
