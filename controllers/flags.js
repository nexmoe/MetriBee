// Country flags for the globe: 4x3 SVG from Iconify (flag set), cached in .data/flags/ forever (flags do not change).
const fs = require("fs/promises");
const path = require("path");

const DIR = path.join(__dirname, "..", ".data", "flags");
const CAP = 50 * 1024;
const TIMEOUT_MS = 5000;
const isCc = (cc) => /^[a-z]{2}$/.test(String(cc || ""));
/* Neutral grey tile for unknown codes or a failed fetch (not cached, so a later request retries) */
const FALLBACK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><rect width="4" height="3" fill="#d4d4dc"/></svg>';

async function fetchFlag(cc) {
    const res = await fetch(`https://api.iconify.design/flag/${cc}-4x3.svg`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if ((res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase() !== "image/svg+xml") throw new Error("not svg");
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > CAP) throw new Error("bad size");
    return buf;
}

const inflight = new Map();

/** SVG bytes for a lowercase ISO country code, or null when it could not be fetched. */
async function getFlag(cc, dir = DIR) {
    if (!isCc(cc)) return null;
    const file = path.join(dir, `${cc}.svg`);
    const hit = await fs.readFile(file).catch(() => null);
    if (hit) return hit;
    if (!inflight.has(file)) {
        inflight.set(file, (async () => {
            const buf = await fetchFlag(cc).catch(() => null);
            if (buf) { await fs.mkdir(dir, { recursive: true }); await fs.writeFile(file, buf); }
            return buf;
        })().finally(() => inflight.delete(file)));
    }
    return inflight.get(file);
}

module.exports = { isCc, getFlag, FALLBACK };
