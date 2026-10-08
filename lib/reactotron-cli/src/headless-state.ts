import fs from "fs"
import os from "os"
import path from "path"

/** Where a running headless server announces itself to other CLI processes. */
export interface HeadlessState {
  pid: number
  mcpPort: number
  serverPort: number
  host: string
  startedAt: string
}

export const DESKTOP_MCP_PORTS = [4567, 4568]
export const DEFAULT_HEADLESS_MCP_PORT = 4569
/** Simulators and `adb reverse` reach loopback; physical devices on Wi-Fi need --host 0.0.0.0. */
export const DEFAULT_HEADLESS_HOST = "127.0.0.1"

export function stateDirectory() {
  return process.env.REACTOTRON_STATE_DIR ?? path.join(os.homedir(), ".reactotron")
}

export function stateFile() {
  return path.join(stateDirectory(), "agent-server.json")
}

export function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: any) {
    return error?.code === "EPERM"
  }
}

/** The live headless server, or undefined. Stale files from a crashed server are ignored. */
export function readHeadlessState(): HeadlessState | undefined {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile(), "utf8")) as HeadlessState
    return Number.isInteger(state.pid) && isProcessAlive(state.pid) ? state : undefined
  } catch {
    return undefined
  }
}

export function writeHeadlessState(state: HeadlessState) {
  fs.mkdirSync(stateDirectory(), { recursive: true })
  fs.writeFileSync(stateFile(), `${JSON.stringify(state, null, 2)}\n`)
}

export function clearHeadlessState(pid = process.pid) {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile(), "utf8")) as HeadlessState
    if (state.pid === pid) fs.rmSync(stateFile(), { force: true })
  } catch {
    // Nothing to clear.
  }
}
