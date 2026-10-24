#!/usr/bin/env node
/* pnpm setup:check. Same check as the /setup page, one line per step.
   Exit codes: 0 connected, 1 env missing, 2 key rejected, 3 zero properties, 4 GA4 request failed. */
process.noDeprecation = true; // keep output to the check lines (punycode warning from a dependency)
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { checkSetup } = require("../lib/setupCheck");

const ok = (s) => console.log(`[ok]   ${s}`);
const fail = (s) => console.log(`[fail] ${s}`);
const info = (s) => console.log(`       ${s}`);

function details(r) {
	if (r.hint) info(r.hint);
	if (r.error) info(`error: ${r.error}`);
	if (r.link) info(`link: ${r.link}`);
}

(async () => {
	const r = await checkSetup({ fresh: true });

	if (!r.envFound) {
		fail(`.env is missing ${(r.missing || []).join(" and ")}`);
		details(r);
		process.exit(1);
	}
	ok(".env has GA4_CLIENT_EMAIL and GA4_PRIVATE_KEY");

	if (!r.keyAccepted) {
		fail(`key rejected by Google for ${r.clientEmail}`);
		details(r);
		process.exit(2);
	}
	ok(`key accepted by Google for ${r.clientEmail}`);

	if (r.propertyCount === null) {
		fail("GA4 access check failed");
		details(r);
		process.exit(4);
	}
	if (r.propertyCount === 0) {
		fail("GA4 access: 0 properties visible");
		info(`Client email: ${r.clientEmail}`);
		info("Add it as Viewer in GA4 Admin, Account access management, then run pnpm setup:check again.");
		info(`link: ${r.link}`);
		process.exit(3);
	}
	ok(`GA4 access: ${r.propertyCount} ${r.propertyCount === 1 ? "property" : "properties"} in ${r.accountCount} ${r.accountCount === 1 ? "account" : "accounts"}`);
	console.log("Connected.");
	process.exit(0);
})().catch((err) => {
	fail(err.message);
	process.exit(4);
});
