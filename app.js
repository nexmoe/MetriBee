// Fastify is the sole HTTP server. Controllers share GA4 caches and quota guards with MCP.
try {
  require("ts-node").register({ transpileOnly: true, files: true });
} catch (error) {
  if (error.code !== "MODULE_NOT_FOUND") throw error;
}
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const Fastify = require("fastify");
const { getLocale, localeHref, stripLocale } = require("./lib/uiLocale");
const { sitesHomeUrl } = require("./lib/homeViews");
const { storage } = require("./lib/requestContext");
const { createIdentityResolver } = require("./lib/identity");
const { failure } = require("./lib/access");
const { publicPageSite, publicApiSite } = require('./lib/publicDashboard');
const setup = require("./lib/setupCheck");
const { isConfigured, resetClients } = require("./controllers/ga4Service");
const { version } = require("./package.json");
const PUBLIC_ACCOUNT = new Set([
  "/login",
  "/signup",
  "/invitation",
  "/reset-password",
  "/auth/consent",
]);
const ACCOUNT = /^\/(?:settings(?:\/|$)|admin(?:\/|$)|auth\/|transfer\/)/;
const PAGES = new Set([
  "/",
  "/realtime",
  "/analytics",
  "/analytics/pages",
  "/events",
  "/journeys",
  "/retention",
  "/funnels",
  "/goals",
  "/dashboards",
  "/widgets",
  "/property-access",
  "/globe",
  "/quota",
  "/analytics/reports",
  "/setup",
  "/settings",
  "/settings/account",
  "/settings/organization",
  "/settings/teams",
  "/settings/billing",
  "/admin",
]);

async function createApp({ authRuntime, billingOptions, warm = false, logger = false } = {}) {
  const app = Fastify({
    logger,
    bodyLimit: 1024 * 1024,
    trustProxy: process.env.TRUST_PROXY === "true",
  });
  const runtime =
    authRuntime ||
    (await (await import("./lib/auth.mjs")).createAuthentication());
  app.decorate("authRuntime", runtime);
  app.decorate("locals", { demo: require("./controllers/demoData").enabled() });
  app.decorateRequest("path", {
    getter() {
      return this.url.split("?")[0];
    },
  });
  app.decorateRequest("originalUrl", {
    getter() {
      return this.url;
    },
  });
  app.decorateRequest("identity", null);
  app.decorateRequest("sharedProperty", null);
  app.decorateRequest("metricWidget", null);
  const identify = createIdentityResolver(runtime);
  const publicSettings = require('./lib/embedStore').createEmbedStore();
  app.addHook("onRequest", (req, _reply, done) =>
    storage.run({ access: runtime.access, identity: null }, done)
  );
  app.addHook("onRequest", async (req, reply) => {
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(req.path);
    } catch {
      throw failure("Invalid URL encoding.", 400);
    }
    const filename = path.posix
      .normalize(decodedPath)
      .toLowerCase()
      .replace(/\/+$/, "");
    const deploymentPath = stripLocale(decodedPath).replace(/\/+$/, "");
    if (app.billing?.cloud === false && (
      deploymentPath === "/settings/billing" || deploymentPath === "/subscribe" ||
      /^\/api\/rybbit\/(?:billing(?:\/|$)|organizations\/[^/]+\/(?:billing|subscription)(?:\/|$))/.test(deploymentPath)
    ))
      return reply.header("Cache-Control", "no-store").code(404).send({ error: "Page not found" });
    if (
      filename === "/ui-source.tar.gz" ||
      filename === "/css/main.scss" ||
      filename === "/bee-drafts" ||
      filename.startsWith("/bee-drafts/")
    )
      return reply.header("Cache-Control", "no-store").code(404).send();
    if (
      req.routeOptions.config.public ||
      req.path.startsWith("/api/auth/") ||
      req.path === "/healthz" ||
      req.path === "/mcp"
    )
      return;
    if (
      req.method === "GET" &&
      (req.path === "/api/rybbit/favicon" ||
        /^\/api\/flag\/[a-z]{2}$/i.test(req.path))
    )
      return;
    const pathname = stripLocale(req.path).replace(/\/+$/, "") || "/";
    if (PUBLIC_ACCOUNT.has(pathname) || pathname.startsWith("/transfer/"))
      return;
    const sharedPage =
      /^\/(\d+)\/([a-f0-9]{12})\/(main|pages|events|journeys|retention|funnels)$/.exec(
        pathname
      );
    if (sharedPage) return;
    if (/^\/widget\/\d+(?:\/[a-f0-9]{12})?$/.test(req.path)) return;
    if (
      /^\/api\/rybbit\/sites\/\d+\/(?:embed-stats|widgets\/[a-f0-9]{12}\/data)$/.test(
        req.path
      ) &&
      req.method === "GET"
    )
      return;
    if (req.headers["x-private-key"] || req.headers["x-private-site"]) {
      const propertyId = /^\/api\/rybbit\/sites\/(\d+)(?:\/|$)/.exec(
        req.path
      )?.[1];
      if (
        !propertyId ||
        req.headers["x-private-site"] !== propertyId ||
        !(await require("./controllers/embeds").handlers.store.validate(
          propertyId,
          req.headers["x-private-key"]
        ))
      )
        throw failure("Invalid private dashboard link.");
      if (
        req.method !== "GET" &&
        !(req.method === "POST" && /\/funnels\/analyze$/.test(req.path))
      )
        throw failure("Shared dashboards are read-only.");
      if (/\/(?:private-link-config|config|widgets)(?:\/|$)/.test(req.path))
        throw failure("This endpoint requires an authenticated workspace.");
      return;
    }
    req.identity = await identify(req);
    const publicSiteId = req.method === 'GET' && publicPageSite(req.path, req.query) || publicApiSite(req.path, req.method);
    // A public property also opens for signed-in visitors with no property grant.
    // Bearer credentials retain their explicit scope and permission checks.
    if (publicSiteId && !req.identity?.bearer &&
      (!req.identity || !runtime.access.siteRole(req.identity, publicSiteId)) &&
      await publicSettings.isPublic(publicSiteId)) {
      req.identity = null;
      storage.getStore().publicSiteId = publicSiteId;
      reply.header('Cache-Control', 'no-store');
      return;
    }
    if (!req.identity) {
      if (req.path.startsWith("/api/") || req.method !== "GET")
        return reply
          .code(401)
          .header("WWW-Authenticate", "Bearer")
          .send({ error: "authentication_required" });
      const exists = runtime.db.prepare("SELECT 1 FROM user LIMIT 1").get();
      return reply.redirect(
        localeHref(exists ? "/login" : "/signup", getLocale(req.path))
      );
    }
    storage.getStore().identity = req.identity;
    if (
      !req.identity.bearer &&
      !["GET", "HEAD", "OPTIONS"].includes(req.method)
    ) {
      const allowed = new Set(
        runtime.auth.options.trustedOrigins || [runtime.baseURL]
      );
      if (!allowed.has(req.headers.origin))
        throw failure(
          "A trusted Origin is required for session-authenticated changes."
        );
    }
    if (
      req.identity.bearer &&
      req.path.startsWith("/api/") &&
      !/^\/api\/rybbit\/(?:organizations|user|sites)(?:\/|$)/.test(req.path)
    ) {
      const permission =
        req.path === "/api/nav-index" ? "sites:read" : "analytics:read";
      if (!runtime.access.scopeAllows(req.identity, permission))
        throw failure("This credential does not grant this API permission.");
    }
    if (isConfigured() && req.path !== '/api/rybbit/organizations' &&
      !req.path.includes('/billing') && !req.path.endsWith('/subscription') && !ACCOUNT.test(pathname))
      await require("./controllers/apiController").ensureProperties();
    const propertyId =
      req.params.siteId ||
      req.params.propertyId ||
      /^\/api\/rybbit\/sites\/(\d+)/.exec(req.path)?.[1] ||
      /^\/(\d+)(?:\/|$)/.exec(pathname)?.[1] ||
      req.query.prop;
    if (propertyId && !ACCOUNT.test(pathname)) {
      const write = !["GET", "HEAD"].includes(req.method);
      const analysisKind = /\/(segments|annotations|goals|dashboards)(?:\/|$)/.exec(req.path)?.[1];
      const analysisRead = req.method === 'POST' && /\/(?:goals\/preview|dashboards\/run-card)$/.test(req.path);
      const permission = /\/(?:journeys\/sessions|sessions\/bq-[^/]+)$/.test(req.path) ? 'sessions:read' : analysisKind ? `${analysisKind}:${write && !analysisRead ? 'write' : 'read'}` : /\/funnels(?:\/|$)/.test(req.path)
        ? write && !/\/analyze$/.test(req.path)
          ? "funnels:write"
          : "funnels:read"
        : /\/private-link-config(?:\/|$)/.test(req.path)
        ? "sites:configure"
        : /\/(?:widgets|config)(?:\/|$)/.test(req.path)
        ? write
          ? "sites:configure"
          : "sites:read"
        : /\/gsc\//.test(req.path)
        ? "gsc:read"
        : /^\/api\/rybbit\/sites\/\d+\/?$/.test(req.path)
        ? "sites:read"
        : "analytics:read";
      runtime.access.requireSite(req.identity, propertyId, permission);
    }
    if (
      (pathname === "/setup" ||
        req.path.startsWith("/api/setup/") ||
        req.path === "/api/refresh-cache") &&
      (!req.identity.systemAdmin || req.identity.bearer)
    )
      throw failure("System administrator permission is required.");
  });
  await app.register(require("@fastify/formbody"));
  await app.register(require("@fastify/rate-limit"), { global: false });
  const handlebars = require("handlebars").create();
  handlebars.registerHelper({
    json_stringify: (value) => JSON.stringify(value).replace(/</g, "\\u003c"),
    json_parse: JSON.parse,
    currentYear: () => new Date().getFullYear(),
  });
  await app.register(require("@fastify/view"), {
    engine: { handlebars },
    root: path.join(__dirname, "views"),
    viewExt: "hbs",
  });
  await app.register(async (assets) => {
    assets.addHook("onRoute", (options) => {
      options.config = { ...options.config, public: true };
    });
    await assets.register(require("@fastify/static"), {
      root: path.join(__dirname, "public"),
      wildcard: false,
      globIgnore: ["ui/**"],
      index: false,
    });
    // Vite replaces hashed files during watch builds; discover them per request.
    await assets.register(require("@fastify/static"), {
      root: path.join(__dirname, "public/ui"),
      prefix: "/ui/",
      decorateReply: false,
      index: false,
    });
  });
  const endpoint = require("./mcp-server/lib/http").createMcpEndpoint({
    authRuntime: runtime,
  });
  await endpoint.register(app);
  app.addHook("onClose", async () => endpoint.close());
  await require("./routes/accounts").accountRoutes(app, runtime);
  await require("./routes/billing").billingRoutes(app, runtime, billingOptions);
  app.get("/healthz", { config: { public: true } }, async () => ({
    ok: true,
    version,
  }));
  app.get("/api/setup/status", async () => setup.checkSetup());
  const doc = require("./lib/setupDoc").loadSetupDoc();
  app.get("/api/setup/instructions", async () => {
    const docker = !!process.env.IN_DOCKER;
    return {
      head: { title: "MetriBee · Setup" },
      prompt: doc.prompt,
      manual: doc.manual.map((html) => ({ html })),
      gsc: doc.gsc,
      oauth: doc.oauth,
      psi: !!process.env.PSI_API_KEY,
      gaAdminUrl: setup.GA4_ADMIN_URL,
      docker,
      dockerImage: "ghcr.io/nexmoe/metribee:latest",
    };
  });
  let bootState = null,
    pending = false;
  app.get("/api/boot/status", async () => ({
    ready: !pending,
    steps: bootState?.progress || [],
  }));
  app.addHook("preHandler", async (req, reply) => {
    if (
      req.routeOptions.config.public ||
      req.path === "/mcp" ||
      req.path.startsWith("/api/auth/") ||
      req.path.startsWith("/api/rybbit/admin/") ||
      req.path.startsWith("/api/rybbit/user/") ||
      req.path.includes("/organizations/")
      || req.path === '/api/rybbit/organizations'
    )
      return;
    const pathname = stripLocale(req.path).replace(/\/+$/, "") || "/";
    if (
      PUBLIC_ACCOUNT.has(pathname) ||
      ACCOUNT.test(pathname) ||
      pathname === "/setup" ||
      req.path.startsWith("/api/setup/") ||
      req.path === "/api/boot/status"
    )
      return;
    if (!isConfigured()) {
      setup.syncEnvFile();
      if (!isConfigured())
        return req.path.startsWith("/api/")
          ? reply.code(503).send({ error: "not_configured" })
          : reply.redirect(localeHref("/setup", getLocale(req.path)));
    }
    if (pending && bootState?.warm)
      await require("./lib/boot").withTimeout(bootState.warm, 30000);
  });
  await require("./routes/apiRoutes")(app);
  const page = async (req, reply) => {
    const pathname = stripLocale(req.path).replace(/\/+$/, "") || "/";
    if (/^\/en(?:\/|$)/.test(req.path))
      return reply.redirect(
        pathname === "/sites"
          ? sitesHomeUrl(req.originalUrl)
          : localeHref(req.originalUrl, "en"),
        308
      );
    if (pathname === "/sites")
      return reply.redirect(sitesHomeUrl(req.originalUrl), 308);
    if (pathname === "/subscribe") return reply.redirect(localeHref('/settings/billing', getLocale(req.path)));
    const share =
      /^\/(\d+)\/([a-f0-9]{12})\/(main|pages|events|journeys|retention|funnels)$/.exec(
        pathname
      );
    if (share) {
      req.params.siteId = share[1];
      req.params.privateKey = share[2];
      return require("./controllers/embeds").handlers.dashboard(req, reply);
    }
    if (
      PAGES.has(pathname) ||
      PUBLIC_ACCOUNT.has(pathname) ||
      pathname.startsWith("/transfer/") ||
      /^\/dashboards\/[1-9]\d*$/.test(pathname)
      || publicPageSite(req.path, req.query)
    )
      return require("./controllers/workspace").workspaceView(req, reply);
    return reply.code(404).send({ error: "Page not found" });
  };
  app.get("/", page);
  app.get("/*", page);
  app.setErrorHandler((error, _req, reply) => {
    const status = error.statusCode || error.status || 500;
    if (status >= 500) app.log.error(error);
    return reply.code(status).send({
      error: status >= 500 ? "Internal server error" : error.message,
      ...(error.reason ? { reason: error.reason } : {}),
      ...(error.recipientEmailHint
        ? { recipientEmailHint: error.recipientEmailHint }
        : {}),
    });
  });
  app.decorate("startBoot", () => {
    const api = require("./controllers/apiController");
    pending = true;
    bootState = require("./lib/boot").runBoot(
      [
        {
          name: "config",
          run: () =>
            isConfigured()
              ? "GA4 configured"
              : { msg: "GA4 credentials missing; open /setup", stop: true },
        },
        {
          name: "properties",
          run: async () => {
            const result = await api.ensureProperties({
              force:
                app.locals.demo || process.argv.includes("--refresh-cache"),
            });
            runtime.access.syncProperties(result.properties);
            return `${result.properties.length} properties, ${result.source}`;
          },
        },
        { name: "warm", run: () => api.warmGlobeUsers() },
        { name: "live", run: () => api.warmRealtime() },
      ],
      { gateAfter: 3 }
    );
    bootState.warm.finally(() => {
      pending = false;
    });
    return bootState.done;
  });
  const weeklyReports = require('./lib/reports/weekly').createWeeklyReports({ runtime, logger: app.log });
  let weeklyTimer;
  if (warm) app.addHook('onReady', async () => {
    weeklyTimer = setInterval(() => void weeklyReports.run().catch(error => app.log.error({ err: error }, 'Weekly reports failed')), 60000);
    weeklyTimer.unref();
  });
  app.addHook('onClose', async () => clearInterval(weeklyTimer));
  setup.onCredentialsChange(resetClients);
  if (warm)
    app.addHook("onReady", async () => {
      void app.startBoot();
    });
  const cleanup = setInterval(
    () =>
      require("./controllers/reportCache")
        .cacheCleanup()
        .catch(() => {}),
    6 * 60 * 60 * 1000
  );
  cleanup.unref();
  app.addHook("onClose", async () => clearInterval(cleanup));
  return app;
}
async function start() {
  const app = await createApp({ warm: true, logger: true });
  await app.listen({
    port: Number(process.env.PORT || 5483),
    host: process.env.HOST || "127.0.0.1",
  });
  for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, () => app.close().then(() => process.exit(0)));
  return app;
}
if (require.main === module)
  start().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { createApp, start };
