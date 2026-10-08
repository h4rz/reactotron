import Store from "electron-store"
import { DEFAULT_REDACTION_RULES, DEFAULT_SERVER_CONFIG } from "@hurajgor/reactotron-mcp"

type StoreType = {
  serverPort: number
  commandHistory: number
  mcpPort: number
  mcpRedactionSensitiveKeys: string[]
  mcpRedactionStatePathPatterns: string[]
  mcpRedactionValuePatterns: string[]
  mcpRedactionRulesVersion: number
  mcpAllowClientDisable: boolean
  mcpAllowClientRemoveRules: boolean
}

function readRuntimeConfig() {
  const isDevAppFromEnv = process.env.REACTOTRON_DEV_APP === "1"
  const defaultServerPortFromEnv = Number(
    process.env.REACTOTRON_SERVER_PORT ?? (isDevAppFromEnv ? 9091 : 9090)
  )
  const defaultMcpPortFromEnv = Number(
    process.env.REACTOTRON_MCP_PORT ?? (isDevAppFromEnv ? 4568 : 4567)
  )

  return {
    isDevApp: isDevAppFromEnv,
    defaultServerPort: defaultServerPortFromEnv,
    defaultMcpPort: defaultMcpPortFromEnv,
  }
}

export const runtimeConfig = readRuntimeConfig()
const { isDevApp, defaultServerPort, defaultMcpPort } = runtimeConfig

const config = new Store<StoreType>({
  schema: {
    serverPort: {
      type: "number",
      default: defaultServerPort,
    },
    commandHistory: {
      type: "number",
      default: 500,
    },
    mcpPort: {
      type: "number",
      default: defaultMcpPort,
    },
    mcpRedactionSensitiveKeys: {
      type: "array",
      items: { type: "string" },
      default: DEFAULT_REDACTION_RULES.sensitiveKeys,
    },
    mcpRedactionStatePathPatterns: {
      type: "array",
      items: { type: "string" },
      default: DEFAULT_REDACTION_RULES.statePathPatterns,
    },
    mcpRedactionValuePatterns: {
      type: "array",
      items: { type: "string" },
      default: DEFAULT_REDACTION_RULES.valuePatterns,
    },
    mcpRedactionRulesVersion: {
      type: "number",
      default: 0,
    },
    mcpAllowClientDisable: {
      type: "boolean",
      default: DEFAULT_SERVER_CONFIG.allowClientDisable,
    },
    mcpAllowClientRemoveRules: {
      type: "boolean",
      default: DEFAULT_SERVER_CONFIG.allowClientRemoveRules,
    },
  },
})

// Setup defaults
if (!config.has("serverPort")) {
  config.set("serverPort", defaultServerPort)
}
if (!config.has("commandHistory")) {
  config.set("commandHistory", 500)
}
if (!config.has("mcpPort")) {
  config.set("mcpPort", defaultMcpPort)
}

const currentRedactionRulesVersion = 1
if (config.get("mcpRedactionRulesVersion") < currentRedactionRulesVersion) {
  config.set(
    "mcpRedactionSensitiveKeys",
    Array.from(
      new Set([
        ...(config.get("mcpRedactionSensitiveKeys") ?? []),
        ...(DEFAULT_REDACTION_RULES.sensitiveKeys ?? []),
      ])
    )
  )
  config.set(
    "mcpRedactionValuePatterns",
    Array.from(
      new Set([
        ...(config.get("mcpRedactionValuePatterns") ?? []),
        ...(DEFAULT_REDACTION_RULES.valuePatterns ?? []),
      ])
    )
  )
  config.set("mcpRedactionRulesVersion", currentRedactionRulesVersion)
}

// The dev app must run beside the released app. Keep its saved defaults pinned
// away from the production ports so stale config cannot restart it on 9090.
if (isDevApp && config.get("serverPort") !== defaultServerPort) {
  config.set("serverPort", defaultServerPort)
}
if (isDevApp && config.get("mcpPort") !== defaultMcpPort) {
  config.set("mcpPort", defaultMcpPort)
}

export function getConfiguredServerPort() {
  if (isDevApp) return defaultServerPort
  return config.get("serverPort") as number
}

export function getConfiguredMcpPort() {
  if (isDevApp) return defaultMcpPort
  return config.get("mcpPort") as number
}

export default config
