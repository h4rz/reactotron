import readline from "readline"

import { parseResponse } from "./client"
import { findDesktopEndpoint, startHeadlessServer, type HeadlessServer } from "./headless"
import { readHeadlessState } from "./headless-state"

/**
 * `reactotron mcp`: an MCP stdio server for agents that launch their tools as
 * subprocesses. It forwards JSON-RPC to whichever HTTP endpoint owns the app
 * connection: the desktop app first, then a running headless server, and
 * otherwise a headless server started inside this process. stdout carries
 * only JSON-RPC, so all diagnostics go to stderr.
 */
export async function runStdio(options: { mcpPort?: number; serverPort?: number; host?: string } = {}) {
  let headless: HeadlessServer | undefined
  let endpoint = await findDesktopEndpoint()

  if (!endpoint) {
    const state = readHeadlessState()
    if (state) endpoint = `http://127.0.0.1:${state.mcpPort}/mcp`
  }
  if (!endpoint) {
    headless = await startHeadlessServer(options)
    endpoint = `http://127.0.0.1:${headless.mcpPort}/mcp`
  }
  process.stderr.write(`[reactotron] MCP stdio bridge -> ${endpoint}${headless ? " (headless)" : ""}\n`)

  const write = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`)
  const pending = new Set<Promise<void>>()

  const forward = async (line: string) => {
    let message: any
    try {
      message = JSON.parse(line)
    } catch {
      write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })
      return
    }
    try {
      const response = await fetch(endpoint!, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: line,
      })
      const body = await response.text()
      // Notifications come back as 202 with no body.
      if (!body.trim()) return
      parseResponse(body, response.headers.get("content-type") ?? "").forEach(write)
    } catch (error) {
      if (message?.id === undefined) return
      write({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32603, message: `Reactotron is unreachable: ${error instanceof Error ? error.message : error}` },
      })
    }
  }

  const input = readline.createInterface({ input: process.stdin })
  input.on("line", (line) => {
    if (!line.trim()) return
    const task = forward(line).finally(() => pending.delete(task))
    pending.add(task)
  })

  await new Promise<void>((resolve) => input.once("close", resolve))
  await Promise.all(pending)
  headless?.stop()
}
