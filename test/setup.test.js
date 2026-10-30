const { expect } = require("chai");
const { spawn } = require("child_process");
const fs = require("node:fs");
const path = require("path");
const { getCredentials, clientOptions } = require("../lib/credentials");
const { checkSetup } = require("../lib/setupCheck");
const { parseSetupDoc, loadSetupDoc } = require("../lib/setupDoc");

describe("credentials from env", () => {
    it("turns \\n sequences into newlines and trims the email", () => {
        const c = getCredentials({ GA4_CLIENT_EMAIL: " a@b.iam.gserviceaccount.com ", GA4_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n" });
        expect(c.client_email).to.equal("a@b.iam.gserviceaccount.com");
        expect(c.private_key).to.equal("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----");
    });
    it("keeps real newlines as they are", () => {
        expect(getCredentials({ GA4_CLIENT_EMAIL: "a@b", GA4_PRIVATE_KEY: "x\ny" }).private_key).to.equal("x\ny");
    });
    it("drops one pair of wrapping quotes (docker run --env-file keeps them)", () => {
        const c = getCredentials({ GA4_CLIENT_EMAIL: "'a@b'", GA4_PRIVATE_KEY: '"-----BEGIN PRIVATE KEY-----\\nabc\\n"' });
        expect(c.client_email).to.equal("a@b");
        expect(c.private_key).to.equal("-----BEGIN PRIVATE KEY-----\nabc");
    });
    it("returns null when either value is missing or blank", () => {
        expect(getCredentials({})).to.equal(null);
        expect(getCredentials({ GA4_CLIENT_EMAIL: "a@b" })).to.equal(null);
        expect(getCredentials({ GA4_CLIENT_EMAIL: "  ", GA4_PRIVATE_KEY: "k" })).to.equal(null);
    });
    it("clientOptions throws without env", () => {
        expect(() => clientOptions({})).to.throw();
    });
});

describe("checkSetup", () => {
    it("reports envFound false and both missing keys for an empty env", async () => {
        const r = await checkSetup({ env: {} });
        expect(r.envFound).to.equal(false);
        expect(r.keyAccepted).to.equal(false);
        expect(r.propertyCount).to.equal(null);
        expect(r.missing).to.deep.equal(["GA4_CLIENT_EMAIL", "GA4_PRIVATE_KEY"]);
        expect(r.hint).to.be.a("string");
    });
});

describe("SETUP.md blocks", () => {
    it("parses prompt, manual steps and MCP prompt without fences", () => {
        const d = loadSetupDoc();
        expect(d.prompt).to.match(/^Set up Google Analytics/);
        expect(d.prompt).to.not.include("```");
        expect(d.manual.length).to.be.greaterThan(3);
        expect(d.mcp).to.include("--scope project");
        expect(d.mcp).to.include("--transport http");
        expect(d.mcp).to.not.include("Server command:");
        expect(d.mcpFeatures.join(" ")).to.include("ga4://capabilities");
        expect(d.mcpVerify.join(" ")).to.include("get_setup_status");
        expect(d.gsc.join(" ")).to.include("GSC_CLIENT_EMAIL");
        expect(d.gsc.join(" ")).to.include("get_search_console_report");
        expect(d.oauth).to.have.length(5);
        expect(d.oauth[3]).to.include("refresh token");
    });
    it("escapes HTML in manual steps and keeps https links", () => {
        const d = parseSetupDoc("<!-- manual:start -->\n1. Open [x](https://e.com) <b>\n<!-- manual:end -->");
        expect(d.manual[0]).to.equal('Open <a href="https://e.com" target="_blank" rel="noopener">x</a> &lt;b&gt;');
    });

    it("turns **bold** and `code` into tags", () => {
        const d = parseSetupDoc("<!-- manual:start -->\n1. **Fill .env.** Run `pnpm setup:check`\n<!-- manual:end -->");
        expect(d.manual[0]).to.equal("<b>Fill .env.</b> Run <code>pnpm setup:check</code>");
    });

    it("preserves indented instructions and escapes optional connection steps", () => {
        const d = parseSetupDoc("<!-- oauth:start -->\n1. Set `GA4_OAUTH_ACCOUNT_IDS`.\n   Only these IDs use OAuth. <script>\n2. Run the login command.\n<!-- oauth:end -->");
        expect(d.oauth).to.deep.equal([
            "Set <code>GA4_OAUTH_ACCOUNT_IDS</code>. Only these IDs use OAuth. &lt;script&gt;",
            "Run the login command.",
        ]);
    });

    it("keeps unavailable document sections empty", () => {
        const d = loadSetupDoc(path.join(__dirname, "missing-setup-document.md"));
        expect(d).to.deep.equal({ prompt: "", manual: [], mcp: "", mcpFeatures: [], mcpVerify: [], gsc: [], oauth: [] });
    });
});

// Boots the app with blank credentials (shell values win over .env) and checks the gate.
describe("setup gate (not configured)", function () {
    this.timeout(30000);
    const port = 3990 + Math.floor(Math.random() * 9);
    const base = `http://localhost:${port}`;
    let app, cookie, temporary;
    const networkFetch=globalThis.fetch;
    const fetch=(url,options={})=>networkFetch(url,{...options,headers:{origin:base,...(cookie?{cookie}:{}),...options.headers}});

    before(async () => {
        temporary=await require('node:fs/promises').mkdtemp(path.join(require('node:os').tmpdir(),'metribee-setup-http-'));
        app = spawn("sh", ["docker-entrypoint.sh", process.execPath, "app.js"], {
            cwd: path.join(__dirname, ".."),
            env: { ...process.env, DEMO: "", GA4_CLIENT_EMAIL: "", GA4_PRIVATE_KEY: "", MCP_PUBLIC_URL: "", DATABASE_PATH:path.join(temporary,"setup.sqlite"),BASE_URL:base, PORT: String(port) },
            stdio: "ignore",
        });
        for (let i = 0; i < 100; i++) {
            try { if ((await networkFetch(`${base}/healthz`)).ok) {
                const signup=await networkFetch(`${base}/api/auth/sign-up/email`,{method:'POST',headers:{'Content-Type':'application/json',origin:base},body:JSON.stringify({email:'setup@example.com',password:'setup-password',name:'Setup'})});
                cookie=signup.headers.getSetCookie()[0].split(';')[0];return;
            } } catch { /* not up yet */ }
            await new Promise((r) => setTimeout(r, 200));
        }
        throw new Error("server did not start");
    });
    after(async () => { if(app)app.kill(); await require('node:fs/promises').rm(temporary,{recursive:true,force:true}); });

    it("/healthz answers ok with the package version", async () => {
        const j = await (await fetch(`${base}/healthz`)).json();
        expect(j).to.deep.equal({ ok: true, version: require("../package.json").version });
    });
    it("blocks stale source archives before static serving and the setup gate", async () => {
        const archive = path.join(__dirname, "../public/ui-source.tar.gz");
        let created = false;
        try {
            fs.writeFileSync(archive, "stale source archive", { flag: "wx" });
            created = true;
        } catch (err) {
            if (err.code !== "EEXIST") throw err;
        }
        try {
            for (const url of ["/ui-source.tar.gz", "/ui-source.tar.gz?download=1", "/ui-source%2Etar.gz", "/%2E%2Fui-source.tar.gz", "/UI-SOURCE.TAR.GZ/"]) {
                for (const method of ["GET", "HEAD"]) {
                    const res = await fetch(base + url, { method, redirect: "manual" });
                    expect(res.status, `${method} ${url}`).to.equal(404);
                    expect(res.headers.get("cache-control")).to.equal("no-store");
                    expect(await res.text()).not.to.include("stale source archive");
                }
            }
        } finally {
            if (created) fs.unlinkSync(archive);
        }
    });
    it("serves Streamable HTTP MCP before the setup gate", async () => {
        const res = await fetch(`${base}/api/mcp`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        });
        expect(res.status).to.equal(200);
        expect(res.headers.get("content-type")).to.include("text/event-stream");
        expect(await res.text()).to.include("get_account_summaries");
    });
    it("blocks retired draft and source paths before the setup gate", async () => {
        for (const url of ["/bee-drafts", "/bee-drafts/", "/bee-drafts/v1.svg", "/bee%2Ddrafts/v2.svg", "/css/main.scss"]) {
            const res = await fetch(base + url, { redirect: "manual" });
            expect(res.status, url).to.equal(404);
            expect(res.headers.get("cache-control"), url).to.equal("no-store");
        }
        const asset = await fetch(`${base}/metribee/mark.svg`);
        expect(asset.status).to.equal(200);
        expect(asset.headers.get("content-type")).to.include("image/svg+xml");
    });
    it("keeps setup instructions focused on data sources", async () => {
        const instructions = await (await fetch(`${base}/api/setup/instructions`)).json();
        expect(instructions).not.to.have.property("projectDir");
        expect(instructions).not.to.have.property("mcp");
        expect(instructions).not.to.have.property("mcpPrompt");
        const doc = loadSetupDoc();
        expect(instructions.prompt).to.equal(doc.prompt);
        expect(instructions.manual).to.deep.equal(doc.manual.map(html => ({ html })));
        expect(instructions.gsc).to.deep.equal(doc.gsc);
        expect(instructions.oauth).to.deep.equal(doc.oauth);
    });
    it("pages redirect to /setup", async () => {
        for (const p of ["/", "/globe", "/analytics"]) {
            const res = await fetch(base + p, { redirect: "manual" });
            expect(res.status, p).to.equal(302);
            expect(res.headers.get("location"), p).to.equal("/setup");
        }
    });
    it("/api/* answers 503 not_configured", async () => {
        const res = await fetch(`${base}/api/quota`);
        expect(res.status).to.equal(503);
        expect(await res.json()).to.deep.equal({ error: "not_configured" });
    });
    it("/setup renders and the status endpoint reports env missing", async () => {
        const html = await (await fetch(`${base}/setup`)).text();
        expect(html).to.include("Connect Google Analytics");
        expect(html).to.include('id="ai"');
        const s = await (await fetch(`${base}/api/setup/status`)).json();
        expect(s.envFound).to.equal(false);
    });
});
