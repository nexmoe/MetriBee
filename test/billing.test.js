const assert = require("node:assert/strict");
const { generateKeyPairSync, sign } = require("node:crypto");
const { verifyWebhook } = require("@waffo/pancake-ts");
const { openDatabase } = require("../lib/database");
const { createBilling } = require("../lib/billing");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

function suite() {
  describe("Waffo organization billing", function () {
    this.timeout(30000);
    let db, billing, app, runtime, directory, owner, viewer, orgId, foreign;
    let calls, order, failLookup, failCreate;
    const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicKey = keys.publicKey.export({ type: "spki", format: "pem" });
    const fakeSDK = {
      checkout: {
        authenticated: {
          async create(params, options) {
            calls.push({ params, options });
            if (failCreate)
              throw Error(
                "Provider request failed with secret material that must not be logged."
              );
            return {
              sessionId: "cs_test",
              checkoutUrl:
                "https://pancake.waffo.ai/store/test/checkout/cs_test#token=private",
              expiresAt: new Date(Date.now() + 3600000).toISOString(),
            };
          },
          async createPlanChange(params, options) {
            calls.push({ params, options });
            return {
              sessionId: "cs_change",
              checkoutUrl:
                "https://pancake.waffo.ai/store/test/change/cs_change",
              expiresAt: new Date(Date.now() + 3600000).toISOString(),
            };
          },
        },
      },
      auth: {
        async createCustomerPortalLink(params) {
          calls.push({ portal: params });
          return {
            portalUrl: "https://pancake.waffo.ai/consumer/portal#token=private",
          };
        },
      },
      orders: {
        async cancelSubscription(params, options) {
          assert.match(options.idempotencyKey, /^[A-Za-z0-9_-]{1,256}$/);
          calls.push({ cancel: params });
          return { status: "canceling" };
        },
      },
      graphql: {
        async query({ query }) {
          if (failLookup) throw Error("temporary outage");
          const field = query.includes("onetimeOrders")
            ? "onetimeOrders"
            : "subscriptionOrders";
          return {
            data: {
              [field]: [
                {
                  ...order,
                  onetimeProduct: { id: order.productId },
                  subscriptionProduct: { id: order.productId },
                  metadata: JSON.stringify(order.metadata),
                },
              ],
            },
          };
        },
      },
    };
    const signEvent = (event, t = Date.now()) => {
      const raw = JSON.stringify(event, null, 2);
      // Fixture signing only. Real requests and webhook verification use the official SDK.
      const signature = `t=${t},v1=${sign(
        "RSA-SHA256",
        Buffer.from(`${t}.${raw}`),
        keys.privateKey
      ).toString("base64")}`;
      return { raw, signature };
    };
    const event = (type = "subscription.activated", data = {}) => ({
      id: "event-entity",
      timestamp: new Date().toISOString(),
      eventId: "business-event",
      eventType: type,
      mode: "test",
      storeId: "STO_test",
      data: {
        orderId: "ORD_test",
        orderMerchantExternalId: order?.orderMerchantExternalId,
        ...data,
      },
    });
    const call = (actor, method, url, payload, extra = {}) =>
      app.inject({
        method,
        url,
        headers: {
          origin: "http://localhost:5483",
          ...(actor ? { cookie: actor.cookie } : {}),
          ...extra,
        },
        ...(payload === undefined ? {} : { payload }),
      });
    async function register(email) {
      const response = await call(null, "POST", "/api/auth/sign-up/email", {
        email,
        name: email.split("@")[0],
        password: "billing-test-password",
      });
      assert.equal(response.statusCode, 200, response.body);
      return {
        id: response.json().user.id,
        cookie: response.headers["set-cookie"][0].split(";")[0],
      };
    }
    before(async () => {
      process.env.DEMO = "1";
      directory = await fs.mkdtemp(path.join(os.tmpdir(), "metribee-billing-"));
      db = openDatabase(path.join(directory, "billing.sqlite"));
      runtime = await (
        await import("../lib/auth.mjs")
      ).createAuthentication({
        db,
        env: { PORT: "5483", CLOUD: "true", WAFFO_MODE: "test" },
        mailer: { configured: false, send: async () => {} },
      });
      app = await require("../app").createApp({
        authRuntime: runtime,
        billingOptions: {
          client: fakeSDK,
          mode: "test",
          cloud: true,
          verify: (raw, sig, options) =>
            verifyWebhook(raw, sig, { ...options, publicKey }),
        },
      });
      await app.ready();
      await register("billing-system-admin@example.com");
      owner = await register("billing-owner@example.com");
      const owned = await call(owner, "POST", "/api/auth/organization/create", {
        name: "Billing org",
        slug: "billing-org",
      });
      assert.equal(owned.statusCode, 200, owned.body);
      orgId = owned.json().id;
      viewer = await register("billing-viewer@example.com");
      const other = await call(
        viewer,
        "POST",
        "/api/auth/organization/create",
        { name: "Other org", slug: "other-org" }
      );
      assert.equal(other.statusCode, 200, other.body);
      foreign = other.json().id;
      const add = await call(
        owner,
        "POST",
        `/api/rybbit/organizations/${orgId}/members`,
        { email: "billing-viewer@example.com", role: "viewer" }
      );
      assert.equal(add.statusCode, 200, add.body);
      db.prepare("INSERT INTO app_setting VALUES(?,?)").run(
        "waffo.test.catalog",
        JSON.stringify({
          storeId: "STO_test",
          plans: [
            {
              id: "standard-monthly",
              productId: "PROD_month",
              name: "Standard",
              interval: "monthly",
              amount: "19.00",
              currency: "USD",
              type: "subscription",
            },
            {
              id: "pro-yearly",
              productId: "PROD_year",
              name: "Pro",
              interval: "yearly",
              amount: "299.00",
              currency: "USD",
              type: "subscription",
            },
          ],
          testProduct: {
            id: "verify",
            productId: "PROD_verify",
            currency: "USD",
            amount: "1.00",
            type: "onetime",
          },
        })
      );
      billing = app.billing;
      calls = [];
    });
    after(async () => {
      await app?.close();
      db?.close();
      await fs.rm(directory, { recursive: true, force: true });
    });
    it("allows only owner sessions to see billing or create checkout, independently of GA4 setup", async () => {
      const root = `/api/rybbit/organizations/${orgId}/billing`;
      assert.equal((await call(null, "GET", root)).statusCode, 401);
      assert.equal((await call(viewer, "GET", root)).statusCode, 403);
      assert.equal(
        (
          await call(viewer, "POST", root + "/checkout", {
            planId: "standard-monthly",
          })
        ).statusCode,
        403
      );
      const result = await call(owner, "GET", root);
      assert.equal(result.statusCode, 200, result.body);
      assert.equal(result.headers["cache-control"], "no-store");
      assert.equal(result.json().plans[0].amount, "19.00");
      const keyResponse = await call(
        owner,
        "POST",
        "/api/rybbit/user/api-keys",
        {
          name: "Billing scope check",
          permissions: { org: ["read"], analytics: ["read"] },
        }
      );
      assert.equal(keyResponse.statusCode, 200, keyResponse.body);
      assert.equal(
        (
          await call(null, "GET", root, undefined, {
            authorization: `Bearer ${keyResponse.json().key}`,
          })
        ).statusCode,
        401
      );
      assert.equal(
        (
          await call(
            owner,
            "GET",
            `/api/rybbit/organizations/${foreign}/billing`
          )
        ).statusCode,
        403
      );
      const scope = await call(
        viewer,
        "GET",
        `/api/rybbit/organizations/${orgId}/subscription`
      );
      assert.equal(scope.statusCode, 200);
    });
    it("binds checkout to the authenticated organization and server price, reusing its pending session", async () => {
      const url = `/api/rybbit/organizations/${orgId}/billing/checkout`;
      let response = await call(owner, "POST", url, {
        planId: "standard-monthly",
        amount: "0.01",
        buyerIdentity: "other-org",
        successUrl: "https://evil.example",
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].params.productId, "PROD_month");
      assert.equal(calls[0].params.currency, "USD");
      assert.equal(calls[0].params.priceSnapshot, undefined);
      assert.equal(calls[0].params.buyerIdentity, `metribee-org-${orgId}`);
      assert.match(
        calls[0].params.successUrl,
        /^http:\/\/localhost:5483\/settings\/billing\?checkout=/
      );
      assert.match(calls[0].options.idempotencyKey, /^metribee-checkout-/);
      response = await call(owner, "POST", url, { planId: "standard-monthly" });
      assert.equal(response.statusCode, 200);
      assert.equal(calls.length, 1);
      assert.equal(
        (await call(owner, "POST", url, { planId: "pro-yearly" })).statusCode,
        409
      );
      const attempt = db.prepare("SELECT * FROM billing_checkout").get();
      order = {
        id: "ORD_test",
        productId: "PROD_month",
        status: "active",
        currency: "USD",
        metadata: { metribeeCheckoutId: attempt.id },
        orderMerchantExternalId: attempt.id,
        merchantProvidedBuyerIdentity: `metribee-org-${orgId}`,
        billingPeriod: "monthly",
        currentPeriodStart: "2026-10-26",
        currentPeriodEnd: "2026-11-26T09:03:05.000Z",
        priceSnapshot: { regularPhase: { total: "19.00" } },
      };
    });
    it("verifies exact signed bytes, rejects altered payloads and replayed signatures", async () => {
      const e = event();
      const { raw, signature } = signEvent(e);
      assert.throws(() => billing.receive(raw + " ", signature), /signature/);
      const stale = signEvent(e, Date.now() - 46 * 60000);
      assert.throws(
        () => billing.receive(stale.raw, stale.signature),
        /tolerance/
      );
      const badMode = signEvent({ ...e, mode: "prod" });
      assert.throws(
        () => billing.receive(badMode.raw, badMode.signature),
        /mismatch/
      );
      const badStore = signEvent({ ...e, storeId: "STO_other" });
      assert.throws(
        () => billing.receive(badStore.raw, badStore.signature),
        /mismatch/
      );
      const response = await app.inject({
        method: "POST",
        url: "/api/rybbit/billing/webhook",
        headers: {
          "content-type": "application/json",
          "x-waffo-signature": signature,
        },
        payload: raw,
      });
      assert.equal(response.statusCode, 200, response.body);
      await new Promise((resolve) => setImmediate(resolve));
      await billing.drain();
      assert.equal(billing.subscription(orgId).status, "active");
      billing.receive(raw, signature);
      await billing.drain();
      assert.equal(
        db.prepare("SELECT count(*) n FROM billing_webhook").get().n,
        1
      );
    });
    it("persists failed inbox events for retries and reconciles provider state rather than event arrival order", async () => {
      failLookup = true;
      const payment = signEvent(
        event("subscription.payment_succeeded", {
          paymentId: "PAY_one",
          chargedAmount: "19.00",
        })
      );
      const id = billing.receive(payment.raw, payment.signature);
      await billing.drain();
      assert.equal(
        db.prepare("SELECT status FROM billing_webhook WHERE id=?").get(id)
          .status,
        "failed"
      );
      failLookup = false;
      await billing.drain();
      assert.equal(billing.summary(orgId).payments[0].amount, "19.00");
      order.status = "canceling";
      const late = signEvent(event("subscription.activated"));
      billing.receive(late.raw, late.signature);
      await billing.drain();
      assert.equal(billing.subscription(orgId).status, "canceling");
      const response = await call(
        owner,
        "POST",
        "/api/auth/organization/delete",
        { organizationId: orgId }
      );
      assert.notEqual(response.statusCode, 200);
    });
    it("does not fulfill a signed event whose provider order belongs to another organization", async () => {
      const before = billing.subscription(orgId).status;
      order.status = "active";
      order.merchantProvidedBuyerIdentity = "metribee-org-foreign";
      const signed = signEvent(event("subscription.uncanceled"));
      const id = billing.receive(signed.raw, signed.signature);
      await billing.drain();
      assert.equal(
        db.prepare("SELECT status FROM billing_webhook WHERE id=?").get(id)
          .status,
        "failed"
      );
      assert.equal(billing.subscription(orgId).status, before);
      order.merchantProvidedBuyerIdentity = `metribee-org-${orgId}`;
    });
    it("keeps self-hosted usable without payment credentials and rejects checkout there", async () => {
      const own = createBilling({ db, cloud: false, mode: "prod" });
      assert.equal(own.cloud, false);
      assert.equal(own.subscription(orgId), null);
      assert.throws(() => own.summary(orgId), /only enabled/);
      assert.throws(() => own.receive("{}", "unused"), /only enabled/);
      await own.drain();
      await assert.rejects(
        () => own.checkout({ organizationId: orgId, planId: "anything" }),
        /only enabled/
      );
      await assert.rejects(() => own.portal(orgId), /only enabled/);
      await assert.rejects(() => own.cancel(orgId), /only enabled/);
    });
    it("binds billing portal access and plan changes to the same organization identity", async () => {
      await billing.drain(); // Retry the previously mismatched event with the corrected authoritative fixture.
      const result = await call(
        owner,
        "POST",
        `/api/rybbit/organizations/${orgId}/billing/portal`,
        { buyerIdentity: "other-customer" }
      );
      assert.equal(result.statusCode, 200, result.body);
      assert.equal(calls.at(-1).portal.buyerIdentity, `metribee-org-${orgId}`);
      const changed = await call(
        owner,
        "POST",
        `/api/rybbit/organizations/${orgId}/billing/checkout`,
        { planId: "pro-yearly" }
      );
      assert.equal(changed.statusCode, 200, changed.body);
      assert.equal(calls.at(-1).params.originOrderId, "ORD_test");
      assert.equal(calls.at(-1).params.productId, "PROD_year");
      assert.equal(billing.subscription(orgId).productId, "PROD_month");
      const attempt = db
        .prepare(
          "SELECT * FROM billing_checkout WHERE status='pending' AND organizationId=?"
        )
        .get(orgId);
      order = {
        ...order,
        id: "ORD_changed",
        productId: "PROD_year",
        orderMerchantExternalId: attempt.id,
        metadata: { metribeeCheckoutId: attempt.id },
        billingPeriod: "yearly",
        priceSnapshot: { regularPhase: { total: "299.00" } },
      };
      const signed = signEvent(
        event("subscription.plan_changed", { orderId: order.id })
      );
      billing.receive(signed.raw, signed.signature);
      await billing.drain();
      assert.equal(billing.subscription(orgId).productId, "PROD_year");
      assert.equal(
        billing.summary(orgId, attempt.id).checkout.status,
        "completed"
      );
      const invalidFeedback = await call(
        owner,
        "POST",
        `/api/rybbit/organizations/${orgId}/billing/cancel`,
        { reason: "missing_features", details: "x".repeat(2001) }
      );
      assert.equal(invalidFeedback.statusCode, 400, invalidFeedback.body);
      const canceled = await call(
        owner,
        "POST",
        `/api/rybbit/organizations/${orgId}/billing/cancel`,
        { reason: "missing_features", details: "Scheduled report controls" }
      );
      assert.equal(canceled.statusCode, 200, canceled.body);
      const feedback = JSON.parse(
        db
          .prepare(
            "SELECT payload FROM app_document WHERE kind='billing-cancellation-feedback' AND propertyId=?"
          )
          .get("test:ORD_changed").payload
      );
      assert.equal(feedback.organizationId, orgId);
      assert.equal(feedback.userId, owner.id);
      assert.equal(feedback.reason, "missing_features");
      assert.equal(billing.subscription(orgId).status, "active");
      order.status = "canceling";
      const cancellation = signEvent(
        event("subscription.canceling", { orderId: order.id })
      );
      billing.receive(cancellation.raw, cancellation.signature);
      await billing.drain();
      assert.equal(billing.subscription(orgId).status, "canceling");
      const other = new (require("better-sqlite3"))(
        path.join(directory, "billing.sqlite")
      );
      try {
        assert.equal(
          createBilling({
            db: other,
            client: fakeSDK,
            mode: "test",
            cloud: true,
          }).subscription(orgId).status,
          "canceling"
        );
      } finally {
        other.close();
      }
    });
    it("records one-time order.completed payments without granting an organization subscription", async () => {
      const result = await call(
        viewer,
        "POST",
        `/api/rybbit/organizations/${foreign}/billing/checkout`,
        { testPurchase: true }
      );
      assert.equal(result.statusCode, 200, result.body);
      const attempt = db
        .prepare("SELECT * FROM billing_checkout WHERE organizationId=?")
        .get(foreign);
      order = {
        id: "ORD_one",
        productId: "PROD_verify",
        status: "completed",
        currency: "USD",
        orderMerchantExternalId: attempt.id,
        metadata: { metribeeCheckoutId: attempt.id },
        merchantProvidedBuyerIdentity: `metribee-org-${foreign}`,
        priceSnapshot: { total: "1.00" },
      };
      const signed = signEvent(
        event("order.completed", {
          orderId: order.id,
          paymentId: "PAY_once",
          chargedAmount: "1.00",
        })
      );
      billing.receive(signed.raw, signed.signature);
      await billing.drain();
      assert.equal(billing.subscription(foreign), null);
      assert.equal(billing.summary(foreign).payments[0].amount, "1.00");
      assert.equal(billing.summary(orgId).payments.length, 1);
    });
    it("recovers the same checkout after a provider outage and expires abandoned attempts", async () => {
      const url = `/api/rybbit/organizations/${foreign}/billing/checkout`;
      failCreate = true;
      const first = await call(viewer, "POST", url, {
        planId: "standard-monthly",
      });
      assert.equal(first.statusCode, 502);
      assert.doesNotMatch(first.body, /secret material/);
      const attempt = db
        .prepare(
          "SELECT * FROM billing_checkout WHERE organizationId=? AND status='creating'"
        )
        .get(foreign);
      assert.ok(attempt.expiresAt);
      failCreate = false;
      const retry = await call(viewer, "POST", url, {
        planId: "standard-monthly",
      });
      assert.equal(retry.statusCode, 200, retry.body);
      assert.equal(calls.at(-1).params.orderMerchantExternalId, attempt.id);
      assert.equal(
        calls.at(-1).options.idempotencyKey,
        calls.at(-2).options.idempotencyKey
      );
      db.prepare(
        "UPDATE billing_checkout SET status='creating',expiresAt=? WHERE id=?"
      ).run(new Date(Date.now() - 1000).toISOString(), attempt.id);
      const next = await call(viewer, "POST", url, { planId: "pro-yearly" });
      assert.equal(next.statusCode, 200, next.body);
      assert.notEqual(calls.at(-1).params.orderMerchantExternalId, attempt.id);
    });
    it("keeps restored Cloud billing data inert in self-hosted HTTP, workers and organization management", async () => {
      await billing.drain();
      const selfRuntime = await (await import("../lib/auth.mjs")).createAuthentication({
        db,
        env: { PORT: "5483", CLOUD: "false" },
        mailer: { configured: false, send: async () => {} },
      });
      const self = await require("../app").createApp({
        authRuntime: selfRuntime,
        billingOptions: { cloud: false, mode: "test", client: fakeSDK },
      });
      const invoke = (method, url, payload, signedIn = true) => self.inject({
        method, url,
        headers: { origin: "http://localhost:5483", ...(signedIn ? { cookie: owner.cookie } : {}) },
        ...(payload === undefined ? {} : { payload }),
      });
      const pendingId = "self-hosted-must-not-process";
      db.prepare("INSERT INTO billing_webhook(id,mode,eventType,payload,receivedAt) VALUES(?,?,?,?,?)")
        .run(pendingId, "test", "subscription.activated", "{}", new Date().toISOString());
      const callCount = calls.length;
      try {
        await self.ready();
        const root = `/api/rybbit/organizations/${orgId}/billing`;
        for (const signedIn of [true, false]) {
          for (const [method, url, payload] of [
            ["GET", "/settings/billing"],
            ["GET", "/zh/settings/billing/"],
            ["GET", "/subscribe"],
            ["GET", "/zh/subscribe/"],
            ["GET", root],
            ["GET", `/api/rybbit/organizations/${orgId}/subscription`],
            ["POST", `${root}/checkout`, { planId: "standard-monthly" }],
            ["POST", `${root}/portal`, {}],
            ["POST", `${root}/cancel`, {}],
            ["POST", "/api/rybbit/billing/webhook", {}],
          ]) {
            const result = await invoke(method, url, payload, signedIn);
            assert.equal(result.statusCode, 404, `${method} ${url}: ${result.body}`);
          }
        }
        const account = await invoke("GET", "/settings/account");
        assert.equal(account.statusCode, 200, account.body);
        assert.match(account.body, /"cloud":false/);
        assert.equal((await invoke("GET", `/api/rybbit/organizations/${orgId}/members`)).statusCode, 200);
        const created = await invoke("POST", "/api/auth/organization/create", { name: "Restored self-hosted", slug: "restored-self-hosted" });
        assert.equal(created.statusCode, 200, created.body);
        const id = created.json().id;
        db.prepare("INSERT INTO billing_subscription SELECT ?,mode,orderId||'-restored',productId,status,currency,amount,interval,currentPeriodStart,currentPeriodEnd,updatedAt FROM billing_subscription WHERE organizationId=?")
          .run(id, orgId);
        db.prepare("INSERT INTO billing_checkout(id,organizationId,userId,mode,productId,productType,status,createdAt,expiresAt) VALUES(?,?,?,?,?,?,?,?,?)")
          .run("self-hosted-restored-checkout", id, owner.id, "test", "PROD_month", "subscription", "pending", new Date().toISOString(), new Date(Date.now()+3600000).toISOString());
        const removed = await invoke("POST", "/api/auth/organization/delete", { organizationId: id });
        assert.equal(removed.statusCode, 200, removed.body);
        await self.billing.drain();
        assert.equal(self.billing.subscription(orgId), null);
        assert.throws(() => self.billing.summary(orgId), /only enabled/);
      } finally {
        await self.close();
        assert.equal(db.prepare("SELECT status FROM billing_webhook WHERE id=?").get(pendingId).status, "pending");
        assert.equal(calls.length, callCount, "Self-hosted must never call Waffo, including at startup or shutdown.");
        db.prepare("DELETE FROM billing_webhook WHERE id=?").run(pendingId);
      }
    });
  });
}
if (process.env.METRIBEE_BILLING_TEST_CHILD === "1") suite();
else
  describe("Waffo billing (isolated SQLite runtime)", function () {
    this.timeout(60000);
    it("passes signed webhook, organization authorization and checkout persistence checks", async () => {
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
          cwd: path.resolve(__dirname, ".."),
          env: { ...process.env, DEMO: "1", METRIBEE_BILLING_TEST_CHILD: "1" },
        }
      );
    });
  });
