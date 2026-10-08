import { DESKTOP_MCP_PORTS, readHeadlessState } from "./headless-state"

export interface McpClientOptions {
  url?: string
  host?: string
  port?: number
  clientVersion?: string
  fetch?: typeof globalThis.fetch
}

export interface ToolCallResult {
  data: unknown
  artifacts: Array<{ mimeType: string; bytes?: number; data?: string }>
  isError: boolean
}

interface JsonRpcResponse {
  id?: number | string | null
  result?: any
  error?: { code?: number; message?: string; data?: unknown }
}

const PROTOCOL_VERSION = "2025-03-26"

function trimEndpoint(url: string): string {
  const trimmed = url.replace(/\/$/, "")
  return trimmed.endsWith("/mcp") ? trimmed : `${trimmed}/mcp`
}

function parseSse(text: string): JsonRpcResponse[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean)
    .map((data) => JSON.parse(data) as JsonRpcResponse)
}

function parseResponse(text: string, contentType: string): JsonRpcResponse[] {
  if (contentType.includes("text/event-stream") || text.trimStart().startsWith("data:")) {
    return parseSse(text)
  }

  const parsed = JSON.parse(text) as JsonRpcResponse | JsonRpcResponse[]
  return Array.isArray(parsed) ? parsed : [parsed]
}

function parseTextPayload(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export class ReactotronAgentClient {
  private readonly fetchImpl: typeof globalThis.fetch
  private readonly candidates: string[]
  private readonly clientVersion: string
  private endpoint?: string
  private requestId = 0

  constructor(options: McpClientOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch
    this.clientVersion = options.clientVersion ?? "development"
    if (!this.fetchImpl) throw new Error("Reactotron CLI requires Node.js 18 or newer.")

    if (options.url) {
      this.candidates = [trimEndpoint(options.url)]
    } else if (options.port) {
      this.candidates = [`http://${options.host ?? "127.0.0.1"}:${options.port}/mcp`]
    } else {
      // The desktop app is preferred; a running headless server is the fallback.
      const headless = readHeadlessState()
      const ports = headless ? [...DESKTOP_MCP_PORTS, headless.mcpPort] : DESKTOP_MCP_PORTS
      this.candidates = ports.map((port) => `http://${options.host ?? "127.0.0.1"}:${port}/mcp`)
    }
  }

  get url(): string | undefined {
    return this.endpoint
  }

  async connect(): Promise<{ endpoint: string; server: unknown }> {
    const failures: string[] = []
    for (const endpoint of this.candidates) {
      try {
        this.endpoint = endpoint
        const server = await this.request("initialize", {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "reactotron-cli", version: this.clientVersion },
        })
        return { endpoint, server }
      } catch (error) {
        failures.push(`${endpoint}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    this.endpoint = undefined
    throw new Error(`Could not connect to Reactotron Agent API. ${failures.join("; ")}`)
  }

  async readResource(uri: string): Promise<unknown> {
    const result = await this.request("resources/read", { uri })
    const content = result?.contents?.[0]
    if (!content || typeof content.text !== "string") {
      throw new Error(`Resource ${uri} returned no text content.`)
    }
    return parseTextPayload(content.text)
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolCallResult> {
    const result = await this.request("tools/call", { name, arguments: args })
    const content = Array.isArray(result?.content) ? result.content : []
    const text = content.find((item: any) => item?.type === "text")?.text
    const artifacts = content
      .filter((item: any) => item?.type === "image" && typeof item.data === "string")
      .map((item: any) => ({
        mimeType: item.mimeType ?? "application/octet-stream",
        bytes: Buffer.byteLength(item.data, "base64"),
        data: item.data,
      }))

    return {
      data: typeof text === "string" ? parseTextPayload(text) : null,
      artifacts,
      isError: Boolean(result?.isError),
    }
  }

  private async request(method: string, params: Record<string, unknown>): Promise<any> {
    if (!this.endpoint) this.endpoint = this.candidates[0]
    const id = ++this.requestId
    let response: Response

    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      })
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error))
    }

    const body = await response.text()
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`)
    }

    const messages = parseResponse(body, response.headers.get("content-type") ?? "")
    const message = messages.find((candidate) => candidate.id === id) ?? messages[0]
    if (!message) throw new Error("Reactotron returned an empty response.")
    if (message.error) throw new Error(message.error.message ?? `MCP error ${message.error.code}`)
    return message.result
  }
}

export { parseResponse, parseTextPayload }
