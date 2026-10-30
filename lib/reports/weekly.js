const { DateTime } = require("luxon");
const { storage } = require("../requestContext");
const { createRybbitHandler } = require("../../controllers/rybbit");
const { collectReport } = require("./data");
const { WeeklyReportEmail } = require("./templates/WeeklyReportEmail");
const { render } = require("@react-email/render");
const React = require("react");
function reportWindow(now = new Date()) {
  const end = DateTime.fromJSDate(now, { zone: "UTC" }).startOf("week");
  return {
    startDate: end.minus({ days: 7 }).toISODate(),
    endDate: end.minus({ days: 1 }).toISODate(),
    week: end.toISODate(),
  };
}
function createWeeklyReports({
  runtime,
  properties = () =>
    require("../../controllers/apiController").ensureProperties(),
  collect = collectReport,
  now = () => new Date(),
  logger = console,
}) {
  let running = false;
  const gateway = createRybbitHandler({ properties, backgroundRefresh: false });
  async function run({ forceSchedule = false } = {}) {
    if (
      running ||
      process.env.DEMO === "1" ||
      process.env.WEEKLY_REPORTS_ENABLED === "false" ||
      !runtime.mailer.configured
    )
      return;
    const at = now();
    // Catch up after a Monday restart while preserving the native Monday UTC schedule.
    if (
      !forceSchedule &&
      DateTime.fromJSDate(at, { zone: "UTC" }).weekday !== 1
    )
      return;
    running = true;
    const db = runtime.db,
      range = reportWindow(at);
    try {
      const users = db
        .prepare(
          "SELECT DISTINCT u.* FROM user u JOIN member m ON m.userId=u.id WHERE u.sendAutoEmailReports=1"
        )
        .all();
      for (const user of users) {
        if (
          user.banned &&
          (!user.banExpires || Number(user.banExpires) > at.getTime())
        )
          continue;
        const identity = {
          userId: user.id,
          user,
          systemAdmin: user.role === "admin",
          bearer: false,
          statements: null,
        };
        await storage.run({ access: runtime.access, identity }, async () => {
          const available = (await properties()).properties;
          const visible = runtime.access.filterProperties(identity, available);
          const counts = new Map();
          for (const property of visible) {
            const currentUser = db
              .prepare(
                "SELECT sendAutoEmailReports,banned,banExpires FROM user WHERE id=?"
              )
              .get(user.id);
            if (
              !currentUser?.sendAutoEmailReports ||
              (currentUser.banned &&
                (!currentUser.banExpires ||
                  Number(currentUser.banExpires) > now().getTime()))
            )
              break;
            try {
              runtime.access.requireSite(
                identity,
                property.id,
                "analytics:read"
              );
            } catch {
              continue;
            }
            const orgId = db
              .prepare(
                "SELECT organizationId FROM property_access WHERE propertyId=?"
              )
              .get(String(property.id))?.organizationId;
            if (!orgId || (counts.get(orgId) || 0) >= 10) continue;
            counts.set(orgId, (counts.get(orgId) || 0) + 1);
            const key = `${range.week}:${orgId}:${user.id}:${property.id}`;
            if (
              db
                .prepare(
                  "SELECT 1 FROM email_report_delivery WHERE deliveryKey=?"
                )
                .get(key)
            )
              continue;
            let data;
            try {
              data = await collect({
                property: { ...property, timeZone: "UTC" },
                query: {
                  start_date: range.startDate,
                  end_date: range.endDate,
                  time_zone: "UTC",
                },
                gateway,
                identity,
                asOf: at,
              });
            } catch (error) {
              const timestamp = now().toISOString();
              db.prepare(
                "INSERT OR IGNORE INTO email_report_delivery(deliveryKey,status,createdAt,updatedAt) VALUES(?,?,?,?)"
              ).run(key, "data_failed", timestamp, timestamp);
              logger.error(
                { err: error, propertyId: property.id },
                "Weekly report data unavailable"
              );
              continue;
            }
            if (!data.overview.pageviews) {
              const timestamp = now().toISOString();
              db.prepare(
                "INSERT OR IGNORE INTO email_report_delivery(deliveryKey,status,createdAt,updatedAt) VALUES(?,?,?,?)"
              ).run(key, "no_data", timestamp, timestamp);
              continue;
            }
            const org = db
              .prepare("SELECT name FROM organization WHERE id=?")
              .get(orgId);
            const site = {
              ...data,
              currentWeek: data.overview,
              previousWeek: data.previousOverview,
            };
            const html = await render(
              React.createElement(WeeklyReportEmail, {
                userName: user.name,
                organizationName: org?.name || "",
                site,
                baseURL: runtime.baseURL.replace(/\/$/, ""),
              })
            );
            // Recheck grants and preference after the asynchronous report queries.
            const fresh = db
              .prepare("SELECT sendAutoEmailReports FROM user WHERE id=?")
              .get(user.id);
            if (!fresh?.sendAutoEmailReports) break;
            try {
              runtime.access.requireSite(
                identity,
                property.id,
                "analytics:read"
              );
            } catch {
              continue;
            }
            if (
              db
                .prepare(
                  "SELECT organizationId FROM property_access WHERE propertyId=?"
                )
                .get(String(property.id))?.organizationId !== orgId
            )
              continue;
            const timestamp = now().toISOString();
            const claimed = db
              .prepare(
                "INSERT OR IGNORE INTO email_report_delivery(deliveryKey,status,createdAt,updatedAt) VALUES(?,?,?,?)"
              )
              .run(key, "sending", timestamp, timestamp);
            if (!claimed.changes) continue;
            try {
              await runtime.mailer.send(
                user.email,
                `${data.siteName} · Weekly report`,
                `${range.startDate} – ${range.endDate}\nSessions: ${data.overview.sessions}\nPageviews: ${data.overview.pageviews}\nManage subscriptions: ${runtime.baseURL}/settings/account`,
                null,
                { html }
              );
              db.prepare(
                "UPDATE email_report_delivery SET status=?,updatedAt=? WHERE deliveryKey=?"
              ).run("sent", now().toISOString(), key);
            } catch (error) {
              // Ambiguous mail-provider failures are not retried automatically: a retry could duplicate delivery.
              db.prepare(
                "UPDATE email_report_delivery SET status=?,updatedAt=? WHERE deliveryKey=?"
              ).run("failed", now().toISOString(), key);
              logger.error(
                { err: error, propertyId: property.id },
                "Weekly report email failed"
              );
            }
          }
        });
      }
    } finally {
      running = false;
    }
  }
  return { run };
}
module.exports = { createWeeklyReports, reportWindow };
