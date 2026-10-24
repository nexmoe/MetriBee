#!/usr/bin/env node
// Desktop OAuth: analytics.readonly, PKCE, one loopback callback. Secrets stay in .env.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const { SCOPE } = require("../lib/credentials");
const { oauthPolicy } = require("../lib/supplementalAuth");

function saveRefreshToken(envPath, refreshToken) {
    const original = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
    const line = "GA4_OAUTH_REFRESH_TOKEN=" + JSON.stringify(refreshToken);
    const pattern = /^\s*(?:export\s+)?GA4_OAUTH_REFRESH_TOKEN\s*=.*$/gm;
    const updated = pattern.test(original) ? original.replace(pattern, line)
        : original.replace(/\s*$/, "\n") + line + "\n";
    const dir = path.join(path.dirname(envPath), ".cache");
    fs.mkdirSync(dir, { recursive: true });
    const temporary = path.join(dir, "oauth-env-" + crypto.randomBytes(12).toString("hex"));
    try {
        fs.writeFileSync(temporary, updated, { mode: 0o600, flag: "wx" });
        fs.renameSync(temporary, envPath);
    } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
}

async function startAuthorization({ clientId, clientSecret, envPath, timeoutMs = 600000,
    OAuthClient = OAuth2Client }) {
    const state = crypto.randomBytes(32).toString("hex");
    const client = new OAuthClient({ clientId, clientSecret });
    const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
    let resolve, reject, timer, consumed = false, expired = false;
    const completed = new Promise((ok, fail) => { resolve = ok; reject = fail; });
    // The caller attaches its own handler after receiving the authorization URL.
    completed.catch(() => {});
    const server = http.createServer(async (request, response) => {
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Referrer-Policy", "no-referrer");
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
        let url;
        try { url = new URL(request.url, "http://127.0.0.1"); }
        catch { response.writeHead(400).end("Invalid request."); return; }
        if (request.method !== "GET" || url.pathname !== "/oauth2callback") {
            response.writeHead(404).end("Not found.");
            return;
        }
        if (url.searchParams.get("state") !== state || consumed) {
            response.writeHead(400).end("Invalid authorization state.");
            return;
        }
        const code = url.searchParams.get("code");
        if (url.searchParams.has("error") || !code) {
            response.writeHead(400).end("Google authorization was not granted.");
            close();
            reject(new Error("Google authorization was not granted."));
            return;
        }
        consumed = true;
        try {
            const { tokens } = await client.getToken({ code, codeVerifier, redirect_uri: redirectUri });
            if (!tokens.access_token || !tokens.refresh_token) throw new Error("Missing tokens.");
            const info = await client.getTokenInfo(tokens.access_token);
            if (!info.scopes?.includes(SCOPE) || info.scopes.some((s) => s !== SCOPE)) {
                throw new Error("Unexpected OAuth scope.");
            }
            if (expired) throw new Error("Authorization expired.");
            saveRefreshToken(envPath, tokens.refresh_token);
            response.end("Google Analytics read-only access saved locally. You can close this page.");
            close();
            resolve();
        } catch {
            // Never log Google errors: they can contain authorization codes or tokens.
            response.writeHead(400).end("Authorization could not be saved. Return to the terminal.");
            close();
            reject(new Error("OAuth failed; no credentials were saved. Check the client and read-only scope."));
        }
    });
    const close = () => {
        clearTimeout(timer);
        server.close();
    };
    server.requestTimeout = 15000;
    await new Promise((ok, fail) => {
        server.once("error", fail);
        server.listen(0, "127.0.0.1", ok);
    });
    const redirectUri = "http://127.0.0.1:" + server.address().port + "/oauth2callback";
    const url = client.generateAuthUrl({
        redirect_uri: redirectUri,
        access_type: "offline",
        prompt: "consent",
        scope: [SCOPE],
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        include_granted_scopes: false,
    });
    timer = setTimeout(() => {
        expired = true;
        close();
        reject(new Error("OAuth login timed out. No credentials were saved."));
    }, timeoutMs);
    return { url, completed, close };
}

async function main() {
    if (process.argv.includes("--help")) {
        console.log("node scripts/oauth-login.js\nSet GA4_OAUTH_CLIENT_ID, GA4_OAUTH_CLIENT_SECRET, GA4_OAUTH_ACCOUNT_IDS and GA4_OAUTH_PROPERTY_IDS in .env first.\nUses a Desktop OAuth client, requests only analytics.readonly, and saves the refresh token to .env (0600).");
        return;
    }
    const envPath = path.join(__dirname, "..", ".env");
    require("dotenv").config({ path: envPath });
    const clientId = process.env.GA4_OAUTH_CLIENT_ID?.trim();
    const clientSecret = process.env.GA4_OAUTH_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) throw new Error("Set the Desktop OAuth client ID and secret in .env first.");
    const policy = oauthPolicy();
    console.log("Supplemental account IDs: " + policy.accounts.join(", "));
    console.log("Supplemental property IDs: " + policy.properties.join(", "));
    const flow = await startAuthorization({ clientId, clientSecret, envPath });
    console.log("Open in your signed-in browser:\n" + flow.url);
    await flow.completed;
    console.log("Read-only OAuth connected. Restart the dashboard and refresh its property cache.");
}

if (require.main === module) main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});

module.exports = { startAuthorization, saveRefreshToken };
