const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");
const { once } = require("node:events");
const { promisify } = require("node:util");
const Database = require("better-sqlite3");
const { eq } = require("drizzle-orm");
const { getTableConfig } = require("drizzle-orm/sqlite-core");
const { migrateDatabase, getOrm } = require("../lib/db/migrate");
const schema = require("../lib/db/schema");
const legacySchema = fs.readFileSync(
  path.join(__dirname, "fixtures/pre-drizzle-schema.sql"),
  "utf8"
);

describe("Drizzle SQLite upgrades", function () {
  this.timeout(15000);
  let directory, db;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "metribee-drizzle-"));
  });
  afterEach(() => {
    if (db?.open) db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const history = (db) =>
    db
      .prepare(
        "SELECT hash,created_at FROM __drizzle_migrations ORDER BY created_at"
      )
      .all();

  it("creates every application/auth table and records migrations once across restarts", () => {
    const filename = path.join(directory, "fresh.sqlite");
    db = new Database(filename);
    migrateDatabase(db);
    for (const table of Object.values(schema)) {
      const config = getTableConfig(table);
      const actual = db
        .pragma(`table_info('${config.name}')`)
        .map((column) => column.name)
        .sort();
      assert.deepEqual(
        actual,
        config.columns.map((column) => column.name).sort(),
        config.name
      );
    }
    const before = history(db);
    assert.equal(before.length, 2);
    db.close();
    db = new Database(filename);
    migrateDatabase(db);
    assert.deepEqual(history(db), before);
  });

  it("adopts a populated pre-Drizzle database, preserving credentials, sessions, grants and saved definitions", async () => {
    db = new Database(path.join(directory, "existing.sqlite"));
    db.exec(legacySchema);
    const { hashPassword } = await import("better-auth/crypto");
    const password = await hashPassword("migration-password");
    const iso = "2026-10-26T04:00:00.123Z";
    db.prepare(
      "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)"
    ).run("old-user", "Existing user", "migration@example.com", iso, iso);
    db.prepare(
      "INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES(?,?,'credential',?,?,?,?)"
    ).run("old-account", "old-user", "old-user", password, iso, iso);
    db.prepare(
      "INSERT INTO organization(id,name,slug,createdAt) VALUES('old-org','Existing org','existing-org',?)"
    ).run(Date.parse(iso));
    db.prepare(
      "INSERT INTO member(id,organizationId,userId,role,createdAt) VALUES('old-member','old-org','old-user','owner',?)"
    ).run(iso);
    db.prepare(
      "INSERT INTO property_access VALUES('123','old-org','Existing site','example.com','[]')"
    ).run();
    db.prepare(
      "INSERT INTO member_site_access VALUES('old-member','123','admin')"
    ).run();
    db.prepare(
      "INSERT INTO app_setting VALUES('authSecret','existing-stable-secret-that-must-not-change')"
    ).run();
    db.prepare(
      "INSERT INTO app_setting VALUES('defaultOrganization','old-org')"
    ).run();
    db.prepare(
      "INSERT INTO session(id,token,userId,expiresAt,createdAt,updatedAt) VALUES('old-session','old-token','old-user',?,?,?)"
    ).run(new Date(Date.now() + 86400000).toISOString(), iso, iso);
    db.prepare(
      "INSERT INTO apikey(id,configId,referenceId,key,createdAt,updatedAt) VALUES('old-key','default','old-user','existing-key-hash',?,?)"
    ).run(iso, iso);
    db.prepare(
      "INSERT INTO oauthClient(id,clientId,redirectUris) VALUES('old-client','existing-client','[\"http://localhost/callback\"]')"
    ).run();
    db.prepare("INSERT INTO app_document VALUES('embeds','123',?,?)").run(
      JSON.stringify({
        embedEnabled: true,
        privateLinkKey: "abcdef123456",
        widgets: [{ id: "123456abcdef" }],
      }),
      iso
    );
    db.prepare(
      "INSERT INTO billing_checkout(id,organizationId,userId,mode,productId,productType,status,createdAt) VALUES('old-checkout','old-org','old-user','test','product','subscription','creating',?)"
    ).run(iso);
    db.prepare(
      "INSERT INTO app_migration VALUES('001-legacy-documents',?)"
    ).run(iso);
    const originals = Object.fromEntries(
      [
        "user",
        "account",
        "session",
        "organization",
        "member",
        "property_access",
        "member_site_access",
        "app_setting",
        "app_document",
        "apikey",
        "oauthClient",
        "app_migration",
      ].map((table) => [table, db.prepare(`SELECT * FROM "${table}"`).all()])
    );
    migrateDatabase(db);
    for (const [table, rows] of Object.entries(originals))
      assert.deepEqual(
        db.prepare(`SELECT * FROM "${table}"`).all(),
        rows,
        table
      );
    assert.equal(
      db
        .prepare(
          "SELECT expiresAt FROM billing_checkout WHERE id='old-checkout'"
        )
        .get().expiresAt,
      "2026-10-26T05:00:00.123Z"
    );
    const runtime = await (
      await import("../lib/auth.mjs")
    ).createAuthentication({ db, env: { BASE_URL: "http://127.0.0.1:56789" } });
    const context = await runtime.auth.$context;
    assert.equal(context.adapter.id, "drizzle");
    const session = await context.adapter.findOne({
      model: "session",
      where: [{ field: "token", value: "old-token" }],
    });
    assert.equal(session.createdAt.toISOString(), iso);
    assert.equal(
      getOrm(db)
        .select()
        .from(schema.organization)
        .where(eq(schema.organization.id, "old-org"))
        .get()
        .createdAt.toISOString(),
      iso
    );
    const signedIn = await runtime.auth.api.signInEmail({
      body: { email: "migration@example.com", password: "migration-password" },
    });
    assert.equal(signedIn.user.id, "old-user");
    assert.equal(db.prepare("SELECT count(*) n FROM organization").get().n, 1);
  });

  it("upgrades the older transfer table through a Drizzle compatibility migration", () => {
    db = new Database(path.join(directory, "older.sqlite"));
    db.exec(
      legacySchema.replace(
        "createdBy TEXT NOT NULL, createdAt TEXT NOT NULL, expiresAt",
        "createdBy TEXT NOT NULL, expiresAt"
      )
    );
    db.prepare(
      "INSERT INTO site_transfer(id,propertyId,sourceOrganizationId,targetEmail,createdBy,expiresAt) VALUES('transfer','123','org','person@example.com','user','2030-01-01')"
    ).run();
    migrateDatabase(db);
    assert.equal(
      db.prepare("SELECT createdAt FROM site_transfer").get().createdAt,
      ""
    );
    assert.equal(
      db.prepare("SELECT count(*) n FROM __drizzle_legacy_migrations").get().n,
      1
    );
    assert.equal(
      db.prepare("SELECT propertyId FROM site_transfer").get().propertyId,
      "123"
    );
  });

  it("rolls back a failed forward migration, releases its lock and applies a fixed migration only once", () => {
    const filename = path.join(directory, "forward.sqlite");
    const folder = path.join(directory, "migrations");
    fs.cpSync(path.join(__dirname, "../drizzle"), folder, { recursive: true });
    db = new Database(filename);
    migrateDatabase(db, { migrationsFolder: folder });
    db.prepare(
      "INSERT INTO property_access VALUES('123','org','Keep me','example.com','[]')"
    ).run();
    db.close();
    const journalPath = path.join(folder, "meta/_journal.json");
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
    journal.entries.push({
      idx: 2,
      version: "6",
      when: journal.entries.at(-1).when + 1,
      tag: "0002_forward",
      breakpoints: true,
    });
    fs.writeFileSync(journalPath, JSON.stringify(journal));
    const nextFile = path.join(folder, "0002_forward.sql");
    fs.writeFileSync(
      nextFile,
      "ALTER TABLE property_access ADD COLUMN note text;\n--> statement-breakpoint\nINSERT INTO nonexistent_table VALUES(1);"
    );
    db = new Database(filename);
    assert.throws(
      () => migrateDatabase(db, { migrationsFolder: folder }),
      /nonexistent_table/
    );
    assert.equal(
      db
        .pragma("table_info(property_access)")
        .some((column) => column.name === "note"),
      false
    );
    assert.equal(history(db).length, 2);
    assert.equal(
      fs.existsSync(`${filename}.migration-lock.sqlite-journal`),
      false
    );
    fs.writeFileSync(
      nextFile,
      "ALTER TABLE property_access ADD COLUMN note text;\n--> statement-breakpoint\nUPDATE property_access SET note='migrated';"
    );
    migrateDatabase(db, { migrationsFolder: folder });
    assert.equal(
      db.prepare("SELECT note FROM property_access").get().note,
      "migrated"
    );
    db.close();
    db = new Database(filename);
    migrateDatabase(db, { migrationsFolder: folder });
    assert.equal(history(db).length, 3);
    assert.equal(
      db.prepare("SELECT name FROM property_access").get().name,
      "Keep me"
    );
  });

  it("serializes simultaneous dashboard/MCP startup against one database", async () => {
    const filename = path.join(directory, "parallel.sqlite");
    const script = `const {openDatabase}=require(${JSON.stringify(
      require.resolve("../lib/database")
    )}); const db=openDatabase(process.argv[1]); db.close();`;
    await Promise.all(
      Array.from({ length: 4 }, () =>
        promisify(execFile)(process.execPath, ["-e", script, filename])
      )
    );
    db = new Database(filename);
    assert.equal(history(db).length, 2);
    assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
    assert.equal(
      fs.existsSync(`${filename}.migration-lock.sqlite-journal`),
      false
    );
  });

  it("recovers the migration lock automatically after a process crashes", async () => {
    const filename = path.join(directory, "crash.sqlite");
    const script = `const Database=require(${JSON.stringify(
      require.resolve("better-sqlite3")
    )});
      const lock=new Database(process.argv[1]); lock.exec('BEGIN EXCLUSIVE');
      console.log('locked'); setInterval(()=>{},1000);`;
    const child = spawn(process.execPath, [
      "-e",
      script,
      `${filename}.migration-lock.sqlite`,
    ]);
    try {
      await once(child.stdout, "data");
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
      db = new Database(filename);
      migrateDatabase(db);
      assert.equal(history(db).length, 2);
    } finally {
      child.kill();
    }
  });
});
