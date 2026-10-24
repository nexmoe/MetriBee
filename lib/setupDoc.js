/* Reads setup instructions from SETUP.md (one source for page and docs).
   Blocks sit between <!-- name:start --> and <!-- name:end --> markers. */
const fs = require("fs");
const path = require("path");

const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        c
      ])
  );

function block(md, name) {
  const m = md.match(
    new RegExp(`<!-- ${name}:start -->([\\s\\S]*?)<!-- ${name}:end -->`)
  );
  if (!m) return "";
  return m[1]
    .trim()
    .replace(/^```\w*\n/, "")
    .replace(/\n```$/, "");
}

/** Markdown list item to safe HTML: escapes text, keeps [label](https://...) links, **bold** and `code`. */
function inline(s) {
  return esc(s)
    .replace(
      /\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g,
      (_, label, href) =>
        `<a href="${href}" target="_blank" rel="noopener">${label}</a>`
    )
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function steps(md, name) {
  const items = [];
  for (const line of block(md, name).split("\n")) {
    const item = line.match(/^\s*\d+\.\s+(.*)$/);
    if (item) items.push(item[1]);
    else if (/^\s+\S/.test(line) && items.length)
      items[items.length - 1] += ` ${line.trim()}`;
  }
  return items.map(inline);
}

function parseSetupDoc(md) {
  return {
    prompt: block(md, "prompt"),
    manual: steps(md, "manual"),
    mcp: block(md, "mcp"),
    mcpFeatures: steps(md, "mcp-features"),
    mcpVerify: steps(md, "mcp-verify"),
    gsc: steps(md, "gsc"),
    oauth: steps(md, "oauth"),
  };
}

function loadSetupDoc(file = path.join(__dirname, "..", "SETUP.md")) {
  try {
    return parseSetupDoc(fs.readFileSync(file, "utf8"));
  } catch {
    return parseSetupDoc("");
  }
}

module.exports = { loadSetupDoc, parseSetupDoc };
