import { defineConfig } from "tsup"
import { readFileSync } from "node:fs"

const packageVersion = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
).version
const define = { __PACKAGE_VERSION__: JSON.stringify(packageVersion) }

// reactotron-core-server and reactotron-mcp are not publishable from this fork
// (unscoped names / private), so the headless server is bundled in. Only ws stays
// external: it has optional native add-ons that must resolve at runtime.
const bundle = {
  noExternal: [/^(?!ws$).*/],
  external: ["ws"],
  platform: "node" as const,
  // core-server require()s mitt; the ESM build would hand it a namespace object.
  esbuildOptions(options: { mainFields?: string[]; conditions?: string[] }) {
    options.mainFields = ["main", "module"]
    options.conditions = ["require", "node"]
  },
}

export default defineConfig([
  {
    entry: ["src/index.ts", "src/cli.ts"],
    format: ["cjs"],
    outDir: "dist/commonjs",
    clean: false,
    define,
    ...bundle,
  },
  {
    entry: ["src/index.ts", "src/cli.ts"],
    format: ["esm"],
    outDir: "dist/module",
    outExtension: () => ({ js: ".js" }),
    clean: false,
    define,
    ...bundle,
  },
])
