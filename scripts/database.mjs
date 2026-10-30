#!/usr/bin/env node
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, chmod } from "node:fs/promises";
import { createAuthentication } from "../lib/auth.mjs";
const require = createRequire(import.meta.url);
require("dotenv").config({
  path: fileURLToPath(new URL("../.env", import.meta.url)),
});
const { db } = await createAuthentication();
try {
  const command = process.argv[2] || "migrate";
  if (command === "backup") {
    const filename = path.resolve(
      process.argv[3] ||
        `.data/backups/metribee-${new Date()
          .toISOString()
          .replace(/[:.]/g, "-")}.sqlite`
    );
    if (filename === path.resolve(db.name))
      throw new Error(
        "Choose a backup file different from the running database."
      );
    await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
    await db.backup(filename);
    await chmod(filename, 0o600);
    console.log(`SQLite backup saved: ${filename}`);
  } else if (command === "check") {
    const integrity = db.pragma("integrity_check", { simple: true });
    if (integrity !== "ok")
      throw new Error(`SQLite integrity check failed: ${integrity}`);
    console.log("SQLite integrity: ok");
  } else if (command === "migrate") {
    console.log(
      `Drizzle SQLite migrations applied: ${
        db.prepare("SELECT count(*) AS count FROM __drizzle_migrations").get().count
      }`
    );
    console.log(
      "Legacy JSON originals are retained; SQLite is now the authoritative store."
    );
  } else throw new Error("Use migrate, backup [destination], or check.");
} finally {
  db.close();
}
