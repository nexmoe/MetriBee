const { expect } = require("chai");
const path = require("node:path");
const { createServer } = require("../frontend/node_modules/vite");
const {
  locales,
  getLocale,
  stripLocale,
  localeHref,
} = require("../lib/uiLocale");
const english = require("../frontend/rybbit/messages/en.json");

const frontend = path.resolve(__dirname, "../frontend");

describe("workspace language routing", () => {
  it("uses only the URL, with English as the default", () => {
    expect(getLocale("/")).to.equal("en");
    expect(getLocale("/zh/analytics")).to.equal("zh");
    expect(getLocale("/ja")).to.equal("ja");
    expect(getLocale("/analytics?locale=zh")).to.equal("en");
    expect(getLocale("/unsupported/analytics")).to.equal("en");
    expect(stripLocale("/en/analytics")).to.equal("/analytics");
    expect(stripLocale("/zh")).to.equal("/");
  });

  it("preserves private sharing paths, report dates and fragments in every language", () => {
    for (const locale of locales) {
      const result = localeHref(
        "/zh/123/abcdef123456/pages?startDate=2026-10-01&endDate=2026-10-24#table",
        locale
      );
      const url = new URL(result, "http://localhost");
      expect(getLocale(url.pathname)).to.equal(locale);
      expect(stripLocale(url.pathname)).to.equal("/123/abcdef123456/pages");
      expect(url.search).to.equal("?startDate=2026-10-01&endDate=2026-10-24");
      expect(url.hash).to.equal("#table");
    }
  });

  it("canonicalizes the English root without losing its query", () => {
    expect(localeHref("/en?view=heatmap", "en")).to.equal("/?view=heatmap");
    expect(localeHref("/zh?view=table#report", "en")).to.equal(
      "/?view=table#report"
    );
    expect(localeHref("/?view=status", "zh")).to.equal("/zh?view=status");
    expect(localeHref("/en//example.com", "en")).to.equal("/example.com");
    expect(() => localeHref("/", "xx")).to.throw(RangeError);
  });
});

describe("Rybbit message runtime", function () {
  this.timeout(15000);
  let server, createTranslator;

  before(async () => {
    server = await createServer({
      root: frontend,
      configFile: path.join(frontend, "vite.config.ts"),
      server: { middlewareMode: true, hmr: false, watch: null },
      optimizeDeps: { noDiscovery: true, include: [] },
      logLevel: "silent",
    });
    ({ createExtractedTranslator: createTranslator } =
      await server.ssrLoadModule("/adapter/extracted.ts"));
  });
  after(async () => {
    await server?.close();
  });

  it("uses upstream catalogs and supplements GA4 and footer messages", () => {
    const zh = createTranslator(
      "zh",
      require("../frontend/rybbit/messages/zh.json")
    );
    expect(zh("Pages")).to.equal("页面");
    expect(zh("Sync properties")).to.equal("同步资源");
    expect(zh("API quota")).to.equal("API 配额");
    expect(zh("Report an issue")).to.equal("反馈问题");
    expect(zh("Search clicks")).to.equal("搜索点击");
    expect(zh("Page transitions")).to.equal("页面流向");
  });

  it("formats ICU variables, plurals and rich messages", () => {
    const zh = createTranslator("zh", {});
    expect(zh("{count} properties", { count: 8 })).to.equal("8 个资源");
    expect(
      zh("{count, plural, one {# pool} other {# pools}}", { count: 3 })
    ).to.equal("3 个配额池");
    expect(
      zh.rich(
        "Top {count} paths cover <b>{covered}</b> of {total} internal page views ({percent})",
        {
          count: 10,
          covered: 80,
          total: 100,
          percent: "80%",
          b: (chunks) => chunks,
        }
      )
    ).to.include("80 / 100");
  });

  it("loads every imported locale and translates the footer", () => {
    for (const locale of locales) {
      const catalog = require(`../frontend/rybbit/messages/${locale}.json`);
      const t = createTranslator(locale, { ...english, ...catalog });
      expect(t("Pages"), locale).to.be.a("string").and.not.empty;
      if (locale !== "en") {
        expect(t("Report an issue"), locale).not.to.equal("Report an issue");
        expect(t("View source on GitHub"), locale).not.to.equal("View source on GitHub");
      }
    }
  });

  it("translates the MetriBee update notice and preserves both version numbers", () => {
    const message = "MetriBee v{latest} is available (you're on v{current})";
    for (const locale of locales) {
      const catalog = require(`../frontend/rybbit/messages/${locale}.json`);
      const t = createTranslator(locale, { ...english, ...catalog });
      const notice = t(message, { latest: "2.2.0", current: "2.1.0" });
      expect(notice).to.include("MetriBee").and.include("2.2.0").and.include("2.1.0");
      if (locale !== "en") expect(notice).not.to.equal("MetriBee v2.2.0 is available (you're on v2.1.0)");
    }
  });

  it("falls back to English and preserves substitution for untranslated app messages", () => {
    const t = createTranslator("fr", {});
    expect(t("New report: {name}", { name: "GA4" })).to.equal(
      "New report: GA4"
    );
  });
});
