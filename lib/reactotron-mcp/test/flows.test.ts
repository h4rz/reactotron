import { createFlowRecorder, runFlow, type ToolHandler } from "../src/flows"

const text = (data: unknown) => ({ content: [{ type: "text", text: JSON.stringify(data) }] })

describe("flow recorder", () => {
  it("records only action tools and drops undefined args", () => {
    const recorder = createFlowRecorder()
    recorder.record("agent_ui_press", { testID: "ignored-before-start" })
    recorder.start("login")
    recorder.record("agent_ui_fill", { testID: "email", text: "a@b.c", clientId: undefined })
    recorder.record("request_state", { path: "user" })
    recorder.record("reload_app", {})

    expect(recorder.stop()).toEqual({
      version: 1,
      name: "login",
      steps: [{ tool: "agent_ui_fill", args: { testID: "email", text: "a@b.c" } }, { tool: "reload_app" }],
    })
    expect(recorder.recording).toBe(false)
  })
})

describe("runFlow", () => {
  it("runs tool steps and assertions in order", async () => {
    const calls: string[] = []
    const handlers = new Map<string, ToolHandler>([
      ["agent_ui_press", async (args) => (calls.push(`press:${args.testID}`), text({ status: "success" }))],
      ["agent_ui_find", async () => text({ status: "success", count: 1 })],
      ["request_state", async () => text({ status: "success", state: { name: "Ada" } })],
    ])
    const commandBuffer: any[] = []
    setTimeout(() => {
      commandBuffer.push({
        type: "api.response",
        date: new Date(),
        payload: { request: { url: "https://api/login", method: "POST" }, response: { status: 200 } },
      })
    }, 50)

    const report = await runFlow(
      {
        version: 1,
        steps: [
          { tool: "agent_ui_press", args: { testID: "submit" } },
          { waitFor: { testID: "home" } },
          { expectNetwork: { url: "/login", method: "post", status: 200, timeoutMs: 2000 } },
          { expectState: { path: "user", equals: { name: "Ada" } } },
        ],
      },
      handlers,
      commandBuffer
    )

    expect(calls).toEqual(["press:submit"])
    expect(report.status).toBe("passed")
    expect(report.ran).toBe(4)
  })

  it("stops at the first failing step", async () => {
    const handlers = new Map<string, ToolHandler>([
      ["agent_ui_press", async () => text({ status: "no_response", message: "app did not answer" })],
    ])

    const report = await runFlow(
      { version: 1, steps: [{ tool: "agent_ui_press" }, { tool: "agent_ui_press" }] },
      handlers,
      []
    )

    expect(report.status).toBe("failed")
    expect(report.ran).toBe(1)
    expect(report.results[0].message).toBe("app did not answer")
  })

  it("fails unknown tools and unmet expectations", async () => {
    const report = await runFlow(
      {
        version: 1,
        steps: [{ tool: "nope" }, { expectNetwork: { url: "/x", timeoutMs: 100 } }],
      },
      new Map(),
      [],
      { continueOnFailure: true }
    )

    expect(report.failed).toBe(2)
    expect(report.results[0].message).toBe("Unknown tool: nope")
  })
})
