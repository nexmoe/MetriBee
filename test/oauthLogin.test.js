const { expect } = require("chai");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { startAuthorization } = require("../scripts/oauth-login");
const { SCOPE } = require("../lib/credentials");

describe("local read-only Google OAuth callback", () => {
    let directory, envPath, flow;
    class FakeOAuth {
        async generateCodeVerifierAsync() { return { codeVerifier: "verifier", codeChallenge: "challenge" }; }
        generateAuthUrl(options) { return "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams(options); }
        async getToken({ codeVerifier }) {
            expect(codeVerifier).to.equal("verifier");
            return { tokens: { access_token: "test-access", refresh_token: "test-refresh" } };
        }
        async getTokenInfo() { return { scopes: [SCOPE] }; }
    }
    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), "ga4-oauth-test-"));
        envPath = path.join(directory, ".env");
        fs.writeFileSync(envPath, "HOST=127.0.0.1\nGA4_PRIVATE_KEY=\"existing-key\"\n");
    });
    afterEach(() => {
        flow?.close();
        fs.rmSync(directory, { recursive: true, force: true });
    });
    const start = (OAuthClient = FakeOAuth) => startAuthorization({
        clientId: "test-id", clientSecret: "test-secret", envPath, timeoutMs: 5000, OAuthClient,
    });
    function callback(flow, state) {
        const url = new URL(flow.url);
        const callback = new URL(url.searchParams.get("redirect_uri"));
        callback.searchParams.set("code", "test-code");
        callback.searchParams.set("state", state || url.searchParams.get("state"));
        return callback;
    }

    it("requests only read access with PKCE and refuses a callback with the wrong state", async () => {
        flow = await start();
        const url = new URL(flow.url);
        expect(url.searchParams.get("scope")).to.equal(SCOPE);
        expect(url.searchParams.get("code_challenge_method")).to.equal("S256");
        expect(url.searchParams.get("include_granted_scopes")).to.equal("false");
        expect((await fetch(callback(flow, "wrong-state"))).status).to.equal(400);
        expect(fs.readFileSync(envPath, "utf8")).to.not.include("REFRESH_TOKEN");
        expect((await fetch(callback(flow))).status).to.equal(200);
        await flow.completed;
        expect(fs.readFileSync(envPath, "utf8")).to.include('GA4_PRIVATE_KEY="existing-key"');
        expect(fs.readFileSync(envPath, "utf8")).to.include('GA4_OAUTH_REFRESH_TOKEN="test-refresh"');
        expect(fs.statSync(envPath).mode & 0o777).to.equal(0o600);
    });

    it("refuses to persist tokens with broader scopes", async () => {
        class BroadOAuth extends FakeOAuth {
            async getTokenInfo() { return { scopes: [SCOPE, "https://www.googleapis.com/auth/analytics.edit"] }; }
        }
        flow = await start(BroadOAuth);
        const result = flow.completed.then(() => null, (error) => error);
        expect((await fetch(callback(flow))).status).to.equal(400);
        expect((await result).message).to.include("no credentials were saved");
        expect(fs.readFileSync(envPath, "utf8")).to.not.include("REFRESH_TOKEN");
    });
});
