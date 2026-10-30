const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function integrationTests() {
  describe("MCP personal / organization / team permissions", function () {
    this.timeout(20000);
    let app,
      standalone,
      runtime,
      db,
      directory,
      owner,
      viewer,
      org,
      otherOrg,
      ownerKey,
      viewerKey,
      teamId;
    const cache = require("../mcp-server/lib/cache");
    let originalCacheGet;
    const headers = (key) => ({
      authorization: `Bearer ${key}`,
      accept: "application/json, text/event-stream",
    });
    async function rpc(
      key,
      method,
      params = {},
      target = app,
      endpoint = "/api/mcp"
    ) {
      const response = await target.inject({
        method: "POST",
        url: endpoint,
        headers: headers(key),
        payload: { jsonrpc: "2.0", id: 1, method, params },
      });
      if (response.statusCode !== 200)
        return { status: response.statusCode, body: response.body };
      const data = response.body
        .split("\n")
        .find((line) => line.startsWith("data: "));
      const body = JSON.parse(data ? data.slice(6) : response.body);
      return body.result || { error: body.error };
    }
    const tool = (key, name, args = {}, target, endpoint) =>
      rpc(key, "tools/call", { name, arguments: args }, target, endpoint);
    const value = (result) =>
      result.structuredContent || JSON.parse(result.content[0].text);
    async function key(user, permissions) {
      return (
        await runtime.auth.api.createApiKey({
          body: {
            userId: user.id,
            name: "MCP permission test",
            ...(permissions ? { permissions } : {}),
          },
        })
      ).key;
    }
    before(async () => {
      directory = await fs.mkdtemp(
        path.join(os.tmpdir(), "metribee-mcp-permissions-")
      );
      db = require("../lib/database").openDatabase(
        path.join(directory, "auth.sqlite")
      );
      runtime = await (
        await import("../lib/auth.mjs")
      ).createAuthentication({
        db,
        env: { BASE_URL: "http://localhost:5483" },
      });
      owner = (
        await runtime.auth.api.signUpEmail({
          body: {
            email: "mcp-owner@example.invalid",
            name: "Owner",
            password: "mcp-test-password",
          },
        })
      ).user;
      viewer = (
        await runtime.auth.api.signUpEmail({
          body: {
            email: "mcp-viewer@example.invalid",
            name: "Viewer",
            password: "mcp-test-password",
          },
        })
      ).user;
      org = db.prepare("SELECT id FROM organization").get().id;
      // Use an ordinary org owner so system-wide admin authority cannot mask isolation bugs.
      db.prepare("UPDATE user SET role='user' WHERE id=?").run(owner.id);
      db.prepare(
        "INSERT INTO member(id,organizationId,userId,role,createdAt,hasRestrictedSiteAccess) VALUES(?,?,?,'viewer',?,1)"
      ).run(randomUUID(), org, viewer.id, Date.now());
      otherOrg = randomUUID();
      db.prepare(
        "INSERT INTO organization(id,name,slug,createdAt) VALUES(?,?,?,?)"
      ).run(otherOrg, "Other organization", "mcp-other", Date.now());
      for (const [id, organizationId] of [
        ["101", org],
        ["102", org],
        ["201", otherOrg],
      ])
        db.prepare(
          "INSERT INTO property_access(propertyId,organizationId,name,domain) VALUES(?,?,?,?)"
        ).run(id, organizationId, `Site ${id}`, `${id}.example.invalid`);
      ownerKey = await key(owner);
      viewerKey = await key(viewer);
      app = await require("../app").createApp({ authRuntime: runtime });
      await app.ready();
      originalCacheGet = cache.get;
      cache.get = () => ({
        value: { rows: [["authorized"]] },
        ageSeconds: 1,
        ttlSeconds: 60,
      });
      standalone = require("fastify")();
      const endpoint = require("../mcp-server/lib/http").createMcpEndpoint({
        authRuntime: runtime,
      });
      await endpoint.register(standalone);
      standalone.addHook("onClose", () => endpoint.close());
      await standalone.ready();
    });
    after(async () => {
      cache.get = originalCacheGet;
      await standalone?.close();
      await app?.close();
      db?.close();
      await fs.rm(directory, { recursive: true, force: true });
    });
    it("uses the same endpoint for different users and scopes the tool catalog without granting roles", async () => {
      const readKey = await key(viewer, { analytics: ["read"] });
      const listed = await rpc(readKey, "tools/list");
      const names = listed.tools.map((row) => row.name);
      assert.ok(names.includes("list_sites") && names.includes("run_report"));
      assert.ok(
        !names.includes("create_team") &&
          !names.includes("save_funnel") &&
          !names.includes("get_cache_status")
      );
      const denied = await tool(readKey, "create_team", {
        organization_id: org,
        name: "Forbidden",
      });
      assert.ok(denied.error || denied.isError);
      const ownerNames = (await rpc(ownerKey, "tools/list")).tools.map(
        (row) => row.name
      );
      assert.ok(ownerNames.includes("create_team"));
      const viewerWriteKey = await key(viewer, { org: ["write"] });
      const forbidden = await tool(viewerWriteKey, "create_team", {
        organization_id: org,
        name: "Still forbidden",
      });
      assert.equal(forbidden.isError, true);
    });
    it("reuses the native member and team APIs and immediately follows team grant changes", async () => {
      assert.equal(
        value(await tool(viewerKey, "list_sites")).organizations[0].sites
          .length,
        0
      );
      const team = value(
        await tool(ownerKey, "create_team", {
          organization_id: org,
          name: "Analytics",
          member_user_ids: [viewer.id],
          site_ids: [101],
          site_role: "member",
        })
      );
      teamId = team.id;
      assert.ok(teamId);
      let sites = value(await tool(viewerKey, "list_sites")).organizations[0]
        .sites;
      assert.deepEqual(
        sites.map((site) => site.site_id),
        [101]
      );
      assert.equal(sites[0].role, "member");
      assert.equal(
        (await tool(viewerKey, "run_realtime_report", { propertyId: "101" }))
          .isError,
        undefined
      );
      assert.equal(
        (await tool(viewerKey, "run_realtime_report", { propertyId: "102" }))
          .isError,
        true
      );
      const updated = await tool(ownerKey, "update_team", {
        organization_id: org,
        team_id: teamId,
        site_ids: [102],
      });
      assert.equal(updated.isError, undefined);
      assert.equal(
        (await tool(viewerKey, "run_realtime_report", { propertyId: "101" }))
          .isError,
        true
      );
      assert.equal(
        (await tool(viewerKey, "run_realtime_report", { propertyId: "102" }))
          .isError,
        undefined
      );
      sites = value(await tool(viewerKey, "list_sites")).organizations[0].sites;
      assert.deepEqual(
        sites.map((site) => site.site_id),
        [102]
      );
      assert.equal(
        value(await tool(ownerKey, "list_members", { organization_id: org }))
          .data.length,
        2
      );
      const viewerMember = db
        .prepare("SELECT id FROM member WHERE userId=? AND organizationId=?")
        .get(viewer.id, org);
      assert.equal(
        (
          await tool(ownerKey, "update_member_site_access", {
            organization_id: org,
            member_id: viewerMember.id,
            has_restricted_site_access: true,
            site_ids: [101],
          })
        ).isError,
        undefined
      );
      assert.deepEqual(
        value(await tool(viewerKey, "list_sites")).organizations[0].sites.map(
          (site) => site.site_id
        ),
        [101, 102]
      );
    });
    it("rejects cross-organization grants and organization-key access outside its organization", async () => {
      const rejected = await tool(ownerKey, "update_team", {
        organization_id: org,
        team_id: teamId,
        site_ids: [201],
      });
      assert.equal(rejected.isError, true);
      const orgKey = await runtime.auth.api.createApiKey({
        body: {
          configId: "org",
          userId: owner.id,
          organizationId: org,
          name: "Organization MCP",
          permissions: { analytics: ["read"], org: ["read"] },
        },
      });
      const sites = value(await tool(orgKey.key, "list_sites")).organizations;
      assert.deepEqual(
        sites.map((row) => row.organization_id),
        [org]
      );
      assert.equal(
        (await tool(orgKey.key, "run_realtime_report", { propertyId: "201" }))
          .isError,
        true
      );
      assert.equal(
        (await tool(orgKey.key, "run_realtime_report", { propertyId: "101" }))
          .isError,
        undefined
      );
      assert.equal(
        (await tool(orgKey.key, "list_teams", { organization_id: otherOrg }))
          .isError,
        true
      );
    });
    it('drops old team authority immediately when a site moves organizations', async () => {
      db.prepare("INSERT INTO member(id,organizationId,userId,role,createdAt,hasRestrictedSiteAccess) VALUES(?,?,?,'owner',?,0)")
        .run(randomUUID(), otherOrg, owner.id, Date.now());
      const moved = await app.inject({ method: 'PUT', url: '/api/rybbit/sites/102/move',
        headers: headers(ownerKey), payload: { organizationId: otherOrg } });
      assert.equal(moved.statusCode, 200, moved.body);
      assert.equal((await tool(viewerKey, 'run_realtime_report', { propertyId: '102' })).isError, true);
      assert.equal(db.prepare('SELECT count(*) n FROM team_site_access WHERE propertyId=?').get('102').n, 0);
      assert.deepEqual(value(await tool(viewerKey, 'list_sites')).organizations[0].sites.map(site => site.site_id), [101]);
    });
    it("applies member removal, role changes, bans, and revoked keys to the existing connection", async () => {
      db.prepare(
        "UPDATE member SET role='viewer' WHERE userId=? AND organizationId=?"
      ).run(owner.id, org);
      assert.equal(
        (
          await tool(ownerKey, "create_team", {
            organization_id: org,
            name: "No longer owner",
          })
        ).isError,
        true
      );
      db.prepare(
        "UPDATE member SET role='owner' WHERE userId=? AND organizationId=?"
      ).run(owner.id, org);
      db.prepare("DELETE FROM member WHERE userId=? AND organizationId=?").run(
        viewer.id,
        org
      );
      assert.equal(
        (await tool(viewerKey, "run_realtime_report", { propertyId: "101" }))
          .isError,
        true
      );
      assert.equal(
        value(await tool(viewerKey, "list_sites")).organizations.length,
        0
      );
      db.prepare("UPDATE user SET banned=1 WHERE id=?").run(viewer.id);
      assert.equal((await rpc(viewerKey, "tools/list")).status, 401);
      db.prepare("UPDATE user SET banned=0 WHERE id=?").run(viewer.id);
      const temporary = await runtime.auth.api.createApiKey({
        body: { userId: viewer.id, name: "Revoke me" },
      });
      db.prepare("DELETE FROM apikey WHERE id=?").run(temporary.id);
      assert.equal((await rpc(temporary.key, "tools/list")).status, 401);
    });
    it("serves the same organization tools standalone and preserves the old MCP URL", async () => {
      const result = await tool(
        ownerKey,
        "list_teams",
        { organization_id: org },
        standalone,
        "/mcp"
      );
      assert.equal(result.isError, undefined);
      assert.ok(value(result).teams.some((team) => team.id === teamId));
      assert.equal(
        (
          await tool(
            ownerKey,
            "delete_team",
            { organization_id: org, team_id: teamId },
            standalone
          )
        ).isError,
        undefined
      );
      const metadata = await app.inject({
        url: "/.well-known/oauth-protected-resource/api/mcp",
      });
      assert.equal(metadata.json().resource, "http://localhost:5483/api/mcp");
      const anonymous = await app.inject({
        method: "POST",
        url: "/api/mcp",
        payload: {},
      });
      assert.equal(anonymous.statusCode, 401);
      assert.match(
        anonymous.headers["www-authenticate"],
        /oauth-protected-resource\/api\/mcp/
      );
    });
    it("does not accept forged internal handoff headers or token swapping", async () => {
      const {
        registerIdentityHandoff,
        releaseIdentityHandoff,
        HANDOFF_HEADER,
      } = require("../lib/identity");
      const nonce = registerIdentityHandoff(ownerKey, {
        userId: owner.id,
        bearer: true,
        statements: null,
      });
      try {
        const response = await app.inject({
          url: "/api/rybbit/organizations",
          headers: {
            authorization: "Bearer invalid-key",
            [HANDOFF_HEADER]: nonce,
          },
        });
        assert.equal(response.statusCode, 401);
      } finally {
        releaseIdentityHandoff(nonce);
      }
    });
  });
}
if (process.env.METRIBEE_MCP_PERMISSION_CHILD === "1") integrationTests();
else
  describe("MCP identity integration (isolated runtime)", function () {
    this.timeout(30000);
    it("follows live organization, team, role and credential permissions through MCP", async () => {
      await require("node:util")
        .promisify(require("node:child_process").execFile)(
          process.execPath,
          [
            require.resolve("mocha/bin/mocha.js"),
            __filename,
            "--reporter",
            "spec",
          ],
          {
            cwd: path.resolve(__dirname, ".."),
            env: {
              ...process.env,
              DEMO: "1",
              METRIBEE_MCP_PERMISSION_CHILD: "1",
            },
          }
        )
        .catch((error) => {
          throw new Error(error.stdout + "\n" + error.stderr);
        });
    });
  });
