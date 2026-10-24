const { expect } = require("chai");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

function load(name) {
  const filename = path.resolve(__dirname, `../frontend/adapter/privacy/${name}.ts`);
  const compiled = new Module(filename, module);
  compiled._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, filename);
  return compiled.exports;
}
const { privacyTerms, privacyMatcher, privacyShortcut } = load("model");

describe("global visual privacy", () => {
  it("collects property, account and connection identifiers without treating report values as names", () => {
    const terms = privacyTerms([
      { value: [{ id: "987654321", name: "Example - GA4", domain: "https://www.example.org/path", accountName: "Private team" }], metadata: true },
      { value: { clientEmail: "service@example.iam.gserviceaccount.com", gcpProject: "private-project", sessions: 12345, name: "Sessions", rows: [{ name: "Views", users: 56789 }] } },
    ]);
    expect(terms).to.include.members(["987654321", "Example", "Example - GA4", "example.org", "www.example.org", "Private team", "service@example.iam.gserviceaccount.com", "private-project"]);
    expect(terms).not.to.include.members(["12345", "56789", "Sessions", "Views"]);
    expect(privacyTerms([{ value: [{ name: "GA4", id: 1 }, { name: "Unknown" }], metadata: true }])).to.deep.equal([]);
  });

  it("masks known names, domains, page paths and email in newly rendered content", () => {
    const matches = privacyMatcher(["Example", "折影轻梦", "987654321"]);
    for (const value of ["example", "Example · Error", "Example网站", "折影轻梦的流量", "Property 987654321", "www.other-site.org", "Source https://other-site.org/path", "user@example.net", "/", "/download?channel=web"]) {
      expect(matches(value), value).to.equal(true);
    }
  });

  it("keeps metrics, dates, navigation and words containing a short site name readable", () => {
    const matches = privacyMatcher(["AI", "Example"]);
    for (const value of ["Sessions", "Active users", "Main", "Email", "12,345", "23K", "0.52%", "2026-10-23", "Last 30 Days", "API quota", "42 / 100", "Total users: 85"]) {
      expect(matches(value), value).to.equal(false);
    }
  });

  it("treats punctuation in property names as literal text", () => {
    const matches = privacyMatcher(["A+B (test)", "[private]", "x.y"]);
    expect(matches("A+B (test)")).to.equal(true);
    expect(matches("[private]")).to.equal(true);
    expect(matches("AAB test")).to.equal(false);
    expect(matches("xay")).to.equal(false);
  });

  it("only handles an unmodified P outside editors and dialogs", () => {
    const event = { key: "P", ctrlKey: false, metaKey: false, altKey: false, repeat: false, isComposing: false, defaultPrevented: false };
    expect(privacyShortcut(event, false)).to.equal(true);
    expect(privacyShortcut(event, true)).to.equal(false);
    for (const key of ["ctrlKey", "metaKey", "altKey", "repeat", "isComposing", "defaultPrevented"]) {
      expect(privacyShortcut({ ...event, [key]: true }, false), key).to.equal(false);
    }
    expect(privacyShortcut({ ...event, key: "m" }, false)).to.equal(false);
  });
});

describe("shared privacy preference", () => {
  let previousStorage, previousWindow, entries, events;
  beforeEach(() => {
    previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    entries = new Map(); events = new Map();
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) } });
    Object.defineProperty(globalThis, "window", { configurable: true, value: { addEventListener: (name, listener) => events.set(name, listener), removeEventListener: name => events.delete(name) } });
  });
  afterEach(() => {
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage); else delete globalThis.localStorage;
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow); else delete globalThis.window;
  });

  it("preserves realtime's existing preference and synchronizes subscribers immediately", () => {
    entries.set("pb_privacy", "1");
    const store = load("store");
    expect(store.privacySnapshot()).to.equal(true);
    const values = [];
    const stop = store.subscribePrivacy(() => values.push(store.privacySnapshot()));
    store.setPrivacy(false);
    store.setPrivacy(value => !value);
    store.setPrivacy(true);
    expect(values).to.deep.equal([false, true]);
    expect(entries.get("pb_privacy")).to.equal("1");
    stop();
    expect(events.has("storage")).to.equal(false);
  });

  it("synchronizes changes from another tab without writing them back", () => {
    const store = load("store");
    const values = [];
    const stop = store.subscribePrivacy(() => values.push(store.privacySnapshot()));
    events.get("storage")({ key: "pb_privacy", newValue: "1" });
    events.get("storage")({ key: "pb_theme", newValue: "dark" });
    events.get("storage")({ key: "pb_privacy", newValue: null });
    expect(values).to.deep.equal([true, false]);
    expect(entries.size).to.equal(0);
    stop();
  });

  it("continues working when browser storage is blocked", () => {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("Storage blocked"); } });
    const store = load("store");
    expect(store.privacySnapshot()).to.equal(false);
    store.setPrivacy(true);
    expect(store.privacySnapshot()).to.equal(true);
  });
});
