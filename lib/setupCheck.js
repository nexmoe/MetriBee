/**
 * Setup check shared by /api/setup/status, the /setup page and `pnpm setup:check`.
 * Steps: env present, Google accepts the key (token mint), account summaries list properties.
 * Never returns or logs the private key.
 */
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { getCredentials, SCOPE } = require("./credentials");
const { OAUTH_KEYS, createAdminClient } = require("./supplementalAuth");

const ENV_PATH = path.join(__dirname, "..", ".env");
const KEYS = ["GA4_CLIENT_EMAIL", "GA4_PRIVATE_KEY"];
const SYNC_KEYS = [...KEYS, ...OAUTH_KEYS, ...require('../controllers/searchConsole').GSC_KEYS];
const CACHE_MS = 3000;
const TIMEOUT_MS = 15000;
const GA4_ADMIN_URL = "https://analytics.google.com/analytics/web/#/admin";

/* ── .env reload ──
   The server may start before the agent writes .env. Each check re-reads the file and adopts the
   two GA4 values when the process did not get them from its own environment. A value that came
   from the file can be replaced by a newer one from the file; a value set in the shell never is. */
const fromFile = {};
(function seed() {
	const file = readEnvFile();
	for (const k of SYNC_KEYS) if (process.env[k] !== undefined && process.env[k] === file[k]) fromFile[k] = true;
})();

function readEnvFile(envPath = ENV_PATH) {
	try {
		return dotenv.parse(fs.readFileSync(envPath));
	} catch {
		return {};
	}
}

const listeners = [];
/** Register a callback that runs when the GA4 values in process.env change (e.g. drop cached clients). */
function onCredentialsChange(fn) {
	listeners.push(fn);
}

/** Re-read .env and apply changed GA4 values. Returns true when something changed. */
function syncEnvFile(envPath = ENV_PATH) {
	const file = readEnvFile(envPath);
	let changed = false;
	for (const k of SYNC_KEYS) {
		const own = process.env[k] !== undefined && !fromFile[k];
		if (own || file[k] === undefined || file[k] === process.env[k]) continue;
		process.env[k] = file[k];
		fromFile[k] = true;
		changed = true;
	}
	if (changed) {
		cached = null;
		listeners.forEach((fn) => fn());
	}
	return changed;
}

/* ── Error to plain hint ── */
function explain(err) {
	const msg = String((err && (err.message || err.details)) || err || "");
	const first = msg.split("\n")[0].slice(0, 400);
	const link = (msg.match(/https:\/\/console\.(?:developers|cloud)\.google\.com\/apis\/api\/[^\s"')]+/) || [])[0] || null;
	let hint;
	if (/disableServiceAccountKeyCreation|constraints\/iam/i.test(msg)) {
		hint = "Your organization blocks service account key creation (iam.disableServiceAccountKeyCreation). Use a Google Cloud project outside the organization, or ask an org admin to allow keys for this project.";
	} else if (/invalid_grant/i.test(msg)) {
		hint = "Google rejected the key (invalid_grant). The key was deleted, or it does not belong to GA4_CLIENT_EMAIL. Create a new JSON key for the service account and update both values in .env. Also check that the system clock is correct.";
	} else if (/has not been used|SERVICE_DISABLED|is disabled|accessNotConfigured/i.test(msg)) {
		hint = `The Google Analytics Admin API or Data API is not enabled for this Cloud project. Enable both${link ? " (link below)" : ""}, wait a minute, then check again.`;
	} else if (/DECODER|PEM|asymmetric|private key|no start line|bad base64|unsupported|invalid key|secretOrPrivateKey/i.test(msg)) {
		hint = "GA4_PRIVATE_KEY is not a valid key. Copy private_key from the JSON key file, keep it in double quotes with the \\n sequences exactly as in the file, then save .env.";
	} else if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|timed out/i.test(msg)) {
		hint = "Could not reach Google. Check the network connection, then check again.";
	} else if (/PERMISSION_DENIED|403/i.test(msg)) {
		hint = "Google refused the request (permission denied). Check that both GA4 APIs are enabled and the service account is active.";
	} else {
		hint = "Setup check failed. See the error below.";
	}
	return { error: first || "Unknown error", hint, link };
}

const withTimeout = (p, label) =>
	Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out`)), TIMEOUT_MS).unref())]);

/* ── The check ── */
let cached = null; // { at, promise }

async function runCheck(env) {
	const out = { envFound: false, clientEmail: null, keyAccepted: false, propertyCount: null, accountCount: null, error: null, hint: null, link: null };
	const creds = getCredentials(env);
	if (!creds) {
		out.missing = KEYS.filter((k) => !(env[k] || "").trim());
		out.hint = "GA4_CLIENT_EMAIL and GA4_PRIVATE_KEY are not set in .env. Paste the setup prompt into your AI agent, or follow the manual steps.";
		return out;
	}
	out.envFound = true;
	out.clientEmail = creds.client_email;

	// Step 2: mint a token. Proves the key parses and Google accepts it.
	try {
		const { JWT } = require("google-auth-library");
		const jwt = new JWT({ email: creds.client_email, key: creds.private_key, scopes: [SCOPE] });
		await withTimeout(jwt.authorize(), "Token request");
		out.keyAccepted = true;
	} catch (err) {
		Object.assign(out, explain(err));
		return out;
	}

	// Step 3: list account summaries. Count properties the service account can see.
	let client;
	try {
		client = createAdminClient(env);
		const [summaries] = await withTimeout(client.listAccountSummaries({}), "GA4 Admin request");
		out.accountCount = summaries.length;
		out.propertyCount = summaries.reduce((n, s) => n + (s.propertySummaries || []).length, 0);
		if (out.propertyCount === 0) {
			out.hint = `Add ${creds.client_email} as Viewer in GA4 Admin, Account access management. One grant covers every property in the account.`;
			out.link = GA4_ADMIN_URL;
		}
	} catch (err) {
		Object.assign(out, explain(err));
	} finally {
		if (client) client.close().catch(() => {});
	}
	return out;
}

/**
 * @param {object} [opts]
 * @param {object} [opts.env]   env to check (tests); default: process.env after re-reading .env
 * @param {boolean} [opts.fresh] skip the 3 s cache
 */
async function checkSetup({ env, fresh = false } = {}) {
	if (env) return runCheck(env);
	syncEnvFile();
	if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.promise;
	const promise = runCheck(process.env);
	cached = { at: Date.now(), promise };
	return promise;
}

module.exports = { checkSetup, syncEnvFile, onCredentialsChange, explain, ENV_PATH, GA4_ADMIN_URL };
