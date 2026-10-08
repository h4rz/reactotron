#!/usr/bin/env node

import { parseArguments, numberFlag, stringFlag } from "./arguments"
import { ReactotronAgentClient } from "./client"
import { runCommand, type CommandResult } from "./commands"
import { runServe, runStop } from "./headless"
import { runStdio } from "./stdio"

declare const __PACKAGE_VERSION__: string

const HELP = `Reactotron Agent CLI

Usage:
  reactotron agent <command> [options]
  reactotron mcp                 MCP stdio server for agents (desktop or headless)

Headless (no desktop app needed):
  serve [--detach]               Own the app connection (:9090) and MCP (:4569)
        [--server-port N] [--mcp-port N] [--host 0.0.0.0]
  stop                           Stop a detached headless server
  When the desktop app is running, serve defers to it and every command uses it.

Read:
  status                         Check the Agent API and connected apps
  apps                           List connected apps
  timeline [--type TYPE]         Read timeline events
  timeline clear                 Clear retained events
  logs                           Read log events
  network [failures]             Read network activity
  state [cached|get|keys] [PATH] Read state
  state subscribe PATH...        Subscribe to state paths
  state unsubscribe PATH...      Unsubscribe from state paths
  state replace FILE --confirm   Replace state from a JSON file
  storage | benchmarks           Read captured data
  subscriptions                  Read state subscription changes
  tap [--type TYPE]              Stream new timeline events by polling

Act:
  dispatch TYPE [--payload JSON]
  commands list
  commands run NAME [--args JSON]
  ui snapshot
  ui find|press [selector]
  ui fill [selector] --value TEXT
  ui scroll [selector] [--x N] [--y N]
  ui action [selector] --action NAME [--args JSON]
  overlay show IMAGE | clear
  ios list|types
  ios open|reconnect|appearance|screenshot UDID
  ios reload
  ios home UDID
  ios rotate UDID portrait|landscape_left
  ios create DEVICE_TYPE --confirm
  ios shutdown UDID --confirm
  reload [--metro-port N]        Reload the React Native app via Metro

Devices (iOS simulators + Android, desktop or headless):
  device list
  device boot ID|avd:NAME
  device shutdown ID --confirm
  device screenshot ID
  device record start ID
  device record stop ID [--out FILE.mp4]
  device home|rotate ID [portrait|landscape]     (Android)
  device appearance ID [light|dark|toggle]
  device open-url ID URL
  device launch|terminate ID APP_ID

Flows (record and replay, CI-friendly exit codes):
  flow record start [NAME]
  flow record stop [--out FILE.json]
  flow run FILE [--continue-on-failure]

Escape hatches:
  read URI                       Read any MCP resource
  call TOOL [--args JSON]        Call any MCP tool

Global options:
  --client-id ID                 Target one connected app
  --host HOST                    Default: 127.0.0.1
  --port PORT                    Use one port instead of discovering 4567/4568/headless
  --url URL                      Use an explicit MCP endpoint
  --limit N                      Limit returned collection items
  --json                         Emit stable JSON; tap emits NDJSON
  --help                         Show help

UI selectors:
  --test-id ID --id ID --type TYPE --text TEXT --label LABEL
  --role ROLE --hint HINT --placeholder TEXT --index N
`

function printResult(result: CommandResult, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(result)}\n`)
    return
  }
  process.stdout.write(`${result.summary}\n`)
  if (result.data !== undefined) process.stdout.write(`${JSON.stringify(result.data, null, 2)}\n`)
  if (result.artifacts?.length)
    process.stdout.write(`${JSON.stringify({ artifacts: result.artifacts }, null, 2)}\n`)
  if (result.next_actions?.length) process.stdout.write(`Next: ${result.next_actions.join("; ")}\n`)
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let parsed
  try {
    parsed = parseArguments(argv)
  } catch (error) {
    printResult(
      { status: "error", summary: error instanceof Error ? error.message : String(error) },
      argv.includes("--json")
    )
    return 1
  }

  const json = Boolean(parsed.flags.json)
  if (parsed.flags.version) {
    process.stdout.write(`${__PACKAGE_VERSION__}\n`)
    return 0
  }
  if (parsed.flags.help || parsed.positionals.length === 0) {
    process.stdout.write(HELP)
    return 0
  }

  const [command] = parsed.positionals
  if (command === "mcp") {
    try {
      await runStdio({
        mcpPort: numberFlag(parsed, "mcp-port"),
        serverPort: numberFlag(parsed, "server-port"),
        host: stringFlag(parsed, "host"),
      })
      return 0
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      return 1
    }
  }
  if (command === "serve" || command === "stop") {
    try {
      const result = command === "serve" ? await runServe(parsed, process.argv[1]) : await runStop()
      // A foreground server keeps the process alive until SIGINT/SIGTERM.
      if (result === "running") return new Promise<number>(() => undefined)
      printResult(result, json)
      return result.status === "error" ? 1 : 0
    } catch (error) {
      printResult(
        { status: "error", summary: error instanceof Error ? error.message : String(error) },
        json
      )
      return 1
    }
  }

  const controller = new AbortController()
  process.once("SIGINT", () => controller.abort())
  const client = new ReactotronAgentClient({
    url: stringFlag(parsed, "url"),
    host: stringFlag(parsed, "host"),
    port: numberFlag(parsed, "port"),
    clientVersion: __PACKAGE_VERSION__,
  })

  try {
    const result = await runCommand({
      client,
      args: parsed,
      signal: controller.signal,
      writeEvent: (event) => process.stdout.write(`${JSON.stringify(event, null, json ? 0 : 2)}\n`),
    })
    printResult(result, json)
    return result.status === "error" ? 1 : 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const connectionError = message.includes("Could not connect")
    printResult(
      {
        status: "error",
        summary: message,
        next_actions: connectionError
          ? [
              "Open Reactotron and enable MCP in the footer, or run reactotron agent serve --detach to work without the desktop app.",
              "Use --port 4568 for Reactotron Dev.",
            ]
          : ["Run reactotron agent --help to check the command syntax."],
      },
      json
    )
    return 1
  }
}

if (require.main === module) {
  void main().then((code) => {
    process.exitCode = code
  })
}

export { HELP }
