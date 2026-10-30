// Fastify handler for Rybbit's native domain-based favicon service (AGPL-3.0).
// Imported source and hashes: frontend/rybbit/server-upstream.json.
const { faviconService, normalizeFaviconDomain } = require("./rybbitFavicon");

function createFaviconHandler(service = faviconService) {
    return async function favicon(req, res) {
        const domain = normalizeFaviconDomain(req.query.domain);
        res.header("X-Content-Type-Options", "nosniff");
        if (!domain) return res.header("Cache-Control", "no-store").status(400).send({ error: "A valid domain is required" });
        const result = await service.get(domain);
        if (!result.icon) return res.header("Cache-Control", "no-store").status(404).send({ error: "Favicon not found" });
        const maxAge = Math.max(0, Math.floor((result.expiresAt - Date.now()) / 1000));
        return res
            .header("Cache-Control", `public, max-age=${maxAge}, must-revalidate`)
            .header("Content-Security-Policy", "default-src 'none'; sandbox")
            .type(result.icon.contentType)
            .send(result.icon.body);
    };
}

module.exports = { createFaviconHandler, favicon: createFaviconHandler() };
