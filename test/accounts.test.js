const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { openDatabase } = require("./helpers/database");

// Exercise actual Better Auth endpoints and Fastify hooks against an isolated SQLite file.
function integrationTests() {
  describe("Fastify / SQLite user system", function () {
    this.timeout(20000);
    let app,
      runtime,
      db,
      directory,
      owner,
      viewer,
      organizationId,
      first,
      second,
      previousDemo;
    const mail = [];
    let requestNumber = 1;
    const call = (actor, method, url, payload, extra = {}) =>
      app.inject({
        method,
        url,
        remoteAddress: `127.0.${Math.floor(requestNumber / 250)}.${
          (++requestNumber % 250) + 1
        }`,
        headers: {
          origin: "http://localhost:5483",
          ...(actor?.cookie ? { cookie: actor.cookie } : {}),
          ...(actor?.key ? { authorization: `Bearer ${actor.key}` } : {}),
          ...extra,
        },
        ...(payload === undefined ? {} : { payload }),
      });
    async function register(email, name = "User") {
      const response = await call(null, "POST", "/api/auth/sign-up/email", {
        email,
        name,
        password: "initial-password",
      });
      assert.equal(response.statusCode, 200, response.body);
      return {
        id: response.json().user.id,
        email,
        cookie: response.headers["set-cookie"][0].split(";")[0],
      };
    }
    async function post(actor, url, payload) {
      const response = await call(actor, "POST", url, payload);
      assert.equal(response.statusCode, 200, response.body);
      return response.json();
    }
    before(async () => {
      previousDemo = process.env.DEMO;
      process.env.DEMO = "1";
      directory = await fs.mkdtemp(
        path.join(os.tmpdir(), "metribee-accounts-")
      );
      db = openDatabase(path.join(directory, "users.sqlite"));
      runtime = await (
        await import("../lib/auth.mjs")
      ).createAuthentication({
        db,
        env: { PORT: "5483" },
        mailer: { configured: true, send: async (...args) => mail.push(args) },
      });
      app = await require("../app").createApp({ authRuntime: runtime });
      // Discovery happens during server warm-up, before the first account exists.
      await call(null, "GET", "/healthz");
      runtime.access.syncProperties(
        (await require("../controllers/apiController").ensureProperties())
          .properties
      );
      owner = await register("owner@example.com", "Owner");
      organizationId = db.prepare("SELECT id FROM organization").get().id;
      await call(owner, "GET", "/api/nav-index");
      [first, second] = db
        .prepare(
          "SELECT propertyId FROM property_access ORDER BY propertyId LIMIT 2"
        )
        .all()
        .map((p) => p.propertyId);
      viewer = await register("viewer@example.com", "Viewer");
      await post(owner, `/api/rybbit/organizations/${organizationId}/members`, {
        email: viewer.email,
        role: "viewer",
      });
    });
    after(async () => {
      await app?.close();
      db?.close();
      await fs.rm(directory, { recursive: true, force: true });
      if (previousDemo === undefined) delete process.env.DEMO;
      else process.env.DEMO = previousDemo;
    });

    it('provides personal MCP connection details to ordinary signed-in users', async () => {
      const response = await call(viewer, 'GET', '/api/rybbit/user/mcp-connection');
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.deepEqual(response.json(), {
        url: (process.env.MCP_PUBLIC_URL || `${runtime.baseURL}/api/mcp`).trim(), oauthAvailable: true,
      });
      assert.equal((await call(null, 'GET', '/api/rybbit/user/mcp-connection')).statusCode, 401);
      const key = await runtime.auth.api.createApiKey({body:{userId:viewer.id,name:'MCP help isolation'}});
      assert.equal((await call({key:key.key}, 'GET', '/api/rybbit/user/mcp-connection')).statusCode, 401);
    });
    it("requires authentication, bootstraps exactly one administrator, and selects their default organization", async () => {
      assert.equal((await call(null, "GET", "/api/nav-index")).statusCode, 401);
      assert.equal((await call(null, "GET", "/")).headers.location, "/login");
      assert.equal(
        (await call(null, "GET", "/api/rybbit/config")).statusCode,
        200
      );
      const session = (
        await call(owner, "GET", "/api/auth/get-session")
      ).json();
      assert.equal(session.user.role, "admin");
      assert.equal(session.session.activeOrganizationId, organizationId);
      assert.equal(
        db.prepare("SELECT count(*) n FROM user WHERE role='admin'").get().n,
        1
      );
      assert.equal(
        (await call(viewer, "GET", "/api/rybbit/admin/organizations"))
          .statusCode,
        403
      );
    });
    it("returns native role permissions and never trusts a viewer role supplied by the browser", async () => {
      const sites = (
        await call(
          viewer,
          "GET",
          `/api/rybbit/organizations/${organizationId}/sites`
        )
      ).json();
      assert.ok(sites.sites.length > 1);
      assert.equal(sites.role, "viewer");
      assert.ok(sites.sites[0].permissions.includes("analytics:read"));
      assert.ok(!sites.sites[0].permissions.includes("funnels:write"));
      assert.equal(
        (
          await call(
            viewer,
            "POST",
            `/api/rybbit/sites/${first}/funnels`,
            { name: "no", steps: [] },
            { "x-role": "owner" }
          )
        ).statusCode,
        403
      );
      assert.equal(
        (
          await call(null, "GET", "/api/nav-index", undefined, {
            "x-private-key": "a".repeat(12),
            "x-private-site": first,
          })
        ).statusCode,
        403
      );
    });
    it("applies direct restrictions across native and legacy APIs, metadata, realtime and snapshots", async () => {
      const member = db
        .prepare("SELECT id FROM member WHERE userId=?")
        .get(viewer.id);
      const updated = await call(
        owner,
        "PUT",
        `/api/rybbit/organizations/${organizationId}/members/${member.id}/sites`,
        {
          hasRestrictedSiteAccess: true,
          siteIds: [Number(first)],
          siteRole: null,
        }
      );
      assert.equal(updated.statusCode, 200, updated.body);
      for (const url of [
        `/api/rybbit/sites/${second}`,
        `/api/property-detail/${second}`,
        `/api/analytics?prop=${second}`,
        `/api/realtime-summary/${second}`,
      ])
        assert.equal((await call(viewer, "GET", url)).statusCode, 403, url);
      assert.deepEqual(
        (await call(viewer, "GET", "/api/nav-index"))
          .json()
          .sites.map((p) => p.id),
        [first]
      );
      const realtime = (await call(viewer, "GET", "/api/realtime-all")).json();
      assert.deepEqual(
        realtime.data.map((p) => String(p.propertyId || p.id)),
        [first]
      );
    });
    it("supports team CRUD, additive grants and per-site role raises without organization admin powers", async () => {
      const team = await post(
        owner,
        `/api/rybbit/organizations/${organizationId}/teams`,
        {
          name: "Editors",
          memberUserIds: [viewer.id],
          siteIds: [Number(second)],
          siteRole: "editor",
        }
      );
      assert.equal(team.members.length, 1);
      assert.equal(team.sites[0].siteId, Number(second));
      assert.equal(
        runtime.access.siteRole({ userId: viewer.id }, second),
        "editor"
      );
      const data = (
        await call(viewer, "GET", `/api/rybbit/sites/${second}`)
      ).json();
      assert.ok(data.permissions.includes("sites:configure"));
      assert.ok(!data.permissions.includes("members:manage"));
      assert.equal(
        (
          await call(
            viewer,
            "POST",
            `/api/rybbit/organizations/${organizationId}/teams`,
            { name: "Forbidden" }
          )
        ).statusCode,
        403
      );
      assert.equal(
        (
          await call(
            owner,
            "DELETE",
            `/api/rybbit/organizations/${organizationId}/teams/${team.id}`
          )
        ).statusCode,
        200
      );
      assert.equal(
        (await call(viewer, "GET", `/api/rybbit/sites/${second}`)).statusCode,
        403
      );
    });
    it("prevents cross-organization grants, multi-role escalation and removing the last owner", async () => {
      const other = await post(owner, "/api/auth/organization/create", {
        name: "Other",
        slug: "other",
      });
      const attempt = await call(
        owner,
        "POST",
        `/api/rybbit/organizations/${other.id}/teams`,
        { name: "Cross", siteIds: [Number(first)] }
      );
      assert.equal(attempt.statusCode, 403);
      const member = db
        .prepare("SELECT id FROM member WHERE userId=? AND organizationId=?")
        .get(viewer.id, organizationId);
      assert.equal(
        (
          await call(
            owner,
            "POST",
            "/api/auth/organization/update-member-role",
            { organizationId, memberId: member.id, role: ["owner", "viewer"] }
          )
        ).statusCode,
        403
      );
      assert.equal(
        (
          await call(owner, "POST", "/api/auth/organization/leave", {
            organizationId,
          })
        ).statusCode,
        403
      );
      const created = await post(
        owner,
        `/api/rybbit/organizations/${organizationId}/users`,
        {
          email: "admin@example.com",
          password: "created-password",
          name: "Org admin",
          role: "admin",
        }
      );
      assert.equal(
        db.prepare("SELECT role FROM user WHERE id=?").get(created.user.id)
          .role,
        "user"
      );
      const login = await call(null, "POST", "/api/auth/sign-in/email", {
        email: "admin@example.com",
        password: "created-password",
      });
      const actor = { cookie: login.headers["set-cookie"][0].split(";")[0] };
      assert.equal(
        (
          await call(actor, "POST", "/api/auth/organization/invite-member", {
            organizationId,
            email: "bad@example.com",
            role: "owner",
          })
        ).statusCode,
        403
      );
    });
    it("creates scoped personal and organization keys, honors revocation, and refuses scope bypasses", async () => {
      const metadataKey = await post(owner, "/api/rybbit/user/api-keys", {
        name: "Metadata only",
        permissions: { sites: ["read"] },
      });
      assert.equal(
        (
          await call(
            { key: metadataKey.key },
            "GET",
            `/api/rybbit/sites/${first}`
          )
        ).statusCode,
        200
      );
      assert.equal(
        (
          await call(
            { key: metadataKey.key },
            "GET",
            `/api/rybbit/sites/${first}/overview`
          )
        ).statusCode,
        403
      );
      const personal = await post(viewer, "/api/rybbit/user/api-keys", {
        name: "Reader",
        permissions: { analytics: ["read"], sites: ["read"], org: ["read"] },
      });
      assert.equal(
        (await call({ key: personal.key }, "GET", `/api/rybbit/sites/${first}`))
          .statusCode,
        200
      );
      assert.equal(
        (
          await call(
            { key: personal.key },
            "GET",
            `/api/rybbit/sites/${second}`
          )
        ).statusCode,
        403
      );
      const scoped = await post(owner, "/api/rybbit/user/api-keys", {
        name: "Funnels only",
        permissions: { funnels: ["read"] },
      });
      assert.equal(
        (await call({ key: scoped.key }, "GET", "/api/realtime-all"))
          .statusCode,
        403
      );
      assert.equal(
        (
          await call(
            { key: scoped.key },
            "GET",
            `/api/rybbit/sites/${first}/overview`
          )
        ).statusCode,
        403
      );
      assert.equal(
        (
          await call(owner, "POST", "/api/rybbit/user/api-keys", {
            name: "Bad",
            permissions: { unknown: ["read"] },
          })
        ).statusCode,
        400
      );
      const orgKey = await post(
        owner,
        `/api/rybbit/organizations/${organizationId}/api-keys`,
        {
          name: "Organization",
          permissions: { analytics: ["read"], sites: ["read"] },
        }
      );
      assert.equal(
        (await call({ key: orgKey.key }, "GET", `/api/rybbit/sites/${second}`))
          .statusCode,
        200
      );
      assert.equal(
        (
          await call(
            { key: orgKey.key },
            "PUT",
            `/api/rybbit/sites/${second}/config`,
            { embedEnabled: true }
          )
        ).statusCode,
        403
      );
      await post(viewer, "/api/auth/api-key/delete", { keyId: personal.id });
      assert.equal(
        (await call({ key: personal.key }, "GET", `/api/rybbit/sites/${first}`))
          .statusCode,
        401
      );
    });
    it("sends real invitation links and copies restricted site access on acceptance", async () => {
      const invitee = await register("invited@example.com");
      const invitation = await post(
        owner,
        "/api/auth/organization/invite-member",
        {
          organizationId,
          email: invitee.email,
          role: "viewer",
          hasRestrictedSiteAccess: true,
          siteIds: [Number(second)],
          siteRole: "member",
        }
      );
      const invitationMail = mail.find((m) => m[0] === invitee.email);
      assert.ok(invitationMail);
      assert.ok(new URL(invitationMail[3]).searchParams.get("invitationId"));
      await post(invitee, "/api/auth/organization/accept-invitation", {
        invitationId: invitation.id,
      });
      assert.equal(
        runtime.access.siteRole({ userId: invitee.id }, first),
        null
      );
      assert.equal(
        runtime.access.siteRole({ userId: invitee.id }, second),
        "member"
      );
      const row = db
        .prepare("SELECT * FROM member WHERE userId=?")
        .get(invitee.id);
      await post(owner, "/api/auth/organization/remove-member", {
        organizationId,
        memberIdOrEmail: row.id,
      });
      assert.equal(
        (
          await call(
            invitee,
            "POST",
            "/api/auth/organization/accept-invitation",
            { invitationId: invitation.id }
          )
        ).statusCode >= 400,
        true
      );
      assert.equal(
        runtime.access.siteRole({ userId: invitee.id }, second),
        null
      );
    });
    for (const mcpPath of ["/mcp", "/api/mcp"]) it(`supports OAuth discovery, PKCE, consent and token exchange for ${mcpPath}`, async () => {
      const metadata = await call(
        null,
        "GET",
        "/.well-known/oauth-authorization-server/api/auth"
      );
      assert.equal(metadata.statusCode, 200);
      assert.ok(metadata.json().authorization_endpoint);
      const registration = await call(
        owner,
        "POST",
        "/api/auth/oauth2/register",
        {
          client_name: "Integration client",
          redirect_uris: ["http://localhost:9999/callback"],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
          application_type: "native",
        }
      );
      assert.equal(registration.statusCode, 201, registration.body);
      const clientId = registration.json().client_id,
        verifier = "a".repeat(64);
      const challenge = require("node:crypto")
        .createHash("sha256")
        .update(verifier)
        .digest("base64url");
      const query = new URLSearchParams({
        client_id: clientId,
        redirect_uri: "http://localhost:9999/callback",
        response_type: "code",
        code_challenge: challenge,
        code_challenge_method: "S256",
        scope: "openid analytics:read sites:read offline_access",
        resource: runtime.baseURL + mcpPath,
        state: "test-state",
      });
      const anonymous = await call(
        null,
        "GET",
        "/api/auth/oauth2/authorize?" + query
      );
      assert.equal(anonymous.statusCode, 302);
      assert.equal(new URL(anonymous.headers.location).pathname, "/login");
      const signedLoginQuery = new URL(anonymous.headers.location).search.slice(
        1
      );
      const login = await post(null, "/api/auth/sign-in/email", {
        email: owner.email,
        password: "initial-password",
        oauth_query: signedLoginQuery,
      });
      assert.equal(login.redirect, true);
      assert.equal(new URL(login.url).pathname, "/auth/consent");
      const authorize = await call(
        owner,
        "GET",
        "/api/auth/oauth2/authorize?" + query
      );
      assert.equal(authorize.statusCode, 302);
      const signedQuery = new URL(authorize.headers.location).search.slice(1);
      const consent = await post(owner, "/api/auth/oauth2/consent", {
        accept: true,
        oauth_query: signedQuery,
      });
      const code = new URL(consent.url).searchParams.get("code");
      assert.ok(code);
      const token = await call(
        null,
        "POST",
        "/api/auth/oauth2/token",
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          redirect_uri: "http://localhost:9999/callback",
          code,
          code_verifier: verifier,
          resource: runtime.baseURL + mcpPath,
        }).toString(),
        { "content-type": "application/x-www-form-urlencoded" }
      );
      assert.equal(token.statusCode, 200, token.body);
      assert.ok(token.json().refresh_token);
      const mcpResponse = await call({ key: token.json().access_token }, 'POST', mcpPath, {
        jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_sites', arguments: {} },
      }, { accept: 'application/json, text/event-stream' });
      assert.equal(mcpResponse.statusCode, 200, mcpResponse.body);
      assert.match(mcpResponse.body, /organization_id/);
      const bearer = { key: token.json().access_token };
      assert.equal(
        (await call(bearer, "GET", `/api/rybbit/sites/${first}`)).statusCode,
        200
      );
      assert.equal(
        (
          await call(bearer, "PUT", `/api/rybbit/sites/${first}/config`, {
            embedEnabled: true,
          })
        ).statusCode,
        403
      );
    });
    it("supports email OTP password reset, session listing and invalidation", async () => {
      await post(null, "/api/auth/email-otp/send-verification-otp", {
        email: viewer.email,
        type: "forget-password",
      });
      const code = mail
        .filter((m) => m[0] === viewer.email)
        .at(-1)[2]
        .match(/\b\d{6}\b/)[0];
      await post(null, "/api/auth/email-otp/reset-password", {
        email: viewer.email,
        otp: code,
        password: "replacement-password",
      });
      assert.equal(
        (
          await call(null, "POST", "/api/auth/sign-in/email", {
            email: viewer.email,
            password: "initial-password",
          })
        ).statusCode,
        401
      );
      const login = await call(null, "POST", "/api/auth/sign-in/email", {
        email: viewer.email,
        password: "replacement-password",
      });
      assert.equal(login.statusCode, 200);
      viewer.cookie = login.headers["set-cookie"][0].split(";")[0];
      const sessions = await call(viewer, "GET", "/api/auth/list-sessions");
      assert.equal(sessions.statusCode, 200);
      assert.ok(sessions.json().length);
      await post(viewer, "/api/auth/revoke-sessions", {});
      assert.equal(
        (await call(viewer, "GET", "/api/nav-index")).statusCode,
        401
      );
    });
    it("supports system-admin roles, bans and impersonation without promoting normal profile updates", async () => {
      await post(owner, "/api/auth/admin/set-role", {
        userId: viewer.id,
        role: "admin",
      });
      assert.equal(
        db.prepare("SELECT role FROM user WHERE id=?").get(viewer.id).role,
        "admin"
      );
      await post(owner, "/api/auth/admin/set-role", {
        userId: viewer.id,
        role: "user",
      });
      await post(owner, "/api/auth/admin/ban-user", {
        userId: viewer.id,
        banReason: "Test",
      });
      assert.equal(
        (
          await call(null, "POST", "/api/auth/sign-in/email", {
            email: viewer.email,
            password: "replacement-password",
          })
        ).statusCode,
        403
      );
      await post(owner, "/api/auth/admin/unban-user", { userId: viewer.id });
      const impersonate = await call(
        owner,
        "POST",
        "/api/auth/admin/impersonate-user",
        { userId: viewer.id }
      );
      assert.equal(impersonate.statusCode, 200, impersonate.body);
      const cookie = impersonate.headers["set-cookie"]
        .filter((s) => s.startsWith("better-auth.session_token="))
        .at(-1)
        .split(";")[0];
      const session = (
        await call({ cookie }, "GET", "/api/auth/get-session")
      ).json();
      assert.equal(session.session.impersonatedBy, owner.id);
      assert.equal(
        (
          await call(owner, "POST", "/api/auth/admin/set-role", {
            userId: owner.id,
            role: "user",
          })
        ).statusCode,
        403
      );
    });
    it("persists sessions and auth secrets across app restarts and migrates idempotently", async () => {
      const oldSecret = db
        .prepare("SELECT value FROM app_setting WHERE key='authSecret'")
        .get().value;
      await app.close();
      runtime = await (
        await import("../lib/auth.mjs")
      ).createAuthentication({
        db,
        env: { PORT: "5483" },
        mailer: { configured: true, send: async (...args) => mail.push(args) },
      });
      app = await require("../app").createApp({ authRuntime: runtime });
      assert.equal(
        db.prepare("SELECT value FROM app_setting WHERE key='authSecret'").get()
          .value,
        oldSecret
      );
      assert.equal(
        (await call(owner, "GET", "/api/rybbit/admin/organizations"))
          .statusCode,
        200
      );
      assert.equal(
        (await call(owner, "GET", "/api/rybbit/admin/database")).json()
          .integrity,
        "ok"
      );
      const database = (await call(owner, 'GET', '/api/rybbit/admin/database')).json();
      assert.ok(database.bytes > 0);
      assert.ok(database.tables.some(table => table.name === 'user' && table.rows > 0));
      const available = (await call(owner, 'GET', '/api/rybbit/properties/available')).json();
      assert.ok(available.properties.every(property => typeof property.domain === 'string'));
    });
    it("keeps private dashboards read-only and revokes old URLs immediately", async () => {
      const manifest = JSON.parse(
        await fs.readFile(
          path.resolve(__dirname, "../public/ui/.vite/manifest.json"),
          "utf8"
        )
      );
      assert.equal(
        (await call(null, "GET", "/ui/" + manifest["index.html"].file))
          .statusCode,
        200
      );
      const config = await post(
        owner,
        `/api/rybbit/sites/${first}/private-link-config`,
        { action: "generate_private_link_key" }
      );
      const key = config.data.privateLinkKey,
        headers = { "x-private-site": first, "x-private-key": key };
      const page = await call(null, "GET", `/${first}/${key}/main`);
      assert.equal(page.statusCode, 200, page.body.slice(0, 200));
      assert.equal(
        (
          await call(
            null,
            "GET",
            `/api/rybbit/sites/${first}`,
            undefined,
            headers
          )
        ).statusCode,
        200
      );
      assert.equal(
        (
          await call(
            null,
            "GET",
            `/api/rybbit/sites/${second}`,
            undefined,
            headers
          )
        ).statusCode,
        403
      );
      assert.equal(
        (
          await call(
            null,
            "GET",
            `/api/rybbit/sites/${first}/private-link-config`,
            undefined,
            headers
          )
        ).statusCode,
        403
      );
      assert.equal(
        (
          await call(
            null,
            "PUT",
            `/api/rybbit/sites/${first}/config`,
            { embedEnabled: true },
            headers
          )
        ).statusCode,
        403
      );
      await post(owner, `/api/rybbit/sites/${first}/private-link-config`, {
        action: "revoke_private_link_key",
      });
      assert.equal(
        (
          await call(
            null,
            "GET",
            `/api/rybbit/sites/${first}`,
            undefined,
            headers
          )
        ).statusCode,
        403
      );
      assert.equal(
        (
          await call(
            owner,
            "POST",
            "/api/rybbit/user/account-settings",
            { sendAutoEmailReports: false },
            { origin: "https://untrusted.example" }
          )
        ).statusCode,
        403
      );
      assert.equal((await call(null, "POST", "/mcp", {})).statusCode, 401);
    });
    it("moves property ownership without leaving grants and lets admins manage organizations they have not joined", async () => {
      const creator = await register("other-owner@example.com");
      assert.deepEqual(
        (await call(creator, "GET", "/api/nav-index")).json().sites,
        []
      );
      const target = await post(creator, "/api/auth/organization/create", {
        name: "Other org",
        slug: "other-org",
      });
      await post(creator, `/api/rybbit/organizations/${target.id}/members`, {
        email: viewer.email,
        role: "viewer",
      });
      const member = db
        .prepare("SELECT id FROM member WHERE userId=? AND organizationId=?")
        .get(viewer.id, target.id);
      assert.equal(
        (
          await call(
            owner,
            "DELETE",
            `/api/rybbit/admin/organizations/${target.id}/members/${member.id}`
          )
        ).statusCode,
        200
      );
      assert.equal(
        db.prepare("SELECT id FROM member WHERE id=?").get(member.id),
        undefined
      );
      assert.equal(
        (
          await call(
            owner,
            "DELETE",
            `/api/rybbit/admin/organizations/${target.id}/members/${
              db
                .prepare(
                  "SELECT id FROM member WHERE userId=? AND organizationId=?"
                )
                .get(creator.id, target.id).id
            }`
          )
        ).statusCode,
        403
      );
      assert.equal(
        (
          await call(owner, "PUT", `/api/rybbit/admin/sites/${first}/move`, {
            organizationId: target.id,
          })
        ).statusCode,
        200
      );
      assert.equal(runtime.access.siteRole({ userId: viewer.id }, first), null);
      assert.equal(
        runtime.access.siteRole({ userId: creator.id }, first),
        "owner"
      );
      assert.equal(
        db
          .prepare(
            "SELECT count(*) n FROM member_site_access WHERE propertyId=?"
          )
          .get(first).n,
        0
      );
      assert.equal(
        db
          .prepare("SELECT count(*) n FROM team_site_access WHERE propertyId=?")
          .get(first).n,
        0
      );
      await post(creator, "/api/auth/organization/delete", {
        organizationId: target.id,
      });
      assert.equal(
        runtime.access.siteRole({ userId: creator.id }, first),
        null
      );
      assert.equal(
        db
          .prepare(
            "SELECT organizationId FROM property_access WHERE propertyId=?"
          )
          .get(first).organizationId,
        ""
      );
    });
  });
}
if (process.env.METRIBEE_AUTH_TEST_CHILD === "1") integrationTests();
else
  describe("Fastify / SQLite user system (isolated demo runtime)", function () {
    this.timeout(30000);
    it("passes authentication, organization, team, scope and persistence integration checks", async () => {
      const { promisify } = require("node:util");
      await promisify(require("node:child_process").execFile)(
        process.execPath,
        [
          require.resolve("mocha/bin/mocha.js"),
          "--require",
          "ts-node/register/transpile-only",
          __filename,
          "--reporter",
          "dot",
        ],
        {
          cwd: path.resolve(__dirname, ".."),
          env: { ...process.env, DEMO: "1", METRIBEE_AUTH_TEST_CHILD: "1" },
        }
      );
    });
  });
