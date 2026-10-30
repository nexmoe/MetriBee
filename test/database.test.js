const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const Database = require("better-sqlite3");
const { promisify } = require("node:util");
const { execFile } = require("node:child_process");
const {
  openDatabase,
  migrateLegacyDocuments,
  documentStore,
  readDocumentSnapshot,
} = require("./helpers/database");

describe("SQLite application data migration", function () {
  this.timeout(15000);
  let directory, db, originalEnv;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "metribee-database-"));
    originalEnv = {
      DEMO: process.env.DEMO,
      GA4_FUNNELS_DIR: process.env.GA4_FUNNELS_DIR,
      GA4_EMBEDS_DIR: process.env.GA4_EMBEDS_DIR,
      DATABASE_PATH: process.env.DATABASE_PATH,
    };
    process.env.DEMO = "0";
    for (const [key, name] of [
      ["GA4_FUNNELS_DIR", "funnels"],
      ["GA4_EMBEDS_DIR", "embeds"],
    ]) {
      process.env[key] = path.join(directory, name);
      fs.mkdirSync(process.env[key]);
    }
    process.env.DATABASE_PATH = path.join(directory, "application.sqlite");
    db = openDatabase(process.env.DATABASE_PATH);
  });
  afterEach(() => {
    if (db.open) db.close();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  it("atomically migrates legacy data once, preserving keys, widget IDs and originals", () => {
    const funnel = {
      version: 1,
      nextId: 2,
      funnels: [{ id: 1, name: "Saved funnel", steps: [] }],
    };
    const embed = {
      embedEnabled: true,
      privateLinkKey: "abcdef123456",
      widgets: [{ id: "123456abcdef", config: { layout: "badge" } }],
    };
    fs.writeFileSync(
      path.join(process.env.GA4_FUNNELS_DIR, "123.json"),
      JSON.stringify(funnel)
    );
    fs.writeFileSync(
      path.join(process.env.GA4_EMBEDS_DIR, "123.json"),
      JSON.stringify(embed)
    );
    migrateLegacyDocuments(db);
    assert.equal(db.prepare("SELECT count(*) n FROM app_document").get().n, 2);
    assert.deepEqual(
      JSON.parse(
        db.prepare("SELECT payload FROM app_document WHERE kind='embeds'").get()
          .payload
      ),
      embed
    );
    assert.deepEqual(
      JSON.parse(
        fs.readFileSync(path.join(process.env.GA4_FUNNELS_DIR, "123.json"))
      ),
      funnel
    );
    db.prepare(
      "UPDATE app_document SET payload='{}' WHERE kind='funnels'"
    ).run();
    migrateLegacyDocuments(db);
    assert.equal(
      db.prepare("SELECT payload FROM app_document WHERE kind='funnels'").get()
        .payload,
      "{}"
    );
    assert.equal(db.pragma("journal_mode", { simple: true }), "wal");
    assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
    assert.equal(fs.statSync(db.name).mode & 0o777, 0o600);
  });
  it("uses the application database for legacy directories configured through env", () => {
    const definitions = { version: 1, nextId: 1, funnels: [] };
    const embeds = {
      embedEnabled: true,
      privateLinkKey: "abcdef123456",
      widgets: [],
    };
    for (const [kind, folder, data] of [
      ["funnels", process.env.GA4_FUNNELS_DIR, definitions],
      ["embeds", process.env.GA4_EMBEDS_DIR, embeds],
    ]) {
      fs.writeFileSync(path.join(folder, "123.json"), JSON.stringify(data));
    }
    migrateLegacyDocuments(db);
    for (const [kind, folder] of [
      ["funnels", process.env.GA4_FUNNELS_DIR],
      ["embeds", process.env.GA4_EMBEDS_DIR],
    ]) {
      const defaultDirectory = path.resolve(__dirname, "../.data", kind);
      const store = documentStore(kind, folder, defaultDirectory);
      const original = store.read("123");
      const next = { ...original, migrationCheck: "written in main database" };
      store.transaction(() => store.write("123", next));
      assert.deepEqual(
        JSON.parse(
          db
            .prepare(
              "SELECT payload FROM app_document WHERE kind=? AND propertyId=?"
            )
            .get(kind, "123").payload
        ),
        next
      );
      assert.deepEqual(
        JSON.parse(readDocumentSnapshot(kind, "123", folder, defaultDirectory)),
        next
      );
      assert.equal(fs.existsSync(path.join(folder, "store.sqlite")), false);
      assert.equal(
        JSON.parse(fs.readFileSync(path.join(folder, "123.json")))
          .migrationCheck,
        undefined
      );
    }
  });
  it("leaves the migration unapplied if any legacy file is corrupt", () => {
    fs.writeFileSync(
      path.join(process.env.GA4_FUNNELS_DIR, "123.json"),
      JSON.stringify({ version: 1, nextId: 1, funnels: [] })
    );
    fs.writeFileSync(
      path.join(process.env.GA4_EMBEDS_DIR, "456.json"),
      "{broken"
    );
    assert.throws(() => migrateLegacyDocuments(db));
    assert.equal(db.prepare("SELECT count(*) n FROM app_document").get().n, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM app_migration").get().n, 0);
  });
  it("serializes writes from separate processes and rolls back failed document updates", async () => {
    const storeDirectory = path.join(directory, "shared");
    const script = `const {documentStore}=require(${JSON.stringify(
      require.resolve("../lib/database")
    )});
      const store=documentStore('counter',process.argv[1],'/unused');
      for(let i=0;i<20;i++)store.transaction(()=>{const data=store.read('1',()=>({count:0}));store.write('1',{count:data.count+1});});`;
    await Promise.all(
      [1, 2].map(() =>
        promisify(execFile)(process.execPath, ["-e", script, storeDirectory])
      )
    );
    const store = documentStore("counter", storeDirectory, "/unused");
    assert.equal(store.read("1").count, 40);
    assert.throws(() =>
      store.transaction(() => {
        store.write("1", { count: -1 });
        throw new Error("rollback");
      })
    );
    assert.equal(store.read("1").count, 40);
  });
  it("backs up a live WAL database with authentication data and verifies integrity", async () => {
    const runtime = await (
      await import("../lib/auth.mjs")
    ).createAuthentication({ db, env: { BASE_URL: "http://localhost:5483" } });
    await runtime.auth.api.signUpEmail({
      body: {
        email: "backup@example.com",
        name: "Backup",
        password: "test-password",
      },
    });
    const destination = path.join(directory, "backup.sqlite");
    await db.backup(destination);
    const backup = new Database(destination, { readonly: true });
    try {
      assert.equal(backup.pragma("integrity_check", { simple: true }), "ok");
      assert.deepEqual(backup.pragma("foreign_key_check"), []);
      assert.equal(
        backup.prepare("SELECT email FROM user").get().email,
        "backup@example.com"
      );
      assert.equal(
        backup.prepare("SELECT count(*) n FROM organization").get().n,
        1
      );
      assert.equal(
        backup
          .prepare("SELECT value FROM app_setting WHERE key='authSecret'")
          .get().value,
        db.prepare("SELECT value FROM app_setting WHERE key='authSecret'").get()
          .value
      );
    } finally {
      backup.close();
    }
  });
  it("finishes migrate, check and backup commands before closing SQLite", async () => {
    const filename = path.join(directory, "cli.sqlite"),
      backupPath = path.join(directory, "cli-backup.sqlite");
    for (const args of [["migrate"], ["check"], ["backup", backupPath]]) {
      const result = await promisify(execFile)(
        process.execPath,
        [path.resolve(__dirname, "../scripts/database.mjs"), ...args],
        {
          env: {
            ...process.env,
            DATABASE_PATH: filename,
            BASE_URL: "http://localhost:5483",
          },
        }
      );
      assert.doesNotMatch(result.stderr, /not open|Unhandled|Error:/);
    }
    const copy = new Database(backupPath, { readonly: true });
    try {
      assert.equal(copy.pragma("integrity_check", { simple: true }), "ok");
    } finally {
      copy.close();
    }
  });
});
