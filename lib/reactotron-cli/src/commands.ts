import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import type { ParsedArguments } from "./arguments"
import { jsonFlag, numberFlag, requiredFlag, requiredPositional, stringFlag } from "./arguments"
import type { ReactotronAgentClient, ToolCallResult } from "./client"

export interface CommandResult {
  status: "success" | "warning" | "error"
  summary: string
  data?: unknown
  next_actions?: string[]
  artifacts?: Array<Record<string, unknown> | string>
}

export interface CommandContext {
  client: ReactotronAgentClient
  args: ParsedArguments
  writeEvent?: (event: unknown) => void
  wait?: (milliseconds: number) => Promise<void>
  signal?: AbortSignal
}

const RESOURCE_URIS: Record<string, string> = {
  apps: "reactotron://apps",
  benchmarks: "reactotron://benchmarks",
  network: "reactotron://network/log",
  state: "reactotron://state/current",
  storage: "reactotron://asyncstorage",
  subscriptions: "reactotron://state/subscriptions",
  timeline: "reactotron://timeline",
}

function selector(args: ParsedArguments): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const name of ["id", "test-id", "type", "text", "label", "role", "hint", "placeholder"]) {
    const value = stringFlag(args, name)
    if (value !== undefined) result[name === "test-id" ? "testID" : name] = value
  }
  const index = numberFlag(args, "index")
  if (index !== undefined) result.index = index
  return result
}

function withClientId(
  args: ParsedArguments,
  input: Record<string, unknown>
): Record<string, unknown> {
  const clientId = stringFlag(args, "client-id")
  return clientId ? { ...input, clientId } : input
}

function limitData(data: any, limit?: number): unknown {
  if (limit === undefined || limit < 0 || !data || typeof data !== "object") return data
  for (const key of ["events", "entries", "benchmarks", "changes", "mutations", "apps"]) {
    if (Array.isArray(data[key])) return { ...data, [key]: data[key].slice(0, limit) }
  }
  return data
}

function filterClient(data: any, clientId?: string): unknown {
  if (!clientId || !data || typeof data !== "object") return data
  for (const key of ["events", "entries", "benchmarks", "changes", "mutations", "apps"]) {
    if (Array.isArray(data[key])) {
      const filtered = data[key].filter((item: any) => item?.clientId === clientId)
      const countKey = key === "events" ? "eventCount" : undefined
      return { ...data, [key]: filtered, ...(countKey ? { [countKey]: filtered.length } : {}) }
    }
  }
  return data
}

function toolResult(name: string, result: ToolCallResult): CommandResult {
  const payloadStatus = (result.data as any)?.status
  const status =
    result.isError || payloadStatus === "error"
      ? "error"
      : payloadStatus === "no_response" || payloadStatus === "warning"
        ? "warning"
        : "success"
  const filePath =
    typeof (result.data as any)?.filePath === "string" ? (result.data as any).filePath : undefined
  return {
    status,
    summary: `${name} ${status === "success" ? "completed" : status === "warning" ? "completed with a warning" : "failed"}.`,
    data: result.data,
    artifacts: [
      ...(filePath ? [filePath] : []),
      ...result.artifacts.map(({ data: _data, ...artifact }) => artifact),
    ],
  }
}

async function call(
  client: ReactotronAgentClient,
  args: ParsedArguments,
  name: string,
  input: Record<string, unknown> = {}
): Promise<CommandResult> {
  return toolResult(name, await client.callTool(name, withClientId(args, input)))
}

async function read(
  client: ReactotronAgentClient,
  args: ParsedArguments,
  uri: string,
  summary: string,
  limit?: number | null
): Promise<CommandResult> {
  const data = await client.readResource(uri)
  return {
    status: "success",
    summary,
    data: limitData(
      filterClient(data, stringFlag(args, "client-id")),
      limit === null ? undefined : limit ?? numberFlag(args, "limit")
    ),
  }
}

function timelineUri(args: ParsedArguments, defaultType?: string): string {
  const type = stringFlag(args, "type") ?? defaultType
  return type ? `reactotron://timeline/${encodeURIComponent(type)}` : RESOURCE_URIS.timeline
}

async function runState(
  context: CommandContext,
  subcommand: string | undefined
): Promise<CommandResult> {
  const { client, args } = context
  switch (subcommand ?? "cached") {
    case "cached":
      if (stringFlag(args, "client-id")) {
        throw new Error(
          "state cached cannot target one app; use state get PATH --client-id ID for a fresh snapshot."
        )
      }
      return read(client, args, RESOURCE_URIS.state, "Read cached state.")
    case "get":
      return call(client, args, "request_state", { path: args.positionals[2] ?? "" })
    case "keys":
      return call(client, args, "request_state_keys", { path: args.positionals[2] ?? "" })
    case "subscribe":
    case "unsubscribe": {
      const paths = args.positionals.slice(2)
      if (paths.length === 0) throw new Error(`state ${subcommand} requires at least one path.`)
      const name = subcommand === "subscribe" ? "subscribe_state" : "unsubscribe_state"
      const results = []
      for (const path of paths) results.push(await client.callTool(name, { path }))
      const failed = results.some(
        (result) => result.isError || (result.data as any)?.status === "error"
      )
      return {
        status: failed ? "error" : "success",
        summary: `${name} ${failed ? "failed" : "completed"} for ${paths.length} path(s).`,
        data: results.map((result) => result.data),
      }
    }
    case "replace": {
      if (!args.flags.confirm)
        throw new Error(
          "state replace requires --confirm because it replaces the complete app state."
        )
      const path = requiredPositional(args, 2, "JSON file path")
      const state = JSON.parse(await readFile(path, "utf8"))
      return call(client, args, "swap_state", { state })
    }
    default:
      throw new Error(`Unknown state command: ${subcommand}`)
  }
}

async function runUi(
  context: CommandContext,
  subcommand: string | undefined
): Promise<CommandResult> {
  const { client, args } = context
  const chosen = selector(args)
  switch (subcommand) {
    case "snapshot":
      return call(client, args, "agent_ui_snapshot")
    case "find":
      return call(client, args, "agent_ui_find", { selector: chosen })
    case "press":
      return call(client, args, "agent_ui_press", { selector: chosen })
    case "fill":
      return call(client, args, "agent_ui_fill", {
        selector: chosen,
        text: requiredFlag(args, "value"),
      })
    case "scroll":
      return call(client, args, "agent_ui_scroll", {
        selector: chosen,
        x: numberFlag(args, "x") ?? 0,
        y: numberFlag(args, "y") ?? 0,
        animated: !args.flags["no-animated"],
      })
    case "action":
      return call(client, args, "agent_ui_action", {
        selector: chosen,
        action: requiredFlag(args, "action"),
        args: jsonFlag(args, "args"),
        includeSnapshot: !args.flags["no-snapshot"],
      })
    default:
      throw new Error(`Unknown UI command: ${subcommand ?? "(missing)"}`)
  }
}

async function runIos(
  context: CommandContext,
  subcommand: string | undefined
): Promise<CommandResult> {
  const { client, args } = context
  const requireUdid = () => requiredPositional(args, 2, "Simulator UDID")
  switch (subcommand) {
    case "list":
      return call(client, args, "list_ios_simulators")
    case "types":
      return call(client, args, "list_ios_simulator_creation_options")
    case "open":
      return call(client, args, "open_ios_simulator", { udid: requireUdid() })
    case "create": {
      if (!args.flags.confirm)
        throw new Error("ios create requires --confirm because it creates a persistent simulator.")
      return call(client, args, "create_ios_simulator", {
        deviceTypeIdentifier: requiredPositional(args, 2, "Device type identifier"),
        confirm: true,
      })
    }
    case "reconnect":
      return call(client, args, "reconnect_ios_simulator", { udid: requireUdid() })
    case "home":
      return call(client, args, "control_ios_simulator", { udid: requireUdid(), command: "home" })
    case "rotate": {
      const orientation = requiredPositional(args, 3, "Orientation")
      if (!new Set(["portrait", "landscape_left"]).has(orientation)) {
        throw new Error("Orientation must be portrait or landscape_left.")
      }
      return call(client, args, "control_ios_simulator", {
        udid: requireUdid(),
        command: orientation,
      })
    }
    case "reload":
      return call(client, args, "reload_ios_app")
    case "appearance":
      return call(client, args, "toggle_ios_simulator_appearance", { udid: requireUdid() })
    case "screenshot":
      return call(client, args, "ios_simulator_screenshot", { udid: requireUdid() })
    case "shutdown": {
      if (!args.flags.confirm) throw new Error("ios shutdown requires --confirm.")
      return call(client, args, "shutdown_ios_simulator", {
        udid: requireUdid(),
        confirm: true,
      })
    }
    default:
      throw new Error(`Unknown iOS command: ${subcommand ?? "(missing)"}`)
  }
}

function eventFingerprint(event: unknown): string {
  return JSON.stringify(event)
}

export function eventsSince(events: unknown[], previousHead?: string): unknown[] {
  if (!previousHead) return []
  const previousIndex = events.findIndex((event) => eventFingerprint(event) === previousHead)
  return previousIndex < 0 ? events : events.slice(0, previousIndex)
}

async function tap(context: CommandContext): Promise<CommandResult> {
  const { client, args } = context
  const wait =
    context.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  const write = context.writeEvent ?? (() => undefined)
  const interval = numberFlag(args, "interval") ?? 500
  if (interval < 100) throw new Error("--interval must be at least 100 milliseconds.")
  let previousHead: string | undefined
  let initialized = false
  let emitted = 0

  while (!context.signal?.aborted) {
    const data: any = filterClient(
      await client.readResource(timelineUri(args)),
      stringFlag(args, "client-id")
    )
    const events = Array.isArray(data?.events) ? data.events : []
    const fresh = !initialized
      ? args.flags["include-existing"]
        ? events
        : []
      : previousHead === undefined
        ? events
        : eventsSince(events, previousHead)
    for (const event of [...fresh].reverse()) {
      write(event)
      emitted += 1
    }
    previousHead = events[0] === undefined ? previousHead : eventFingerprint(events[0])
    initialized = true
    await wait(interval)
  }

  return { status: "success", summary: `Stopped timeline stream after ${emitted} event(s).` }
}

async function runDevice(
  context: CommandContext,
  subcommand: string | undefined
): Promise<CommandResult> {
  const { client, args } = context
  const deviceId = () => requiredPositional(args, 2, "Device id")
  const out = stringFlag(args, "out")
  switch (subcommand) {
    case "list":
      return call(client, args, "list_devices")
    case "boot":
      return call(client, args, "boot_device", { deviceId: deviceId() })
    case "shutdown":
      if (!args.flags.confirm) throw new Error("device shutdown requires --confirm.")
      return call(client, args, "shutdown_device", { deviceId: deviceId(), confirm: true })
    case "screenshot":
      return call(client, args, "device_screenshot", { deviceId: deviceId() })
    case "record": {
      const action = requiredPositional(args, 2, "record start|stop")
      const id = requiredPositional(args, 3, "Device id")
      if (action === "start") return call(client, args, "device_record_start", { deviceId: id })
      if (action === "stop")
        return call(client, args, "device_record_stop", {
          deviceId: id,
          ...(out ? { outputPath: resolve(out) } : {}),
        })
      throw new Error("Use device record start|stop DEVICE_ID.")
    }
    case "home":
      return call(client, args, "device_home", { deviceId: deviceId() })
    case "appearance":
      return call(client, args, "device_appearance", {
        deviceId: deviceId(),
        appearance: args.positionals[3] ?? "toggle",
      })
    case "rotate":
      return call(client, args, "device_rotate", {
        deviceId: deviceId(),
        orientation: requiredPositional(args, 3, "Orientation (portrait|landscape)"),
      })
    case "open-url":
      return call(client, args, "device_open_url", {
        deviceId: deviceId(),
        url: requiredPositional(args, 3, "URL"),
      })
    case "launch":
    case "terminate":
      return call(client, args, subcommand === "launch" ? "device_launch_app" : "device_terminate_app", {
        deviceId: deviceId(),
        appId: requiredPositional(args, 3, "App id"),
      })
    default:
      throw new Error(`Unknown device command: ${subcommand ?? "(missing)"}`)
  }
}

async function runFlowCommand(
  context: CommandContext,
  subcommand: string | undefined
): Promise<CommandResult> {
  const { client, args } = context
  switch (subcommand) {
    case "record": {
      const action = requiredPositional(args, 2, "record start|stop")
      if (action === "start") return call(client, args, "flow_record_start", { name: args.positionals[3] })
      if (action === "stop") {
        const out = stringFlag(args, "out")
        return call(client, args, "flow_record_stop", out ? { outputPath: resolve(out) } : {})
      }
      throw new Error("Use flow record start [NAME] or flow record stop [--out FILE].")
    }
    case "run": {
      // Paths resolve here because the server may run with a different cwd.
      const result = await client.callTool("flow_run", {
        path: resolve(requiredPositional(args, 2, "Flow file")),
        continueOnFailure: Boolean(args.flags["continue-on-failure"]),
      })
      const report: any = result.data
      const passed = report?.status === "passed"
      const failure = report?.results?.find((step: any) => !step.ok)
      return {
        status: passed ? "success" : "error",
        summary: passed
          ? `Flow passed: ${report.ran}/${report.steps} steps in ${report.durationMs}ms.`
          : failure
            ? `Flow failed at step ${failure.index + 1}: ${failure.message}`
            : `Flow failed: ${report?.message ?? "unknown error"}`,
        data: report,
      }
    }
    default:
      throw new Error(`Unknown flow command: ${subcommand ?? "(missing)"}`)
  }
}

export async function runCommand(context: CommandContext): Promise<CommandResult> {
  const { client, args } = context
  const [command, subcommand] = args.positionals

  if (command !== "help") await client.connect()

  switch (command) {
    case "status": {
      const apps = await client.readResource(RESOURCE_URIS.apps)
      return {
        status: "success",
        summary: `Reactotron Agent API is running at ${client.url}.`,
        data: apps,
      }
    }
    case "apps":
      return read(client, args, RESOURCE_URIS.apps, "Read connected apps.")
    case "timeline":
      if (subcommand === "clear") return call(client, args, "clear_timeline")
      return read(client, args, timelineUri(args), "Read timeline events.")
    case "logs":
      return read(client, args, timelineUri(args, "log"), "Read log events.")
    case "network": {
      const requestedLimit = numberFlag(args, "limit")
      const result = await read(client, args, RESOURCE_URIS.network, "Read network activity.", null)
      if (subcommand === "failures" && typeof result.data === "object" && result.data) {
        const data: any = result.data
        result.data = {
          ...data,
          entries: (data.entries ?? []).filter(
            (entry: any) => Number(entry?.response?.status) >= 400
          ),
        }
        result.summary = "Read failed network requests."
      }
      result.data = limitData(result.data, requestedLimit)
      return result
    }
    case "state":
      return runState(context, subcommand)
    case "storage":
      return read(client, args, RESOURCE_URIS.storage, "Read AsyncStorage mutations.")
    case "benchmarks":
      return read(client, args, RESOURCE_URIS.benchmarks, "Read benchmarks.")
    case "subscriptions":
      return read(client, args, RESOURCE_URIS.subscriptions, "Read state subscriptions.")
    case "ui":
      return runUi(context, subcommand)
    case "commands":
      if (subcommand === "list") return call(client, args, "list_custom_commands")
      if (subcommand === "run")
        return call(client, args, "send_custom_command", {
          command: requiredPositional(args, 2, "Custom command name"),
          args: jsonFlag(args, "args"),
        })
      throw new Error(`Unknown custom command operation: ${subcommand ?? "(missing)"}`)
    case "dispatch": {
      const payload = stringFlag(args, "payload")
      return call(client, args, "dispatch_action", {
        actionType: requiredPositional(args, 1, "Action type"),
        ...(payload === undefined ? {} : { actionPayload: jsonFlag(args, "payload") }),
      })
    }
    case "overlay":
      if (subcommand === "show")
        return call(client, args, "show_overlay", {
          uri: requiredPositional(args, 2, "Overlay image"),
        })
      if (subcommand === "clear") return call(client, args, "show_overlay", { uri: null })
      throw new Error(`Unknown overlay command: ${subcommand ?? "(missing)"}`)
    case "ios":
      return runIos(context, subcommand)
    case "device":
      return runDevice(context, subcommand)
    case "flow":
      return runFlowCommand(context, subcommand)
    case "reload": {
      const metroPort = numberFlag(args, "metro-port")
      return call(client, args, "reload_app", metroPort === undefined ? {} : { metroPort })
    }
    case "tap":
      return tap(context)
    case "read": {
      const uri = requiredPositional(args, 1, "Resource URI")
      return read(client, args, uri, `Read ${uri}.`)
    }
    case "call":
      return call(
        client,
        args,
        requiredPositional(args, 1, "Tool name"),
        jsonFlag(args, "args") as Record<string, unknown>
      )
    case "help":
      return { status: "success", summary: "Reactotron Agent CLI help." }
    default:
      throw new Error(`Unknown command: ${command ?? "(missing)"}. Run reactotron agent --help.`)
  }
}
