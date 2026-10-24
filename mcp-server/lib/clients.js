// Use the dashboard's OAuth routing, REST fallback, demo clients, quota ledger and resets.
const service = require("../../controllers/ga4Service");
module.exports = {
	getAdminClient: service.getGA4AdminClient,
	getDataClient: service.getGA4DataClient,
	getAlphaDataClient: service.getGA4AlphaDataClient,
};
