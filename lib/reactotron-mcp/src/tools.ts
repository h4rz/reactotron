import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type ReactotronServer from "@hurajgor/reactotron-core-server"
import type {
  AgentUiActionRequestPayload,
  AgentUiNode,
  AgentUiResponsePayload,
  AgentUiSelector,
  Command,
} from "@hurajgor/reactotron-core-contract"
import { z } from "zod/v4"
import { promises as fsPromises } from "fs"
import { extname } from "path"

import { MAX_RESPONSE_CHARS, safeSerialize } from "./serialization"
import { createRedactor, type McpRedactionServerConfig } from "./redaction"
import type { ReactotronDesktopHost } from "./desktop-host"
import { registerDesktopTools } from "./desktop-tools"

/** Extract width/height from PNG or JPEG buffer */
function getImageSize(buf: Buffer, ext: string): { width: number; height: number } | null {
  try {
    if (ext === "png" && buf.length > 24) {
      // PNG: width at offset 16, height at offset 20 (big-endian uint32)
      const width = buf.readUInt32BE(16)
      const height = buf.readUInt32BE(20)
      return { width, height }
    }
    if ((ext === "jpg" || ext === "jpeg") && buf.length > 2) {
      // Validate JPEG magic bytes
      if (buf[0] !== 0xFF || buf[1] !== 0xD8) return null
      // JPEG: scan for SOF0 (0xFFC0) or SOF2 (0xFFC2) marker
      let offset = 2
      while (offset < buf.length - 8) {
        if (buf[offset] !== 0xFF) break
        const marker = buf[offset + 1]
        if (marker === 0xC0 || marker === 0xC2) {
          const height = buf.readUInt16BE(offset + 5)
          const width = buf.readUInt16BE(offset + 7)
          return { width, height }
        }
        const segLen = buf.readUInt16BE(offset + 2)
        offset += 2 + segLen
      }
    }
    if (ext === "gif" && buf.length > 10) {
      // GIF: width at offset 6, height at offset 8 (little-endian uint16)
      const width = buf.readUInt16LE(6)
      const height = buf.readUInt16LE(8)
      return { width, height }
    }
  } catch {}
  return null
}

function resolveClientId(
  server: ReactotronServer,
  requestedClientId?: string
): { clientId?: string; error?: string } {
  const connections = server.connections as any[]

  if (connections.length === 0) {
    return { error: "No apps connected to Reactotron." }
  }

  if (connections.length > 1 && !requestedClientId) {
    const apps = connections.map((c) => `${c.name} (${c.platform}): ${c.clientId}`).join(", ")
    return { error: `Multiple apps connected. Specify clientId. Available: ${apps}` }
  }

  return { clientId: requestedClientId || connections[0]?.clientId }
}

function textResult(data: unknown, guidance?: string) {
  return { content: [{ type: "text" as const, text: safeSerialize(data, MAX_RESPONSE_CHARS, guidance) }] }
}

function createRequestId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const agentUiSelectorSchema = z.object({
  id: z.string().optional().describe("Runtime node id from agent_ui_snapshot or agent_ui_find."),
  testID: z.string().optional().describe("React Native testID."),
  type: z.string().optional().describe("React component/native type, e.g. Pressable or TextInput."),
  text: z.string().optional().describe("Visible text content, matched case-insensitively by substring."),
  label: z.string().optional().describe("Accessibility label, matched case-insensitively by substring."),
  role: z.string().optional().describe("Accessibility role, e.g. button, text, search, image."),
  hint: z.string().optional().describe("Accessibility hint, matched case-insensitively by substring."),
  placeholder: z.string().optional().describe("Input placeholder, matched case-insensitively by substring."),
  enabled: z.boolean().optional().describe("Whether the node is enabled."),
  visible: z.boolean().optional().describe("Whether the node is visible."),
  index: z.number().optional().describe("0-based index to disambiguate multiple selector matches."),
})

function flattenAgentNodes(nodes: AgentUiNode[] = []): AgentUiNode[] {
  return nodes.flatMap((node) => [node, ...flattenAgentNodes(node.children ?? [])])
}

function normalizeSelectorValue(value: unknown) {
  return String(value ?? "").trim().toLowerCase()
}

function selectorTextMatches(actual: unknown, expected: unknown) {
  return normalizeSelectorValue(actual).includes(normalizeSelectorValue(expected))
}

function nodeMatchesSelector(node: AgentUiNode, selector: AgentUiSelector) {
  if (selector.id && node.id !== selector.id) return false
  if (selector.testID && node.testID !== selector.testID) return false
  if (selector.type && node.type !== selector.type) return false
  if (selector.role && node.role !== selector.role) return false
  if (selector.enabled != null && node.enabled !== selector.enabled) return false
  if (selector.visible != null && node.visible !== selector.visible) return false
  if (selector.text && !selectorTextMatches(node.text, selector.text)) return false
  if (selector.label && !selectorTextMatches(node.label, selector.label)) return false
  if (selector.hint && !selectorTextMatches(node.hint, selector.hint)) return false
  if (selector.placeholder && !selectorTextMatches(node.placeholder, selector.placeholder)) return false
  return true
}

function compactArgs(args: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined))
}

async function waitForAgentUiResponse(
  commandBuffer: Command[],
  requestId: string,
  clientId: string,
  timeoutMs = 2000
): Promise<AgentUiResponsePayload | null> {
  const start = Date.now()
  const startLen = commandBuffer.length

  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 50))
    for (let i = startLen; i < commandBuffer.length; i++) {
      const cmd = commandBuffer[i]
      if (
        cmd.type === "agent.ui.response" &&
        cmd.clientId === clientId &&
        (cmd.payload as AgentUiResponsePayload)?.requestId === requestId
      ) {
        return cmd.payload as AgentUiResponsePayload
      }
    }
  }

  return null
}

export function registerTools(
  mcp: McpServer,
  server: ReactotronServer,
  commandBuffer: Command[],
  serverRedactionConfig: McpRedactionServerConfig,
  desktopHost?: ReactotronDesktopHost
) {
  if (desktopHost) registerDesktopTools(mcp, desktopHost)

  mcp.registerTool("dispatch_action", {
    description: [
      "Dispatch a Redux action to the connected app.",
      "Requires the Reactotron Redux plugin to be configured in the app.",
      "Example: { type: 'user/setName', payload: { name: 'Alice' } }",
    ].join(" "),
    inputSchema: {
      actionType: z.string().describe("Action type, e.g. 'counter/increment' or 'RESET'"),
      actionPayload: z.any().optional().describe("Optional action payload, e.g. { name: 'Alice' }"),
      clientId: z.string().optional().describe("Target app clientId (required when multiple apps connected). Get from the apps resource."),
    },
  }, async (args) => {
    const { clientId, error } = resolveClientId(server, args.clientId)
    if (error) return textResult({ status: "error", message: error })

    const action = { type: args.actionType, payload: args.actionPayload }
    server.send("state.action.dispatch", { action }, clientId)

    const redactor = createRedactor(server, serverRedactionConfig)

    // Poll for confirmation (state.action.complete)
    const start = Date.now()
    const startLen = commandBuffer.length
    while (Date.now() - start < 1500) {
      await new Promise((r) => setTimeout(r, 100))
      for (let i = startLen; i < commandBuffer.length; i++) {
        const cmd = commandBuffer[i]
        if (cmd.type === "state.action.complete" && cmd.clientId === clientId) {
          return textResult({ status: "dispatched", action: redactor.redact(action, clientId), confirmed: true })
        }
      }
    }
    return textResult({ status: "dispatched", action: redactor.redact(action, clientId), confirmed: false, note: "Action was sent but no confirmation received. The app may not have the Redux plugin configured." })
  })

  mcp.registerTool("request_state", {
    description: [
      "Request a fresh state snapshot from the connected app.",
      "Requires Redux, MST or MobX plugin configured in the app.",
      "IMPORTANT: Always specify a path to avoid oversized responses.",
      "The full state tree can be millions of characters.",
      "Use request_state_keys first to explore the state shape, then request specific slices.",
      "Example path: 'user.profile' to get just that slice.",
    ].join(" "),
    inputSchema: {
      path: z.string().optional().describe("Dot-separated state path, e.g. 'user.profile'. STRONGLY RECOMMENDED — omitting this returns the full state tree which may be too large."),
      clientId: z.string().optional().describe("Target app clientId (required when multiple apps connected)."),
    },
  }, async (args) => {
    const { clientId, error } = resolveClientId(server, args.clientId)
    if (error) return textResult({ status: "error", message: error })

    const path = args.path ?? ""
    server.send("state.values.request", { path }, clientId)

    const start = Date.now()
    const startLen = commandBuffer.length
    while (Date.now() - start < 1500) {
      await new Promise((r) => setTimeout(r, 100))
      for (let i = startLen; i < commandBuffer.length; i++) {
        const cmd = commandBuffer[i]
        if (cmd.type === "state.values.response" && cmd.clientId === clientId) {
          const stateValue = cmd.payload?.value ?? cmd.payload
          const redactor = createRedactor(server, serverRedactionConfig)
          const redactedState = redactor.redactState(stateValue, clientId, path)
          return textResult(
            { status: "success", state: redactedState },
            "State response is too large. Use request_state with a more specific path (e.g. 'user.profile') to narrow the response. Use request_state_keys to explore the state shape."
          )
        }
      }
    }
    return textResult({ status: "no_response", message: "The app did not respond to the state request. It likely doesn't have a state management plugin (Redux, MST or MobX) configured in Reactotron." })
  })

  mcp.registerTool("request_state_keys", {
    description: [
      "List the keys at a state path without fetching values.",
      "Use this to explore the state tree structure before requesting specific slices with request_state.",
      "Returns an array of key names at the given path.",
      "Example: path='' returns root keys, path='user' returns keys under user.",
    ].join(" "),
    inputSchema: {
      path: z.string().optional().describe("Dot-separated state path. Omit or pass empty string for root keys."),
      clientId: z.string().optional().describe("Target app clientId (required when multiple apps connected)."),
    },
  }, async (args) => {
    const { clientId, error } = resolveClientId(server, args.clientId)
    if (error) return textResult({ status: "error", message: error })

    const path = args.path ?? ""
    server.send("state.keys.request", { path }, clientId)

    const start = Date.now()
    const startLen = commandBuffer.length
    while (Date.now() - start < 1500) {
      await new Promise((r) => setTimeout(r, 100))
      for (let i = startLen; i < commandBuffer.length; i++) {
        const cmd = commandBuffer[i]
        if (cmd.type === "state.keys.response" && cmd.clientId === clientId) {
          return textResult({
            status: "success",
            path: (cmd.payload as any)?.path ?? path,
            keys: (cmd.payload as any)?.keys ?? [],
            valid: (cmd.payload as any)?.valid ?? true,
          })
        }
      }
    }
    return textResult({ status: "no_response", message: "The app did not respond to the keys request. It likely doesn't have a state management plugin (Redux, MST or MobX) configured in Reactotron." })
  })

  mcp.registerTool("swap_state", {
    description: [
      "Replace the entire app state tree. WARNING: this is destructive and cannot be undone.",
      "Requires the Reactotron state plugin (Redux, MST or MobX).",
      "Use request_state first to get the current state, modify it, then swap.",
    ].join(" "),
    inputSchema: {
      state: z.record(z.string(), z.any()).describe("The complete replacement state tree as a JSON object."),
      clientId: z.string().optional().describe("Target app clientId (required when multiple apps connected)."),
    },
  }, async (args) => {
    const { clientId, error } = resolveClientId(server, args.clientId)
    if (error) return textResult({ status: "error", message: error })

    server.send("state.restore.request", { state: args.state }, clientId)
    return textResult({ status: "swapped", message: "State replacement sent to app." })
  })

  mcp.registerTool("send_custom_command", {
    description: [
      "Send a named custom command to the app.",
      "The app must have registered a handler for this command name.",
      "Use list_custom_commands first to see what commands are available.",
      "Example: command='showDebugOverlay', args={ enabled: true }",
    ].join(" "),
    inputSchema: {
      command: z.string().describe("The custom command name, e.g. 'ping' or 'showDebugOverlay'"),
      args: z.any().optional().describe("Optional arguments to pass to the command handler"),
      clientId: z.string().optional().describe("Target app clientId (required when multiple apps connected)."),
    },
  }, async (args) => {
    const { clientId, error } = resolveClientId(server, args.clientId)
    if (error) return textResult({ status: "error", message: error })

    server.send("custom", { command: args.command, args: args.args }, clientId)
    return textResult({ status: "sent", command: args.command })
  })

  mcp.registerTool("list_custom_commands", {
    description: [
      "List all custom commands registered by the connected app.",
      "These are commands the app has set up handlers for.",
      "Use this before send_custom_command to see what's available.",
    ].join(" "),
    inputSchema: {
      clientId: z.string().optional().describe("Target app clientId (required when multiple apps connected)."),
    },
  }, async (args) => {
    const { clientId, error } = resolveClientId(server, args.clientId)
    if (error) return textResult({ status: "error", message: error })

    const commands = (server.customCommands?.get(clientId) ?? []).map((c) => ({
      id: c.id,
      command: c.command,
      title: c.title,
      description: c.description,
    }))

    if (commands.length === 0) {
      return textResult({ status: "none", message: "No custom commands registered by the app." })
    }

    return textResult({ status: "success", commands })
  })

  mcp.registerTool("agent_ui_snapshot", {
    description: [
      "Request a semantic UI snapshot from the connected app's Reactotron agent runtime.",
      "Requires the app to use the @hurajgor/reactotron-react-native agentRuntime plugin.",
      "This is testID/runtime-tree based and does not use screenshots.",
    ].join(" "),
    inputSchema: {
      clientId: z.string().optional().describe("Target app clientId (required when multiple apps connected)."),
      timeoutMs: z.number().optional().describe("How long to wait for the app to respond, in milliseconds. Default 2000."),
    },
  }, async (args) => {
    const { clientId, error } = resolveClientId(server, args.clientId)
    if (error) return textResult({ status: "error", message: error })

    const requestId = createRequestId("agent-ui-snapshot")
    server.send("agent.ui.snapshot.request", { requestId }, clientId)

    const response = await waitForAgentUiResponse(commandBuffer, requestId, clientId, args.timeoutMs)
    if (!response) {
      return textResult({
        status: "no_response",
        message: "The app did not answer agent.ui.snapshot.request. Add Reactotron.use(agentRuntime(...)) in the app.",
      })
    }

    return textResult(response)
  })

  mcp.registerTool("agent_ui_action", {
    description: [
      "Run a semantic UI action by testID or accessibility selector through the connected app's Reactotron agent runtime.",
      "Use testID when available. Otherwise use selector fields such as role, label, text, placeholder, or id.",
      "Use agent_ui_snapshot or agent_ui_find first to discover available nodes.",
    ].join(" "),
    inputSchema: {
      testID: z.string().optional().describe("Target React Native testID, e.g. 'login-submit-button'."),
      selector: agentUiSelectorSchema.optional().describe("Accessibility/runtime selector when testID is unavailable."),
      action: z.string().describe("Action name registered by the app, e.g. 'press', 'fill', or 'scroll'."),
      value: z.any().optional().describe("Optional action value. For fill, this is usually the text."),
      args: z.record(z.string(), z.any()).optional().describe("Optional structured arguments for the handler."),
      includeSnapshot: z.boolean().optional().describe("Whether the app should include a fresh snapshot in the action response. Default true for this generic tool."),
      clientId: z.string().optional().describe("Target app clientId (required when multiple apps connected)."),
      timeoutMs: z.number().optional().describe("How long to wait for the app to respond, in milliseconds. Default 2000."),
    },
  }, async (args) => {
    const { clientId, error } = resolveClientId(server, args.clientId)
    if (error) return textResult({ status: "error", message: error })

    const requestId = createRequestId("agent-ui-action")
    const payload: AgentUiActionRequestPayload = {
      requestId,
      testID: args.testID,
      selector: args.selector,
      action: args.action,
      value: args.value,
      args: args.args,
      includeSnapshot: args.includeSnapshot,
    }

    server.send("agent.ui.action.request", payload, clientId)

    const response = await waitForAgentUiResponse(commandBuffer, requestId, clientId, args.timeoutMs)
    if (!response) {
      return textResult({
        status: "no_response",
        action: args.action,
        testID: args.testID,
        selector: args.selector,
        message: "The app did not answer agent.ui.action.request. Add Reactotron.use(agentRuntime(...)) in the app.",
      })
    }

    return textResult(response)
  })

  mcp.registerTool("agent_ui_find", {
    description: [
      "Find semantic UI nodes in the connected app by testID or accessibility selector.",
      "This is useful when an app has no testIDs but does have accessibility labels, roles, text, hints, or placeholders.",
      "If multiple nodes match, use the returned id or selector.index to disambiguate before acting.",
    ].join(" "),
    inputSchema: {
      selector: agentUiSelectorSchema.describe("Selector to match against runtime nodes."),
      clientId: z.string().optional().describe("Target app clientId (required when multiple apps connected)."),
      timeoutMs: z.number().optional().describe("How long to wait for the app to respond, in milliseconds. Default 2000."),
    },
  }, async (args) => {
    const { clientId, error } = resolveClientId(server, args.clientId)
    if (error) return textResult({ status: "error", message: error })

    const requestId = createRequestId("agent-ui-find")
    server.send("agent.ui.snapshot.request", { requestId }, clientId)

    const response = await waitForAgentUiResponse(commandBuffer, requestId, clientId, args.timeoutMs)
    if (!response) {
      return textResult({
        status: "no_response",
        message: "The app did not answer agent.ui.snapshot.request. Add Reactotron.use(agentRuntime(...)) in the app.",
      })
    }

    if (response.status === "error" || !response.snapshot) return textResult(response)

    const matches = flattenAgentNodes(response.snapshot.nodes).filter((node) =>
      nodeMatchesSelector(node, args.selector)
    )

    return textResult({
      status: "success",
      count: matches.length,
      selector: args.selector,
      matches,
      guidance:
        matches.length > 1
          ? "Multiple nodes matched. Use a returned id, add more selector fields, or pass selector.index to press/fill/scroll."
          : undefined,
    })
  })

  mcp.registerTool("agent_ui_press", {
    description: "Press a node by testID or accessibility selector through Reactotron agent runtime. Shortcut for agent_ui_action with action='press'.",
    inputSchema: {
      testID: z.string().optional().describe("Target React Native testID."),
      selector: agentUiSelectorSchema.optional().describe("Accessibility/runtime selector when testID is unavailable."),
      args: z.record(z.string(), z.any()).optional().describe("Optional structured arguments for the handler."),
      includeSnapshot: z.boolean().optional().describe("Whether to include a fresh snapshot in the response. Default false for speed."),
      clientId: z.string().optional().describe("Target app clientId (required when multiple apps connected)."),
      timeoutMs: z.number().optional().describe("How long to wait for the app to respond, in milliseconds. Default 2000."),
    },
  }, async (args) => {
    const { clientId, error } = resolveClientId(server, args.clientId)
    if (error) return textResult({ status: "error", message: error })

    const requestId = createRequestId("agent-ui-press")
    server.send("agent.ui.action.request", {
      requestId,
      testID: args.testID,
      selector: args.selector,
      action: "press",
      args: args.args,
      includeSnapshot: args.includeSnapshot ?? false,
    }, clientId)

    const response = await waitForAgentUiResponse(commandBuffer, requestId, clientId, args.timeoutMs)
    if (!response) {
      return textResult({
        status: "no_response",
        action: "press",
        testID: args.testID,
        selector: args.selector,
        message: "The app did not answer press. Ensure the app has Reactotron.use(agentRuntime(...)) enabled.",
      })
    }

    return textResult(response)
  })

  mcp.registerTool("agent_ui_fill", {
    description: "Fill a text input by testID or accessibility selector through Reactotron agent runtime. Shortcut for agent_ui_action with action='fill'.",
    inputSchema: {
      testID: z.string().optional().describe("Target React Native TextInput testID."),
      selector: agentUiSelectorSchema.optional().describe("Accessibility/runtime selector when testID is unavailable."),
      text: z.string().describe("Text to enter."),
      args: z.record(z.string(), z.any()).optional().describe("Optional structured arguments for the handler."),
      includeSnapshot: z.boolean().optional().describe("Whether to include a fresh snapshot in the response. Default false for speed."),
      clientId: z.string().optional().describe("Target app clientId (required when multiple apps connected)."),
      timeoutMs: z.number().optional().describe("How long to wait for the app to respond, in milliseconds. Default 2000."),
    },
  }, async (args) => {
    const { clientId, error } = resolveClientId(server, args.clientId)
    if (error) return textResult({ status: "error", message: error })

    const requestId = createRequestId("agent-ui-fill")
    server.send("agent.ui.action.request", {
      requestId,
      testID: args.testID,
      selector: args.selector,
      action: "fill",
      value: args.text,
      args: args.args,
      includeSnapshot: args.includeSnapshot ?? false,
    }, clientId)

    const response = await waitForAgentUiResponse(commandBuffer, requestId, clientId, args.timeoutMs)
    if (!response) {
      return textResult({
        status: "no_response",
        action: "fill",
        testID: args.testID,
        selector: args.selector,
        message: "The app did not answer fill. Ensure the app has Reactotron.use(agentRuntime(...)) enabled.",
      })
    }

    return textResult(response)
  })

  mcp.registerTool("agent_ui_scroll", {
    description: "Scroll a ScrollView, FlatList, or SectionList by testID or accessibility selector through Reactotron agent runtime. Shortcut for agent_ui_action with action='scroll'.",
    inputSchema: {
      testID: z.string().optional().describe("Target React Native ScrollView, FlatList, or SectionList testID."),
      selector: agentUiSelectorSchema.optional().describe("Accessibility/runtime selector when testID is unavailable."),
      y: z.number().optional().describe("Y position for ScrollView, or fallback offset for virtualized lists."),
      offset: z.number().optional().describe("FlatList offset. Overrides y for FlatList-style refs."),
      x: z.number().optional().describe("X position for ScrollView. Default 0."),
      sectionIndex: z.number().optional().describe("SectionList section index. Default 0."),
      itemIndex: z.number().optional().describe("SectionList item index. Default 0."),
      viewOffset: z.number().optional().describe("SectionList view offset."),
      viewPosition: z.number().optional().describe("SectionList view position."),
      animated: z.boolean().optional().describe("Whether to animate scrolling. Default true."),
      includeSnapshot: z.boolean().optional().describe("Whether to include a fresh snapshot in the response. Default false for speed."),
      clientId: z.string().optional().describe("Target app clientId (required when multiple apps connected)."),
      timeoutMs: z.number().optional().describe("How long to wait for the app to respond, in milliseconds. Default 2000."),
    },
  }, async (args) => {
    const { clientId, error } = resolveClientId(server, args.clientId)
    if (error) return textResult({ status: "error", message: error })

    const requestId = createRequestId("agent-ui-scroll")
    server.send("agent.ui.action.request", {
      requestId,
      testID: args.testID,
      selector: args.selector,
      action: "scroll",
      args: compactArgs({
        y: args.y,
        offset: args.offset,
        x: args.x,
        sectionIndex: args.sectionIndex,
        itemIndex: args.itemIndex,
        viewOffset: args.viewOffset,
        viewPosition: args.viewPosition,
        animated: args.animated,
      }),
      includeSnapshot: args.includeSnapshot ?? false,
    }, clientId)

    const response = await waitForAgentUiResponse(commandBuffer, requestId, clientId, args.timeoutMs)
    if (!response) {
      return textResult({
        status: "no_response",
        action: "scroll",
        testID: args.testID,
        selector: args.selector,
        message: "The app did not answer scroll. Ensure the testID is mounted on a scrollable component with a captured ref.",
      })
    }

    return textResult(response)
  })

  mcp.registerTool("show_overlay", {
    description: [
      "Show an image overlay on top of the running app.",
      "Useful for comparing a design mockup against the actual UI.",
      "The app must have the overlay plugin enabled (it is by default in React Native).",
      "Pass uri=null or opacity=0 to hide the overlay.",
    ].join(" "),
    inputSchema: {
      uri: z.string().nullable().describe("Image to display. Accepts a local file path (/path/to/image.png), file:// URI, http/https URL, or data: URI. Local files are automatically converted to base64. Pass null to clear the overlay."),
      opacity: z.number().optional().describe("Overlay opacity from 0 to 1 (default: 0.5)"),
      growToWindow: z.boolean().optional().describe("Scale image to fill the entire window (default: false)"),
      resizeMode: z.enum(["cover", "contain", "stretch", "center"]).optional().describe("How to resize the image when growToWindow is true (default: cover)"),
      width: z.number().optional().describe("Image width in pixels (ignored if growToWindow is true)"),
      height: z.number().optional().describe("Image height in pixels (ignored if growToWindow is true)"),
      marginTop: z.number().optional().describe("Top margin offset in pixels"),
      marginBottom: z.number().optional().describe("Bottom margin offset in pixels"),
      marginLeft: z.number().optional().describe("Left margin offset in pixels"),
      marginRight: z.number().optional().describe("Right margin offset in pixels"),
      justifyContent: z.enum(["flex-start", "flex-end", "center", "space-between", "space-around", "space-evenly"]).optional().describe("Vertical alignment of the overlay image (default: center)"),
      alignItems: z.enum(["flex-start", "flex-end", "center", "stretch", "baseline"]).optional().describe("Horizontal alignment of the overlay image (default: center)"),
      showDebug: z.boolean().optional().describe("Show debug info overlay with current overlay settings (useful for positioning)"),
      clientId: z.string().optional().describe("Target app clientId (required when multiple apps connected)."),
    },
  }, async (args) => {
    const { clientId, error } = resolveClientId(server, args.clientId)
    if (error) return textResult({ status: "error", message: error })

    const { clientId: _, ...overlayArgs } = args as any
    const payload: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(overlayArgs)) {
      if (value !== undefined) payload[key] = value
    }

    // Convert local file paths to data: URIs
    if (typeof payload.uri === "string" && !payload.uri.startsWith("data:") && !payload.uri.startsWith("http")) {
      const filePath = (payload.uri as string).replace(/^file:\/\//, "")
      const ext = extname(filePath).slice(1).toLowerCase()
      const supportedFormats: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif" }
      const mime = supportedFormats[ext]
      if (!mime) {
        return textResult({ status: "error", message: `Unsupported image format: .${ext}. Use PNG, JPEG, or GIF.` })
      }
      try {
        const buf = await fsPromises.readFile(filePath)
        const maxSize = 2 * 1024 * 1024 // 2MB file size limit
        if (buf.length > maxSize) {
          return textResult({ status: "error", message: `Image too large (${(buf.length / 1024 / 1024).toFixed(1)}MB). Maximum is 2MB. Resize or compress the image first.` })
        }
        payload.uri = `data:${mime};base64,${buf.toString("base64")}`
        // Extract dimensions if not already specified
        if (!payload.width || !payload.height) {
          const size = getImageSize(buf, ext)
          if (size) {
            payload.width = payload.width ?? size.width
            payload.height = payload.height ?? size.height
          }
        }
      } catch (e) {
        return textResult({ status: "error", message: `Could not read file: ${filePath}` })
      }
    }

    // Apply defaults matching the desktop app's behavior
    payload.opacity = payload.opacity ?? 0.5
    payload.marginTop = payload.marginTop ?? 0
    payload.marginRight = payload.marginRight ?? 0
    payload.marginBottom = payload.marginBottom ?? 0
    payload.marginLeft = payload.marginLeft ?? 0
    payload.growToWindow = payload.growToWindow ?? false
    payload.justifyContent = payload.justifyContent ?? "center"
    payload.alignItems = payload.alignItems ?? "center"

    const uriLen = typeof payload.uri === "string" ? payload.uri.length : 0
    try {
      server.send("overlay", payload, clientId)
    } catch (e) {
      return textResult({ status: "error", message: `Failed to send overlay: ${e}` })
    }
    return textResult({ status: "sent", overlay: { ...payload, uri: uriLen > 0 ? `(${uriLen} chars)` : null } })
  })

  mcp.registerTool("clear_timeline", {
    description: "Clear the MCP event buffer. This only affects what you see via MCP resources — the Reactotron desktop app's timeline is not affected. Useful to discard old events and focus on what happens next.",
    inputSchema: {},
  }, async () => {
    const count = commandBuffer.length
    commandBuffer.length = 0
    return textResult({ status: "cleared", eventsRemoved: count })
  })

  mcp.registerTool("subscribe_state", {
    description: [
      "Subscribe to a state path. The app will send state.values.change events whenever the value at this path changes.",
      "Read the state/subscriptions resource to see changes.",
      "Requires Redux, MST or MobX plugin. Example path: 'user.profile.name'",
    ].join(" "),
    inputSchema: {
      path: z.string().describe("Dot-separated state path to subscribe to, e.g. 'user.profile' or 'cart.items'"),
    },
  }, async (args) => {
    const path = args.path
    if (!path) return textResult({ status: "error", message: "path is required" })

    ;(server as any).stateValuesSubscribe(path)
    const active = (server as any).subscriptions || []
    return textResult({ status: "subscribed", path, activeSubscriptions: active })
  })

  mcp.registerTool("unsubscribe_state", {
    description: "Unsubscribe from a state path. Stops receiving change events for this path.",
    inputSchema: {
      path: z.string().describe("State path to unsubscribe from"),
    },
  }, async (args) => {
    const path = args.path
    if (!path) return textResult({ status: "error", message: "path is required" })

    ;(server as any).stateValuesUnsubscribe(path)
    const active = (server as any).subscriptions || []
    return textResult({ status: "unsubscribed", path, activeSubscriptions: active })
  })
}
