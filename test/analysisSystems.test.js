function integrationTests() {
  const assert = require("node:assert/strict");
  const fs = require("node:fs/promises");
  const os = require("node:os");
  const path = require("node:path");
  const { storage } = require("../lib/requestContext");
  const { openDatabase } = require("../lib/database");
  const { createAnalysisStore } = require("../lib/analysisStore");
  const { createRybbitHandler } = require("../controllers/rybbit");
  const {
    parseCardQuery,
    goalFilter,
  } = require("../controllers/analysisReports");
  const {
    createWeeklyReports,
    reportWindow,
  } = require("../lib/reports/weekly");

  describe("Native analysis systems / SQLite and GA4 adapters", function () {
    this.timeout(30000);
    let app,
      runtime,
      db,
      directory,
      previousDemo,
      owner,
      member,
      viewer,
      org,
      propertyId,
      secondId;
    const identity = (user) => ({
      userId: user.id,
      user,
      statements: null,
      bearer: false,
    });
    const scoped = (user, task) =>
      storage.run({ access: runtime.access, identity: identity(user) }, task);
    const store = (user, id = propertyId) =>
      createAnalysisStore({
        access: runtime.access,
        identity: identity(user),
        propertyId: id,
      });
    const call = (user, method, url, payload) =>
      app.inject({
        method,
        url,
        payload,
        headers: {
          origin: "http://localhost:5483",
          ...(user?.cookie ? { cookie: user.cookie } : {}),
        },
      });
    async function register(email) {
      const response = await call(null, "POST", "/api/auth/sign-up/email", {
        email,
        name: email.split("@")[0],
        password: "initial-password",
      });
      assert.equal(response.statusCode, 200, response.body);
      return {
        ...response.json().user,
        cookie: response.headers["set-cookie"][0].split(";")[0],
      };
    }
    before(async () => {
      previousDemo = process.env.DEMO;
      process.env.DEMO = "1";
      directory = await fs.mkdtemp(
        path.join(os.tmpdir(), "metribee-analysis-")
      );
      db = openDatabase(path.join(directory, "app.sqlite"));
      runtime = await (
        await import("../lib/auth.mjs")
      ).createAuthentication({
        db,
        env: { PORT: "5483" },
        mailer: { configured: false, send: async () => {} },
      });
      app = await require("../app").createApp({ authRuntime: runtime });
      runtime.access.syncProperties(
        (await require("../controllers/apiController").ensureProperties())
          .properties
      );
      owner = await register("analysis-owner@example.com");
      org = db.prepare("SELECT id FROM organization").get().id;
      [propertyId, secondId] = db
        .prepare(
          "SELECT propertyId FROM property_access ORDER BY propertyId LIMIT 2"
        )
        .all()
        .map((row) => row.propertyId);
      member = await register("analysis-member@example.com");
      viewer = await register("analysis-viewer@example.com");
      for (const [user, role] of [
        [member, "member"],
        [viewer, "viewer"],
      ]) {
        const response = await call(
          owner,
          "POST",
          `/api/rybbit/organizations/${org}/members`,
          { email: user.email, role }
        );
        assert.equal(response.statusCode, 200, response.body);
      }
    });
    after(async () => {
      await app?.close();
      db?.close();
      await fs.rm(directory, { recursive: true, force: true });
      if (previousDemo === undefined) delete process.env.DEMO;
      else process.env.DEMO = previousDemo;
    });
    const segment = {
      name: "Organic",
      filters: [
        { parameter: "channel", type: "equals", value: ["Organic Search"] },
      ],
    };
    it("persists native segment/annotation shapes and enforces ownership, organization scope and public visibility", async () => {
      const own = store(member).save("segments", segment);
      assert.equal(own.siteId, Number(propertyId));
      assert.equal(own.canEdit, true);
      assert.equal(store(owner).get("segments", own.segmentId).canEdit, true);
      assert.equal(store(viewer).get("segments", own.segmentId).canEdit, false);
      assert.throws(
        () => store(viewer).save("segments", { name: "Denied" }, own.segmentId),
        /permission/
      );
      const others = store(owner).save("segments", {
        ...segment,
        name: "Owner only",
      });
      assert.throws(
        () => store(member).remove("segments", others.segmentId),
        /cannot delete/
      );
      assert.throws(
        () =>
          store(member).save("segments", { ...segment, scope: "organization" }),
        /permission/
      );
      const organizationWide = store(owner).save("segments", {
        ...segment,
        scope: "organization",
        isPublic: true,
      });
      assert.equal(organizationWide.siteId, null);
      assert.ok(
        store(member, secondId)
          .list("segments")
          .some((row) => row.segmentId === organizationWide.segmentId)
      );
      assert.throws(
        () => store(owner, secondId).get("segments", own.segmentId),
        /not found/
      );
      const publicStore = createAnalysisStore({
        access: runtime.access,
        propertyId,
        shared: true,
      });
      assert.deepEqual(
        publicStore.list("segments").map((row) => row.segmentId),
        [organizationWide.segmentId]
      );
      assert.throws(
        () => publicStore.get("segments", own.segmentId),
        /not found/
      );
      assert.throws(
        () => publicStore.save("segments", segment),
        /authenticated/
      );
      const annotation = store(member).save("annotations", {
        title: "Launch",
        date: "2026-10-10T10:00:00Z",
        endDate: "2026-10-11T10:00:00Z",
        icon: "🚀",
        color: "amber",
      });
      assert.equal(annotation.userName, member.name);
      assert.equal(
        store(member).save(
          "annotations",
          { title: "New title" },
          annotation.annotationId
        ).date,
        annotation.date
      );
      assert.throws(
        () =>
          store(member).save(
            "annotations",
            { endDate: "2026-10-09" },
            annotation.annotationId
          ),
        /after/
      );
      assert.throws(
        () =>
          store(member).save("annotations", {
            title: "Bad",
            date: "2026-02-30",
          }),
        /ISO date/
      );
      assert.throws(
        () =>
          store(member).save("annotations", {
            title: "Bad",
            date: "2026-10-10",
            icon: "two",
          }),
        /emoji/
      );
      assert.throws(
        () =>
          store(member).save("segments", {
            ...segment,
            filters: [
              { parameter: "user_id", type: "equals", value: ["private"] },
            ],
          }),
        /does not expose/
      );
    });
    it("connects native HTTP CRUD, refuses viewer writes and preserves partial dashboard updates", async () => {
      const response = await call(
        owner,
        "POST",
        `/api/rybbit/sites/${propertyId}/dashboards`,
        { name: "Executive" }
      );
      assert.equal(response.statusCode, 200, response.body);
      const id = response.json().dashboardId;
      const update = await call(
        owner,
        "PUT",
        `/api/rybbit/sites/${propertyId}/dashboards/${id}`,
        {
          config: {
            cards: [
              {
                id: "traffic",
                title: "Traffic",
                sql: JSON.stringify({
                  dimensions: ["time"],
                  metrics: ["sessions"],
                }),
                vizType: "line",
                mapping: { xColumn: "time", yColumns: ["sessions"] },
                gridPos: { x: 0, y: 0, w: 6, h: 5 },
              },
            ],
          },
        }
      );
      assert.equal(update.statusCode, 200, update.body);
      const saved = await call(
        viewer,
        "GET",
        `/api/rybbit/sites/${propertyId}/dashboards/${id}`
      );
      assert.equal(saved.statusCode, 200, saved.body);
      assert.equal(saved.json().name, "Executive");
      assert.equal(saved.json().config.cards.length, 1);
      assert.equal(
        (
          await call(
            viewer,
            "DELETE",
            `/api/rybbit/sites/${propertyId}/dashboards/${id}`
          )
        ).statusCode,
        403
      );
      const annotation = await call(
        owner,
        "POST",
        `/api/rybbit/sites/${propertyId}/annotations`,
        { title: "Release", date: "2026-10-01" }
      );
      assert.equal(annotation.statusCode, 200, annotation.body);
      assert.ok(
        Array.isArray(
          (
            await call(
              viewer,
              "GET",
              `/api/rybbit/sites/${propertyId}/annotations`
            )
          ).json()
        )
      );
    });
    function mockGateway(run) {
      return createRybbitHandler({
        properties: async () => ({
          properties: [{ id: propertyId, timeZone: "UTC", site: "Example" }],
        }),
        run,
        read: async () => null,
        write: async () => {},
        now: () => new Date("2026-10-26T12:00:00Z"),
        backgroundRefresh: false,
      });
    }
    function invoke(
      gateway,
      action,
      query = {},
      body,
      method = "GET",
      user = owner
    ) {
      return scoped(user, async () => {
        let status = 200,
          payload;
        await gateway(
          { method, path: `/sites/${propertyId}/${action}`, query, body },
          {
            status(code) {
              status = code;
              return this;
            },
            send(value) {
              payload = value;
            },
          }
        );
        return { status, payload };
      });
    }
    it("counts goal sessions and the deduplicated any-goal union through the guarded report adapter", async () => {
      const a = store(owner).save("goals", {
        name: "Signup",
        goalType: "event",
        config: { eventName: "sign_up" },
      });
      const b = store(owner).save("goals", {
        name: "Purchase",
        goalType: "event",
        config: { eventName: "purchase" },
      });
      const calls = [];
      const gateway = mockGateway(async (request) => {
        calls.push(request);
        const json = JSON.stringify(request.dimensionFilter) || "";
        const value = json.includes("orGroup")
          ? 50
          : json.includes("sign_up")
          ? 30
          : json.includes("purchase")
          ? 40
          : 100;
        return {
          ok: true,
          rows: [{ metricValues: [{ value: String(value) }] }],
        };
      });
      const { status, payload } = await invoke(gateway, "goals/summary", {
        start_date: "2026-10-01",
        end_date: "2026-10-20",
      });
      assert.equal(status, 200, JSON.stringify(payload));
      assert.equal(payload.data.total_sessions, 100);
      assert.equal(payload.data.converting_sessions, 50);
      assert.equal(
        payload.data.goals.find((goal) => goal.goalId === a.goalId)
          .conversion_rate,
        0.3
      );
      assert.equal(
        payload.data.goals.find((goal) => goal.goalId === b.goalId)
          .total_conversions,
        40
      );
      assert.ok(
        calls.every(
          (call) =>
            call.propertyId === propertyId &&
            call.metrics[0].name === "sessions"
        )
      );
      const detail = await invoke(gateway, `goals/${a.goalId}/sessions`);
      assert.equal(detail.status, 422);
      const scopedKey = {
        ...identity(owner),
        bearer: true,
        statements: { goals: ["read"] },
      };
      await storage.run(
        { access: runtime.access, identity: scopedKey },
        async () => {
          let result;
          await gateway(
            {
              method: "POST",
              path: `/sites/${propertyId}/goals`,
              query: {},
              body: { goalType: "event", config: { eventName: "sign_up" } },
            },
            {
              status() {
                return this;
              },
              send(value) {
                result = value;
              },
            }
          );
          assert.match(result.error, /permission/);
        }
      );
    });
    it("runs dashboard metrics with period, filter, sorting and truncation; rejects SQL and unbounded queries", async () => {
      let request;
      const gateway = mockGateway(async (value) => {
        request = value;
        return {
          ok: true,
          rowCount: 3,
          rows: [
            {
              dimensionValues: [{ value: "US" }],
              metricValues: [{ value: "12" }, { value: ".4" }],
            },
          ],
        };
      });
      const result = await invoke(
        gateway,
        "dashboards/run-card",
        {},
        {
          startDate: "2026-10-01",
          endDate: "2026-10-20",
          query: JSON.stringify({
            dimensions: ["country"],
            metrics: ["sessions", "bounce_rate"],
            filters: segment.filters,
            limit: 1,
          }),
        },
        "POST"
      );
      assert.equal(result.status, 200, JSON.stringify(result.payload));
      assert.deepEqual(result.payload.data, [
        { country: "US", sessions: 12, bounce_rate: 40 },
      ]);
      assert.equal(result.payload.meta.truncated, true);
      assert.deepEqual(request.dateRange, {
        startDate: "2026-10-01",
        endDate: "2026-10-20",
      });
      assert.match(
        JSON.stringify(request.dimensionFilter),
        /sessionDefaultChannelGroup/
      );
      assert.equal(request.limit, 1);
      assert.equal(request.orderBys[0].metric.metricName, "sessions");
      assert.throws(
        () => parseCardQuery("SELECT * FROM events"),
        /GA4 dimensions/
      );
      assert.throws(() =>
        parseCardQuery({ metrics: ["sessions"], limit: 1000000 })
      );
      assert.throws(
        () => parseCardQuery({ metrics: ["sessions"], orderBy: "secret" }),
        /selected column/
      );
      assert.match(
        JSON.stringify(
          goalFilter({ goalType: "path", config: { pathPattern: "/docs/**" } })
        ),
        /FULL_REGEXP/
      );
      assert.match(
        JSON.stringify(
          goalFilter({
            goalType: "event",
            config: {
              eventName: "purchase",
              propertyFilters: [{ key: "plan", value: "pro" }],
            },
          })
        ),
        /customEvent:plan/
      );
    });
    it("expands saved segments before querying and rejects cross-property segment ids", async () => {
      const saved = store(owner).save("segments", {
        ...segment,
        name: "Reusable",
      });
      let report;
      const gateway = mockGateway(async (request) => {
        report = request;
        return { ok: true, rows: [] };
      });
      assert.equal(
        (await invoke(gateway, "overview", { segment_id: saved.segmentId }))
          .status,
        200
      );
      assert.match(JSON.stringify(report.dimensionFilter), /Organic Search/);
      const foreign = store(owner, secondId).save("segments", segment);
      assert.equal(
        (await invoke(gateway, "overview", { segment_id: foreign.segmentId }))
          .status,
        404
      );
    });
    it("exposes native definitions through MCP with the same grants and no Google calls", async () => {
      const service =
        require("../mcp-server/lib/dashboard").createDashboardService({
          properties: async () => ({
            properties: [{ id: propertyId, timeZone: "UTC" }],
          }),
          dataClient: () => {
            throw new Error("No Google calls allowed");
          },
          adminClient: () => {
            throw new Error("No Google calls allowed");
          },
        });
      const saved = await scoped(owner, () =>
        service.execute("save_analysis_definition", {
          propertyId,
          kind: "segments",
          definition: { ...segment, name: "MCP audience" },
        })
      );
      assert.equal(saved.apiCalls, 0);
      assert.equal(saved.data.name, "MCP audience");
      const denied = await scoped(viewer, () =>
        service.execute("delete_analysis_definition", {
          propertyId,
          kind: "segments",
          id: saved.data.segmentId,
        })
      );
      assert.ok(denied.error);
      const [ownerRows, viewerRows] = await Promise.all([
        scoped(owner, () =>
          service.execute("list_analysis_definitions", {
            propertyId,
            kind: "segments",
          })
        ),
        scoped(viewer, () =>
          service.execute("list_analysis_definitions", {
            propertyId,
            kind: "segments",
          })
        ),
      ]);
      assert.equal(
        ownerRows.data.find((row) => row.segmentId === saved.data.segmentId)
          .canEdit,
        true
      );
      assert.equal(
        viewerRows.data.find((row) => row.segmentId === saved.data.segmentId)
          .canEdit,
        false
      );
      const removed = await scoped(owner, () =>
        service.execute("delete_analysis_definition", {
          propertyId,
          kind: "segments",
          id: saved.data.segmentId,
        })
      );
      assert.equal(removed.data.success, true);
    });
    it("schedules complete UTC weeks, respects preferences and grants, and deduplicates deliveries durably", async () => {
      assert.deepEqual(reportWindow(new Date("2026-10-26T12:00:00Z")), {
        startDate: "2026-10-19",
        endDate: "2026-10-25",
        week: "2026-10-26",
      });
      const mail = [],
        collected = [];
      db.prepare("UPDATE user SET sendAutoEmailReports=0").run();
      db.prepare("UPDATE user SET sendAutoEmailReports=1 WHERE id=?").run(
        viewer.id
      );
      const memberId = db
        .prepare("SELECT id FROM member WHERE userId=? AND organizationId=?")
        .get(viewer.id, org).id;
      db.prepare("UPDATE member SET hasRestrictedSiteAccess=1 WHERE id=?").run(
        memberId
      );
      db.prepare(
        "INSERT INTO member_site_access(memberId,propertyId) VALUES(?,?)"
      ).run(memberId, propertyId);
      const oldDemo = process.env.DEMO;
      process.env.DEMO = "0";
      try {
        const scheduler = createWeeklyReports({
          runtime: {
            ...runtime,
            mailer: {
              configured: true,
              send: async (...args) => mail.push(args),
            },
          },
          now: () => new Date("2026-10-26T12:00:00Z"),
          properties: async () => ({
            properties: [
              { id: propertyId, site: "Allowed" },
              { id: secondId, site: "Forbidden" },
            ],
          }),
          collect: async ({ property, query }) => {
            collected.push(property.id);
            assert.equal(query.end_date, "2026-10-25");
            return {
              siteId: Number(property.id),
              siteName: "Allowed",
              overview: {
                sessions: 100,
                pageviews: 200,
                users: 80,
                session_duration: 30,
                pages_per_session: 2,
                bounce_rate: 40,
              },
              previousOverview: { sessions: 50 },
              topCountries: [],
              topPages: [],
              topReferrers: [],
              deviceBreakdown: [],
            };
          },
        });
        await scheduler.run();
        await scheduler.run();
        assert.deepEqual(collected, [propertyId]);
        assert.equal(mail.length, 1);
        assert.equal(mail[0][0], viewer.email);
        assert.match(mail[0][4].html, /localhost:5483\/settings\/account/);
        assert.doesNotMatch(mail[0][4].html, /app\.rybbit\.io/);
        assert.equal(
          db
            .prepare(
              "SELECT count(*) n FROM email_report_delivery WHERE status='sent'"
            )
            .get().n,
          1
        );
      } finally {
        process.env.DEMO = oldDemo;
      }
    });
    it("does not requery empty or failed weekly reports every minute", async () => {
      const previous = process.env.DEMO;
      process.env.DEMO = "0";
      try {
        for (const [date, status] of [
          ["2026-11-02", "data_failed"],
          ["2026-11-09", "no_data"],
        ]) {
          let calls = 0;
          const scheduler = createWeeklyReports({
            runtime: {
              ...runtime,
              mailer: {
                configured: true,
                send: async () => {
                  throw new Error("No mail expected");
                },
              },
            },
            now: () => new Date(date + "T12:00:00Z"),
            logger: { error() {} },
            properties: async () => ({
              properties: [{ id: propertyId, site: "Allowed" }],
            }),
            collect: async () => {
              calls++;
              if (status === "data_failed") throw new Error("GA4 unavailable");
              return { overview: { pageviews: 0 } };
            },
          });
          await scheduler.run();
          await scheduler.run();
          assert.equal(calls, 1);
          assert.equal(
            db
              .prepare(
                "SELECT count(*) n FROM email_report_delivery WHERE status=?"
              )
              .get(status).n,
            1
          );
        }
      } finally {
        process.env.DEMO = previous;
      }
    });
  });
}
if (process.env.METRIBEE_ANALYSIS_TEST_CHILD === "1") integrationTests();
else
  describe("Native analysis systems (isolated demo runtime)", function () {
    this.timeout(30000);
    it("passes native definition, GA4 query, permission and weekly delivery checks", async () => {
      await require("node:util").promisify(
        require("node:child_process").execFile
      )(
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
          cwd: require("node:path").resolve(__dirname, ".."),
          env: { ...process.env, DEMO: "1", METRIBEE_ANALYSIS_TEST_CHILD: "1" },
        }
      );
    });
  });
