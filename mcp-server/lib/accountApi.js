// Rybbit's in-process REST bridge, adapted for the standalone MetriBee MCP server.
const Fastify = require("fastify");
const { storage } = require("../../lib/requestContext");
const {
  createIdentityResolver,
  HANDOFF_HEADER,
} = require("../../lib/identity");
async function createAccountApi(app, runtime) {
  let gateway = app;
  const ownsGateway = !app.hasDecorator("authRuntime");
  if (ownsGateway) {
    // Standalone MCP has no public account routes. Mount the very same handlers
    // in a private Fastify instance; it never listens on a network socket.
    gateway = Fastify();
    const identify = createIdentityResolver(runtime);
    gateway.decorateRequest("identity", null);
    gateway.addHook("onRequest", (req, _reply, done) =>
      storage.run({ access: runtime.access, identity: null }, done)
    );
    gateway.addHook("onRequest", async (req) => {
      req.identity = await identify(req);
      if (!req.identity)
        throw Object.assign(new Error("Authentication required."), {
          statusCode: 401,
        });
      storage.getStore().identity = req.identity;
    });
    await require("../../routes/accounts").accountRoutes(gateway, runtime);
    await gateway.ready();
  }
  return {
    async call(method, path, body) {
      const context = storage.getStore();
      if (!context?.identity || !context.mcpHeaders)
        throw new Error("Authentication required.");
      const response = await gateway.inject({
        method,
        url: `/api/rybbit${path}`,
        headers: {
          ...context.mcpHeaders,
          ...(context.handoff ? { [HANDOFF_HEADER]: context.handoff } : {}),
        },
        ...(body === undefined ? {} : { payload: body }),
      });
      const result = response.json();
      if (response.statusCode >= 400)
        throw new Error(
          result.error ||
            result.message ||
            `Request failed (${response.statusCode}).`
        );
      return result;
    },
    close: () => (ownsGateway ? gateway.close() : Promise.resolve()),
  };
}
module.exports = { createAccountApi };
