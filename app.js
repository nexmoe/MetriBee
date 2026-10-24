// TypeScript support for controllers/*.ts in dev. Must run before any .ts file is required.
// The Docker image compiles them to .js and ships without ts-node.
try {
	require('ts-node').register({ transpileOnly: true, files: true });
} catch (err) {
	if (err.code !== 'MODULE_NOT_FOUND') throw err;
}

const express = require('express');
const exphbs = require('express-handlebars');
const cors = require('cors');
const path = require('path');

require('dotenv').config();
const log = require('./lib/log');


/* Express server */
const app = express();

// MCP owns its JSON parser and protocol responses, independently of dashboard setup/boot.
const mcp = require('./mcp-server/lib/http').createMcpEndpoint();
app.use('/mcp', mcp.app);

/* Parsing Middlewares */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── LiveReload middleware (dev only) ──
if (process.env.NODE_ENV === 'development') {
    try {
        const livereload = require('livereload');
        const connectLivereload = require('connect-livereload');

        // Watch frontend files: views (templates) and public (CSS/JS)
        const lrServer = livereload.createServer({
            exts: ['hbs', 'js', 'css', 'scss', 'json'],
            delay: 300,
        });
        lrServer.watch([
            path.join(__dirname, 'views'),
            path.join(__dirname, 'public'),
        ]);
        lrServer.server.on('error', (err) => {
            console.warn('[livereload] Server error:', err.message);
        });

        // Inject livereload script tag into all HTML responses
        app.use(connectLivereload());

        console.log('[livereload] Watching views/ and public/');
    } catch (err) {
        console.warn('[livereload] Not available, run: npm install --save-dev livereload connect-livereload');
    }
}

// Static Files
app.use(express.static('public'));


// logging middleware
// there will be no logging for static file as they are served before setting up logging


app.use(log.problems);

if (process.env.NODE_ENV === 'development') {
	app.locals.baseurl = 'http://localhost:5483';
}

// Templating Engine

// const hbs = exphbs.create({extname: 'hbs'});
/*
  If data stored in database is in object format than use json_stringify helper to format it.
	data is sotred in object format when we pass data to the template and use it in the template.
	ex: {{{json_stringify data}}}

For stringified data stored in db use triple stash to auto parse it by handlebars.
	data is stored is string format when data is not used in template logic.
	ex: {{{data}}}
*/

app.engine('hbs', exphbs.engine({
	extname: 'hbs',
	helpers: {
		json_stringify: function (context) {
			// Escape < so a value holding </script> cannot close the inline script tag
			return JSON.stringify(context).replace(/</g, '\\u003c');
		},
		json_parse: function (context) {
			return JSON.parse(context);
		},
		currentYear: function () {
			return new Date().getFullYear();
		}
	}
}));
app.set('view engine', 'hbs');

// ── Setup gate ──
// Credentials come from .env only (lib/credentials.js). Until GA4_CLIENT_EMAIL and GA4_PRIVATE_KEY
// are set (or DEMO=1), pages redirect to /setup and /api/* answers 503 not_configured.
const { isConfigured, resetClients } = require('./controllers/ga4Service');
const setup = require('./lib/setupCheck');
setup.onCredentialsChange(resetClients);
// Boot runs after listen; when credentials arrive later through /setup, it runs once more.
const { runBoot, bootGate } = require('./lib/boot');
let bootState = null;
let bootWarmPending = false;
setup.onCredentialsChange(() => { if (bootState?.waiting && isConfigured()) startBoot(); });
const SETUP_DOC = require('./lib/setupDoc').loadSetupDoc();
const { version: APP_VERSION } = require('./package.json');
const DOCKER_IMAGE = 'ghcr.io/thetechbasket/ga4-dashboard:latest';
// Screenshot per manual step (public/img/setup/*.webp), by step index; redacted placeholder values only
const STEP_SHOTS = { 0: ['s1-project', 'New Project form'], 1: ['s2-enable-api', 'Google Analytics Data API page with the Enable button'], 2: ['s3-service-account', 'Create service account form'], 3: ['s4-keys', 'Keys tab with the Add key menu open'], 6: ['s7-viewer', 'GA4 Add roles panel with Viewer selected'] };

// Navbar: page title and active icon from the path (views/partials/navbar.hbs)
const NAV_PAGES = { '/': 'Dashboard', '/globe': 'Globe', '/analytics': 'Analytics', '/journeys': 'Journeys', '/analytics/pages': 'Pages', '/retention': 'Retention', '/events': 'Events', '/sites': 'Sites', '/setup': 'Setup' };
app.use((req, res, next) => {
	const title = NAV_PAGES[req.path] || '';
	res.locals.nav = { title, dash: title === 'Dashboard', globe: title === 'Globe', analyticsMain: title === 'Analytics', journeys: title === 'Journeys', pages: title === 'Pages', analytics: title === 'Journeys' || title === 'Pages' || title === 'Analytics' || title === 'Events' || title === 'Retention', retention: title === 'Retention', events: title === 'Events', sites: title === 'Sites' };
	next();
});

app.get('/healthz', (req, res) => res.json({ ok: true, version: APP_VERSION }));

app.get('/api/setup/status', async (req, res) => {
	res.set('Cache-Control', 'no-store');
	try {
		res.json(await setup.checkSetup());
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

app.get(['/setup', /^\/(?:de|fr|zh|es|pl|it|ko|pt|ja|cs|uk)\/setup\/?$/], require('./controllers/workspace').workspaceView);
app.get('/api/setup/instructions', (req, res) => {
	// Docker: the host folder is unknown and pnpm is not there, so show docker commands
	const docker = !!process.env.IN_DOCKER;
	const mcpUrl = process.env.MCP_PUBLIC_URL || `${req.protocol}://${req.get('host')}/mcp`;
	const mcpCommand = "claude mcp add ga4 --transport http --scope project '" + mcpUrl.replace(/'/g, "'\\''") + "'";
	const mcpPrompt = SETUP_DOC.mcp.replace('claude mcp add ga4 --transport http --scope project <MCP URL>', mcpCommand).split('<MCP URL>').join(mcpUrl);
	res.json({
		head: { title: 'GA4 Dashboard · Setup', description: 'Connect Google Analytics and use it with AI', image: '', url: '' },
		prompt: SETUP_DOC.prompt,
		manual: SETUP_DOC.manual.map((m, i) => ({
			html: docker ? m.split('pnpm setup:check').join('docker compose up -d, then docker compose exec dashboard node scripts/setup-check.js') : m,
			shot: STEP_SHOTS[i]?.[0], alt: STEP_SHOTS[i]?.[1],
		})),
		mcpPrompt,
		mcp: {
			url: mcpUrl,
			transport: 'Streamable HTTP',
			clientConfig: JSON.stringify({ mcpServers: { ga4: { type: 'http', url: mcpUrl } } }, null, 2),
			claudeCommand: mcpCommand,
			features: SETUP_DOC.mcpFeatures,
			verify: SETUP_DOC.mcpVerify,
		},
		gsc: SETUP_DOC.gsc,
		oauth: SETUP_DOC.oauth,
		psi: !!process.env.PSI_API_KEY,
		gaAdminUrl: setup.GA4_ADMIN_URL,
		projectDir: __dirname,
		docker,
		dockerImage: DOCKER_IMAGE,
	});
});

app.use((req, res, next) => {
	if (isConfigured()) return next();
	setup.syncEnvFile(); // .env may have been written since startup
	if (isConfigured()) return next();
	if (req.path.startsWith('/api/') || req.method !== 'GET') return res.status(503).json({ error: 'not_configured' });
	res.redirect('/setup');
});

// First boot: pages show a live progress page, API requests wait (max 30 s) until the warm step ends.
app.get('/api/boot/status', (req, res) => {
	res.json({ ready: !bootWarmPending, steps: bootState?.progress || [] });
});
app.use(bootGate(() => (bootWarmPending ? bootState.warm : null), {
	page: (req, res) => res.set('Cache-Control', 'no-store').render('booting', { layout: false, steps: bootState?.progress || [] }),
}));

/* Routes */
const apiroutes = require("./routes/apiRoutes.js");

/* using Routes
https://expressjs.com/en/guide/routing.html
	- Actual link of routes have prefix used below
*/

// for image creation api
app.use("/", apiroutes);

// Demo mode (DEMO=1): generated data, no Google credentials. Views show a "Demo data" badge.
app.locals.demo = require('./controllers/demoData').enabled();

/* Express Server Listening */
const port = process.env.PORT || 5483;
const host = process.env.HOST || '127.0.0.1';
const httpServer = app.listen(port, host, () => {
	const dev = process.env.NODE_ENV === 'development';
	log.banner({
		name: 'GA4 Dashboard',
		version: APP_VERSION,
		url: `http://localhost:${port}`,
		mode: app.locals.demo ? { label: 'demo', style: 'yellow' } : dev ? { label: 'development', style: 'magenta' } : { label: 'production', style: 'green' },
		links: [['Dashboard', '/'], ['Globe', '/globe'], ['Analytics', '/analytics'], ['Sites', '/sites'], ['Setup', '/setup'], ['MCP', '/mcp'], ['Health', '/healthz']],
		notes: [
			app.locals.demo && 'Demo mode: generated data, no GA4 calls',
			!app.locals.demo && !isConfigured() && 'GA4 credentials missing: open /setup',
		].filter(Boolean),
	});

	// Load the bundled country list into memory
	const { warmCountriesCache } = require('./controllers/countriesCache');
	warmCountriesCache();

	// ── Clean up old report cache files (async, non-blocking) ──
	const { cacheCleanup } = require('./controllers/reportCache');

	// Immediate startup cleanup
	cacheCleanup().then(cleaned => {
		if (cleaned > 0) {
			console.log(`[cache] Cleaned ${cleaned} stale report file(s)`);
		}
	}).catch(() => {});

	// Periodic cleanup every 6 hours for long-running servers
	setInterval(() => {
		cacheCleanup().catch(() => {});
	}, 6 * 60 * 60 * 1000);

	startBoot();
});
httpServer.on('close', () => mcp.close().catch((err) => console.error('[mcp] Shutdown failed:', err.message)));

// ── Boot sequence: one numbered line per step (lib/boot.js) ──
// `node app.js --refresh-cache` (and demo mode) refetch the properties list instead of reading the cache.
function startBoot() {
	const api = require('./controllers/apiController');
	const nf = (n) => Number(n).toLocaleString('en-US');
	const state = { waiting: false };
	const steps = [
		{ name: 'config', run: () => {
			if (app.locals.demo) return 'demo mode, generated data';
			if (!isConfigured()) { state.waiting = true; return { msg: 'GA4 credentials missing, waiting for setup (open /setup)', stop: true }; }
			return 'GA4 credentials from .env';
		} },
		{ name: 'properties', run: async () => {
			const force = app.locals.demo || process.argv.includes('--refresh-cache');
			const { properties, source } = await api.ensureProperties({ force });
			return `${properties.length} properties, ${source}`;
		} },
		{ name: 'warm', run: async () => {
			const globe = await api.warmGlobeUsers();
			return globe === 'cached' ? 'globe users cached' : `globe users fetched, ${nf(globe)} active`;
		} },
		{ name: 'live', run: async () => {
			const live = await api.warmRealtime();
			return live === 'cached' ? 'live counts cached' : `${nf(live.activeUsers)} active users on ${live.sites} sites`;
		} },
		{ name: 'ready', run: () => `ready in ${((Date.now() - started) / 1000).toFixed(1)} s` },
	];
	const started = Date.now();
	bootWarmPending = true;
	const run = runBoot(steps, { gateAfter: 3 });
	bootState = Object.assign(state, run);
	run.warm.then(() => { bootWarmPending = false; });
	run.done.then(() => { if (!state.waiting && !app.locals.demo) startQuotaLog(); });
}

// ── Quota line: shared ledger (lib/quotaLedger.js), after boot, then every 5 min when tokens were spent ──
let quotaTimer = null;
const quotaSeen = new Set();
async function printQuota(always) {
	const qc = require('./lib/quotaConsole');
	const spent = qc.takeSpent();
	if (!always && !Object.values(spent).some((v) => v > 0)) return;
	const { properties } = await require('./controllers/apiController').ensureProperties();
	const names = Object.fromEntries(properties.map((p) => [String(p.id), p.site || p.domain || String(p.id)]));
	const entries = require('./lib/quotaLedger').list();
	const lines = qc.quotaLines(entries, { names, spent });
	if (!lines.length) console.log('[quota] no GA4 calls in the last hour');
	lines.forEach((l) => console.log(`[quota] ${l}`));
	qc.quotaWarnings(entries, quotaSeen, { names }).forEach((w) => console.warn(`[quota] ${w}`));
}
function startQuotaLog() {
	printQuota(true).catch((err) => console.error('[quota] Line failed:', err.message));
	if (quotaTimer) return;
	quotaTimer = setInterval(() => printQuota(false).catch(() => {}), 5 * 60 * 1000);
	quotaTimer.unref();
}
