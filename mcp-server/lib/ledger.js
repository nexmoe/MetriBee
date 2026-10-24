// Demo MCP queries must never inspect or overwrite the user's live quota ledger.
const demo = require("../../controllers/demoData");
const current = () => require("../../lib/quotaLedger");
const local = {
	record: () => {},
	get: () => null,
	list: () => [],
	status: () => ({ status: "demo", cost: 0 }),
	blocked: () => null,
	block: () => null,
	cooldowns: () => [],
	gcpProject: () => "demo",
};
module.exports = {
	...current(),
	...Object.fromEntries(
		Object.entries(local).map(([name, fallback]) => [name, (...args) => (demo.enabled() ? fallback(...args) : current()[name](...args))]),
	),
};
