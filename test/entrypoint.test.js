const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const { once } = require("node:events");
const Database = require("better-sqlite3");

const root = path.resolve(__dirname, "..");
const entrypoint = path.join(root, "docker-entrypoint.sh");

describe("Rybbit-style migration entrypoint", function () {
  this.timeout(15000);
  let directory, filename, env;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "metribee-entrypoint-"));
    filename = path.join(directory, "data/app.sqlite");
    env = {
      ...process.env,
      DATABASE_PATH: filename,
      DEMO: "0",
      GA4_FUNNELS_DIR: path.join(directory, "funnels"),
      GA4_EMBEDS_DIR: path.join(directory, "embeds"),
    };
  });
  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  it("runs Drizzle Kit and imports legacy definitions before executing the requested command", async () => {
    fs.mkdirSync(env.GA4_FUNNELS_DIR);
    fs.writeFileSync(
      path.join(env.GA4_FUNNELS_DIR, "123.json"),
      JSON.stringify({
        version: 1,
        nextId: 2,
        funnels: [{ id: 1, name: "Existing", steps: [] }],
      })
    );
    const command = `const db=new(require(${JSON.stringify(
      require.resolve("better-sqlite3")
    )}))(${JSON.stringify(filename)},{readonly:true});
      const rows=db.prepare('SELECT count(*) n FROM __drizzle_migrations').get().n;
      const document=JSON.parse(db.prepare("SELECT payload FROM app_document WHERE kind='funnels'").get().payload);
      if(rows!==2||document.funnels[0].name!=='Existing')process.exit(42);
      console.log('command-after-migration'); db.close();`;
    for (let run = 0; run < 2; run++) {
      const result = await promisify(execFile)(
        "sh",
        [entrypoint, process.execPath, "-e", command],
        { cwd: directory, env }
      );
      assert.match(result.stdout, /migrations applied successfully/i);
      assert.ok(
        result.stdout.indexOf("Drizzle SQLite migrations applied: 2") <
          result.stdout.indexOf("command-after-migration")
      );
    }
    assert.equal(
      fs.existsSync(path.join(env.GA4_FUNNELS_DIR, "123.json")),
      true
    );
  });

  it("stops before starting the service when a SQL migration fails", async () => {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    const db = new Database(filename);
    db.exec(
      "CREATE TABLE member(id TEXT PRIMARY KEY); INSERT INTO member VALUES('keep-me');"
    );
    db.close();
    const marker = path.join(directory, "service-started");
    await assert.rejects(
      promisify(execFile)(
        "sh",
        [
          entrypoint,
          process.execPath,
          "-e",
          `require('node:fs').writeFileSync(${JSON.stringify(
            marker
          )},'started')`,
        ],
        { env }
      ),
      (error) => {
        assert.notEqual(error.code, 0);
        assert.doesNotMatch(error.stdout || "", /Starting application/);
        return true;
      }
    );
    assert.equal(fs.existsSync(marker), false);
    const original = new Database(filename, { readonly: true });
    try {
      assert.equal(
        original.prepare("SELECT id FROM member").get().id,
        "keep-me"
      );
    } finally {
      original.close();
    }
  });

  it("stops before starting the service when legacy JSON is corrupt", async () => {
    fs.mkdirSync(env.GA4_EMBEDS_DIR);
    fs.writeFileSync(path.join(env.GA4_EMBEDS_DIR, "123.json"), "{broken");
    await assert.rejects(
      promisify(execFile)(
        "sh",
        [entrypoint, process.execPath, "-e", "console.log('must-not-start')"],
        { env }
      ),
      (error) => {
        assert.doesNotMatch(
          error.stdout || "",
          /must-not-start|Starting application/
        );
        return true;
      }
    );
  });

  it("uses exec so the application receives SIGTERM as the container process", async () => {
    const child = spawn(
      "sh",
      [
        entrypoint,
        process.execPath,
        "-e",
        "console.log('application-pid='+process.pid); setInterval(()=>{},1000)",
      ],
      { env }
    );
    try {
      const pid = await new Promise((resolve, reject) => {
        let output = "";
        child.on("error", reject);
        child.on("exit", (code) =>
          reject(new Error(`Exited before startup: ${code}`))
        );
        child.stdout.on("data", (chunk) => {
          output += chunk;
          const match = output.match(/application-pid=(\d+)/);
          if (match) resolve(Number(match[1]));
        });
      });
      assert.equal(pid, child.pid);
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      assert.deepEqual(await exited, [null, "SIGTERM"]);
    } finally {
      child.kill();
    }
  });

  it("leaves schema untouched when the app opens an unmigrated database", async () => {
    const database = require("../lib/database");
    const db = database.openDatabase(filename);
    try {
      await assert.rejects(
        (
          await import("../lib/auth.mjs")
        ).createAuthentication({
          db,
          env: { BASE_URL: "http://127.0.0.1:56789" },
        }),
        /pnpm db:migrate/
      );
      assert.deepEqual(
        db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(),
        []
      );
    } finally {
      db.close();
    }
  });
});
