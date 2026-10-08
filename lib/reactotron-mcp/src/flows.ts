import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { Command } from "@hurajgor/reactotron-core-contract"
import { promises as fsPromises } from "fs"
import { dirname, resolve } from "path"
import { z } from "zod/v4"

import { MAX_RESPONSE_CHARS, safeSerialize } from "./serialization"

/**
 * Flows are replayable sequences of MCP tool calls plus assertions. They are
 * recorded from whatever an agent or the CLI does through this server and
 * replayed server-side, so a flow runs the same way in CI as it did live.
 */

export type FlowStep =
  | { tool: string; args?: Record<string, unknown> }
  | { waitFor: { testID?: string; selector?: Record<string, unknown>; timeoutMs?: number; clientId?: string } }
  | { expectNetwork: { url: string; method?: string; status?: number; timeoutMs?: number } }
  | { expectState: { path: string; equals: unknown; clientId?: string } }
  | { sleep: number }

export interface Flow {
  version: 1
  name?: string
  steps: FlowStep[]
}

export type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<any>

/** Tools that change the app or device. Reads are not worth replaying. */
const RECORDABLE_TOOLS = new Set([
  "agent_ui_press",
  "agent_ui_fill",
  "agent_ui_scroll",
  "agent_ui_action",
  "dispatch_action",
  "send_custom_command",
  "swap_state",
  "show_overlay",
  "boot_device",
  "device_home",
  "device_appearance",
  "device_rotate",
  "device_open_url",
  "device_launch_app",
  "device_terminate_app",
  "reload_app",
  "control_ios_simulator",
  "reload_ios_app",
  "toggle_ios_simulator_appearance",
])

export interface FlowRecorder {
  readonly recording: boolean
  start(name?: string): void
  stop(): Flow | null
  record(tool: string, args: Record<string, unknown>): void
}

export function createFlowRecorder(): FlowRecorder {
  let current: Flow | null = null
  return {
    get recording() {
      return current !== null
    },
    start(name) {
      current = { version: 1, name, steps: [] }
    },
    stop() {
      const flow = current
      current = null
      return flow
    },
    record(tool, args) {
      if (!current || !RECORDABLE_TOOLS.has(tool)) return
      const cleanArgs = Object.fromEntries(Object.entries(args ?? {}).filter(([, value]) => value !== undefined))
      current.steps.push(Object.keys(cleanArgs).length ? { tool, args: cleanArgs } : { tool })
    },
  }
}

/**
 * Wrap registerTool so every handler is reachable by name for replay and every
 * call is offered to the recorder. Must run before any tool is registered.
 */
export function instrumentTools(mcp: McpServer, handlers: Map<string, ToolHandler>, recorder: FlowRecorder) {
  const register = mcp.registerTool.bind(mcp) as (...args: any[]) => unknown
  ;(mcp as any).registerTool = (name: string, config: unknown, handler: ToolHandler) => {
    handlers.set(name, handler)
    return register(name, config, async (args: Record<string, unknown>, extra: unknown) => {
      recorder.record(name, args)
      return handler(args, extra)
    })
  }
}

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: safeSerialize(data, MAX_RESPONSE_CHARS) }] }
}

function parseToolResult(result: any): any {
  const text = result?.content?.find((item: any) => item?.type === "text")?.text
  if (typeof text !== "string") return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function toolFailed(result: any, data: any): string | null {
  if (result?.isError) return typeof data === "string" ? data : "Tool returned an error."
  if (data && typeof data === "object" && (data.status === "error" || data.status === "no_response")) {
    return data.message ?? `Tool returned status ${data.status}.`
  }
  return null
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export async function runFlow(
  flow: Flow,
  handlers: Map<string, ToolHandler>,
  commandBuffer: Command[],
  options: { continueOnFailure?: boolean } = {}
) {
  const startedAt = Date.now()
  const results: Array<{ index: number; step: FlowStep; ok: boolean; ms: number; message?: string }> = []

  const call = async (tool: string, args: Record<string, unknown> = {}) => {
    const handler = handlers.get(tool)
    if (!handler) throw new Error(`Unknown tool: ${tool}`)
    const result = await handler(args, {})
    return { result, data: parseToolResult(result) }
  }

  for (const [index, step] of flow.steps.entries()) {
    const stepStart = Date.now()
    let message: string | undefined
    try {
      if ("tool" in step) {
        const { result, data } = await call(step.tool, step.args)
        const failure = toolFailed(result, data)
        if (failure) throw new Error(failure)
      } else if ("waitFor" in step) {
        const { timeoutMs = 5000, testID, selector, clientId } = step.waitFor
        const deadline = Date.now() + timeoutMs
        let found = false
        while (!found && Date.now() < deadline) {
          const { data } = await call("agent_ui_find", {
            selector: { ...selector, ...(testID ? { testID } : {}) },
            clientId,
          })
          found = Number(data?.count) > 0
          if (!found) await wait(250)
        }
        if (!found) throw new Error(`Timed out after ${timeoutMs}ms waiting for ${JSON.stringify(step.waitFor)}.`)
      } else if ("expectNetwork" in step) {
        const { url, method, status, timeoutMs = 5000 } = step.expectNetwork
        const deadline = Date.now() + timeoutMs
        const matches = () =>
          commandBuffer.some((cmd) => {
            if (cmd.type !== "api.response" || new Date(cmd.date).getTime() < startedAt) return false
            const payload = cmd.payload as any
            if (!String(payload?.request?.url ?? "").includes(url)) return false
            if (method && String(payload?.request?.method).toUpperCase() !== method.toUpperCase()) return false
            return status === undefined || Number(payload?.response?.status) === status
          })
        while (!matches()) {
          if (Date.now() >= deadline) {
            throw new Error(`No ${method ?? ""} request to ${url}${status ? ` with status ${status}` : ""} within ${timeoutMs}ms.`)
          }
          await wait(250)
        }
      } else if ("expectState" in step) {
        const { path, equals, clientId } = step.expectState
        const { result, data } = await call("request_state", { path, clientId })
        const failure = toolFailed(result, data)
        if (failure) throw new Error(failure)
        if (!deepEqual(data?.state, equals)) {
          throw new Error(`State at ${path} was ${JSON.stringify(data?.state)}, expected ${JSON.stringify(equals)}.`)
        }
      } else if ("sleep" in step) {
        await wait(step.sleep)
      } else {
        throw new Error(`Unknown step: ${JSON.stringify(step)}`)
      }
      results.push({ index, step, ok: true, ms: Date.now() - stepStart })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
      results.push({ index, step, ok: false, ms: Date.now() - stepStart, message })
      if (!options.continueOnFailure) break
    }
  }

  const failed = results.filter((r) => !r.ok).length
  const passed = failed === 0 && results.length === flow.steps.length
  return {
    status: passed ? "passed" : "failed",
    name: flow.name,
    steps: flow.steps.length,
    ran: results.length,
    failed,
    durationMs: Date.now() - startedAt,
    results,
  }
}

const stepSchema = z.record(z.string(), z.any())

export function registerFlowTools(
  mcp: McpServer,
  handlers: Map<string, ToolHandler>,
  recorder: FlowRecorder,
  commandBuffer: Command[]
) {
  mcp.registerTool("flow_record_start", {
    description: [
      "Start recording a replayable flow.",
      "Every app/device action made through Reactotron (agent_ui_*, dispatch_action, device_* ...) is captured until flow_record_stop.",
    ].join(" "),
    inputSchema: { name: z.string().optional().describe("Optional flow name.") },
  }, async (args) => {
    recorder.start(args.name)
    return textResult({ status: "recording", name: args.name })
  })

  mcp.registerTool("flow_record_stop", {
    description: "Stop recording and return the flow. Pass outputPath to also save it as JSON for flow_run or `reactotron agent flow run`.",
    inputSchema: { outputPath: z.string().optional().describe("Path to write the flow JSON to.") },
  }, async (args) => {
    const flow = recorder.stop()
    if (!flow) return textResult({ status: "error", message: "No flow is being recorded." })
    let filePath: string | undefined
    if (args.outputPath) {
      filePath = resolve(args.outputPath)
      await fsPromises.mkdir(dirname(filePath), { recursive: true })
      await fsPromises.writeFile(filePath, `${JSON.stringify(flow, null, 2)}\n`)
    }
    return textResult({ status: "success", filePath, flow })
  })

  mcp.registerTool("flow_run", {
    description: [
      "Replay a flow: tool steps { tool, args }, plus assertions { waitFor: { testID | selector, timeoutMs } },",
      "{ expectNetwork: { url, method?, status?, timeoutMs } }, { expectState: { path, equals } } and { sleep: ms }.",
      "Returns status passed/failed with per-step results. Stops at the first failure unless continueOnFailure.",
    ].join(" "),
    inputSchema: {
      path: z.string().optional().describe("Path to a flow JSON file."),
      steps: z.array(stepSchema).optional().describe("Inline steps, used when path is omitted."),
      continueOnFailure: z.boolean().optional().describe("Run every step even after a failure."),
    },
  }, async (args) => {
    let flow: Flow
    if (args.path) {
      flow = JSON.parse(await fsPromises.readFile(resolve(args.path), "utf8"))
    } else if (args.steps) {
      flow = { version: 1, steps: args.steps as FlowStep[] }
    } else {
      return textResult({ status: "error", message: "Pass path or steps." })
    }
    if (!Array.isArray(flow?.steps)) return textResult({ status: "error", message: "Flow has no steps array." })
    return textResult(await runFlow(flow, handlers, commandBuffer, { continueOnFailure: args.continueOnFailure }))
  })
}
