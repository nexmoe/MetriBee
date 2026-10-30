// Derived from Rybbit shared/src/scopes.ts. AGPL-3.0-only; see NOTICE.
"use strict";
// Scope taxonomy for bearer credentials (API keys and OAuth access tokens).
// Pure data — no runtime dependencies — so both the server (enforcement,
// zod validation) and the client (scope picker) can share one source of truth.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_SCOPE_STRINGS = exports.SCOPE_RESOURCES = exports.OIDC_STANDARD_SCOPES = exports.SCOPE_MATRIX = exports.ORG_API_KEY_CONFIG_ID = void 0;
exports.isValidScopePair = isValidScopePair;
// better-auth configId of the organization-owned API key configuration. Keys
// from this config authenticate as the organization itself; keys from any
// other config (including legacy NULL configIds) are user-owned. The server
// (bearerAuth, auth.ts) and the client (org key management) must agree on it.
exports.ORG_API_KEY_CONFIG_ID = "org";
exports.SCOPE_MATRIX = {
    analytics: ["read"],
    sessions: ["read"],
    events: ["read"],
    users: ["read", "write"],
    goals: ["read", "write"],
    funnels: ["read", "write"],
    dashboards: ["read", "write"],
    annotations: ["read", "write"],
    segments: ["read", "write"],
    flags: ["read", "write"],
    experiments: ["read", "write"],
    sites: ["read", "write"],
    gsc: ["read", "write"],
    org: ["read", "write"],
    replay: ["read", "write"],
    sql: ["read"],
    ingest: ["write"],
};
exports.OIDC_STANDARD_SCOPES = ["openid", "profile", "email", "offline_access"];
exports.SCOPE_RESOURCES = Object.keys(exports.SCOPE_MATRIX);
/** Every valid "resource:action" string, e.g. "analytics:read", "goals:write". */
exports.ALL_SCOPE_STRINGS = exports.SCOPE_RESOURCES.flatMap(resource => exports.SCOPE_MATRIX[resource].map(action => `${resource}:${action}`));
function isValidScopePair(resource, action) {
    const actions = exports.SCOPE_MATRIX[resource];
    return !!actions && actions.includes(action);
}
