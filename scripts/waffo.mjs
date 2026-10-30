// Configure payment products using only the two merchant credentials from .env.
import "dotenv/config";
import { WaffoPancake } from "@waffo/pancake-ts";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
const require = createRequire(import.meta.url);
const { openDatabase } = require("../lib/database");
const { events } = require("../lib/billing");
const args = process.argv.slice(2);
const command = args.shift();
const value = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const mode = value("mode") || "test";
if (!["test", "prod"].includes(mode)) throw Error("Mode must be test or prod.");
const db = openDatabase();
const read = (key) => {
  const row = db.prepare("SELECT value FROM app_setting WHERE key=?").get(key);
  return row ? JSON.parse(row.value) : null;
};
const save = (key, data) =>
  db
    .prepare(
      "INSERT INTO app_setting VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
    )
    .run(key, JSON.stringify(data));
const client = new WaffoPancake({
  merchantId: process.env.WAFFO_MERCHANT_ID,
  privateKey: process.env.WAFFO_PRIVATE_KEY,
  fetch: (url, options) =>
    fetch(url, { ...options, signal: AbortSignal.timeout(30000) }),
});
const key = `waffo.${mode}.catalog`;
const requestOptions = (operation) => ({
  idempotencyKey: `metribee-${mode}-${operation}`,
});
try {
  if (command === "setup") {
    if (mode !== "test")
      throw Error(
        "This setup command creates sandbox products only. Configure reviewed production products with import."
      );
    const monthly = value("monthly");
    const yearly = value("yearly");
    const proMonthly = value("pro-monthly");
    const proYearly = value("pro-yearly");
    const currency = (value("currency") || "USD").toUpperCase();
    if (
      ![monthly, yearly].every(
        (x) => /^\d+(\.\d{1,2})?$/.test(x || "") && Number(x) > 0
      )
    )
      throw Error("Supply --monthly DISPLAY_AMOUNT --yearly DISPLAY_AMOUNT.");
    if (
      (proMonthly || proYearly) &&
      ![proMonthly, proYearly].every(
        (x) => /^\d+(\.\d{1,2})?$/.test(x || "") && Number(x) > 0
      )
    )
      throw Error("Supply both --pro-monthly and --pro-yearly.");
    const stores = await client.graphql.query({
      query: "query { stores { id name } }",
    });
    if (stores.errors?.length || !stores.data?.stores)
      throw Error("Cannot load merchant stores.");
    let storeId = value("store-id") || read(`waffo.${mode}.storeId`);
    if (storeId && !stores.data.stores.some((s) => s.id === storeId))
      throw Error("Configured store does not belong to this merchant.");
    if (!storeId) {
      if (stores.data.stores.length > 1)
        throw Error(
          "Multiple stores found. Select --store-id before creating products."
        );
      storeId =
        stores.data.stores[0]?.id ||
        (
          await client.stores.create(
            { name: "MetriBee" },
            requestOptions("store")
          )
        ).store.id;
    }
    save(`waffo.${mode}.storeId`, storeId);
    const catalog = read(key) || { storeId, plans: [] };
    if (catalog.storeId !== storeId)
      throw Error("A catalog already exists for another store.");
    const definitions = proMonthly
      ? [
          ["standard-monthly", "monthly", monthly, "Standard"],
          ["standard-yearly", "yearly", yearly, "Standard"],
          ["pro-monthly", "monthly", proMonthly, "Pro"],
          ["pro-yearly", "yearly", proYearly, "Pro"],
        ]
      : [
          ["monthly", "monthly", monthly, "Cloud"],
          ["yearly", "yearly", yearly, "Cloud"],
        ];
    for (const [id, interval, amount, name] of definitions) {
      if (catalog.plans.some((p) => p.id === id)) continue;
      const { product } = await client.subscriptionProducts.create(
        {
          storeId,
          name: `MetriBee ${name} ${interval} (Test)`,
          billingPeriod: interval,
          prices: { [currency]: { amount, taxCategory: "saas" } },
        },
        requestOptions(`${storeId}-${id}`)
      );
      catalog.plans.push({
        id,
        productId: product.id,
        name,
        interval,
        currency,
        amount,
        type: "subscription",
      });
      save(key, catalog);
    }
    const wanted = new Set(definitions.map((p) => p[0]));
    const retired = catalog.plans.filter((p) => !wanted.has(p.id));
    catalog.archivedPlans = [...(catalog.archivedPlans || []), ...retired];
    catalog.plans = catalog.plans.filter((p) => wanted.has(p.id));
    save(key, catalog);
    if (!catalog.groupId) {
      const { group } = await client.subscriptionProductGroups.create(
        {
          storeId,
          name: "MetriBee Cloud (Test)",
          productIds: catalog.plans.map((p) => p.productId),
          rules: { sharedTrial: false, allowCustomerPlanChange: true },
        },
        requestOptions(`${storeId}-group`)
      );
      catalog.groupId = group.id;
      save(key, catalog);
    } else
      await client.subscriptionProductGroups.update({
        id: catalog.groupId,
        productIds: catalog.plans.map((p) => p.productId),
      });
    for (const plan of retired)
      await client.subscriptionProducts.updateStatus({
        id: plan.productId,
        status: "inactive",
      });
    if (args.includes("--test-product") && !catalog.testProduct) {
      const { product } = await client.onetimeProducts.create(
        {
          storeId,
          name: "MetriBee checkout verification (Test)",
          prices: { USD: { amount: "1.00", taxCategory: "saas" } },
        },
        requestOptions(`${storeId}-verification`)
      );
      catalog.testProduct = {
        id: "verification",
        productId: product.id,
        name: "Checkout verification",
        currency: "USD",
        amount: "1.00",
        type: "onetime",
      };
      save(key, catalog);
    }
    console.log(
      JSON.stringify({
        mode,
        storeId,
        plans: catalog.plans,
        testProduct: catalog.testProduct?.productId,
      })
    );
  } else if (command === "import") {
    const input = JSON.parse(await readFile(value("catalog"), "utf8"));
    if (!input.storeId || !Array.isArray(input.plans) || !input.plans.length)
      throw Error("Catalog needs storeId and plans.");
    const catalog = { storeId: input.storeId, plans: [] };
    for (const plan of input.plans) {
      if (
        !/^[a-z0-9-]+$/.test(plan.id) ||
        !plan.productId ||
        !/^[A-Z]{3}$/.test(plan.currency) ||
        catalog.plans.some((p) => p.id === plan.id)
      )
        throw Error(
          "Each plan needs a unique id, productId and uppercase currency."
        );
      const result = await client.graphql.query({
        query:
          "query($id:String!){subscriptionProduct(id:$id){id storeId name status billingPeriod hasProdVersion prices{currency priceInfo{amount}}}}",
        variables: { id: plan.productId },
      });
      const product = result.data?.subscriptionProduct;
      const price = product?.prices.find(
        (p) => p.currency.toUpperCase() === plan.currency
      );
      if (
        result.errors?.length ||
        !product ||
        product.storeId !== input.storeId ||
        product.status !== "active" ||
        !price ||
        (mode === "prod" && !product.hasProdVersion)
      )
        throw Error(
          "Product must be active, accessible, have the selected currency and belong to this store/environment."
        );
      catalog.plans.push({
        id: plan.id,
        productId: product.id,
        name: plan.name || product.name,
        interval: product.billingPeriod,
        currency: plan.currency,
        amount: String(price.priceInfo.amount),
        type: "subscription",
      });
    }
    const previous = read(key);
    const active = new Set(catalog.plans.map((p) => p.productId));
    catalog.archivedPlans = [
      ...(previous?.plans || []),
      ...(previous?.archivedPlans || []),
    ].filter(
      (p, i, list) =>
        !active.has(p.productId) &&
        list.findIndex((x) => x.productId === p.productId) === i
    );
    if (mode === "test" && previous?.testProduct)
      catalog.testProduct = previous.testProduct;
    save(key, catalog);
    save(`waffo.${mode}.storeId`, catalog.storeId);
    console.log(
      JSON.stringify({ mode, storeId: catalog.storeId, plans: catalog.plans })
    );
  } else if (command === "webhook") {
    const c = read(key);
    const url = value("url");
    if (!c?.storeId || !url || new URL(url).protocol !== "https:")
      throw Error("Configure a catalog and provide an HTTPS --url.");
    const old = read(`waffo.${mode}.webhook`);
    const result = old
      ? await client.webhooks.update({ id: old.id, url, events })
      : await client.webhooks.add(
          {
            storeId: c.storeId,
            channel: "http",
            url,
            events,
            testMode: mode === "test",
          },
          requestOptions(`${c.storeId}-webhook`)
        );
    const webhook = result.webhook;
    if (!webhook?.id) throw Error("Webhook registration returned no ID.");
    save(`waffo.${mode}.webhook`, { id: webhook.id, url });
    console.log(JSON.stringify({ mode, webhookId: webhook.id, url }));
  } else if (command === "retry") {
    db.prepare(
      "UPDATE billing_webhook SET attempts=0,status='pending' WHERE mode=? AND status='failed'"
    ).run(mode);
    await require("../lib/billing").createBilling({ db, client, mode }).drain();
    console.log(
      JSON.stringify({
        mode,
        remaining: db
          .prepare(
            "SELECT count(*) n FROM billing_webhook WHERE mode=? AND status!='processed'"
          )
          .get(mode).n,
      })
    );
  } else if (command === "status") {
    const c = read(key);
    console.log(
      JSON.stringify({
        mode,
        catalog: c,
        webhook: read(`waffo.${mode}.webhook`),
        events: db
          .prepare(
            "SELECT eventType,status,attempts,receivedAt,processedAt FROM billing_webhook WHERE mode=? ORDER BY receivedAt DESC LIMIT 20"
          )
          .all(mode),
      })
    );
  } else {
    throw Error(
      "Usage: node scripts/waffo.mjs setup --monthly 19.00 --yearly 199.00 --pro-monthly 29.00 --pro-yearly 299.00 [--store-id STO_xxx] [--test-product], import --catalog FILE [--mode test|prod], webhook --url https://.../api/rybbit/billing/webhook, or status."
    );
  }
} catch (error) {
  // Avoid echoing SDK request bodies/tokens/keys.
  console.error(
    error.name === "WaffoPancakeError"
      ? `Waffo rejected the operation (HTTP ${error.status}).`
      : error.message
  );
  process.exitCode = 1;
} finally {
  db.close();
}
