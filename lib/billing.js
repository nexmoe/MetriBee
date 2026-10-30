const { randomUUID, createHash } = require("node:crypto");
const { WaffoPancake, verifyWebhook } = require("@waffo/pancake-ts");
const { failure } = require("./access");

const isCloud = () => process.env.CLOUD === "true";
const billingMode = () => (process.env.WAFFO_MODE === "prod" ? "prod" : "test");
const configured = () =>
  !!(process.env.WAFFO_MERCHANT_ID && process.env.WAFFO_PRIVATE_KEY);
const events = [
  "order.completed",
  "subscription.activated",
  "subscription.payment_succeeded",
  "subscription.canceling",
  "subscription.uncanceled",
  "subscription.plan_changed",
  "subscription.canceled",
  "subscription.past_due",
  "refund.succeeded",
  "refund.failed",
];

function createBilling({
  db,
  client,
  mode = billingMode(),
  verify = verifyWebhook,
  cloud = isCloud(),
}) {
  const sdk = () => {
    if (client) return client;
    if (!configured()) throw failure("Waffo payments are not configured.", 503);
    return new WaffoPancake({
      merchantId: process.env.WAFFO_MERCHANT_ID,
      privateKey: process.env.WAFFO_PRIVATE_KEY,
      environment: mode,
      fetch: (url, options) =>
        fetch(url, { ...options, signal: AbortSignal.timeout(30000) }),
    });
  };
  const catalog = () => {
    const row = db
      .prepare("SELECT value FROM app_setting WHERE key=?")
      .get(`waffo.${mode}.catalog`);
    return row ? JSON.parse(row.value) : { storeId: null, plans: [] };
  };
  const buyerIdentity = (organizationId) => `metribee-org-${organizationId}`;
  function subscription(organizationId) {
    if (!cloud) return null;
    return (
      db
        .prepare(
          "SELECT * FROM billing_subscription WHERE organizationId=? AND mode=?"
        )
        .get(organizationId, mode) || null
    );
  }
  function summary(organizationId, checkoutId) {
    assertEnabled();
    const c = catalog();
    return {
      provider: "waffo",
      cloud,
      mode,
      configured:
        !!(client || configured()) && !!c.storeId && c.plans.length > 0,
      plans: c.plans.filter((p) => p.type === "subscription"),
      subscription: subscription(organizationId),
      checkout: checkoutId
        ? db
            .prepare(
              "SELECT status,productType FROM billing_checkout WHERE id=? AND organizationId=? AND mode=?"
            )
            .get(checkoutId, organizationId, mode) || null
        : null,
      payments: db
        .prepare(
          "SELECT * FROM billing_payment WHERE organizationId=? AND mode=? ORDER BY createdAt DESC LIMIT 100"
        )
        .all(organizationId, mode),
    };
  }
  function assertEnabled() {
    if (!cloud)
      throw failure("Billing is only enabled for MetriBee Cloud.", 404);
  }
  const locks = new Map();
  async function checkout({
    organizationId,
    userId,
    email,
    planId,
    baseURL,
    testPurchase = false,
  }) {
    assertEnabled();
    const c = catalog();
    const plan =
      testPurchase && mode === "test"
        ? c.testProduct
        : c.plans.find((p) => p.id === planId && p.type === "subscription");
    if (!plan || !c.storeId)
      throw failure("Choose a configured billing plan.", 400);
    if (locks.has(organizationId))
      throw failure("A checkout is already being created. Please retry.", 409);
    locks.set(organizationId, true);
    try {
      const now = new Date().toISOString();
      const current = subscription(organizationId);
      if (!testPurchase && current?.status === "past_due")
        throw failure(
          "Resolve the outstanding payment in the billing portal first.",
          409
        );
      if (!testPurchase && current?.status === "canceling")
        throw failure(
          "Resume or finish canceling your current subscription in the billing portal first.",
          409
        );
      const change = !testPurchase && current?.status === "active";
      if (change && current.productId === plan.productId)
        throw failure("This plan is already active.", 409);
      let attempt = db
        .transaction(() => {
          db.prepare(
            "UPDATE billing_checkout SET status='expired' WHERE organizationId=? AND mode=? AND status IN ('creating','pending') AND expiresAt<=?"
          ).run(organizationId, mode, now);
          let existing = db
            .prepare(
              "SELECT * FROM billing_checkout WHERE organizationId=? AND mode=? AND status IN ('creating','pending')"
            )
            .get(organizationId, mode);
          if (existing && existing.productId !== plan.productId)
            throw failure(
              "Finish the open checkout before choosing another plan.",
              409
            );
          if (!existing) {
            const id = randomUUID();
            db.prepare(
              "INSERT INTO billing_checkout(id,organizationId,userId,mode,productId,productType,status,createdAt,expiresAt) VALUES(?,?,?,?,?,?,?,?,?)"
            ).run(
              id,
              organizationId,
              userId,
              mode,
              plan.productId,
              plan.type,
              "creating",
              now,
              new Date(Date.now() + 3600000).toISOString()
            );
            existing = db
              .prepare("SELECT * FROM billing_checkout WHERE id=?")
              .get(id);
          }
          return existing;
        })
        .immediate();
      if (attempt.status === "pending")
        return {
          checkoutUrl: attempt.checkoutUrl,
          sessionId: attempt.sessionId,
          expiresAt: attempt.expiresAt,
        };
      const params = {
        productId: plan.productId,
        currency: plan.currency,
        buyerIdentity: buyerIdentity(organizationId),
        successUrl: `${baseURL.replace(/\/$/, "")}/settings/billing?checkout=${
          attempt.id
        }`,
        metadata: { metribeeCheckoutId: attempt.id, organizationId },
        orderMerchantExternalId: attempt.id,
        expiresInSeconds: 3600,
        ...(change
          ? { originOrderId: current.orderId }
          : { buyerEmail: email }),
      };
      const session = change
        ? await sdk().checkout.authenticated.createPlanChange(params, {
            idempotencyKey: `metribee-change-${attempt.id}`,
          })
        : await sdk().checkout.authenticated.create(params, {
            idempotencyKey: `metribee-checkout-${attempt.id}`,
          });
      const url = new URL(session.checkoutUrl);
      if (url.protocol !== "https:" || url.hostname !== "pancake.waffo.ai")
        throw failure("Unexpected checkout destination.", 502);
      db.prepare(
        "UPDATE billing_checkout SET status='pending',sessionId=?,checkoutUrl=?,expiresAt=? WHERE id=?"
      ).run(
        session.sessionId,
        session.checkoutUrl,
        session.expiresAt,
        attempt.id
      );
      return {
        checkoutUrl: session.checkoutUrl,
        sessionId: session.sessionId,
        expiresAt: session.expiresAt,
      };
    } finally {
      locks.delete(organizationId);
    }
  }
  async function portal(organizationId) {
    assertEnabled();
    const c = catalog();
    if (!c.storeId) throw failure("Waffo payments are not configured.", 503);
    const { portalUrl } = await sdk().auth.createCustomerPortalLink({
      storeId: c.storeId,
      buyerIdentity: buyerIdentity(organizationId),
    });
    return { portalUrl };
  }
  async function cancel(organizationId) {
    assertEnabled();
    const sub = subscription(organizationId);
    if (!sub || !["active", "past_due"].includes(sub.status))
      throw failure("There is no active subscription to cancel.", 409);
    await sdk().orders.cancelSubscription(
      { orderId: sub.orderId },
      {
        idempotencyKey: `metribee-cancel-${createHash("sha256")
          .update(
            [mode, sub.orderId, sub.currentPeriodEnd || "first"].join(":")
          )
          .digest("hex")}`,
      }
    );
    // Only an authoritative order lookup/webhook changes local subscription state.
    return { pending: true };
  }
  function receive(raw, signature) {
    assertEnabled();
    const event = verify(raw, signature, { environment: mode });
    const c = catalog();
    if (event.mode !== mode || !c.storeId || event.storeId !== c.storeId)
      throw failure("Webhook environment or store mismatch.", 400);
    if (
      !event.id ||
      !event.eventType ||
      !event.timestamp ||
      !event.data?.orderId
    )
      throw failure("Invalid webhook payload.", 400);
    // Waffo reuses the entity ID for different lifecycle events. Include type and event time.
    const id = `${mode}:${event.eventType}:${event.id}:${event.timestamp}`;
    db.prepare(
      "INSERT OR IGNORE INTO billing_webhook(id,mode,eventType,payload,receivedAt) VALUES(?,?,?,?,?)"
    ).run(
      id,
      mode,
      event.eventType,
      JSON.stringify(event),
      new Date().toISOString()
    );
    return id;
  }
  async function lookupOrder(orderId, productType) {
    const field =
      productType === "onetime" ? "onetimeOrders" : "subscriptionOrders";
    const productField =
      productType === "onetime" ? "onetimeProduct" : "subscriptionProduct";
    const fields =
      productType === "onetime"
        ? ""
        : "billingPeriod currentPeriodStart currentPeriodEnd";
    const priceFields =
      productType === "onetime"
        ? "total currency"
        : "currency regularPhase { total }";
    const result = await sdk().graphql.query({
      query: `query($storeId:String!, $id:String!) {
      ${field}(storeId:$storeId, filter:{id:{eq:$id}}, limit:1) {
        id status ${productField} { id } currency metadata orderMerchantExternalId merchantProvidedBuyerIdentity
        priceSnapshot { ${priceFields} } ${fields}
      }
    }`,
      variables: { storeId: catalog().storeId, id: orderId },
    });
    if (result.errors?.length || !result.data?.[field]?.[0])
      throw Error("Waffo order reconciliation is temporarily unavailable.");
    const order = result.data[field][0];
    return {
      ...order,
      productId: order[productField]?.id,
      metadata:
        typeof order.metadata === "string"
          ? JSON.parse(order.metadata)
          : order.metadata,
    };
  }
  async function processEvent(row) {
    const event = JSON.parse(row.payload);
    if (!events.includes(event.eventType)) return;
    const data = event.data;
    const c = catalog();
    let attempt = db
      .prepare("SELECT * FROM billing_checkout WHERE id=? AND mode=?")
      .get(
        data.orderMerchantExternalId ||
          data.orderMetadata?.metribeeCheckoutId ||
          "",
        mode
      );
    const known = db
      .prepare("SELECT * FROM billing_subscription WHERE orderId=? AND mode=?")
      .get(data.orderId, mode);
    if (!attempt && known)
      attempt = db
        .prepare(
          "SELECT * FROM billing_checkout WHERE organizationId=? AND mode=? AND orderId=? ORDER BY createdAt DESC LIMIT 1"
        )
        .get(known.organizationId, mode, known.orderId);
    if (!attempt)
      throw Error("Order is not associated with a MetriBee checkout.");
    const order = await lookupOrder(data.orderId, attempt.productType);
    const origin = db
      .prepare("SELECT * FROM billing_checkout WHERE id=? AND mode=?")
      .get(
        order.orderMerchantExternalId ||
          order.metadata?.metribeeCheckoutId ||
          "",
        mode
      );
    if (
      !origin ||
      origin.organizationId !== attempt.organizationId ||
      order.merchantProvidedBuyerIdentity !==
        buyerIdentity(attempt.organizationId)
    )
      throw Error("Order ownership does not match the organization.");
    const plan = [
      ...c.plans,
      ...(c.archivedPlans || []),
      ...(c.testProduct ? [c.testProduct] : []),
    ].find((p) => p.productId === order.productId);
    if (!plan || order.currency.toUpperCase() !== plan.currency)
      throw Error("Unrecognized order product or currency.");
    const updatedAt = new Date().toISOString();
    db.transaction(() => {
      db.prepare(
        "UPDATE billing_checkout SET orderId=?,status=CASE WHEN ? IN ('active','canceling','completed','past_due','canceled') THEN 'completed' ELSE status END WHERE id=?"
      ).run(order.id, order.status, origin.id);
      if (origin.productType === "subscription") {
        const previous = subscription(origin.organizationId);
        // A delayed event for an older canceled subscription must not replace a newer one.
        const newest = db
          .prepare(
            "SELECT createdAt FROM billing_checkout WHERE organizationId=? AND mode=? AND orderId=? ORDER BY createdAt DESC LIMIT 1"
          )
          .get(origin.organizationId, mode, previous?.orderId || "");
        if (
          !previous ||
          previous.orderId === order.id ||
          !newest ||
          origin.createdAt >= newest.createdAt
        ) {
          db.prepare(
            `INSERT INTO billing_subscription VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(organizationId,mode) DO UPDATE SET
            orderId=excluded.orderId,productId=excluded.productId,status=excluded.status,currency=excluded.currency,
            amount=excluded.amount,interval=excluded.interval,currentPeriodStart=excluded.currentPeriodStart,
            currentPeriodEnd=excluded.currentPeriodEnd,updatedAt=excluded.updatedAt`
          ).run(
            origin.organizationId,
            mode,
            order.id,
            order.productId,
            order.status,
            plan.currency,
            String(order.priceSnapshot.regularPhase.total),
            order.billingPeriod,
            order.currentPeriodStart || null,
            order.currentPeriodEnd || null,
            updatedAt
          );
        }
      }
      if (
        ["order.completed", "subscription.payment_succeeded"].includes(
          event.eventType
        ) &&
        data.paymentId
      ) {
        db.prepare(
          "INSERT OR IGNORE INTO billing_payment VALUES(?,?,?,?,?,?,?,?)"
        ).run(
          data.paymentId,
          mode,
          origin.organizationId,
          order.id,
          String(data.chargedAmount ?? data.amount),
          plan.currency,
          "succeeded",
          event.timestamp
        );
      }
      if (event.eventType === "refund.succeeded" && data.paymentId)
        db.prepare(
          "UPDATE billing_payment SET status='refunded' WHERE id=? AND mode=?"
        ).run(data.paymentId, mode);
    }).immediate();
  }
  let processing;
  function drain() {
    if (!cloud) return Promise.resolve();
    if (processing) return processing;
    processing = (async () => {
      const rows = db
        .prepare(
          "SELECT * FROM billing_webhook WHERE mode=? AND status IN ('pending','failed') AND attempts<12 ORDER BY receivedAt LIMIT 25"
        )
        .all(mode);
      for (const row of rows) {
        try {
          await processEvent(row);
          db.prepare(
            "UPDATE billing_webhook SET status='processed',processedAt=?,lastError=NULL WHERE id=?"
          ).run(new Date().toISOString(), row.id);
        } catch {
          // Never persist SDK exceptions: they may contain request credentials or checkout tokens.
          db.prepare(
            "UPDATE billing_webhook SET status='failed',attempts=attempts+1,lastError='Order reconciliation failed; retry pending.' WHERE id=?"
          ).run(row.id);
        }
      }
    })().finally(() => {
      processing = null;
    });
    return processing;
  }
  return {
    summary,
    subscription,
    checkout,
    portal,
    cancel,
    receive,
    drain,
    catalog,
    mode,
    cloud,
  };
}
module.exports = {
  createBilling,
  isCloud,
  billingMode,
  configured,
  events,
};
