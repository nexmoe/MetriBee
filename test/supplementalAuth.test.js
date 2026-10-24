const { expect } = require("chai");
const { routeClient, oauthSettings, createDataClient, createAdminClient, createAlphaDataClient } = require("../lib/supplementalAuth");

describe("supplemental Google Analytics access", () => {
    const policy = { accounts: ["111"], properties: ["456"] };
    const call = (label) => async (request) => [label, request];

    it("uses REST for Data, Admin and Alpha clients when gRPC cannot connect", async () => {
        const env = { GA4_CLIENT_EMAIL: "sa@example.iam.gserviceaccount.com", GA4_PRIVATE_KEY: "test-key" };
        for (const create of [createDataClient, createAdminClient, createAlphaDataClient]) {
            const client = create(env);
            try {
                expect(client._opts.fallback).to.equal(true);
            } finally {
                await client.close();
            }
        }
    });

    it("keeps other properties on the service account and routes approved reports to OAuth", async () => {
        const client = routeClient({ runReport: call("service") }, { runReport: call("oauth") }, policy, "data");
        expect((await client.runReport({ property: "properties/987654321" }))[0]).to.equal("service");
        expect((await client.runReport({ property: "properties/456" }))[0]).to.equal("oauth");
    });

    it("cannot route an out-of-scope metadata name using an unrelated property field", async () => {
        const client = routeClient({ getMetadata: call("service") }, { getMetadata: call("oauth") }, policy, "data");
        expect((await client.getMetadata({ property: "properties/456", name: "properties/999/metadata" }))[0]).to.equal("service");
    });

    it("routes quota snapshot names through the same read-only property restrictions", async () => {
        const client = routeClient({ getPropertyQuotasSnapshot: call("service") }, { getPropertyQuotasSnapshot: call("oauth") }, policy, "data");
        expect((await client.getPropertyQuotasSnapshot({ name: "properties/456/propertyQuotasSnapshot" }))[0]).to.equal("oauth");
        expect((await client.getPropertyQuotasSnapshot({ name: "properties/999/propertyQuotasSnapshot", property: "properties/456" }))[0]).to.equal("service");
    });

    it("blocks mixed-property batches and writes on approved properties", () => {
        const data = routeClient({ batchRunReports: call("service") }, {}, policy, "data");
        expect(() => data.batchRunReports({ property: "properties/456",
            requests: [{ property: "properties/999" }] })).to.throw("approved read-only");
        const admin = routeClient({ deleteProperty: call("service") }, {}, policy, "admin");
        expect(() => admin.deleteProperty({ name: "properties/456" })).to.throw("approved read-only");
    });

    it("filters extra properties and never enumerates other OAuth accounts", async () => {
        const calls = [];
        const extra = {
            getAccount: async (request) => { calls.push(request.name); return [{ name: request.name, displayName: "Supplemental account" }]; },
            listProperties: async (request) => {
                calls.push(request.filter);
                return [[{ name: "properties/456", displayName: "Approved extension" },
                    { name: "properties/999", displayName: "Other extension" }]];
            },
        };
        const primary = {
            listAccounts: async () => [[{ name: "accounts/222", displayName: "Primary account" }]],
            listAccountSummaries: async () => [[{ account: "accounts/222", propertySummaries: [] }]],
            listProperties: async () => [[]],
        };
        const client = routeClient(primary, extra, policy, "admin");
        expect((await client.listAccounts())[0].map((a) => a.name)).to.deep.equal(["accounts/222", "accounts/111"]);
        const [summaries] = await client.listAccountSummaries({});
        expect(summaries[1].propertySummaries.map((p) => p.property)).to.deep.equal(["properties/456"]);
        const [props] = await client.listProperties({ filter: "parent:accounts/111" });
        expect(props.map((p) => p.name)).to.deep.equal(["properties/456"]);
        expect(calls.every((name) => name.includes("111"))).to.equal(true);
    });

    it("requires explicit numeric account and property restrictions", () => {
        expect(oauthSettings({})).to.equal(null);
        expect(oauthSettings({ GA4_OAUTH_CLIENT_ID: "id", GA4_OAUTH_CLIENT_SECRET: "secret" })).to.equal(null);
        const env = { GA4_OAUTH_CLIENT_ID: "id", GA4_OAUTH_CLIENT_SECRET: "secret", GA4_OAUTH_REFRESH_TOKEN: "refresh" };
        expect(() => oauthSettings(env)).to.throw("incomplete");
        expect(() => oauthSettings({ ...env, GA4_OAUTH_ACCOUNT_IDS: "*", GA4_OAUTH_PROPERTY_IDS: "456" })).to.throw("numeric IDs");
    });
});
