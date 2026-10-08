import { spawn } from "child_process"
import fs from "fs"
import net from "net"
import path from "path"
import { createServer } from "reactotron-core-server"
import { createMcpServer, createNodeDeviceHost } from "reactotron-mcp"

import { numberFlag, stringFlag, type ParsedArguments } from "./arguments"
import { ReactotronAgentClient } from "./client"
import type { CommandResult } from "./commands"
import {
  DEFAULT_HEADLESS_HOST,
  DEFAULT_HEADLESS_MCP_PORT,
  DESKTOP_MCP_PORTS,
  clearHeadlessState,
  readHeadlessState,
  stateDirectory,
  writeHeadlessState,
} from "./headless-state"

/**
 * The headless server owns the app connection (core-server on :9090) and the
 * MCP endpoint, so the CLI and MCP clients work with the desktop app closed.
 * The desktop app stays the preferred owner: when it is running, serve defers
 * to it instead of competing for the port.
 */

export interface HeadlessServer {
  mcpPort: number
  serverPort: number
  host: string
  stop(): void
}

function portIsFree(port: number) {
  return new Promise<boolean>((resolve) => {
    const probe = net.createServer()
    probe.once("error", () => resolve(false))
    probe.once("listening", () => probe.close(() => resolve(true)))
    probe.listen(port)
  })
}

/** The desktop app's MCP endpoint when it is up, otherwise undefined. */
export async function findDesktopEndpoint(): Promise<string | undefined> {
  for (const port of DESKTOP_MCP_PORTS) {
    const client = new ReactotronAgentClient({ port })
    try {
      const { endpoint } = await client.connect()
      return endpoint
    } catch {
      // Try the next port.
    }
  }
  return undefined
}

export async function startHeadlessServer(
  options: { serverPort?: number; mcpPort?: number; host?: string } = {}
) {
  const serverPort = options.serverPort ?? 9090
  const host = options.host ?? DEFAULT_HEADLESS_HOST
  const mcpPort = options.mcpPort ?? DEFAULT_HEADLESS_MCP_PORT

  if (!(await portIsFree(serverPort))) {
    throw new Error(
      `Port ${serverPort} is in use, usually by the Reactotron desktop app. Close it or pass --server-port.`
    )
  }
  if (!(await portIsFree(mcpPort))) throw new Error(`MCP port ${mcpPort} is in use. Pass --mcp-port.`)

  const reactotron = createServer({ port: serverPort, host })
  reactotron.on("connectionEstablished", (connection: any) =>
    process.stderr.write(`[reactotron] ${connection.name ?? "app"} (${connection.platform}) connected.\n`)
  )
  reactotron.on("disconnect", (connection: any) =>
    process.stderr.write(`[reactotron] ${connection.name ?? "app"} disconnected.\n`)
  )
  reactotron.start()

  const deviceHost = createNodeDeviceHost()
  const mcp = createMcpServer(reactotron, undefined, undefined, deviceHost)
  try {
    await mcp.start(mcpPort)
  } catch (error) {
    reactotron.stop()
    throw error
  }

  writeHeadlessState({ pid: process.pid, mcpPort, serverPort, host, startedAt: new Date().toISOString() })

  let stopped = false
  return {
    mcpPort,
    serverPort,
    host,
    stop() {
      if (stopped) return
      stopped = true
      deviceHost.dispose()
      mcp.stop()
      reactotron.stop()
      clearHeadlessState()
    },
  } satisfies HeadlessServer
}

async function waitForEndpoint(port: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      return (await new ReactotronAgentClient({ port }).connect()).endpoint
    } catch {
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  return undefined
}

export async function runServe(args: ParsedArguments, cliPath: string): Promise<CommandResult | "running"> {
  const serverPort = numberFlag(args, "server-port")
  const mcpPort = numberFlag(args, "mcp-port") ?? DEFAULT_HEADLESS_MCP_PORT
  const host = stringFlag(args, "host")

  const desktop = await findDesktopEndpoint()
  if (desktop) {
    return {
      status: "success",
      summary: `Reactotron desktop is running with MCP at ${desktop}; the CLI and MCP clients use it. No headless server needed.`,
      data: { mode: "desktop", url: desktop },
    }
  }

  const existing = readHeadlessState()
  if (existing) {
    return {
      status: "success",
      summary: `Headless server already running (pid ${existing.pid}) with MCP at http://127.0.0.1:${existing.mcpPort}/mcp.`,
      data: { mode: "headless", ...existing },
    }
  }

  if (args.flags.detach) {
    fs.mkdirSync(stateDirectory(), { recursive: true })
    const logFile = path.join(stateDirectory(), "agent-server.log")
    const log = fs.openSync(logFile, "a")
    const passthrough = [
      ...(serverPort ? ["--server-port", String(serverPort)] : []),
      ...(host ? ["--host", host] : []),
      "--mcp-port",
      String(mcpPort),
    ]
    const child = spawn(process.execPath, [cliPath, "agent", "serve", ...passthrough], {
      detached: true,
      stdio: ["ignore", log, log],
    })
    child.unref()
    const endpoint = await waitForEndpoint(mcpPort, 10000)
    if (!endpoint) {
      return { status: "error", summary: `Headless server did not start. See ${logFile}.` }
    }
    return {
      status: "success",
      summary: `Headless server started (pid ${child.pid}) with MCP at ${endpoint}. Stop it with reactotron agent stop.`,
      data: { mode: "headless", pid: child.pid, url: endpoint, log: logFile },
    }
  }

  const server = await startHeadlessServer({ serverPort, mcpPort, host })
  process.stderr.write(
    `Reactotron headless server: apps connect on ${server.host}:${server.serverPort}, MCP at http://127.0.0.1:${server.mcpPort}/mcp. Ctrl+C to stop.\n`
  )
  const shutdown = () => {
    server.stop()
    process.exit(0)
  }
  process.once("SIGINT", shutdown)
  process.once("SIGTERM", shutdown)
  return "running"
}

export async function runStop(): Promise<CommandResult> {
  const state = readHeadlessState()
  if (!state) return { status: "success", summary: "No headless server is running." }
  process.kill(state.pid, "SIGTERM")
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    try {
      process.kill(state.pid, 0)
      await new Promise((r) => setTimeout(r, 100))
    } catch {
      return { status: "success", summary: `Stopped headless server (pid ${state.pid}).` }
    }
  }
  return { status: "error", summary: `Headless server (pid ${state.pid}) did not exit after SIGTERM.` }
}
