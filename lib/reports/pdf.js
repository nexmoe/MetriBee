const fs = require("node:fs");
const path = require("node:path");
const { renderToStaticMarkup } = require("react-dom/server");
const { PdfReportTemplate } = require("./templates/PdfReportTemplate");
const { failure } = require("../access");
let active = false;
function executablePath() {
  return [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
  ].find((file) => file && fs.existsSync(file));
}
function renderHtml(data) {
  const logo = fs.readFileSync(
    path.join(__dirname, "../../public/metribee/mark.svg"),
    "utf8"
  );
  return (
    "<!doctype html>" +
    renderToStaticMarkup(
      PdfReportTemplate({
        reportData: {
          ...data,
          logoDataUrl:
            "data:image/svg+xml;base64," + Buffer.from(logo).toString("base64"),
        },
      })
    )
  );
}
async function renderPdf(data) {
  if (active)
    throw failure("Another PDF is being generated. Try again shortly.", 429);
  const executable = executablePath();
  if (!executable)
    throw failure(
      "Install Chromium or configure PUPPETEER_EXECUTABLE_PATH to export PDF reports.",
      503
    );
  active = true;
  let browser;
  try {
    browser = await require("puppeteer-core").launch({
      executablePath: executable,
      headless: true,
      timeout: 30000,
      args:
        process.env.IN_DOCKER === "1"
          ? [
              "--no-sandbox",
              "--disable-setuid-sandbox",
              "--disable-dev-shm-usage",
            ]
          : [],
    });
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (request) =>
      /^(?:data:|about:)/.test(request.url())
        ? request.continue()
        : request.abort()
    );
    await page.setContent(renderHtml(data), {
      waitUntil: "load",
      timeout: 30000,
    });
    await page.evaluate(() => document.fonts.ready);
    return Buffer.from(
      await page.pdf({
        format: "A4",
        printBackground: true,
        timeout: 30000,
        margin: { top: "0", bottom: "0", left: "0", right: "0" },
      })
    );
  } finally {
    try {
      await browser?.close();
    } finally {
      active = false;
    }
  }
}
module.exports = { renderPdf, renderHtml, executablePath };
