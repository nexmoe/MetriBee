const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { isCc, getFlag } = require("../controllers/flags");

describe("flags", () => {
    const realFetch = global.fetch;
    let dir, calls;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"/>';
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "flags-"));
        calls = [];
        global.fetch = async (url) => { calls.push(url); return new Response(svg, { headers: { "content-type": "image/svg+xml" } }); };
    });
    afterEach(() => { global.fetch = realFetch; fs.rmSync(dir, { recursive: true, force: true }); });

    it("accepts only two lowercase letters", () => {
        assert.ok(isCc("in"));
        for (const bad of ["IN", "ind", "i", "../", "1n", "", undefined]) assert.ok(!isCc(bad), String(bad));
    });

    it("fetches once from Iconify, then serves the cached file", async () => {
        assert.strictEqual(String(await getFlag("in", dir)), svg);
        assert.deepStrictEqual(calls, ["https://api.iconify.design/flag/in-4x3.svg"]);
        assert.ok(fs.existsSync(path.join(dir, "in.svg")));
        assert.strictEqual(String(await getFlag("in", dir)), svg);
        assert.strictEqual(calls.length, 1);
    });

    it("does not cache a non-SVG response", async () => {
        global.fetch = async () => new Response("<html>", { headers: { "content-type": "text/html" } });
        assert.strictEqual(await getFlag("fr", dir), null);
        assert.ok(!fs.existsSync(path.join(dir, "fr.svg")));
    });
});
