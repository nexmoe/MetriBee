const { expect } = require("chai");
const path = require("node:path");
const { createServer } = require("../frontend/node_modules/vite");

const frontend = path.resolve(__dirname, "../frontend");

describe("shared workspace component resolution", function () {
  this.timeout(15000);
  let server;

  before(async () => {
    server = await createServer({
      root: frontend,
      configFile: path.join(frontend, "vite.config.ts"),
      server: { middlewareMode: true, hmr: false, watch: null },
      optimizeDeps: { noDiscovery: true, include: [] },
      logLevel: "silent",
    });
  });

  after(async () => {
    await server?.close();
  });

  for (const [component, replacement] of [["AppSidebar", "AppSidebar"], ["RybbitLogo", "Logo"]]) {
    it(`uses one ${component} implementation for relative, aliased and absolute imports`, async () => {
      const cases = [
        [`./${component}`, "rybbit/src/components/StandardPage.tsx"],
        [`../../components/${component}`, "rybbit/src/app/(home)/page.tsx"],
        [`../../rybbit/src/components/${component}`, "adapter/pages/Globe.tsx"],
        [`@/components/${component}`, "rybbit/src/app/(home)/page.tsx"],
        [`./${component}.tsx`, "rybbit/src/components/StandardPage.tsx"],
        [path.join(frontend, `rybbit/src/components/${component}.tsx`), "adapter/main.tsx"],
      ];
      for (const [source, importer] of cases) {
        const resolved = await server.pluginContainer.resolveId(source, path.join(frontend, importer));
        expect(resolved?.id, `${source} from ${importer}`).to.equal(path.join(frontend, `metribee/${replacement}.tsx`));
      }
    });
  }
});
