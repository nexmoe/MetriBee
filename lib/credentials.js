/**
 * GA4 service-account credentials, from env only (root .env, loaded by the caller).
 * GA4_CLIENT_EMAIL and GA4_PRIVATE_KEY. A literal "\n" in the key becomes a newline,
 * so the key can sit on one line in .env. Used by the app, the MCP server and setup:check.
 */
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

/** `docker run --env-file` keeps quotes as part of the value, so drop one wrapping pair. */
const unquote = (v) => {
	const s = (v || "").trim();
	return s.length > 1 && (s[0] === '"' || s[0] === "'") && s.at(-1) === s[0] ? s.slice(1, -1) : s;
};

function getCredentials(env = process.env) {
	const client_email = unquote(env.GA4_CLIENT_EMAIL);
	const private_key = unquote(env.GA4_PRIVATE_KEY).replace(/\\n/g, "\n").trim();
	if (!client_email || !private_key) return null;
	return { client_email, private_key };
}

/** Options for the generated GA4 clients (Data, Admin). Throws when env is missing. */
function clientOptions(env = process.env) {
	const credentials = getCredentials(env);
	if (!credentials) {
		throw new Error("GA4 credentials missing: set GA4_CLIENT_EMAIL and GA4_PRIVATE_KEY in .env (see SETUP.md).");
	}
	return { credentials, scopes: [SCOPE] };
}

module.exports = { getCredentials, clientOptions, SCOPE };
