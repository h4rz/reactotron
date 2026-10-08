import { defineConfig } from "tsup"

// Bundle the MCP SDK into the output (its CJS exports are broken).
// Keep reactotron packages external — they're workspace peers.
const bundle = {
  noExternal: ["@modelcontextprotocol/sdk"],
  external: ["@hurajgor/reactotron-core-server", "@hurajgor/reactotron-core-contract"],
  platform: "node" as const,
}

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["cjs"],
    outDir: "dist/commonjs",
    clean: false,
    ...bundle,
  },
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    outDir: "dist/module",
    outExtension: () => ({ js: ".js" }),
    clean: false,
    ...bundle,
  },
  {
    // One bundled declaration file: per-file declarations would expose zod v4's
    // types, which the desktop app's TypeScript 4.9 cannot parse.
    entry: { "src/index": "src/index.ts" },
    outDir: "dist/typescript/commonjs",
    dts: { only: true },
    clean: false,
    ...bundle,
  },
])
