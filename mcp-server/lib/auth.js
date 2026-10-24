// Credentials come from the root .env only (GA4_CLIENT_EMAIL, GA4_PRIVATE_KEY), via lib/credentials.js.
const { clientOptions } = require("../../lib/credentials");

function getAuthOptions() {
	return clientOptions();
}

// For REST calls outside the generated GA4 clients (e.g. Indexing API):
// same credentials, but the caller picks the scopes.
function getScopedAuthClient(scopes) {
	const { GoogleAuth } = require("google-auth-library");
	const auth = new GoogleAuth({ credentials: clientOptions().credentials, scopes });
	return auth.getClient();
}

module.exports = { getAuthOptions, getScopedAuthClient };
