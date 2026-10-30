const { expect } = require("chai");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { build, loadConfigFromFile } = require("../frontend/node_modules/vite");

describe("UI updates with an already-open page", function () {
  this.timeout(20000);
  let directory;
  afterEach(async () => {
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  });

  it("keeps scripts referenced by the previous HTML after a new build", async () => {
    directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "metribee-ui-update-")));
    const { config } = await loadConfigFromFile(
      { command: "build", mode: "production" },
      path.resolve(__dirname, "../frontend/vite.config.ts")
    );
    await fs.writeFile(path.join(directory, "index.html"), '<script type="module" src="/entry.js"></script>');
    const options = {
      configFile: false,
      root: directory,
      logLevel: "silent",
      build: {
        ...config.build,
        outDir: path.join(directory, "dist"),
        rollupOptions: {},
      },
    };
    await fs.writeFile(path.join(directory, "entry.js"), 'console.log("old page");');
    await build(options);
    const manifestPath = path.join(directory, "dist/.vite/manifest.json");
    const oldEntry = JSON.parse(await fs.readFile(manifestPath, "utf8"))["index.html"].file;
    await fs.writeFile(path.join(directory, "entry.js"), 'console.log("new page");');
    await build(options);
    const newEntry = JSON.parse(await fs.readFile(manifestPath, "utf8"))["index.html"].file;
    expect(newEntry).not.to.equal(oldEntry);
    expect(await fs.readFile(path.join(directory, "dist", oldEntry), "utf8")).to.include("old page");
    expect(await fs.readFile(path.join(directory, "dist", newEntry), "utf8")).to.include("new page");
  });
});

describe("workspace startup recovery", () => {
  function startup({ blockedStorage = false } = {}) {
    const vm = require("node:vm");
    const listeners = {};
    const elements = {
      "metribee-startup": { setAttribute() {} },
      "metribee-startup-message": { textContent: "Loading MetriBee…" },
      "metribee-startup-reload": { hidden: true },
    };
    let timestamp, reloads = 0;
    vm.runInNewContext(require("node:fs").readFileSync(path.resolve(__dirname, "../public/js/workspaceStartup.js"), "utf8"), {
      window: { addEventListener: (event, callback) => { listeners[event] = callback; } },
      document: { getElementById: id => elements[id], documentElement: { lang: "en" } },
      sessionStorage: {
        getItem() { if (blockedStorage) throw new Error("Storage blocked"); return timestamp; },
        setItem(key, value) { timestamp = value; },
      },
      location: { reload() { reloads++; } },
      Date,
    });
    return { listeners, elements, reloads: () => reloads };
  }

  it("retries a missing module once and offers manual recovery instead of a reload loop", () => {
    const app = startup();
    const event = { target: { tagName: "SCRIPT", type: "module" } };
    app.listeners.error(event);
    expect(app.reloads()).to.equal(1);
    app.listeners.error(event);
    expect(app.reloads()).to.equal(1);
    expect(app.elements["metribee-startup-reload"].hidden).to.equal(false);
    expect(app.elements["metribee-startup-message"].textContent).to.include("could not start");
  });

  it("offers recovery when storage is unavailable and ignores unrelated resource errors", () => {
    const app = startup({ blockedStorage: true });
    app.listeners.error({ target: { tagName: "IMG" } });
    expect(app.elements["metribee-startup-reload"].hidden).to.equal(true);
    app.listeners["vite:preloadError"]({ preventDefault() {} });
    expect(app.reloads()).to.equal(0);
    expect(app.elements["metribee-startup-reload"].hidden).to.equal(false);
  });

  it("does not cache the HTML that selects the current scripts", async () => {
    const headers = {};
    await require("../controllers/workspace").workspaceView({ path: "/login" }, {
      header(name, value) { headers[name] = value; return this; },
      viewAsync() {},
    });
    expect(headers["Cache-Control"]).to.equal("no-store");
  });
});
