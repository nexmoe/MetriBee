const defaultLedger = require("../lib/quotaLedger");
const demo = require("./demoData");
const { getGA4AlphaDataClient } = require("./ga4Service");
const { addSpent } = require("../lib/quotaConsole");

const QUOTAS = {
  core: "corePropertyQuota",
  realtime: "realtimePropertyQuota",
  funnel: "funnelPropertyQuota",
};

function createQuotaHandlers(deps = {}) {
  const ledger = deps.ledger || defaultLedger;
  const client = deps.client || getGA4AlphaDataClient;
  const properties =
    deps.properties || (() => require("./apiController").ensureProperties());
  const isDemo = deps.isDemo || demo.enabled;
  const now = deps.now || Date.now;
  const spent = deps.addSpent || addSpent;
  const gsc = deps.gsc || (() => require('./searchConsole').getSearchConsole());
  // Demo observations never read or overwrite the private shared ledger.
  const demoEntries = new Map();
  let pending = null;

  async function snapshot(connectedProperties) {
    const at = now();
    const connectedIds = new Set(connectedProperties.map((p) => String(p.id)));
    const rows = isDemo()
      ? [...demoEntries.values()].map((entry) => ({
          ...entry,
          ...ledger.summarize(entry, at),
        }))
      : ledger
          .list(at)
          .map((row) => ({ ...row, ...ledger.get(row.propertyId, row.pool) }));
    return {
      fetchedAt: at,
      pools: ledger.POOLS,
      limits: ledger.STANDARD,
      reserve: ledger.RESERVE,
      dailyReset: ledger.nextDailyReset(at).toISOString(),
      searchConsole: await gsc().quota(connectedProperties, { demo: isDemo() }),
      cooldowns: isDemo()
        ? []
        : ledger
            .cooldowns(at)
            .filter(
              (cooldown) =>
                cooldown.scope === "project" ||
                connectedIds.has(String(cooldown.propertyId))
            ),
      entries: rows
        .filter((row) => connectedIds.has(String(row.propertyId)))
        .map(({ quota, ...row }) => ({
          ...row,
          scale:
            Number(quota?.tokensPerDay?.remaining) > ledger.STANDARD.day
              ? 10
              : 1,
        })),
    };
  }

  async function fetchLatest() {
    const loaded = await properties();
    const ids = [
      ...new Set(
        loaded.properties
          .map((p) => String(p.id))
          .filter((id) => /^\d+$/.test(id))
      ),
    ];
    if (!ids.length) throw new Error("No connected GA4 properties.");
    const errors = [];
    let next = 0,
      refreshed = 0;
    await Promise.all(
      Array.from({ length: Math.min(3, ids.length) }, async () => {
        while (next < ids.length) {
          const propertyId = ids[next++];
          try {
            if (
              !isDemo() &&
              ledger.cooldowns(now()).some((c) => c.scope === "project")
            ) {
              throw Object.assign(
                new Error("GA4 requests are temporarily paused."),
                { refreshCode: "paused" }
              );
            }
            // A single uncached request returns all three quota categories.
            const [result] = await client().getPropertyQuotasSnapshot(
              { name: `properties/${propertyId}/propertyQuotasSnapshot` },
              { timeout: 15000, retry: null }
            );
            const valid = Object.values(QUOTAS).every((field) =>
              [
                "tokensPerDay",
                "tokensPerHour",
                "tokensPerProjectPerHour",
              ].every((key) => {
                const value = result?.[field]?.[key]?.remaining;
                return value != null && Number.isFinite(Number(value));
              })
            );
            if (!valid)
              throw Object.assign(
                new Error("GA4 returned an incomplete quota snapshot."),
                { refreshCode: "incomplete" }
              );
            for (const [pool, field] of Object.entries(QUOTAS)) {
              const quota = result[field];
              if (isDemo())
                demoEntries.set(`${propertyId}:${pool}`, {
                  propertyId,
                  pool,
                  source: "quota-refresh",
                  at: now(),
                  quota,
                });
              else {
                ledger.record(propertyId, pool, quota, "quota-refresh");
                spent(pool, quota.tokensPerHour?.consumed);
              }
            }
            refreshed++;
          } catch (err) {
            const code = Number(err.code ?? err.status);
            // Snapshot requests choose their own pool. Do not guess which pool a generic 429 exhausted.
            if (
              !isDemo() &&
              !err.refreshCode &&
              (![8, 429].includes(code) || /project/i.test(err.message || ""))
            ) {
              ledger.block(propertyId, "core", err, "quota-refresh");
            }
            errors.push({
              propertyId,
              code:
                err.refreshCode ||
                ([7, 403].includes(code)
                  ? "permission"
                  : [8, 429].includes(code)
                  ? "quota"
                  : "unavailable"),
            });
          }
        }
      })
    );
    return {
      ...await snapshot(loaded.properties),
      refresh: { total: ids.length, refreshed, errors },
    };
  }

  return {
    async status(_req, res) {
      const loaded = await properties();
      return res
        .set("Cache-Control", "no-store")
        .json(await snapshot(loaded.properties));
    },
    async refresh(_req, res) {
      res.set("Cache-Control", "no-store");
      try {
        // Share only a currently running lookup; a later click always queries Google again.
        if (!pending)
          pending = fetchLatest().finally(() => {
            pending = null;
          });
        const result = await pending;
        return res.status(result.refresh.refreshed ? 200 : 502).json(result);
      } catch {
        return res
          .status(502)
          .json({ error: "Could not fetch the latest quota from GA4." });
      }
    },
  };
}

module.exports = { createQuotaHandlers };
