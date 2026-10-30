const { createBilling } = require("../lib/billing");
const { failure } = require("../lib/access");

async function billingRoutes(app, runtime, options = {}) {
  const billing = createBilling({ db: runtime.db, ...options });
  app.decorate("billing", billing);
  // Self-hosted has no billing routes, webhook receiver or reconciliation worker.
  if (!billing.cloud) return;
  const guard = (req) => {
    if (!req.identity?.userId || req.identity.bearer)
      throw failure("A signed-in user session is required.", 401);
    const organizationId = req.params.organizationId;
    runtime.access.requireOrg(req.identity, organizationId, "billing:manage");
    return organizationId;
  };
  const root = "/api/rybbit/organizations/:organizationId/billing";
  const paymentAction = async (operation) => {
    try {
      return await operation();
    } catch (error) {
      if (error.statusCode) throw error;
      // Provider errors may contain request or session data; keep them out of HTTP logs.
      throw failure(
        "The payment provider is temporarily unavailable. Please retry.",
        502
      );
    }
  };
  app.get(
    "/api/rybbit/organizations/:organizationId/subscription",
    async (req, reply) => {
      if (!req.identity?.userId || req.identity.bearer)
        throw failure("A signed-in user session is required.", 401);
      runtime.access.requireOrg(
        req.identity,
        req.params.organizationId,
        "org:read"
      );
      reply.header("Cache-Control", "no-store");
      const sub = billing.subscription(req.params.organizationId);
      return {
        id: sub?.orderId || "",
        planName: billing.cloud ? (sub ? "cloud" : "free") : "self-hosted",
        status:
          !billing.cloud || ["active", "canceling"].includes(sub?.status)
            ? "active"
            : sub
            ? "expired"
            : "free",
        currentPeriodStart: sub?.currentPeriodStart || "",
        currentPeriodEnd: sub?.currentPeriodEnd || "",
        createdAt: sub?.updatedAt || "",
        interval: sub?.interval === "yearly" ? "year" : "month",
        cancelAtPeriodEnd: sub?.status === "canceling",
        hasActiveSubscription: ["active", "canceling", "past_due"].includes(
          sub?.status
        ),
        monthlyEventCount: 0,
        eventLimit: 0,
        memberLimit: null,
        siteLimit: null,
        trialEligible: false,
      };
    }
  );
  app.get(root, async (req, reply) => {
    const id = guard(req);
    reply.header("Cache-Control", "no-store");
    return billing.summary(
      id,
      typeof req.query.checkout === "string" ? req.query.checkout : undefined
    );
  });
  app.post(`${root}/checkout`, async (req, reply) => {
    const id = guard(req);
    reply.header("Cache-Control", "no-store");
    const user = runtime.db
      .prepare("SELECT email FROM user WHERE id=?")
      .get(req.identity.userId);
    return paymentAction(() =>
      billing.checkout({
        organizationId: id,
        userId: req.identity.userId,
        email: user.email,
        planId: req.body?.planId,
        baseURL: runtime.baseURL,
        testPurchase: req.body?.testPurchase === true,
      })
    );
  });
  app.post(`${root}/portal`, async (req, reply) => {
    const id = guard(req);
    reply.header("Cache-Control", "no-store");
    return paymentAction(() => billing.portal(id));
  });
  app.post(`${root}/cancel`, async (req) => {
    const id = guard(req);
    const reasons = [
      "too_expensive",
      "missing_features",
      "not_using",
      "too_complex",
      "switching_competitor",
      "other",
    ];
    const feedback =
      req.body?.reason === undefined
        ? null
        : { reason: req.body.reason, details: req.body.details ?? "" };
    if (
      feedback &&
      (!reasons.includes(feedback.reason) ||
        typeof feedback.details !== "string" ||
        feedback.details.length > 2000)
    )
      throw failure(
        "Choose a valid cancellation reason and keep feedback within 2000 characters.",
        400
      );
    const sub = billing.subscription(id);
    const result = await paymentAction(() => billing.cancel(id));
    if (feedback)
      runtime.db
        .prepare(
          `INSERT INTO app_document(kind,propertyId,payload,updatedAt) VALUES(?,?,?,?)
      ON CONFLICT(kind,propertyId) DO UPDATE SET payload=excluded.payload,updatedAt=excluded.updatedAt`
        )
        .run(
          "billing-cancellation-feedback",
          `${billing.mode}:${sub.orderId}`,
          JSON.stringify({
            organizationId: id,
            userId: req.identity.userId,
            reason: feedback.reason,
            details: feedback.details.trim(),
          }),
          new Date().toISOString()
        );
    return result;
  });
  // Encapsulated parser preserves the exact signed bytes without affecting other JSON routes.
  await app.register(async (hook) => {
    hook.removeContentTypeParser("application/json");
    hook.addContentTypeParser(
      "application/json",
      { parseAs: "string" },
      (_req, body, done) => done(null, body)
    );
    hook.post(
      "/api/rybbit/billing/webhook",
      { config: { public: true } },
      async (req, reply) => {
        try {
          billing.receive(req.body, req.headers["x-waffo-signature"]);
        } catch (error) {
          return reply
            .code(error.statusCode || 401)
            .send({ error: "Invalid Waffo webhook." });
        }
        // Durable inbox is committed before acknowledgement. Processing is retried after failures/restarts.
        reply.code(200).send({ received: true });
        setImmediate(() => billing.drain().catch(() => {}));
      }
    );
  });
  const timer = setInterval(() => billing.drain().catch(() => {}), 60000);
  timer.unref();
  app.addHook("onClose", async () => {
    clearInterval(timer);
    await billing.drain();
  });
  app.addHook("onReady", async () => {
    setImmediate(() => billing.drain().catch(() => {}));
  });
}
module.exports = { billingRoutes };
