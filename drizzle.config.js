const { defineConfig } = require("drizzle-kit");

// Generation/checking is offline. Database migration runs through the same
// startup entry point as the server, with DATABASE_PATH loaded from .env.
module.exports = defineConfig({
  schema: "./lib/db/schema.js",
  out: "./drizzle",
  dialect: "sqlite",
});
