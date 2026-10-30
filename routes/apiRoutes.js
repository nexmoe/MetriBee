const api = require("../controllers/apiController");
const workspace = require("../controllers/workspace");
const embeds = require("../controllers/embeds").handlers;
const widgets = require("../controllers/widgets").createWidgetHandlers();

async function apiRoutes(app) {
  app.get("/widget/:siteId", embeds.widget);
  app.get("/widget/:siteId/:widgetId", widgets.page);
  app.get("/widget-preview", widgets.previewPage);
  app.get("/api/rybbit/sites/:siteId/widgets", widgets.list);
  app.post("/api/rybbit/sites/:siteId/widgets", widgets.save);
  app.post("/api/rybbit/sites/:siteId/widgets/preview", widgets.preview);
  app.put("/api/rybbit/sites/:siteId/widgets/:widgetId", widgets.save);
  app.delete("/api/rybbit/sites/:siteId/widgets/:widgetId", widgets.remove);
  app.get("/api/rybbit/sites/:siteId/widgets/:widgetId/data", widgets.data);
  app.get("/api/rybbit/sites/:siteId/embed-stats", embeds.stats);
  app.put("/api/rybbit/sites/:siteId/config", async (req, reply) => {
    const { tags } = req.body || {};
    if (tags !== undefined) {
      if (Object.keys(req.body).length !== 1) return reply.code(400).send({ error: 'Update one site setting at a time.' });
      if (
        !Array.isArray(tags) ||
        tags.length > 30 ||
        tags.some((t) => typeof t !== "string" || !t.trim() || t.length > 100)
      )
        return reply.code(400).send({ error: "Choose up to 30 valid tags." });
      app.authRuntime.db
        .prepare("UPDATE property_access SET tags=? WHERE propertyId=?")
        .run(
          JSON.stringify([...new Set(tags.map((t) => t.trim()))]),
          req.params.siteId
        );
      return { success: true };
    }
    return embeds.config(req, reply);
  });
  app.get("/api/rybbit/sites/:siteId/private-link-config", embeds.privateLink);
  app.post("/api/rybbit/sites/:siteId/private-link-config", embeds.privateLink);
  app.get(
    "/api/sites-snapshot",
    require("../controllers/dashboardModels").sitesSnapshot
  );
  const quota = require("../controllers/quota").createQuotaHandlers();
  app.get("/api/quota/status", quota.status);
  app.post("/api/quota/refresh", quota.refresh);
  app.get(
    "/api/workspace-overview/:propertyId",
    workspace.createOverviewHandler()
  );
  const rybbit = require("../controllers/rybbit").createRybbitHandler();
  app.route({
    method: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    url: "/api/rybbit/*",
    handler: rybbit,
  });
  app.post("/api/refresh-cache", api.refreshCache);
  app.get("/api/globe-data", api.globeData);
  app.get("/api/globe-users", api.globeUsers);
  app.get("/api/favicon/:propertyId", api.favicon);
  app.get("/api/flag/:cc", api.flag);
  app.get("/api/quota", api.quotaData);
  app.get("/api/nav-index", api.navIndex);
  app.get("/api/property-detail/:propertyId", api.propertyDetail);
  app.get("/api/visitor-insights/:propertyId", api.visitorInsights);
  app.get(
    "/api/journeys/:propertyId",
    require("../controllers/journeys").createJourneysHandler()
  );
  const pages = require("../controllers/pagesReport");
  app.get("/api/pages-report/:propertyId", pages.createPagesReportHandler());
  app.get("/api/pages-section/:propertyId", pages.createSectionReportHandler());
  app.get(
    "/api/retention/:propertyId",
    require("../controllers/retention").createRetentionHandler()
  );
  const events =
    require("../controllers/eventsController").createEventsHandlers();
  app.get("/api/events/:propertyId", events.overview);
  app.get("/api/events/:propertyId/activity", events.activity);
  app.get("/api/analytics-card/:propertyId/:type", api.analyticsCard);
  app.get("/api/realtime-summary/:propertyId", api.realtimeSummary);
  app.get("/api/realtime-all", api.realtimeAllApi);
  app.get(
    "/api/home-cards",
    require("../controllers/homeCards").createHomeCardsHandler()
  );
  app.get("/api/spikes", api.trafficSpikes);
  app.get("/api/analytics-reports/:propertyId", api.analyticsReports);
}
module.exports = apiRoutes;
