import type {
  AgentUiActionRequestPayload,
  AgentUiNode,
  AgentUiSelector,
  AgentUiResponsePayload,
  AgentUiSnapshot,
  AgentUiSnapshotRequestPayload,
  Command,
} from "@hurajgor/reactotron-core-contract"
import type { Plugin, ReactotronCore } from "@hurajgor/reactotron-core-client"

export type AgentRuntimeActionHandler = (request: AgentUiActionRequestPayload) => unknown | Promise<unknown>
export type AgentRuntimeSnapshotProvider = () => AgentUiSnapshot | Promise<AgentUiSnapshot>

export interface AgentRuntimeOptions {
  /**
   * Automatically inspect mounted React fibers for testID/accessibility metadata
   * and infer actions from props such as onPress and onChangeText.
   */
  autoCapture?: boolean
  snapshot?: AgentRuntimeSnapshotProvider
  actions?: Record<string, AgentRuntimeActionHandler | Record<string, AgentRuntimeActionHandler>>
  nodes?: AgentUiNode[]
}

export interface AgentRuntimePlugin {
  setAgentRuntimeSnapshotProvider: (provider: AgentRuntimeSnapshotProvider) => void
  registerAgentRuntimeNode: (node: AgentUiNode) => void
  updateAgentRuntimeNode: (testID: string, patch: Partial<AgentUiNode>) => void
  unregisterAgentRuntimeNode: (testID: string) => void
  clearAgentRuntimeNodes: () => void
  registerAgentRuntimeAction: (
    testID: string,
    action: string,
    handler: AgentRuntimeActionHandler
  ) => void
  unregisterAgentRuntimeAction: (testID: string, action: string) => void
}

const actionKey = (testID: string, action: string) => `${testID}:${action}`
const AUTO_CAPTURE_KEY = "__REACTOTRON_AGENT_RUNTIME_CAPTURE__"

type CapturedElement = {
  node: AgentUiNode
  props: Record<string, any>
  ref?: any
  seenAt: number
}

type AgentRuntimeGlobalState = {
  installed: boolean
  elements: Map<string, CapturedElement[]>
  ids: WeakMap<Record<string, any>, string>
  nextId: number
}

function getGlobalState(): AgentRuntimeGlobalState {
  const target = globalThis as any
  if (!target[AUTO_CAPTURE_KEY]) {
    target[AUTO_CAPTURE_KEY] = {
      installed: false,
      elements: new Map<string, CapturedElement[]>(),
      ids: new WeakMap<Record<string, any>, string>(),
      nextId: 1,
    } satisfies AgentRuntimeGlobalState
  }

  const state = target[AUTO_CAPTURE_KEY] as AgentRuntimeGlobalState
  if (!state.ids) {
    state.ids = new WeakMap<Record<string, any>, string>()
  }
  if (!state.nextId) {
    state.nextId = 1
  }
  ;(state.elements as Map<string, CapturedElement[] | CapturedElement>).forEach((value, testID) => {
    if (!Array.isArray(value)) {
      state.elements.set(testID, [value])
    }
  })

  return target[AUTO_CAPTURE_KEY]
}

function typeName(type: unknown) {
  if (typeof type === "string") return type
  if (typeof type === "function") return (type as any).displayName ?? (type as any).name ?? "Component"
  if (type && typeof type === "object") return (type as any).displayName ?? (type as any).name ?? "Component"
  return "Component"
}

function textFromChildren(children: unknown): string | undefined {
  if (typeof children === "string" || typeof children === "number") return String(children)
  if (Array.isArray(children)) {
    const text = children
      .map(textFromChildren)
      .filter(Boolean)
      .join("")
      .trim()
    return text || undefined
  }
  return undefined
}

function roleFromProps(props: Record<string, any>) {
  return props.accessibilityRole ?? props.role
}

function labelFromProps(props: Record<string, any>) {
  return props.accessibilityLabel ?? props["aria-label"]
}

function hintFromProps(props: Record<string, any>) {
  return props.accessibilityHint
}

function placeholderFromProps(props: Record<string, any>) {
  return props.placeholder
}

function enabledFromProps(props: Record<string, any>) {
  return !(props.disabled || props.accessibilityState?.disabled)
}

function visibleFromProps(props: Record<string, any>) {
  return !(props.accessibilityElementsHidden || props.importantForAccessibility === "no-hide-descendants")
}

function hasPressHandler(props: Record<string, any>) {
  return typeof props.onPress === "function" || typeof props.onClick === "function"
}

function hasFillHandler(props: Record<string, any>) {
  return typeof props.onChangeText === "function" || typeof props.onChange === "function"
}

function hasScrollRef(candidate: CapturedElement) {
  try {
    return Boolean(
      candidate.ref &&
        (typeof candidate.ref.scrollTo === "function" ||
          typeof candidate.ref.scrollToOffset === "function" ||
          typeof candidate.ref.scrollToLocation === "function")
    )
  } catch {
    return false
  }
}

function scoreCandidate(candidate: CapturedElement, action?: string) {
  if (action === "press") return hasPressHandler(candidate.props) ? 100 : 0
  if (action === "fill") return hasFillHandler(candidate.props) ? 100 : 0
  if (action === "scroll") return hasScrollRef(candidate) ? 100 : 0

  let score = 0
  if (hasPressHandler(candidate.props)) score += 10
  if (hasFillHandler(candidate.props)) score += 10
  if (hasScrollRef(candidate)) score += 10
  if (candidate.node.role) score += 1
  if (candidate.node.type) score += 1
  return score
}

function bestCandidate(candidates: CapturedElement[] = [], action?: string) {
  return candidates
    .slice()
    .sort((a, b) => scoreCandidate(b, action) - scoreCandidate(a, action) || b.seenAt - a.seenAt)[0]
}

function bestCandidateNode(candidates: CapturedElement[]) {
  return bestCandidate(candidates)?.node
}

function addCapturedElement(
  elements: Map<string, CapturedElement[]>,
  candidate: CapturedElement
) {
  const key = candidateKey(candidate.node)
  const candidates = elements.get(key) ?? []
  const existingIndex = candidates.findIndex((entry) => entry.props === candidate.props)

  if (existingIndex >= 0) {
    candidates[existingIndex] = candidate
  } else {
    candidates.push(candidate)
  }

  candidates.sort((a, b) => scoreCandidate(b) - scoreCandidate(a) || b.seenAt - a.seenAt)
  elements.set(key, candidates.slice(0, 20))
}

function assignOriginalRef(ref: any, value: any) {
  if (typeof ref === "function") {
    ref(value)
    return
  }

  if (ref && typeof ref === "object") {
    ref.current = value
  }
}

function generatedIdForProps(type: unknown, props: Record<string, any>) {
  const state = getGlobalState()
  let id = state.ids.get(props)
  if (!id) {
    id = `agent-runtime-${state.nextId++}`
    state.ids.set(props, id)
  }

  return id
}

const CONTEXT_TYPES = ["react.provider", "react.context", "react.consumer"].map((name) => Symbol.for(name))

/** Context providers and consumers carry app objects in `value`, not UI. */
function isContextType(type: unknown) {
  return Boolean(type && typeof type === "object" && CONTEXT_TYPES.includes((type as any).$$typeof))
}

/** Only an input's text, number or toggle state; objects can throw when serialized. */
function valueFromProps(props: Record<string, any>) {
  const value = props.value
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? value
    : undefined
}

function nodeFromProps(type: unknown, props: Record<string, any>): AgentUiNode | null {
  if (isContextType(type)) return null

  const testID = typeof props.testID === "string" && props.testID.length > 0 ? props.testID : undefined
  const text = textFromChildren(props.children)
  const label = labelFromProps(props)
  const role = roleFromProps(props)
  const hint = hintFromProps(props)
  const placeholder = placeholderFromProps(props)
  const value = valueFromProps(props)

  if (
    !testID &&
    !text &&
    !label &&
    !role &&
    !hint &&
    !placeholder &&
    value === undefined &&
    !hasPressHandler(props) &&
    !hasFillHandler(props)
  ) {
    return null
  }

  return {
    id: generatedIdForProps(type, props),
    testID,
    type: typeName(type),
    text,
    label,
    role,
    hint,
    placeholder,
    visible: visibleFromProps(props),
    enabled: enabledFromProps(props),
    value,
  }
}

function candidateKey(node: AgentUiNode) {
  return node.testID ?? node.id ?? ""
}

function allCandidates(elements: Map<string, CapturedElement[]>) {
  return Array.from(elements.values()).flat()
}

function uniqueCandidates(candidates: CapturedElement[]) {
  const seenProps = new WeakSet<Record<string, any>>()
  const seenKeys = new Set<string>()

  return candidates.filter((candidate) => {
    if (candidate.props && seenProps.has(candidate.props)) return false
    if (candidate.props) seenProps.add(candidate.props)

    const key = candidateKey(candidate.node)
    if (key) {
      const nodeKey = `${key}:${candidate.node.type ?? ""}:${candidate.node.text ?? ""}:${candidate.node.label ?? ""}`
      if (seenKeys.has(nodeKey)) return false
      seenKeys.add(nodeKey)
    }

    return true
  })
}

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase()
}

function textMatches(actual: unknown, expected: unknown) {
  return normalize(actual).includes(normalize(expected))
}

function candidateMatchesSelector(candidate: CapturedElement, selector: AgentUiSelector) {
  const node = candidate.node
  if (selector.id && node.id !== selector.id) return false
  if (selector.testID && node.testID !== selector.testID) return false
  if (selector.type && node.type !== selector.type) return false
  if (selector.role && node.role !== selector.role) return false
  if (selector.enabled != null && node.enabled !== selector.enabled) return false
  if (selector.visible != null && node.visible !== selector.visible) return false
  if (selector.text && !textMatches(node.text, selector.text)) return false
  if (selector.label && !textMatches(node.label, selector.label)) return false
  if (selector.hint && !textMatches(node.hint, selector.hint)) return false
  if (selector.placeholder && !textMatches(node.placeholder, selector.placeholder)) return false
  return true
}

function summarizeNode(node: AgentUiNode) {
  return {
    id: node.id,
    testID: node.testID,
    type: node.type,
    text: node.text,
    label: node.label,
    role: node.role,
    hint: node.hint,
    placeholder: node.placeholder,
    enabled: node.enabled,
    visible: node.visible,
  }
}

function safeSelectorDescription(request: AgentUiActionRequestPayload) {
  if (request.testID) return `testID "${request.testID}"`
  if (request.selector) return `selector ${JSON.stringify(request.selector)}`
  return "the empty selector"
}

function findCandidates(
  elements: Map<string, CapturedElement[]>,
  request: AgentUiActionRequestPayload
) {
  if (request.testID) {
    return uniqueCandidates([
      ...(elements.get(request.testID) ?? []),
      ...(getGlobalState().elements.get(request.testID) ?? []),
    ])
  }

  if (request.selector?.id) {
    return uniqueCandidates([
      ...(elements.get(request.selector.id) ?? []),
      ...(getGlobalState().elements.get(request.selector.id) ?? []),
    ].filter((candidate) => candidateMatchesSelector(candidate, request.selector as AgentUiSelector)))
  }

  if (request.selector?.testID) {
    return uniqueCandidates([
      ...(elements.get(request.selector.testID) ?? []),
      ...(getGlobalState().elements.get(request.selector.testID) ?? []),
    ].filter((candidate) => candidateMatchesSelector(candidate, request.selector as AgentUiSelector)))
  }

  if (request.selector) {
    const matches = [
      ...allCandidates(elements),
      ...allCandidates(getGlobalState().elements),
    ].filter((candidate) => candidateMatchesSelector(candidate, request.selector as AgentUiSelector))

    return uniqueCandidates(matches)
  }

  return []
}

function captureElement(
  type: unknown,
  props: Record<string, any> | null | undefined
): CapturedElement | undefined {
  if (!props) return undefined
  const node = nodeFromProps(type, props)
  if (!node) return undefined

  const candidate: CapturedElement = {
    node,
    props,
    seenAt: Date.now(),
  }
  addCapturedElement(getGlobalState().elements, candidate)
  return candidate
}

function captureElementProps(
  type: unknown,
  props: Record<string, any> | null | undefined,
  children: unknown[]
) {
  if (!props) return props

  const captureProps = children.length > 0 ? { ...props, children } : props
  const candidate = captureElement(type, captureProps)
  const originalRef = props.ref

  if (!candidate || originalRef == null) return props

  return {
    ...props,
    ref: (value: any) => {
      candidate.ref = value
      assignOriginalRef(originalRef, value)
    },
  }
}

function installCreateElementCapture() {
  const state = getGlobalState()
  if (state.installed) return

  try {
    // Keep this as a runtime require so package consumers do not need a direct
    // React peer declaration beyond the app's normal React Native dependency.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const React = require("react")
    const originalCreateElement = React.createElement
    if (typeof originalCreateElement !== "function") return

    React.createElement = function reactotronAgentCreateElement(
      type: unknown,
      props: Record<string, any>,
      ...children: unknown[]
    ) {
      const nextProps = captureElementProps(type, props, children)
      return originalCreateElement.apply(this, [type, nextProps, ...children])
    }

    state.installed = true
  } catch {
    // React may not be require-able in every runtime. Fiber capture can still work.
  }
}

function collectFiberNodes(): { nodes: AgentUiNode[]; elements: Map<string, CapturedElement[]> } {
  const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__
  const elements = new Map<string, CapturedElement[]>()

  if (!hook?.renderers || typeof hook.getFiberRoots !== "function") {
    return { nodes: [], elements }
  }

  const visitFiber = (fiber: any) => {
    if (!fiber) return

    const props = fiber.memoizedProps ?? fiber.pendingProps
    const node = props ? nodeFromProps(fiber.elementType ?? fiber.type, props) : null
    if (node) {
      addCapturedElement(elements, {
        node,
        props,
        ref: fiber.stateNode,
        seenAt: Date.now(),
      })
    }

    visitFiber(fiber.child)
    visitFiber(fiber.sibling)
  }

  for (const rendererId of hook.renderers.keys()) {
    try {
      const roots = hook.getFiberRoots(rendererId)
      for (const root of roots) {
        visitFiber(root.current)
      }
    } catch {
      // Some devtools integrations register renderers without exposing compatible fiber roots.
    }
  }

  return {
    nodes: Array.from(elements.values())
      .map(bestCandidateNode)
      .filter((node): node is AgentUiNode => Boolean(node)),
    elements,
  }
}

async function runInferredAction(
  elements: Map<string, CapturedElement[]>,
  request: AgentUiActionRequestPayload
) {
  const matches = findCandidates(elements, request)
  const index = request.selector?.index
  const selectedMatches = index == null ? matches : matches.slice(index, index + 1)
  const actionableMatches = selectedMatches.filter((candidate) => scoreCandidate(candidate, request.action) > 0)

  if (!request.testID && !request.selector) {
    throw new Error("Agent UI action requires either testID or selector.")
  }

  if (matches.length === 0) {
    throw new Error(`No mounted element matched ${safeSelectorDescription(request)}.`)
  }

  if (index != null && selectedMatches.length === 0) {
    throw new Error(`No mounted element matched ${safeSelectorDescription(request)} at index ${index}.`)
  }

  if (!request.testID && index == null && actionableMatches.length > 1) {
    throw new Error(
      `Ambiguous selector matched ${actionableMatches.length} actionable elements. Add testID, id, more selector fields, or index. Candidates: ${JSON.stringify(
        actionableMatches.slice(0, 10).map((candidate) => summarizeNode(candidate.node))
      )}`
    )
  }

  const element = bestCandidate(selectedMatches, request.action)
  const props = element?.props
  const targetDescription = request.testID ?? request.selector?.testID ?? request.selector?.id ?? "selector"

  if (!props) {
    throw new Error(`No mounted element matched ${safeSelectorDescription(request)}.`)
  }

  if (request.action === "press") {
    const handler = props.onPress ?? props.onClick
    if (typeof handler !== "function") {
      throw new Error(`Element "${targetDescription}" does not expose an onPress handler.`)
    }

    return handler({
      nativeEvent: {
        target: targetDescription,
      },
    })
  }

  if (request.action === "fill") {
    if (typeof props.onChangeText === "function") {
      return props.onChangeText(String(request.value ?? ""))
    }

    if (typeof props.onChange === "function") {
      return props.onChange({
        nativeEvent: {
          text: String(request.value ?? ""),
          target: targetDescription,
        },
      })
    }

    throw new Error(`Element "${targetDescription}" does not expose onChangeText or onChange.`)
  }

  if (request.action === "scroll") {
    const ref = element?.ref
    if (!ref) {
      throw new Error(`Element "${targetDescription}" scroll ref not available.`)
    }

    const args = request.args ?? {}
    const animated = args.animated !== false
    const y = Number(args.y ?? request.value ?? 0)
    const offset = Number(args.offset ?? args.y ?? request.value ?? 0)

    if (typeof ref.scrollTo === "function") {
      return ref.scrollTo({ x: Number(args.x ?? 0), y, animated })
    }

    if (typeof ref.scrollToOffset === "function") {
      return ref.scrollToOffset({ offset, animated })
    }

    if (typeof ref.scrollToLocation === "function") {
      return ref.scrollToLocation({
        sectionIndex: Number(args.sectionIndex ?? 0),
        itemIndex: Number(args.itemIndex ?? 0),
        viewOffset: args.viewOffset == null ? undefined : Number(args.viewOffset),
        viewPosition: args.viewPosition == null ? undefined : Number(args.viewPosition),
        animated,
      })
    }

    throw new Error(`Element "${targetDescription}" scroll ref not available.`)
  }

  throw new Error(`No inferred handler exists for action "${request.action}".`)
}

const agentRuntime = (options: AgentRuntimeOptions = {}) => <Client extends ReactotronCore = ReactotronCore>(
  reactotron: Client
) => {
  const autoCapture = options.autoCapture !== false
  let snapshotProvider = options.snapshot
  const nodes = new Map<string, AgentUiNode>()
  const actions = new Map<string, AgentRuntimeActionHandler>()

  if (autoCapture) {
    installCreateElementCapture()
  }

  ;(options.nodes ?? []).forEach((node) => {
    const key = candidateKey(node)
    if (key) nodes.set(key, node)
  })

  Object.entries(options.actions ?? {}).forEach(([testID, handlerOrMap]) => {
    if (typeof handlerOrMap === "function") {
      actions.set(actionKey(testID, "press"), handlerOrMap)
      return
    }

    Object.entries(handlerOrMap).forEach(([action, handler]) => {
      actions.set(actionKey(testID, action), handler)
    })
  })

  const sendResponse = (payload: AgentUiResponsePayload) => {
    reactotron.send("agent.ui.response", payload)
  }

  const buildSnapshot = async (): Promise<AgentUiSnapshot> => {
    if (snapshotProvider) return snapshotProvider()

    const fiberSnapshot = autoCapture ? collectFiberNodes() : { nodes: [], elements: new Map() }
    const capturedNodes = Array.from(getGlobalState().elements.values())
      .map(bestCandidateNode)
      .filter((node): node is AgentUiNode => Boolean(node))
    const mergedNodes = new Map<string, AgentUiNode>()

    ;[...capturedNodes, ...fiberSnapshot.nodes, ...Array.from(nodes.values())].forEach((node) => {
      const key = candidateKey(node)
      if (key) mergedNodes.set(key, node)
    })

    return {
      nodes: Array.from(mergedNodes.values()),
      metadata: {
        autoCapture,
        fiberNodes: fiberSnapshot.nodes.length,
        capturedNodes: capturedNodes.length,
        manualNodes: nodes.size,
      },
    }
  }

  const handleSnapshot = async (payload: AgentUiSnapshotRequestPayload) => {
    try {
      sendResponse({
        requestId: payload.requestId,
        status: "success",
        snapshot: await buildSnapshot(),
      })
    } catch (error) {
      sendResponse({
        requestId: payload.requestId,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const handleAction = async (payload: AgentUiActionRequestPayload) => {
    const manualActionTestID = payload.testID ?? payload.selector?.testID
    const handler = manualActionTestID
      ? actions.get(actionKey(manualActionTestID, payload.action))
      : undefined

    try {
      const fiberSnapshot = autoCapture ? collectFiberNodes() : { nodes: [], elements: new Map() }
      const result = handler
        ? await handler(payload)
        : await runInferredAction(fiberSnapshot.elements, payload)

      sendResponse({
        requestId: payload.requestId,
        status: "success",
        action: payload.action,
        testID: manualActionTestID,
        result,
        snapshot: payload.includeSnapshot === false ? undefined : await buildSnapshot(),
      })
    } catch (error) {
      sendResponse({
        requestId: payload.requestId,
        status: "error",
        action: payload.action,
        testID: manualActionTestID,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    onCommand: (command: Command) => {
      if (command.type === "agent.ui.snapshot.request") {
        handleSnapshot(command.payload as AgentUiSnapshotRequestPayload)
      }

      if (command.type === "agent.ui.action.request") {
        handleAction(command.payload as AgentUiActionRequestPayload)
      }
    },
    features: {
      setAgentRuntimeSnapshotProvider: (provider: AgentRuntimeSnapshotProvider) => {
        snapshotProvider = provider
      },
      registerAgentRuntimeNode: (node: AgentUiNode) => {
        const key = candidateKey(node)
        if (key) nodes.set(key, node)
      },
      updateAgentRuntimeNode: (testID: string, patch: Partial<AgentUiNode>) => {
        nodes.set(testID, { testID, ...nodes.get(testID), ...patch })
      },
      unregisterAgentRuntimeNode: (testID: string) => {
        nodes.delete(testID)
      },
      clearAgentRuntimeNodes: () => {
        nodes.clear()
      },
      registerAgentRuntimeAction: (
        testID: string,
        action: string,
        handler: AgentRuntimeActionHandler
      ) => {
        actions.set(actionKey(testID, action), handler)
      },
      unregisterAgentRuntimeAction: (testID: string, action: string) => {
        actions.delete(actionKey(testID, action))
      },
    },
  } satisfies Plugin<Client>
}

export default agentRuntime
