const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const dir = path.join(__dirname, "../frontend/rybbit");
const upstream = require("../frontend/rybbit/upstream.json");
const adaptations = require("../frontend/rybbit/adaptations.json");
let unchanged = 0,
  changed = 0;
for (const [file, original] of Object.entries(upstream.files)) {
  const hash = createHash("sha256")
    .update(fs.readFileSync(path.join(dir, file)))
    .digest("hex");
  if (hash === original) unchanged++;
  else if (adaptations[file] === hash) changed++;
  else throw new Error(`Unrecorded Rybbit source adaptation: ${file}`);
}
const server = require("../frontend/rybbit/server-upstream.json");
for (const [file, source] of Object.entries(server.files)) {
  const hash = createHash("sha256").update(fs.readFileSync(path.resolve(dir, "../..", source.target))).digest("hex");
  if (hash !== source.sha256) throw new Error(`Unrecorded Rybbit server adaptation: ${file}`);
}
console.log(
  `Rybbit ${upstream.commit}: ${unchanged} identical upstream files; ${changed} recorded GA4 adaptations.`
);
