import React from "react"

import agentRuntime from "./agentRuntime"

function createPlugin() {
  const sent: Array<{ type: string; payload: any }> = []
  const reactotron = {
    send: (type: string, payload: any) => {
      sent.push({ type, payload })
    },
  }

  return {
    plugin: agentRuntime()(reactotron as any),
    sent,
  }
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe("agentRuntime", () => {
  beforeEach(() => {
    ;(globalThis as any).__REACTOTRON_AGENT_RUNTIME_CAPTURE__?.elements?.clear()
  })

  test("automatically snapshots elements with testIDs", async () => {
    const { plugin, sent } = createPlugin()

    React.createElement("Pressable", {
      testID: "agent-auto-button",
      accessibilityRole: "button",
      children: "Save",
    })

    plugin.onCommand?.({
      type: "agent.ui.snapshot.request",
      payload: { requestId: "snapshot-1" },
    } as any)
    await flush()

    expect(sent[0].type).toBe("agent.ui.response")
    expect(sent[0].payload.status).toBe("success")
    expect(sent[0].payload.snapshot.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          testID: "agent-auto-button",
          role: "button",
          text: "Save",
        }),
      ])
    )
  })

  test("automatically snapshots accessibility-only elements without testIDs", async () => {
    const { plugin, sent } = createPlugin()

    React.createElement("Pressable", {
      accessibilityRole: "button",
      accessibilityLabel: "Sign In",
      accessibilityHint: "Submits the login form",
      children: "Continue",
    })

    plugin.onCommand?.({
      type: "agent.ui.snapshot.request",
      payload: { requestId: "snapshot-a11y-1" },
    } as any)
    await flush()

    expect(sent[0].payload.status).toBe("success")
    expect(sent[0].payload.snapshot.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expect.stringMatching(/^agent-runtime-/),
          testID: undefined,
          role: "button",
          label: "Sign In",
          hint: "Submits the login form",
          text: "Continue",
        }),
      ])
    )
  })

  test("skips context providers whose value throws when serialized", async () => {
    // React Navigation's default context value: every getter throws.
    const throwing = Object.defineProperty({}, "navigation", {
      enumerable: true,
      get: () => {
        throw new Error("Couldn't find a navigation context.")
      },
    })
    const NavigationContext = React.createContext(throwing)
    const { plugin, sent } = createPlugin()

    React.createElement(NavigationContext.Provider, { value: throwing, children: "Dashboard" })
    React.createElement("TextInput", { testID: "context-safe-input", value: throwing })
    React.createElement("TextInput", { testID: "context-safe-amount", value: "42" })

    plugin.onCommand?.({
      type: "agent.ui.snapshot.request",
      payload: { requestId: "snapshot-context" },
    } as any)
    await flush()

    expect(sent[0].payload.status).toBe("success")
    expect(() => JSON.stringify(sent[0].payload)).not.toThrow()
    const nodes = sent[0].payload.snapshot.nodes
    expect(nodes).not.toEqual(expect.arrayContaining([expect.objectContaining({ text: "Dashboard" })]))
    expect(nodes.find((node: any) => node.testID === "context-safe-input").value).toBeUndefined()
    expect(nodes.find((node: any) => node.testID === "context-safe-amount").value).toBe("42")
  })

  test("falls back to captured elements when a devtools renderer rejects fiber access", async () => {
    const originalHook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__
    ;(globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      renderers: new Map([[1, {}]]),
      getFiberRoots: () => {
        throw new Error("No compatible navigation context")
      },
    }

    try {
      const { plugin, sent } = createPlugin()
      React.createElement("Pressable", { testID: "fallback-button", children: "Continue" })

      plugin.onCommand?.({
        type: "agent.ui.snapshot.request",
        payload: { requestId: "snapshot-fallback" },
      } as any)
      await flush()

      expect(sent[0].payload.status).toBe("success")
      expect(sent[0].payload.snapshot.nodes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ testID: "fallback-button", text: "Continue" }),
        ])
      )
    } finally {
      ;(globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ = originalHook
    }
  })

  test("snapshots captured elements whose refs reject capability access", async () => {
    const { plugin, sent } = createPlugin()
    React.createElement("ScrollView", { testID: "guarded-ref" })
    const captured = (globalThis as any).__REACTOTRON_AGENT_RUNTIME_CAPTURE__.elements.get(
      "guarded-ref"
    )[0]
    captured.ref = new Proxy({}, {
      get: () => {
        throw new Error("Couldn't find a navigation context")
      },
    })

    plugin.onCommand?.({
      type: "agent.ui.snapshot.request",
      payload: { requestId: "snapshot-guarded-ref" },
    } as any)
    await flush()

    expect(sent[0].payload.status).toBe("success")
    expect(sent[0].payload.snapshot.nodes).toEqual(
      expect.arrayContaining([expect.objectContaining({ testID: "guarded-ref" })])
    )
  })

  test("infers press from captured onPress props", async () => {
    const { plugin, sent } = createPlugin()
    const onPress = jest.fn(() => ({ pressed: true }))

    React.createElement("Pressable", {
      testID: "agent-auto-press",
      onPress,
    })

    plugin.onCommand?.({
      type: "agent.ui.action.request",
      payload: { requestId: "press-1", testID: "agent-auto-press", action: "press" },
    } as any)
    await flush()

    expect(onPress).toHaveBeenCalledTimes(1)
    expect(sent[0].payload.status).toBe("success")
    expect(sent[0].payload.action).toBe("press")
  })

  test("omits action snapshot when includeSnapshot is false", async () => {
    const { plugin, sent } = createPlugin()
    const onPress = jest.fn()

    React.createElement("Pressable", {
      testID: "fast-press",
      onPress,
    })

    plugin.onCommand?.({
      type: "agent.ui.action.request",
      payload: {
        requestId: "press-fast-1",
        testID: "fast-press",
        action: "press",
        includeSnapshot: false,
      },
    } as any)
    await flush()

    expect(sent[0].payload.status).toBe("success")
    expect(sent[0].payload.snapshot).toBeUndefined()
  })

  test("includes action snapshot by default for compatibility", async () => {
    const { plugin, sent } = createPlugin()

    React.createElement("Pressable", {
      testID: "compat-press",
      onPress: jest.fn(),
    } as any)

    plugin.onCommand?.({
      type: "agent.ui.action.request",
      payload: {
        requestId: "press-compat-1",
        testID: "compat-press",
        action: "press",
      },
    } as any)
    await flush()

    expect(sent[0].payload.status).toBe("success")
    expect(sent[0].payload.snapshot.nodes).toEqual(
      expect.arrayContaining([expect.objectContaining({ testID: "compat-press" })])
    )
  })

  test("infers press from an accessibility selector when testID is missing", async () => {
    const { plugin, sent } = createPlugin()
    const onPress = jest.fn(() => ({ pressed: true }))

    React.createElement("Pressable", {
      accessibilityRole: "button",
      accessibilityLabel: "Sign In",
      onPress,
    })

    plugin.onCommand?.({
      type: "agent.ui.action.request",
      payload: {
        requestId: "press-selector-1",
        selector: { role: "button", label: "sign in" },
        action: "press",
      },
    } as any)
    await flush()

    expect(onPress).toHaveBeenCalledTimes(1)
    expect(sent[0].payload.status).toBe("success")
  })

  test("returns candidates when an accessibility selector is ambiguous", async () => {
    const { plugin, sent } = createPlugin()

    React.createElement("Pressable", {
      accessibilityRole: "button",
      accessibilityLabel: "Continue",
      onPress: jest.fn(),
    } as any)
    React.createElement("Pressable", {
      accessibilityRole: "button",
      accessibilityLabel: "Continue",
      onPress: jest.fn(),
    } as any)

    plugin.onCommand?.({
      type: "agent.ui.action.request",
      payload: {
        requestId: "press-selector-ambiguous-1",
        selector: { role: "button", label: "Continue" },
        action: "press",
      },
    } as any)
    await flush()

    expect(sent[0].payload.status).toBe("error")
    expect(sent[0].payload.message).toContain("Ambiguous selector matched 2 actionable elements")
    expect(sent[0].payload.message).toContain("Candidates")
  })

  test("prefers an actionable press candidate when a native child duplicates testID", async () => {
    const { plugin, sent } = createPlugin()
    const onPress = jest.fn(() => ({ pressed: true }))

    React.createElement("RNGHPressable", {
      testID: "abc.backButton",
      onPress,
    })
    React.createElement("RNGestureHandlerButton", {
      testID: "abc.backButton",
      accessibilityRole: "button",
    })

    plugin.onCommand?.({
      type: "agent.ui.action.request",
      payload: { requestId: "press-duplicate-1", testID: "abc.backButton", action: "press" },
    } as any)
    await flush()

    expect(onPress).toHaveBeenCalledTimes(1)
    expect(sent[0].payload.status).toBe("success")
    expect(sent[0].payload.action).toBe("press")
  })

  test("infers fill from captured onChangeText props", async () => {
    const { plugin, sent } = createPlugin()
    const onChangeText = jest.fn()

    React.createElement("TextInput", {
      testID: "agent-auto-input",
      onChangeText,
    })

    plugin.onCommand?.({
      type: "agent.ui.action.request",
      payload: {
        requestId: "fill-1",
        testID: "agent-auto-input",
        action: "fill",
        value: "qa@example.com",
      },
    } as any)
    await flush()

    expect(onChangeText).toHaveBeenCalledWith("qa@example.com")
    expect(sent[0].payload.status).toBe("success")
    expect(sent[0].payload.action).toBe("fill")
  })

  test("infers fill from a placeholder selector when testID is missing", async () => {
    const { plugin, sent } = createPlugin()
    const onChangeText = jest.fn()

    React.createElement("TextInput", {
      accessibilityRole: "text",
      placeholder: "Email address",
      onChangeText,
    })

    plugin.onCommand?.({
      type: "agent.ui.action.request",
      payload: {
        requestId: "fill-selector-1",
        selector: { placeholder: "email" },
        action: "fill",
        value: "qa@example.com",
      },
    } as any)
    await flush()

    expect(onChangeText).toHaveBeenCalledWith("qa@example.com")
    expect(sent[0].payload.status).toBe("success")
  })

  test("prefers an actionable fill candidate when a native child duplicates testID", async () => {
    const { plugin, sent } = createPlugin()
    const onChangeText = jest.fn()

    React.createElement("TextInputWrapper", {
      testID: "agent-search-input",
      onChangeText,
    })
    React.createElement("RCTTextInput", {
      testID: "agent-search-input",
      value: "",
    })

    plugin.onCommand?.({
      type: "agent.ui.action.request",
      payload: {
        requestId: "fill-duplicate-1",
        testID: "agent-search-input",
        action: "fill",
        value: "toyota",
      },
    } as any)
    await flush()

    expect(onChangeText).toHaveBeenCalledWith("toyota")
    expect(sent[0].payload.status).toBe("success")
    expect(sent[0].payload.action).toBe("fill")
  })

  test("infers scroll on a captured ScrollView ref", async () => {
    const { plugin, sent } = createPlugin()
    const scrollTo = jest.fn()

    const element = React.createElement("ScrollView", {
      testID: "results-scroll",
      ref: jest.fn(),
    } as any)
    ;(element as any).ref({ scrollTo })

    plugin.onCommand?.({
      type: "agent.ui.action.request",
      payload: {
        requestId: "scroll-1",
        testID: "results-scroll",
        action: "scroll",
        args: { y: 240, animated: false },
      },
    } as any)
    await flush()

    expect(scrollTo).toHaveBeenCalledWith({ x: 0, y: 240, animated: false })
    expect(sent[0].payload.status).toBe("success")
    expect(sent[0].payload.action).toBe("scroll")
  })

  test("infers scroll on a captured FlatList ref", async () => {
    const { plugin, sent } = createPlugin()
    const scrollToOffset = jest.fn()

    const element = React.createElement("FlatList", {
      testID: "results-list",
      ref: jest.fn(),
    } as any)
    ;(element as any).ref({ scrollToOffset })

    plugin.onCommand?.({
      type: "agent.ui.action.request",
      payload: {
        requestId: "scroll-2",
        testID: "results-list",
        action: "scroll",
        args: { offset: 480 },
      },
    } as any)
    await flush()

    expect(scrollToOffset).toHaveBeenCalledWith({ offset: 480, animated: true })
    expect(sent[0].payload.status).toBe("success")
  })

  test("infers scroll on a captured SectionList ref", async () => {
    const { plugin, sent } = createPlugin()
    const scrollToLocation = jest.fn()

    const element = React.createElement("SectionList", {
      testID: "section-list",
      ref: jest.fn(),
    } as any)
    ;(element as any).ref({ scrollToLocation })

    plugin.onCommand?.({
      type: "agent.ui.action.request",
      payload: {
        requestId: "scroll-3",
        testID: "section-list",
        action: "scroll",
        args: { sectionIndex: 2, itemIndex: 4, viewOffset: 16, viewPosition: 0.5 },
      },
    } as any)
    await flush()

    expect(scrollToLocation).toHaveBeenCalledWith({
      sectionIndex: 2,
      itemIndex: 4,
      viewOffset: 16,
      viewPosition: 0.5,
      animated: true,
    })
    expect(sent[0].payload.status).toBe("success")
  })

  test("returns a clear error when scroll ref is unavailable", async () => {
    const { plugin, sent } = createPlugin()

    React.createElement("ScrollView", {
      testID: "missing-scroll-ref",
    })

    plugin.onCommand?.({
      type: "agent.ui.action.request",
      payload: {
        requestId: "scroll-4",
        testID: "missing-scroll-ref",
        action: "scroll",
        args: { y: 100 },
      },
    } as any)
    await flush()

    expect(sent[0].payload.status).toBe("error")
    expect(sent[0].payload.message).toContain("scroll ref not available")
  })
})
