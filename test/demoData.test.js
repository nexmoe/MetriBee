const { expect } = require("chai");
const { spawn } = require("child_process");
const path = require("path");

// Boots the real app in demo mode (DEMO=1, no credentials) and checks the endpoints the pages call.
describe("demo mode", function () {
    this.timeout(30000);
    const port = 3900 + Math.floor(Math.random() * 90);
    const base = `http://localhost:${port}`;
    let app, cookie, temporary;
    const networkFetch = globalThis.fetch;
    const fetch = (url, options = {}) => networkFetch(url, { ...options, headers: { origin:base, ...(cookie ? { cookie } : {}), ...options.headers } });
    const get = async (u) => {
        const res = await fetch(base + u);
        expect(res.status, u).to.equal(200);
        return res.headers.get("content-type").includes("json") ? res.json() : res.text();
    };

    before(async () => {
        temporary = await require('node:fs/promises').mkdtemp(path.join(require('node:os').tmpdir(),'metribee-demo-http-'));
        app = spawn("sh", ["docker-entrypoint.sh", process.execPath, "app.js"], {
            cwd: path.join(__dirname, ".."),
            env: { ...process.env, DEMO: "1", DATABASE_PATH:path.join(temporary,"demo.sqlite"), BASE_URL:base, PORT: String(port) },
            stdio: "ignore",
        });
        for (let i = 0; i < 100; i++) {
            try {
                if (!(await networkFetch(`${base}/healthz`)).ok) continue;
                const signup=await networkFetch(`${base}/api/auth/sign-up/email`,{method:'POST',headers:{'Content-Type':'application/json',origin:base},body:JSON.stringify({email:'demo@example.com',password:'demo-password',name:'Demo'})});
                cookie=signup.headers.getSetCookie()[0].split(';')[0];
                const nav = await (await fetch(`${base}/api/nav-index`)).json();
                if (nav.sites?.length) return;
            } catch { /* not up yet */ }
            await new Promise((r) => setTimeout(r, 200));
        }
        throw new Error("demo server did not start");
    });
    after(async () => { if(app)app.kill(); await require('node:fs/promises').rm(temporary,{recursive:true,force:true}); });


    it("renders the three pages with the Demo data badge", async () => {
        for (const p of ["/", "/realtime", "/sites", "/quota", "/analytics/reports", "/globe", "/analytics", "/retention"]) expect(await get(p)).to.include("Demo data");
    });

    it("redirects Sites bookmarks into the homepage without losing the language or parameters", async () => {
        for (const [from, to] of [
            ['/sites', '/?view=status'],
            ['/sites?view=table&prop=311000101', '/?view=table&prop=311000101'],
            ['/zh/sites?view=heat&range=7d', '/zh?view=heatmap&range=7d'],
            ['/en/sites?view=look', '/?view=status'],
        ]) {
            const response = await fetch(base + from, { redirect: 'manual' });
            expect(response.status, from).to.equal(308);
            expect(response.headers.get('location'), from).to.equal(to);
            expect((await fetch(base + from)).status, from).to.equal(200);
        }
    });

    it("demo quota and Sites never expose local private snapshots or quota observations", async () => {
        const quota = await get('/api/quota/status');
        expect(quota.entries).to.deep.equal([]);
        expect(quota.cooldowns).to.deep.equal([]);
        const snapshot = await get('/api/sites-snapshot');
        expect(snapshot.sites).to.deep.equal([]);
        expect(snapshot.generatedAt).to.equal(null);
    });

    it("hard refreshes all three demo quota pools without exposing private observations", async () => {
        const response = await fetch(base + '/api/quota/refresh', { method: 'POST' });
        expect(response.status).to.equal(200);
        const result = await response.json();
        expect(result.refresh.refreshed).to.equal(8);
        expect(result.entries).to.have.length(24);
        expect([...new Set(result.entries.map(entry => entry.pool))].sort()).to.deep.equal(['core', 'funnel', 'realtime']);
        expect(result.entries.every(entry => /^31100010[1-8]$/.test(entry.propertyId))).to.equal(true);
        const stable = entries => entries.map(({ propertyId, pool, at, hourLeft }) => ({ propertyId, pool, at, hourLeft }));
        expect(stable((await get('/api/quota/status')).entries)).to.deep.equal(stable(result.entries));
    });

    it("realtime-all lists 8 fictional properties with live users", async () => {
        let j = await get("/api/realtime-all");
        for (let i = 0; i < 20 && j.cached === false && !j.data?.some((d) => d.activeUsers); i++) {
            await new Promise((r) => setTimeout(r, 300));
            j = await get("/api/realtime-all");
        }
        expect(j.ok).to.equal(true);
        expect(j.data).to.have.length(8);
        for (const d of j.data) {
            expect(d.domain).to.match(/\.example$/);
            expect(d).to.include.keys("propertyId", "siteName", "activeUsers", "pageViews", "series", "accountId", "accountName");
            expect(d.accountId).to.be.a("string").and.not.equal("");
            expect(d.accountName).to.be.a("string").and.not.equal("");
        }
        const total = j.data.reduce((a, d) => a + d.activeUsers, 0);
        expect(total).to.be.within(50, 3000);
    });

    it("globe-users has cities with coordinates, a feed and countries", async () => {
        const j = await get("/api/globe-users");
        expect(j.cities.length).to.be.greaterThan(0);
        expect(j.countries.length).to.be.greaterThan(0);
        expect(j.feed.length).to.be.greaterThan(0);
        expect(j.properties).to.have.length(8);
    });

    it("keeps historical cards in the same accounts on fresh and cached responses", async () => {
        const realtime = await get("/api/realtime-all");
        const accounts = new Map(realtime.data.map(p => [p.propertyId, [p.accountId, p.accountName]]));
        for (let i = 0; i < 2; i++) {
            const cards = await get("/api/home-cards?range=7d");
            expect(cards.data).to.have.length(8);
            for (const property of cards.data) {
                expect([property.accountId, property.accountName]).to.deep.equal(accounts.get(property.propertyId));
            }
        }
    });

    it("spikes flags the spiking property", async () => {
        const j = await get("/api/spikes");
        expect(j.ok).to.equal(true);
        expect(j.spikes.map((s) => s.siteName)).to.include("Pixel Recipes");
    });

    it("analytics card and reports return rows with previous-period values", async () => {
        const card = await get("/api/analytics-card/311000101/traffic-sources?range=28d");
        expect(card.ok).to.equal(true);
        expect(card.rows.length).to.be.greaterThan(3);
        expect(card.rows[0]).to.include.keys("dims", "metrics", "prev");
        const rep = await get("/api/analytics-reports/311000101?range=7d");
        expect(rep.ok).to.equal(true);
        expect(rep.topPages.length).to.be.greaterThan(0);
    });

    it("quota and favicon answer without Google", async () => {
        expect((await get("/api/quota")).quota.tokensPerDay.remaining).to.be.a("number");
        expect(await get("/api/favicon/311000101")).to.include("<svg");
    });

    it('serves native-shaped daily and weekly retention cohorts with weighted averages', async () => {
        for (const bucket of ['day', 'week']) {
            const report = await get(`/api/retention/311000101?range=30d&bucket=${bucket}`);
            expect(report.ok).to.equal(true);
            expect(report.timeZone).to.equal('America/New_York');
            expect(report.summary.totalUsers).to.be.greaterThan(0);
            expect(report.summary.cells[0].rate).to.be.within(0, 1);
            if (bucket === 'day') expect(report.cohorts).to.have.length(30);
            else expect(report.cohorts.length).to.be.within(5, 6);
            expect(report.cohorts.at(-1).cells.every(c => c.users === null)).to.equal(true);
        }
    });

    it("serves geographic and technology reports with matching dimensions and real-shaped session metrics", async () => {
        for (const [type, dimensions] of Object.entries({
            countries: ['country', 'countryId'], regions: ['countryId', 'region'], cities: ['countryId', 'region', 'city'],
            languages: ['languageCode'], browsers: ['browser'], 'operating-systems': ['operatingSystem'], 'screen-resolutions': ['screenResolution'],
        })) {
            const card = await get(`/api/analytics-card/311000101/${type}?range=28d`);
            expect(card.ok, type).to.equal(true);
            expect(card.dimensionHeaders, type).to.deep.equal(dimensions);
            expect(card.metricHeaders[0], type).to.equal('sessions');
            expect(card.rows.length, type).to.be.greaterThan(1);
            expect(card.rows.some(r => r.dims.every(d => d !== '(not set)')), type).to.equal(true);
            expect(card.rows.every(r => r.dims.length === dimensions.length && r.metrics[0] >= 0), type).to.equal(true);
        }
    });
});
