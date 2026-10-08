import { getPort } from "get-port-please"
import { createServer } from "@hurajgor/reactotron-core-server"
import { createMcpServer } from "../src/mcp-server"
import type { ReactotronDesktopHost } from "../src/desktop-host"
import WebSocket from "ws"
import http from "http"

// Helper: make an MCP JSON-RPC request
function mcpRequest(
  port: number,
  body: object
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const req = http.request(
      {
        hostname: "localhost",
        port,
        path: "/mcp",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let body = ""
        res.on("data", (chunk) => (body += chunk))
        res.on("end", () => resolve({ status: res.statusCode!, body }))
      }
    )
    req.on("error", reject)
    req.write(data)
    req.end()
  })
}

// Helper: parse SSE response to get the JSON-RPC result
function parseSSE(body: string): any {
  const dataLine = body.split("\n").find((l) => l.startsWith("data: "))
  if (!dataLine) return null
  return JSON.parse(dataLine.replace("data: ", ""))
}

// Helper: connect a mock app to the relay
function connectMockApp(
  relayPort: number,
  appName = "TestApp"
): Promise<WebSocket> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${relayPort}`)
    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "client.intro",
          payload: {
            name: appName,
            platform: "ios",
            platformVersion: "17.0",
            clientId: `${appName}-ios-test`,
          },
        })
      )
      // Give the relay time to process
      setTimeout(() => resolve(ws), 100)
    })
  })
}

let relayPort: number
let mcpPort: number
let relay: ReturnType<typeof createServer>
let mcp: ReturnType<typeof createMcpServer>

beforeEach(async () => {
  relayPort = await getPort({ random: true })
  mcpPort = await getPort({ random: true })
  relay = createServer({ port: relayPort })
  relay.start()
  mcp = createMcpServer(relay)
  mcp.start(mcpPort)
  // Wait for both servers to be ready
  await new Promise((r) => setTimeout(r, 200))
})

afterEach(() => {
  mcp.stop()
  relay.stop()
})

describe("MCP server lifecycle", () => {
  test("starts and reports as started", () => {
    expect(mcp.started).toBe(true)
    expect(mcp.port).toBe(mcpPort)
  })

  test("stops cleanly", () => {
    mcp.stop()
    expect(mcp.started).toBe(false)
    expect(mcp.port).toBe(null)
  })

  test("responds to MCP initialize", async () => {
    const res = await mcpRequest(mcpPort, {
      jsonrpc: "2.0",
      method: "initialize",
      id: 1,
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
    })
    expect(res.status).toBe(200)
    const result = parseSSE(res.body)
    expect(result.result.serverInfo.name).toBe("reactotron")
  })

  test("rejects non-POST methods", async () => {
    const res = await new Promise<{ status: number }>((resolve, reject) => {
      const req = http.request(
        { hostname: "localhost", port: mcpPort, path: "/mcp", method: "GET" },
        (res) => {
          res.resume()
          res.on("end", () => resolve({ status: res.statusCode! }))
        }
      )
      req.on("error", reject)
      req.end()
    })
    expect(res.status).toBe(405)
  })

  test("returns 404 for unknown paths", async () => {
    const res = await new Promise<{ status: number }>((resolve, reject) => {
      const req = http.request(
        { hostname: "localhost", port: mcpPort, path: "/unknown", method: "POST" },
        (res) => {
          res.resume()
          res.on("end", () => resolve({ status: res.statusCode! }))
        }
      )
      req.on("error", reject)
      req.end()
    })
    expect(res.status).toBe(404)
  })
})

describe("resources", () => {
  test("lists resources", async () => {
    const res = await mcpRequest(mcpPort, {
      jsonrpc: "2.0",
      method: "resources/list",
      id: 2,
      params: {},
    })
    const result = parseSSE(res.body)
    const names = result.result.resources.map((r: any) => r.name)
    expect(names).toContain("timeline")
    expect(names).toContain("apps")
    expect(names).toContain("state")
    expect(names).toContain("network")
    expect(names).toContain("benchmarks")
    expect(names).toContain("subscriptions")
    expect(names).toContain("asyncstorage")
  })

  test("reads apps resource with no connections", async () => {
    const res = await mcpRequest(mcpPort, {
      jsonrpc: "2.0",
      method: "resources/read",
      id: 3,
      params: { uri: "reactotron://apps" },
    })
    const result = parseSSE(res.body)
    const data = JSON.parse(result.result.contents[0].text)
    expect(data._meta.connection).toBe("no_apps_connected")
    expect(data.apps).toEqual([])
  })

  test("reads apps resource with a connected app", async () => {
    const app = await connectMockApp(relayPort)
    try {
      const res = await mcpRequest(mcpPort, {
        jsonrpc: "2.0",
        method: "resources/read",
        id: 4,
        params: { uri: "reactotron://apps" },
      })
      const result = parseSSE(res.body)
      const data = JSON.parse(result.result.contents[0].text)
      expect(data._meta.connection).toBe("single_app")
      expect(data.apps.length).toBe(1)
      expect(data.apps[0].name).toBe("TestApp")
    } finally {
      app.close()
    }
  })

  test("reads timeline with buffered events", async () => {
    const app = await connectMockApp(relayPort)
    try {
      // Send a log event from the mock app
      app.send(JSON.stringify({ type: "log", payload: { message: "hello" } }))
      await new Promise((r) => setTimeout(r, 100))

      const res = await mcpRequest(mcpPort, {
        jsonrpc: "2.0",
        method: "resources/read",
        id: 5,
        params: { uri: "reactotron://timeline" },
      })
      const result = parseSSE(res.body)
      const data = JSON.parse(result.result.contents[0].text)
      // Should have client.intro + log events
      expect(data.events.length).toBeGreaterThanOrEqual(2)
      const logEvent = data.events.find((e: any) => e.type === "log")
      expect(logEvent).toBeDefined()
      // Timeline events are now summarized — payload is replaced with payloadPreview
      expect(logEvent.payloadPreview).toContain("hello")
    } finally {
      app.close()
    }
  })

  test("reads empty state", async () => {
    const res = await mcpRequest(mcpPort, {
      jsonrpc: "2.0",
      method: "resources/read",
      id: 6,
      params: { uri: "reactotron://state/current" },
    })
    const result = parseSSE(res.body)
    const data = JSON.parse(result.result.contents[0].text)
    expect(data.state.status).toBe("no_state_received")
  })

  test("reads asyncstorage mutations", async () => {
    const app = await connectMockApp(relayPort)
    try {
      app.send(
        JSON.stringify({
          type: "asyncStorage.mutation",
          payload: { action: "setItem", data: { key: "token", value: "abc123" } },
        })
      )
      await new Promise((r) => setTimeout(r, 100))

      const res = await mcpRequest(mcpPort, {
        jsonrpc: "2.0",
        method: "resources/read",
        id: 7,
        params: { uri: "reactotron://asyncstorage" },
      })
      const result = parseSSE(res.body)
      const data = JSON.parse(result.result.contents[0].text)
      expect(data.mutations.length).toBe(1)
      expect(data.mutations[0].action).toBe("setItem")
      expect(data.mutations[0].data.key).toBe("token")
    } finally {
      app.close()
    }
  })
})

describe("tools", () => {
  test("lists tools", async () => {
    const res = await mcpRequest(mcpPort, {
      jsonrpc: "2.0",
      method: "tools/list",
      id: 10,
      params: {},
    })
    const result = parseSSE(res.body)
    const names = result.result.tools.map((t: any) => t.name)
    expect(names).toContain("dispatch_action")
    expect(names).toContain("request_state")
    expect(names).toContain("request_state_keys")
    expect(names).toContain("swap_state")
    expect(names).toContain("send_custom_command")
    expect(names).toContain("list_custom_commands")
    expect(names).toContain("agent_ui_snapshot")
    expect(names).toContain("agent_ui_action")
    expect(names).toContain("agent_ui_find")
    expect(names).toContain("agent_ui_press")
    expect(names).toContain("agent_ui_fill")
    expect(names).toContain("agent_ui_scroll")
    expect(names).toContain("show_overlay")
    expect(names).toContain("clear_timeline")
    expect(names).toContain("subscribe_state")
    expect(names).toContain("unsubscribe_state")
    expect(names).not.toContain("list_ios_simulators")
  })

  test("registers desktop simulator tools only when a desktop host is supplied", async () => {
    const host: ReactotronDesktopHost = {
      listIOSSimulators: async () => ({ ok: true, simulators: [] }),
      listIOSSimulatorCreationOptions: async () => ({ ok: true, options: [] }),
      openIOSSimulator: async () => ({ ok: true }),
      createIOSSimulator: async () => ({ ok: true }),
      reconnectIOSSimulator: async () => ({ ok: true }),
      shutdownIOSSimulator: async () => ({ ok: true }),
      controlIOSSimulator: async () => ({ ok: true }),
      reloadIOSSimulator: async () => ({ ok: true }),
      toggleIOSSimulatorAppearance: async () => ({ ok: true }),
      captureIOSSimulatorScreenshot: async () => ({ ok: true, imageBase64: "iVBORw0KGgo=", mimeType: "image/png" }),
    }
    const desktopPort = await getPort({ random: true })
    const desktopMcp = createMcpServer(relay, undefined, host)
    await desktopMcp.start(desktopPort)

    try {
      const res = await mcpRequest(desktopPort, {
        jsonrpc: "2.0",
        method: "tools/list",
        id: 10,
        params: {},
      })
      const result = parseSSE(res.body)
      const names = result.result.tools.map((tool: any) => tool.name)
      expect(names).toContain("list_ios_simulators")
      expect(names).toContain("ios_simulator_screenshot")
      expect(names).toContain("shutdown_ios_simulator")
    } finally {
      desktopMcp.stop()
    }
  })

  test("send_custom_command errors with no apps connected", async () => {
    const res = await mcpRequest(mcpPort, {
      jsonrpc: "2.0",
      method: "tools/call",
      id: 11,
      params: { name: "send_custom_command", arguments: { command: "test" } },
    })
    const result = parseSSE(res.body)
    const data = JSON.parse(result.result.content[0].text)
    expect(data.status).toBe("error")
    expect(data.message).toContain("No apps connected")
  })

  test("send_custom_command sends to connected app", async () => {
    const app = await connectMockApp(relayPort)
    try {
      const received: any[] = []
      app.on("message", (msg) => {
        const parsed = JSON.parse(msg.toString())
        if (parsed.type === "custom") received.push(parsed)
      })

      const res = await mcpRequest(mcpPort, {
        jsonrpc: "2.0",
        method: "tools/call",
        id: 12,
        params: { name: "send_custom_command", arguments: { command: "ping" } },
      })
      const result = parseSSE(res.body)
      const data = JSON.parse(result.result.content[0].text)
      expect(data.status).toBe("sent")
      expect(data.command).toBe("ping")

      await new Promise((r) => setTimeout(r, 100))
      expect(received.length).toBe(1)
      expect(received[0].payload.command).toBe("ping")
    } finally {
      app.close()
    }
  })

  test("list_custom_commands returns registered commands", async () => {
    const app = await connectMockApp(relayPort)
    try {
      app.send(
        JSON.stringify({
          type: "customCommand.register",
          payload: { id: 1, command: "reload", title: "Reload App" },
        })
      )
      await new Promise((r) => setTimeout(r, 100))

      const res = await mcpRequest(mcpPort, {
        jsonrpc: "2.0",
        method: "tools/call",
        id: 13,
        params: { name: "list_custom_commands", arguments: {} },
      })
      const result = parseSSE(res.body)
      const data = JSON.parse(result.result.content[0].text)
      expect(data.status).toBe("success")
      expect(data.commands.length).toBe(1)
      expect(data.commands[0].command).toBe("reload")
    } finally {
      app.close()
    }
  })

  test("agent_ui_snapshot returns app semantic UI tree", async () => {
    const app = await connectMockApp(relayPort)
    try {
      app.on("message", (msg) => {
        const parsed = JSON.parse(msg.toString())
        if (parsed.type === "agent.ui.snapshot.request") {
          app.send(JSON.stringify({
            type: "agent.ui.response",
            payload: {
              requestId: parsed.payload.requestId,
              status: "success",
              snapshot: {
                route: "Login",
                nodes: [
                  { testID: "login-email-input", type: "TextInput", enabled: true, visible: true },
                  { testID: "login-submit-button", type: "Pressable", text: "Sign In", enabled: true, visible: true },
                ],
              },
            },
          }))
        }
      })

      const res = await mcpRequest(mcpPort, {
        jsonrpc: "2.0",
        method: "tools/call",
        id: 22,
        params: { name: "agent_ui_snapshot", arguments: {} },
      })
      const result = parseSSE(res.body)
      const data = JSON.parse(result.result.content[0].text)
      expect(data.status).toBe("success")
      expect(data.snapshot.route).toBe("Login")
      expect(data.snapshot.nodes.map((node: any) => node.testID)).toContain("login-submit-button")
    } finally {
      app.close()
    }
  })

  test("agent_ui_find returns nodes matching accessibility selector", async () => {
    const app = await connectMockApp(relayPort)
    try {
      app.on("message", (msg) => {
        const parsed = JSON.parse(msg.toString())
        if (parsed.type === "agent.ui.snapshot.request") {
          app.send(JSON.stringify({
            type: "agent.ui.response",
            payload: {
              requestId: parsed.payload.requestId,
              status: "success",
              snapshot: {
                nodes: [
                  { id: "node-1", type: "Pressable", role: "button", label: "Sign In", enabled: true, visible: true },
                  { id: "node-2", type: "TextInput", role: "text", placeholder: "Email address", enabled: true, visible: true },
                ],
              },
            },
          }))
        }
      })

      const res = await mcpRequest(mcpPort, {
        jsonrpc: "2.0",
        method: "tools/call",
        id: 26,
        params: {
          name: "agent_ui_find",
          arguments: { selector: { role: "button", label: "sign" } },
        },
      })
      const result = parseSSE(res.body)
      const data = JSON.parse(result.result.content[0].text)
      expect(data.status).toBe("success")
      expect(data.count).toBe(1)
      expect(data.matches[0].id).toBe("node-1")
    } finally {
      app.close()
    }
  })

  test("agent_ui_press sends a testID action and returns app result", async () => {
    const app = await connectMockApp(relayPort)
    try {
      const received: any[] = []
      app.on("message", (msg) => {
        const parsed = JSON.parse(msg.toString())
        if (parsed.type === "agent.ui.action.request") {
          received.push(parsed)
          app.send(JSON.stringify({
            type: "agent.ui.response",
            payload: {
              requestId: parsed.payload.requestId,
              status: "success",
              action: parsed.payload.action,
              testID: parsed.payload.testID,
              result: { pressed: true },
            },
          }))
        }
      })

      const res = await mcpRequest(mcpPort, {
        jsonrpc: "2.0",
        method: "tools/call",
        id: 23,
        params: { name: "agent_ui_press", arguments: { testID: "login-submit-button" } },
      })
      const result = parseSSE(res.body)
      const data = JSON.parse(result.result.content[0].text)
      expect(data.status).toBe("success")
      expect(data.action).toBe("press")
      expect(data.testID).toBe("login-submit-button")
      expect(data.result.pressed).toBe(true)
      expect(received[0].payload.action).toBe("press")
      expect(received[0].payload.includeSnapshot).toBe(false)
    } finally {
      app.close()
    }
  })

  test("agent_ui_press sends selector action when testID is unavailable", async () => {
    const app = await connectMockApp(relayPort)
    try {
      const received: any[] = []
      app.on("message", (msg) => {
        const parsed = JSON.parse(msg.toString())
        if (parsed.type === "agent.ui.action.request") {
          received.push(parsed)
          app.send(JSON.stringify({
            type: "agent.ui.response",
            payload: {
              requestId: parsed.payload.requestId,
              status: "success",
              action: parsed.payload.action,
              result: { selector: parsed.payload.selector },
            },
          }))
        }
      })

      const res = await mcpRequest(mcpPort, {
        jsonrpc: "2.0",
        method: "tools/call",
        id: 27,
        params: {
          name: "agent_ui_press",
          arguments: { selector: { role: "button", label: "Sign In" } },
        },
      })
      const result = parseSSE(res.body)
      const data = JSON.parse(result.result.content[0].text)
      expect(data.status).toBe("success")
      expect(data.action).toBe("press")
      expect(received[0].payload.testID).toBeUndefined()
      expect(received[0].payload.selector).toEqual({ role: "button", label: "Sign In" })
      expect(received[0].payload.includeSnapshot).toBe(false)
    } finally {
      app.close()
    }
  })

  test("agent_ui_fill sends text value to app handler", async () => {
    const app = await connectMockApp(relayPort)
    try {
      const received: any[] = []
      app.on("message", (msg) => {
        const parsed = JSON.parse(msg.toString())
        if (parsed.type === "agent.ui.action.request") {
          received.push(parsed)
          app.send(JSON.stringify({
            type: "agent.ui.response",
            payload: {
              requestId: parsed.payload.requestId,
              status: "success",
              action: parsed.payload.action,
              testID: parsed.payload.testID,
              result: { value: parsed.payload.value },
            },
          }))
        }
      })

      const res = await mcpRequest(mcpPort, {
        jsonrpc: "2.0",
        method: "tools/call",
        id: 24,
        params: {
          name: "agent_ui_fill",
          arguments: { testID: "login-email-input", text: "qa@example.com" },
        },
      })
      const result = parseSSE(res.body)
      const data = JSON.parse(result.result.content[0].text)
      expect(data.status).toBe("success")
      expect(data.action).toBe("fill")
      expect(data.result.value).toBe("qa@example.com")
      expect(received[0].payload.includeSnapshot).toBe(false)
    } finally {
      app.close()
    }
  })

  test("agent_ui_scroll sends scroll args to app handler", async () => {
    const app = await connectMockApp(relayPort)
    try {
      const received: any[] = []
      app.on("message", (msg) => {
        const parsed = JSON.parse(msg.toString())
        if (parsed.type === "agent.ui.action.request") {
          received.push(parsed)
          app.send(JSON.stringify({
            type: "agent.ui.response",
            payload: {
              requestId: parsed.payload.requestId,
              status: "success",
              action: parsed.payload.action,
              testID: parsed.payload.testID,
              result: parsed.payload.args,
            },
          }))
        }
      })

      const res = await mcpRequest(mcpPort, {
        jsonrpc: "2.0",
        method: "tools/call",
        id: 25,
        params: {
          name: "agent_ui_scroll",
          arguments: { testID: "results-list", offset: 320, animated: false },
        },
      })
      const result = parseSSE(res.body)
      const data = JSON.parse(result.result.content[0].text)
      expect(data.status).toBe("success")
      expect(data.action).toBe("scroll")
      expect(data.result.offset).toBe(320)
      expect(data.result.animated).toBe(false)
      expect(received[0].payload.action).toBe("scroll")
      expect(received[0].payload.args.offset).toBe(320)
      expect(received[0].payload.includeSnapshot).toBe(false)
    } finally {
      app.close()
    }
  })

  test("list_custom_commands returns commands registered before MCP started", async () => {
    // Stop MCP server, connect app and register commands, then restart MCP
    mcp.stop()

    const app = await connectMockApp(relayPort)
    try {
      app.send(
        JSON.stringify({
          type: "customCommand.register",
          payload: { id: 1, command: "navigateTo", title: "Navigate To Screen" },
        })
      )
      app.send(
        JSON.stringify({
          type: "customCommand.register",
          payload: { id: 2, command: "resetStore", title: "Reset Root Store" },
        })
      )
      await new Promise((r) => setTimeout(r, 100))

      // Now start MCP — commands were registered before it was listening
      const newMcpPort = await getPort({ random: true })
      mcp = createMcpServer(relay)
      await mcp.start(newMcpPort)
      await new Promise((r) => setTimeout(r, 200))

      const res = await mcpRequest(newMcpPort, {
        jsonrpc: "2.0",
        method: "tools/call",
        id: 30,
        params: { name: "list_custom_commands", arguments: {} },
      })
      const result = parseSSE(res.body)
      const data = JSON.parse(result.result.content[0].text)
      expect(data.status).toBe("success")
      expect(data.commands.length).toBe(2)
      expect(data.commands.map((c: any) => c.command)).toEqual(["navigateTo", "resetStore"])
    } finally {
      app.close()
    }
  })

  test("clear_timeline clears the buffer", async () => {
    const app = await connectMockApp(relayPort)
    try {
      app.send(JSON.stringify({ type: "log", payload: { message: "test" } }))
      await new Promise((r) => setTimeout(r, 100))

      const res = await mcpRequest(mcpPort, {
        jsonrpc: "2.0",
        method: "tools/call",
        id: 14,
        params: { name: "clear_timeline", arguments: {} },
      })
      const result = parseSSE(res.body)
      const data = JSON.parse(result.result.content[0].text)
      expect(data.status).toBe("cleared")
      expect(data.eventsRemoved).toBeGreaterThan(0)

      // Verify timeline is now empty
      const timelineRes = await mcpRequest(mcpPort, {
        jsonrpc: "2.0",
        method: "resources/read",
        id: 15,
        params: { uri: "reactotron://timeline" },
      })
      const timelineResult = parseSSE(timelineRes.body)
      const timelineData = JSON.parse(timelineResult.result.contents[0].text)
      expect(timelineData.events.length).toBe(0)
    } finally {
      app.close()
    }
  })

  test("request_state returns no_response when app has no state plugin", async () => {
    const app = await connectMockApp(relayPort)
    try {
      const res = await mcpRequest(mcpPort, {
        jsonrpc: "2.0",
        method: "tools/call",
        id: 16,
        params: { name: "request_state", arguments: {} },
      })
      const result = parseSSE(res.body)
      const data = JSON.parse(result.result.content[0].text)
      expect(data.status).toBe("no_response")
    } finally {
      app.close()
    }
  }, 10000)

  test("dispatch_action sends to connected app", async () => {
    const app = await connectMockApp(relayPort)
    try {
      const received: any[] = []
      app.on("message", (msg) => {
        const parsed = JSON.parse(msg.toString())
        if (parsed.type === "state.action.dispatch") received.push(parsed)
      })

      const res = await mcpRequest(mcpPort, {
        jsonrpc: "2.0",
        method: "tools/call",
        id: 17,
        params: {
          name: "dispatch_action",
          arguments: { actionType: "INCREMENT", actionPayload: { amount: 1 } },
        },
      })
      const result = parseSSE(res.body)
      const data = JSON.parse(result.result.content[0].text)
      expect(data.status).toBe("dispatched")

      await new Promise((r) => setTimeout(r, 100))
      expect(received.length).toBe(1)
    } finally {
      app.close()
    }
  }, 10000)

  test("subscribe_state adds a subscription", async () => {
    const res = await mcpRequest(mcpPort, {
      jsonrpc: "2.0",
      method: "tools/call",
      id: 18,
      params: { name: "subscribe_state", arguments: { path: "user.name" } },
    })
    const result = parseSSE(res.body)
    const data = JSON.parse(result.result.content[0].text)
    expect(data.status).toBe("subscribed")
    expect(data.path).toBe("user.name")
    expect(data.activeSubscriptions).toContain("user.name")
  })

  test("unsubscribe_state removes a subscription", async () => {
    // Subscribe first
    await mcpRequest(mcpPort, {
      jsonrpc: "2.0",
      method: "tools/call",
      id: 19,
      params: { name: "subscribe_state", arguments: { path: "user.name" } },
    })

    const res = await mcpRequest(mcpPort, {
      jsonrpc: "2.0",
      method: "tools/call",
      id: 20,
      params: { name: "unsubscribe_state", arguments: { path: "user.name" } },
    })
    const result = parseSSE(res.body)
    const data = JSON.parse(result.result.content[0].text)
    expect(data.status).toBe("unsubscribed")
    expect(data.activeSubscriptions).not.toContain("user.name")
  })

  test("request_state_keys returns no_response when app has no state plugin", async () => {
    const app = await connectMockApp(relayPort)
    try {
      const res = await mcpRequest(mcpPort, {
        jsonrpc: "2.0",
        method: "tools/call",
        id: 21,
        params: { name: "request_state_keys", arguments: { path: "" } },
      })
      const result = parseSSE(res.body)
      const data = JSON.parse(result.result.content[0].text)
      expect(data.status).toBe("no_response")
    } finally {
      app.close()
    }
  })
})

describe("timeline summarization", () => {
  test("timeline events have payloadPreview instead of full payload", async () => {
    const app = await connectMockApp(relayPort)
    try {
      app.send(JSON.stringify({
        type: "api.response",
        payload: {
          duration: 100,
          request: { method: "GET", url: "/api/users", data: null, headers: {}, params: {} },
          response: { status: 200, body: "x".repeat(10_000), headers: {} },
        },
      }))
      await new Promise((r) => setTimeout(r, 100))

      const res = await mcpRequest(mcpPort, {
        jsonrpc: "2.0",
        method: "resources/read",
        id: 30,
        params: { uri: "reactotron://timeline" },
      })
      const result = parseSSE(res.body)
      const data = JSON.parse(result.result.contents[0].text)
      const apiEvent = data.events.find((e: any) => e.type === "api.response")
      expect(apiEvent).toBeDefined()
      expect(apiEvent.payloadPreview).toBe("GET /api/users -> 200 (100ms)")
      // Full payload should NOT be present
      expect(apiEvent.payload).toBeUndefined()
    } finally {
      app.close()
    }
  })

  test("network resource returns summarized entries with truncated bodies", async () => {
    const app = await connectMockApp(relayPort)
    try {
      app.send(JSON.stringify({
        type: "api.response",
        payload: {
          duration: 50,
          request: { method: "POST", url: "/api/data", data: { key: "value" }, headers: {}, params: {} },
          response: { status: 201, body: "y".repeat(10_000), headers: {} },
        },
      }))
      await new Promise((r) => setTimeout(r, 100))

      const res = await mcpRequest(mcpPort, {
        jsonrpc: "2.0",
        method: "resources/read",
        id: 31,
        params: { uri: "reactotron://network/log" },
      })
      const result = parseSSE(res.body)
      const data = JSON.parse(result.result.contents[0].text)
      expect(data.entries.length).toBeGreaterThanOrEqual(1)
      const entry = data.entries.find((e: any) => e.request.url === "/api/data")
      expect(entry).toBeDefined()
      expect(entry.request.method).toBe("POST")
      expect(entry.response.status).toBe(201)
      expect(entry.duration).toBe(50)
      // Body should be truncated
      expect(entry.response.body.length).toBeLessThanOrEqual(503)
    } finally {
      app.close()
    }
  })

  test("timeline_by_type resource template returns filtered events with full payloads", async () => {
    const app = await connectMockApp(relayPort)
    try {
      app.send(JSON.stringify({ type: "log", payload: { message: "test log" } }))
      app.send(JSON.stringify({
        type: "api.response",
        payload: {
          duration: 50,
          request: { method: "GET", url: "/api/test", data: null, headers: {}, params: {} },
          response: { status: 200, body: "ok", headers: {} },
        },
      }))
      await new Promise((r) => setTimeout(r, 100))

      const res = await mcpRequest(mcpPort, {
        jsonrpc: "2.0",
        method: "resources/read",
        id: 32,
        params: { uri: "reactotron://timeline/log" },
      })
      const result = parseSSE(res.body)
      const data = JSON.parse(result.result.contents[0].text)
      expect(data.type).toBe("log")
      // Should only have log events (plus possibly other log events from connection)
      expect(data.events.every((e: any) => e.type === "log")).toBe(true)
      // Should have full payload, not just preview
      const logEvent = data.events.find((e: any) => e.payload?.message === "test log")
      expect(logEvent).toBeDefined()
    } finally {
      app.close()
    }
  })
})

describe("large response truncation", () => {
  test("request_state truncates oversized state with guidance message", async () => {
    const app = await connectMockApp(relayPort)
    try {
      // Mock app replies to state.values.request with a huge state tree
      app.on("message", (msg) => {
        const parsed = JSON.parse(msg.toString())
        if (parsed.type === "state.values.request") {
          // Build a state tree that exceeds MAX_RESPONSE_CHARS (800K)
          const bigState: Record<string, any> = {}
          for (let i = 0; i < 2000; i++) {
            bigState[`key_${i}`] = {
              id: i,
              data: "x".repeat(500),
              nested: { a: { b: { c: `value-${i}` } } },
            }
          }
          app.send(JSON.stringify({
            type: "state.values.response",
            payload: { path: "", value: bigState, valid: true },
          }))
        }
      })

      const res = await mcpRequest(mcpPort, {
        jsonrpc: "2.0",
        method: "tools/call",
        id: 40,
        params: { name: "request_state", arguments: {} },
      })
      const result = parseSSE(res.body)
      const text = result.result.content[0].text

      // Should be truncated to MAX_RESPONSE_CHARS (800K)
      expect(text.length).toBeLessThanOrEqual(800_000)
      // Should contain the truncation guidance message
      expect(text).toContain("[TRUNCATED")
      expect(text).toContain("request_state")
      expect(text).toContain("path")
    } finally {
      app.close()
    }
  }, 10000)

  test("state resource truncates oversized cached state with guidance message", async () => {
    const app = await connectMockApp(relayPort)
    try {
      // Inject a huge state.values.response directly into the buffer
      const bigState: Record<string, any> = {}
      for (let i = 0; i < 2000; i++) {
        bigState[`key_${i}`] = { data: "y".repeat(500) }
      }
      app.send(JSON.stringify({
        type: "state.values.response",
        payload: { path: "", value: bigState, valid: true },
      }))
      await new Promise((r) => setTimeout(r, 100))

      const res = await mcpRequest(mcpPort, {
        jsonrpc: "2.0",
        method: "resources/read",
        id: 41,
        params: { uri: "reactotron://state/current" },
      })
      const result = parseSSE(res.body)
      const text = result.result.contents[0].text

      expect(text.length).toBeLessThanOrEqual(800_000)
      expect(text).toContain("[TRUNCATED")
      expect(text).toContain("request_state")
    } finally {
      app.close()
    }
  })
})

describe("per-client redaction across multiple connected apps", () => {
  function connectAppWithConfig(
    port: number,
    name: string,
    mcpRedaction: any
  ): Promise<WebSocket> {
    return new Promise((resolve) => {
      const ws = new WebSocket(`ws://localhost:${port}`)
      ws.on("open", () => {
        ws.send(
          JSON.stringify({
            type: "client.intro",
            payload: {
              name,
              platform: "ios",
              platformVersion: "17.0",
              clientId: `${name}-ios-test`,
              mcpRedaction,
            },
          })
        )
        setTimeout(() => resolve(ws), 100)
      })
    })
  }

  test("each app's events are redacted with its own additionalRules", async () => {
    // App A redacts "fooSecret"; App B redacts "barSecret". Each emits a log
    // containing both keys. Verify cross-app rules don't leak: app A's log
    // should still show "barSecret" (only fooSecret redacted), and vice versa.
    const appA = await connectAppWithConfig(relayPort, "AppA", {
      additionalRules: { sensitiveKeys: ["fooSecret"] },
    })
    const appB = await connectAppWithConfig(relayPort, "AppB", {
      additionalRules: { sensitiveKeys: ["barSecret"] },
    })

    try {
      const sensitivePayload = { fooSecret: "leak-foo", barSecret: "leak-bar", note: "hi" }
      appA.send(JSON.stringify({ type: "log", payload: sensitivePayload }))
      appB.send(JSON.stringify({ type: "log", payload: sensitivePayload }))
      await new Promise((r) => setTimeout(r, 150))

      const res = await mcpRequest(mcpPort, {
        jsonrpc: "2.0",
        method: "resources/read",
        id: 100,
        params: { uri: "reactotron://timeline/log" },
      })
      const result = parseSSE(res.body)
      const data = JSON.parse(result.result.contents[0].text)

      const appAEvent = data.events.find((e: any) => e.clientId === "AppA-ios-test")
      const appBEvent = data.events.find((e: any) => e.clientId === "AppB-ios-test")
      expect(appAEvent).toBeDefined()
      expect(appBEvent).toBeDefined()

      // App A: fooSecret redacted (its own rule), barSecret leaks through (not its rule)
      expect(appAEvent.payload.fooSecret).toBe("[REDACTED]")
      expect(appAEvent.payload.barSecret).toBe("leak-bar")

      // App B: opposite
      expect(appBEvent.payload.fooSecret).toBe("leak-foo")
      expect(appBEvent.payload.barSecret).toBe("[REDACTED]")
    } finally {
      appA.close()
      appB.close()
    }
  })

  test("server defaults still apply per-event in multi-app mode", async () => {
    // Without any per-client overrides, both apps' password fields must redact.
    const appA = await connectMockApp(relayPort, "DefaultAppA")
    const appB = await connectMockApp(relayPort, "DefaultAppB")

    try {
      appA.send(JSON.stringify({ type: "log", payload: { password: "pw-a", name: "alice" } }))
      appB.send(JSON.stringify({ type: "log", payload: { password: "pw-b", name: "bob" } }))
      await new Promise((r) => setTimeout(r, 150))

      const res = await mcpRequest(mcpPort, {
        jsonrpc: "2.0",
        method: "resources/read",
        id: 101,
        params: { uri: "reactotron://timeline/log" },
      })
      const result = parseSSE(res.body)
      const data = JSON.parse(result.result.contents[0].text)

      const events = data.events.filter((e: any) => e.type === "log")
      for (const ev of events) {
        expect(ev.payload.password).toBe("[REDACTED]")
      }
    } finally {
      appA.close()
      appB.close()
    }
  })
})
