const { expect } = require("chai");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

function onboarding(organizations, failures = {}) {
  const calls = [];
  const organization = Object.fromEntries(["create", "update", "setActive"].map(action => [action, async input => {
    calls.push({ action, input });
    return failures[action] ? { error: { message: failures[action] } } : { data: { id: "new-org" } };
  }]));
  const filename = path.resolve(__dirname, "../frontend/adapter/accounts/onboarding.ts");
  const compiled = new Module(filename, module);
  compiled.require = name => {
    if (name.endsWith("/lib/auth")) return { authClient: { organization } };
    if (name.endsWith("/api/utils")) return { authedFetch: async url => {
      calls.push({ action: "fetch", url });
      if (url === "/user/organizations") return organizations;
      throw new Error(`Signup must not claim or move GA4 properties: ${url}`);
    } };
    throw new Error(`Unexpected import: ${name}`);
  };
  compiled._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, filename);
  return { complete: compiled.exports.completeSignupWorkspace, calls };
}

describe("GA4 workspace signup", () => {
  it("finishes the bootstrap workspace without a domain or any property reassignment", async () => {
    const { complete, calls } = onboarding([{ id: "default-org", slug: "metribee-123", role: "owner" }]);
    expect(await complete({ name: "My workspace", slug: "my-workspace" })).to.deep.equal({ organizationId: "default-org" });
    expect(calls).to.deep.equal([
      { action: "fetch", url: "/user/organizations" },
      { action: "update", input: { organizationId: "default-org", data: { name: "My workspace" } } },
      { action: "setActive", input: { organizationId: "default-org" } },
    ]);
  });

  it("creates an empty workspace for a later user without importing another owner's properties", async () => {
    const { complete, calls } = onboarding([]);
    expect(await complete({ name: "Another workspace", slug: "another-workspace" })).to.deep.equal({ organizationId: "new-org" });
    expect(calls.find(call => call.action === "create").input).to.deep.equal({ name: "Another workspace", slug: "another-workspace" });
  });

  it("reports a failed organization update instead of continuing", async () => {
    const { complete, calls } = onboarding([{ id: "org", slug: "workspace", role: "owner" }], { update: "Permission denied" });
    let error;
    try { await complete({ name: "Workspace", slug: "workspace" }); } catch (value) { error = value; }
    expect(error?.message).to.equal("Permission denied");
    expect(calls.some(call => call.action === "setActive")).to.equal(false);
  });
});
