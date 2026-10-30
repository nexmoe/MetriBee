const Fastify = require("fastify");
const { toNodeHandler } = require("@modelcontextprotocol/node");
const {
  createMcpHandler,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  validateHostHeader,
  validateOriginHeader,
} = require("@modelcontextprotocol/server");
const { createServer } = require("../index");
const { version } = require("../../package.json");
const { storage } = require("../../lib/requestContext");
const { createIdentityResolver, registerIdentityHandoff, releaseIdentityHandoff } = require("../../lib/identity");
const { createAccountApi } = require('./accountApi');
const list = (value) =>
  (value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
function publicHostname(value) {
  if (!value?.trim()) return [];
  try {
    const url = new URL(value.trim());
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error();
    return [url.hostname];
  } catch {
    throw new Error(
      "MCP_PUBLIC_URL must be an absolute http:// or https:// URL without credentials."
    );
  }
}
function createMcpEndpoint({ env = process.env, authRuntime } = {}) {
  const publicHosts = publicHostname(env.MCP_PUBLIC_URL);
  const hosts = [
    ...localhostAllowedHostnames(),
    ...publicHosts,
    ...list(env.MCP_ALLOWED_HOSTS),
  ];
  const origins = [
    ...localhostAllowedOrigins(),
    ...publicHosts,
    ...list(env.MCP_ALLOWED_ORIGINS),
  ];
  const handlers = new Set();
  const accountApis = new Set();
  return {
    async register(app) {
      const runtime =
        authRuntime ||
        (await (
          await import("../../lib/auth.mjs")
        ).createAuthentication({ env }));
      const identify = createIdentityResolver(runtime);
      const accountApi = await createAccountApi(app, runtime);
      accountApis.add(accountApi);
      const handler = createMcpHandler(
        () =>
          createServer({
            identity: storage.getStore()?.identity,
            access: runtime.access,
            accountApi,
          }),
        { responseMode: "sse" }
      );
      handlers.add(handler);
      const node = toNodeHandler(handler);
      if (!app.hasRequestDecorator("identity"))
        app.decorateRequest("identity", null);
      const gate = async (req, reply) => {
        const host = validateHostHeader(req.headers.host, hosts),
          origin = validateOriginHeader(req.headers.origin, origins);
        if (!host.ok || !origin.ok)
          return reply
            .code(403)
            .send({
              jsonrpc: "2.0",
              id: null,
              error: { code: -32000, message: "Invalid Host or Origin header" },
            });
        if (req.headers.origin)
          reply
            .header("Access-Control-Allow-Origin", req.headers.origin)
            .header("Vary", "Origin");
        reply
          .header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
          .header(
            "Access-Control-Expose-Headers",
            "Mcp-Session-Id, MCP-Protocol-Version, WWW-Authenticate"
          );
        if (req.method === "OPTIONS")
          return reply
            .header(
              "Access-Control-Allow-Headers",
              req.headers["access-control-request-headers"] ||
                "content-type,authorization,mcp-protocol-version"
            )
            .code(204)
            .send();
        const identity = await identify(req);
        if (!identity)
          return reply
            .header(
              "WWW-Authenticate",
              `Bearer resource_metadata="${runtime.baseURL}/.well-known/oauth-protected-resource${req.url.split('?')[0]}"`
            )
            .code(401)
            .send({ error: "authentication_required" });
        if (
          !identity.bearer &&
          !new Set(
            runtime.auth.options.trustedOrigins || [runtime.baseURL]
          ).has(req.headers.origin)
        )
          return reply
            .code(403)
            .send({
              error:
                "A trusted Origin is required for cookie-authenticated MCP requests.",
            });
        req.identity = identity;
        if (["GET", "DELETE"].includes(req.method))
          return reply
            .header("Allow", "POST, OPTIONS")
            .code(405)
            .send({
              jsonrpc: "2.0",
              id: null,
              error: { code: -32000, message: "Method not allowed" },
            });
      };
      const route = {
        method: ["GET", "POST", "DELETE", "OPTIONS"],
        url: "/mcp",
        bodyLimit: 100 * 1024,
        config: { public: true },
        onRequest: gate,
        handler: async (req, reply) => {
          const identity = req.identity;
          reply.hijack();
          for (const [key, value] of Object.entries(reply.getHeaders()))
            reply.raw.setHeader(key, value);
          reply.raw.setHeader("X-Accel-Buffering", "no");
          reply.raw.setHeader('Cache-Control', 'no-store');
          const mcpHeaders = Object.fromEntries(['authorization', 'x-api-key', 'cookie', 'origin']
            .filter(key => req.headers[key]).map(key => [key, req.headers[key]]));
          const token = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1] || req.headers['x-api-key'];
          const handoff = token ? registerIdentityHandoff(token, identity) : undefined;
          reply.raw.once('close', () => releaseIdentityHandoff(handoff));
          return storage.run({ identity, access: runtime.access, mcpHeaders, handoff }, () =>
            node(req.raw, reply.raw, req.body)
          );
        },
      };
      for (const url of ['/mcp', '/api/mcp']) {
        app.route({ ...route, url });
        app.get(`/.well-known/oauth-protected-resource${url}`, { config: { public: true } }, async () => ({
          resource: `${runtime.baseURL}${url}`, authorization_servers: [`${runtime.baseURL}/api/auth`], bearer_methods_supported: ['header'],
        }));
      }
      app.get('/.well-known/oauth-protected-resource', { config: { public: true } }, async () => ({
        resource: `${runtime.baseURL}/api/mcp`, authorization_servers: [`${runtime.baseURL}/api/auth`], bearer_methods_supported: ['header'],
      }));
      const metadata = async (req, reply) => {
        const response = await runtime.auth.handler(
          new Request(
            `${runtime.baseURL}/api/auth/.well-known/oauth-authorization-server`,
            { headers: { "x-forwarded-for": req.ip } }
          )
        );
        return reply
          .code(response.status)
          .type("application/json")
          .send(await response.text());
      };
      app.get(
        "/.well-known/oauth-authorization-server",
        { config: { public: true } },
        metadata
      );
      app.get(
        "/.well-known/oauth-authorization-server/api/auth",
        { config: { public: true } },
        metadata
      );
    },
    async close() {
      await Promise.all([...handlers].map((handler) => handler.close()));
      handlers.clear();
      await Promise.all([...accountApis].map(api => api.close()));
      accountApis.clear();
    },
  };
}
async function startStandalone({ env = process.env, authRuntime } = {}) {
  const host = env.MCP_HOST || "127.0.0.1",
    port = Number(env.MCP_PORT ?? 5484);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("MCP_PORT must be an integer between 0 and 65535.");
  const endpoint = createMcpEndpoint({ env, authRuntime });
  const app = Fastify({ bodyLimit: 1024 * 1024 });
  await endpoint.register(app);
  app.get("/healthz", async () => ({
    ok: true,
    version,
    transport: "streamable-http",
  }));
  app.setErrorHandler((error, _req, reply) =>
    reply
      .code(error.statusCode || 500)
      .send({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: error.statusCode === 400 ? -32700 : -32603,
          message:
            error.statusCode === 400
              ? "Parse error"
              : error.statusCode === 413
              ? "Request body too large"
              : "Internal server error",
        },
      })
  );
  app.addHook("onClose", () => endpoint.close());
  await app.listen({ port, host });
  const hostname = host.includes(":") ? `[${host}]` : host;
  return {
    server: app.server,
    app,
    url: `http://${hostname}:${app.server.address().port}/mcp`,
    close: () => app.close(),
  };
}
module.exports = { createMcpEndpoint, startStandalone };
