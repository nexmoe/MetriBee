const { failure } = require("./access");
const { SCOPE_MATRIX, OIDC_STANDARD_SCOPES } = require("./scopes");
const { randomUUID } = require('node:crypto');
const handoffs = new Map();
const HANDOFF_HEADER = 'x-metribee-mcp-identity';
function registerIdentityHandoff(token, identity) {
  const nonce = randomUUID();
  handoffs.set(nonce, { token, identity });
  return nonce;
}
function releaseIdentityHandoff(nonce) { handoffs.delete(nonce); }
function statements(value) {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([resource, actions]) =>
          SCOPE_MATRIX[resource] && Array.isArray(actions)
      )
      .map(([resource, actions]) => [
        resource,
        actions.filter((a) => SCOPE_MATRIX[resource].includes(a)),
      ])
  );
}
function oauthStatements(scopes) {
  const custom = String(scopes || "")
    .split(/\s+/)
    .filter((s) => s && !OIDC_STANDARD_SCOPES.includes(s));
  if (!custom.length) return null;
  const result = {};
  for (const item of custom) {
    const [resource, action, extra] = item.split(":");
    if (!extra && SCOPE_MATRIX[resource]?.includes(action))
      (result[resource] ||= []).push(action);
  }
  return result;
}
function createIdentityResolver({ auth, db }) {
  function liveUser(id) {
    const user = db.prepare("SELECT * FROM user WHERE id=?").get(id);
    if (
      !user ||
      (user.banned &&
        (!user.banExpires || Number(user.banExpires) > Date.now()))
    )
      throw failure("Account is unavailable.", 401);
    return user;
  }
  return async (request) => {
    const bearer =
      /^Bearer (.+)$/.exec(request.headers.authorization || "")?.[1] ||
      request.headers["x-api-key"];
    if (bearer) {
      // Only a one-use, credential-bound in-process nonce can reuse verification.
      // A batch's subsequent API calls verify normally and consume their own budget.
      const nonce = request.headers[HANDOFF_HEADER];
      const handoff = typeof nonce === 'string' ? handoffs.get(nonce) : null;
      if (handoff?.token === bearer) {
        handoffs.delete(nonce);
        const identity = handoff.identity;
        if (identity.userId) {
          const user = liveUser(identity.userId);
          return { ...identity, user, systemAdmin: user.role === 'admin' };
        }
        if (!db.prepare('SELECT 1 FROM organization WHERE id=?').get(identity.organizationId))
          throw failure('Organization is unavailable.', 401);
        return identity;
      }
      if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(bearer)) {
        const result = await auth.api
          .verifyApiKey({ body: { key: bearer } })
          .catch(() => null);
        if (result?.valid && result.key?.referenceId) {
          if (result.key.configId === "org") {
            if (
              !db
                .prepare("SELECT 1 FROM organization WHERE id=?")
                .get(result.key.referenceId)
            )
              throw failure("Organization is unavailable.", 401);
            return {
              organizationId: result.key.referenceId,
              bearer: true,
              statements: statements(result.key.permissions),
            };
          }
          const user = liveUser(result.key.referenceId);
          return {
            userId: user.id,
            systemAdmin: user.role === "admin",
            bearer: true,
            statements: statements(result.key.permissions),
            user,
          };
        }
      }
      const token = await auth.api
        .verifyRybbitOAuthToken({ body: { token: bearer } })
        .catch(() => null);
      if (!token?.userId)
        throw failure("Invalid or expired bearer credential.", 401);
      const user = liveUser(token.userId);
      return {
        userId: user.id,
        user,
        systemAdmin: user.role === "admin",
        bearer: true,
        statements: oauthStatements(token.scopes),
      };
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers))
      if (value)
        headers.set(key, Array.isArray(value) ? value.join(",") : value);
    const session = await auth.api.getSession({ headers });
    if (!session?.user) return null;
    const user = liveUser(session.user.id);
    return {
      userId: user.id,
      user,
      systemAdmin: user.role === "admin",
      bearer: false,
      statements: null,
      session: session.session,
    };
  };
}
module.exports = { createIdentityResolver, statements, oauthStatements, HANDOFF_HEADER, registerIdentityHandoff, releaseIdentityHandoff };
