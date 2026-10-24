const express = require("express");
const router = express.Router();
const apiController = require("../controllers/apiController");
const workspace = require('../controllers/workspace');
const embeds = require('../controllers/embeds').handlers;
const widgets = require('../controllers/widgets').createWidgetHandlers();
const { sitesHomeUrl } = require('../lib/homeViews');
router.get('/widget/:siteId', embeds.widget);
router.get('/widget/:siteId/:widgetId', widgets.page);
router.get('/widget-preview', widgets.previewPage);
router.get('/api/rybbit/sites/:siteId/widgets', widgets.list);
router.post('/api/rybbit/sites/:siteId/widgets', widgets.save);
router.post('/api/rybbit/sites/:siteId/widgets/preview', widgets.preview);
router.put('/api/rybbit/sites/:siteId/widgets/:widgetId', widgets.save);
router.delete('/api/rybbit/sites/:siteId/widgets/:widgetId', widgets.remove);
router.get('/api/rybbit/sites/:siteId/widgets/:widgetId/data', widgets.data);
router.get('/api/rybbit/sites/:siteId/embed-stats', embeds.stats);
router.put('/api/rybbit/sites/:siteId/config', embeds.config);
router.get('/api/rybbit/sites/:siteId/private-link-config', embeds.privateLink);
router.post('/api/rybbit/sites/:siteId/private-link-config', embeds.privateLink);
router.get(/^\/(?:de\/|fr\/|zh\/|es\/|pl\/|it\/|ko\/|pt\/|ja\/|cs\/|uk\/)?(\d+)\/([a-f0-9]{12})\/(main|pages|events|journeys|retention|funnels)\/?$/, (req, res) => {
  req.params.siteId = req.params[0];
  req.params.privateKey = req.params[1];
  return embeds.dashboard(req, res);
});
router.get(/^\/(?:en\/|de\/|fr\/|zh\/|es\/|pl\/|it\/|ko\/|pt\/|ja\/|cs\/|uk\/)?sites\/?$/, (req, res) => res.redirect(308, sitesHomeUrl(req.originalUrl)));
router.get(['/', '/realtime', '/analytics', '/analytics/pages', '/events', '/journeys', '/retention', '/funnels', '/widgets', '/globe', '/quota', '/analytics/reports'], workspace.workspaceView);
router.get(/^\/en(?:\/|$)/, (req, res) => res.redirect(308, req.originalUrl.replace(/^\/en(?=\/|\?|$)/, '') || '/'));
router.get(/^\/(?:de|fr|zh|es|pl|it|ko|pt|ja|cs|uk)(?:\/(?:realtime|analytics(?:\/(?:pages|reports))?|events|journeys|retention|funnels|widgets|globe|quota))?\/?$/, workspace.workspaceView);
router.get('/api/sites-snapshot', require('../controllers/dashboardModels').sitesSnapshot);
const quota = require('../controllers/quota').createQuotaHandlers();
router.get('/api/quota/status', quota.status);
router.post('/api/quota/refresh', quota.refresh);
router.get('/api/workspace-overview/:propertyId', workspace.createOverviewHandler());
router.use('/api/rybbit', require('../controllers/rybbit').createRybbitHandler());

router.get('/', apiController.allrealtime);

/** Force a fresh pull of GA4 properties and update the on-disk cache */
router.post('/api/refresh-cache', apiController.refreshCache);

/** 3D globe page */
router.get('/globe', apiController.globeView);

/** Country-level realtime data for the globe (JSON) */
router.get('/api/globe-data', apiController.globeData);

/** City-level user avatar data for the globe map */
router.get('/api/globe-users', apiController.globeUsers);

/** Compatibility site favicon URL; shares the native Rybbit domain service. */
router.get('/api/favicon/:propertyId', apiController.favicon);

/** Country flag SVG by lowercase ISO code (cached forever in .data/flags) */
router.get('/api/flag/:cc', apiController.flag);

/** Latest API quota snapshot */
router.get('/api/quota', apiController.quotaData);

/** Sites and report names for the navbar jump palette */
router.get('/api/nav-index', apiController.navIndex);

/** Per-property detail: top countries, sources, pages */
router.get('/api/property-detail/:propertyId', apiController.propertyDetail);

/** Per-property aggregate visitor persona and intent insights */
router.get('/api/visitor-insights/:propertyId', apiController.visitorInsights);

/** Analytics page */
router.get('/analytics', apiController.analyticsView);

/** Referrer-based page journeys, counted as page views. */
router.get('/journeys', require('../controllers/journeys').journeysView);
router.get('/api/journeys/:propertyId', require('../controllers/journeys').createJourneysHandler());

/** Page traffic and landing-page reports. */
const pages = require('../controllers/pagesReport');
router.get('/analytics/pages', pages.pagesView);
router.get('/api/pages-report/:propertyId', pages.createPagesReportHandler());
router.get('/api/pages-section/:propertyId', pages.createSectionReportHandler());

/** First-visit cohort retention, using the native GA4 cohort report. */
const retention = require('../controllers/retention');
router.get('/retention', retention.retentionView);
router.get('/api/retention/:propertyId', retention.createRetentionHandler());

/** Events workspace: aggregate GA4 reports, never raw individual event logs. */
const events = require('../controllers/eventsController').createEventsHandlers();
router.get('/events', events.view);
router.get('/api/events/:propertyId', events.overview);
router.get('/api/events/:propertyId/activity', events.activity);

/** Analytics widget card data (non-realtime) */
router.get('/api/analytics-card/:propertyId/:type', apiController.analyticsCard);

/** Live realtime summary for a single property (reads in-memory cache) */
router.get('/api/realtime-summary/:propertyId', apiController.realtimeSummary);

/** Live realtime batch summary for all properties */
router.get('/api/realtime-all', apiController.realtimeAllApi);

/** Homepage property cards for today, the last 7 days or the last 28 days. */
router.get('/api/home-cards', require('../controllers/homeCards').createHomeCardsHandler());

/** Traffic spike detection & referral analysis */
router.get('/api/spikes', apiController.trafficSpikes);

/** Reports section – aggregated report data with spike annotations (analytics page) */
router.get('/api/analytics-reports/:propertyId', apiController.analyticsReports);

module.exports = router;
