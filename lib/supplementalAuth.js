// Optional user OAuth access for properties that cannot grant a service account access.
// The service account remains the default. Only explicit account/property IDs use OAuth.
const { clientOptions, SCOPE } = require("./credentials");

const OAUTH_KEYS = ["GA4_OAUTH_CLIENT_ID", "GA4_OAUTH_CLIENT_SECRET", "GA4_OAUTH_REFRESH_TOKEN",
    "GA4_OAUTH_ACCOUNT_IDS", "GA4_OAUTH_PROPERTY_IDS"];
const DATA_READS = new Set(["runReport", "runRealtimeReport", "runPivotReport", "batchRunReports",
    "batchRunPivotReports", "runFunnelReport", "getMetadata", "checkCompatibility", "getPropertyQuotasSnapshot"]);
const ADMIN_READS = new Set(["getAccount", "getProperty", "listDataStreams", "getDataStream", "listGoogleAdsLinks"]);

function ids(value, key) {
    const result = [...new Set(String(value || "").split(",").map((s) => s.trim()).filter(Boolean))];
    if (!result.length || result.some((id) => !/^\d+$/.test(id))) throw new Error(key + " must list numeric IDs.");
    return result;
}

function oauthPolicy(env = process.env) {
    return {
        accounts: ids(env.GA4_OAUTH_ACCOUNT_IDS, "GA4_OAUTH_ACCOUNT_IDS"),
        properties: ids(env.GA4_OAUTH_PROPERTY_IDS, "GA4_OAUTH_PROPERTY_IDS"),
    };
}

function oauthSettings(env = process.env) {
    // Client setup may precede consent; keep the existing service account working meanwhile.
    if (!(env.GA4_OAUTH_REFRESH_TOKEN || "").trim()) return null;
    if (OAUTH_KEYS.some((key) => !(env[key] || "").trim())) {
        throw new Error("Supplemental GA4 OAuth is incomplete. Set all GA4_OAUTH_* credentials and ID lists.");
    }
    return {
        ...oauthPolicy(env),
        credentials: {
            type: "authorized_user",
            client_id: env.GA4_OAUTH_CLIENT_ID.trim(),
            client_secret: env.GA4_OAUTH_CLIENT_SECRET.trim(),
            refresh_token: env.GA4_OAUTH_REFRESH_TOKEN.trim(),
        },
    };
}

function denied() {
    return Object.assign(new Error("Supplemental Google access is limited to approved read-only properties."), { code: 7 });
}

function routeClient(primary, extra, policy, kind) {
    const accounts = new Set(policy.accounts);
    const properties = new Set(policy.properties);
    const reads = kind === "admin" ? ADMIN_READS : DATA_READS;
    const approved = (name) => {
        const match = /^(accounts|properties)\/(\d+)(?:\/|$)/.exec(name || "");
        return !!match && (match[1] === "accounts" ? accounts : properties).has(match[2]);
    };
    const filteredProperties = async (request, ...rest) => {
        const out = await extra.listProperties(request, ...rest);
        return [out[0].filter((p) => approved(p.name)), ...out.slice(1)];
    };
    return new Proxy(primary, {
        get(target, method) {
            if (method === "close") return async () => {
                const results = await Promise.allSettled([primary.close(), extra.close()]);
                const error = results.find((r) => r.status === "rejected");
                if (error) throw error.reason;
            };
            if (kind === "admin" && method === "listAccounts") return async (...args) => {
                const out = await primary.listAccounts(...args);
                const seen = new Set(out[0].map((a) => a.name));
                const added = [];
                for (const id of accounts) {
                    if (!seen.has("accounts/" + id)) added.push((await extra.getAccount({ name: "accounts/" + id }))[0]);
                }
                return [[...out[0], ...added], ...out.slice(1)];
            };
            if (kind === "admin" && method === "listAccountSummaries") return async (...args) => {
                const out = await primary.listAccountSummaries(...args);
                const merged = new Map(out[0].map((a) => [a.account, a]));
                for (const id of accounts) {
                    const name = "accounts/" + id;
                    const [account] = await extra.getAccount({ name });
                    const [props] = await filteredProperties({ filter: "parent:" + name });
                    if (!props.length) continue;
                    const old = merged.get(name);
                    const combined = new Map((old?.propertySummaries || []).map((p) => [p.property, p]));
                    for (const p of props) combined.set(p.name, {
                        property: p.name, displayName: p.displayName, propertyType: p.propertyType, parent: name,
                    });
                    merged.set(name, { name: "accountSummaries/" + id, account: name,
                        displayName: account.displayName, propertySummaries: [...combined.values()] });
                }
                return [[...merged.values()], ...out.slice(1)];
            };
            if (kind === "admin" && method === "listProperties") return (request = {}, ...rest) => {
                const match = /^parent:accounts\/(\d+)$/.exec(request.filter || "");
                return match && accounts.has(match[1])
                    ? filteredProperties(request, ...rest) : primary.listProperties(request, ...rest);
            };
            const value = Reflect.get(target, method, target);
            if (typeof value !== "function") return value;
            return (request = {}, ...rest) => {
                const resource = kind === "data"
                    ? (["getMetadata", "getPropertyQuotasSnapshot"].includes(method) ? request.name : request.property)
                    : (String(method).startsWith("list") ? request.parent : request.name);
                if (!approved(resource)) return value.call(target, request, ...rest);
                if (!reads.has(method)) throw denied();
                if (request.requests?.some((r) => r.property && r.property !== resource)) throw denied();
                return extra[method](request, ...rest);
            };
        },
    });
}

function createClient(Client, kind, env = process.env) {
    const settings = oauthSettings(env);
    // REST works on networks that allow HTTPS but cannot establish gRPC channels.
    const transport = { fallback: true };
    const primary = new Client({ ...clientOptions(env), ...transport });
    if (!settings) return primary;
    const extra = new Client({ credentials: settings.credentials, scopes: [SCOPE], ...transport });
    return routeClient(primary, extra, settings, kind);
}

function createAdminClient(env) {
    const { AnalyticsAdminServiceClient } = require("@google-analytics/admin");
    return createClient(AnalyticsAdminServiceClient, "admin", env);
}

function createDataClient(env) {
    const { BetaAnalyticsDataClient } = require("@google-analytics/data");
    return createClient(BetaAnalyticsDataClient, "data", env);
}

function createAlphaDataClient(env) {
    const { v1alpha } = require("@google-analytics/data");
    return createClient(v1alpha.AlphaAnalyticsDataClient, "data", env);
}

module.exports = { OAUTH_KEYS, oauthPolicy, oauthSettings, routeClient, createAdminClient, createDataClient, createAlphaDataClient };
