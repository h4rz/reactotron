import { parseArguments } from "../src/arguments"
import { runCommand } from "../src/commands"

function client() {
  return {
    url: "http://127.0.0.1:4567/mcp",
    connect: jest.fn().mockResolvedValue({}),
    readResource: jest.fn().mockResolvedValue({ events: [] }),
    callTool: jest
      .fn()
      .mockResolvedValue({ data: { status: "success" }, artifacts: [], isError: false }),
  }
}

describe("friendly command aliases", () => {
  test("maps Redux dispatch to the MCP schema", async () => {
    const mock = client()
    await runCommand({
      client: mock as any,
      args: parseArguments(["dispatch", "cart/reset", "--payload", '{"source":"agent"}']),
    })

    expect(mock.callTool).toHaveBeenCalledWith("dispatch_action", {
      actionType: "cart/reset",
      actionPayload: { source: "agent" },
    })
  })

  test("maps UI fill to text", async () => {
    const mock = client()
    await runCommand({
      client: mock as any,
      args: parseArguments(["ui", "fill", "--test-id", "email", "--value", "a@example.com"]),
    })

    expect(mock.callTool).toHaveBeenCalledWith("agent_ui_fill", {
      selector: { testID: "email" },
      text: "a@example.com",
    })
  })

  test("maps simulator controls to command", async () => {
    const mock = client()
    await runCommand({
      client: mock as any,
      args: parseArguments(["ios", "rotate", "SIM-1", "landscape_left"]),
    })

    expect(mock.callTool).toHaveBeenCalledWith("control_ios_simulator", {
      udid: "SIM-1",
      command: "landscape_left",
    })
  })

  test("requires confirmation before replacing app state", async () => {
    const mock = client()
    await expect(
      runCommand({
        client: mock as any,
        args: parseArguments(["state", "replace", "state.json"]),
      })
    ).rejects.toThrow("requires --confirm")
  })

  test("tap emits the first event after an initially empty timeline", async () => {
    const mock = client()
    mock.readResource
      .mockResolvedValueOnce({ events: [] })
      .mockResolvedValueOnce({ events: [{ type: "log", date: 1 }] })
    const controller = new AbortController()
    const writeEvent = jest.fn()
    let waits = 0

    await runCommand({
      client: mock as any,
      args: parseArguments(["tap", "--interval", "100"]),
      signal: controller.signal,
      writeEvent,
      wait: async () => {
        waits += 1
        if (waits === 2) controller.abort()
      },
    })

    expect(writeEvent).toHaveBeenCalledWith({ type: "log", date: 1 })
  })
})

describe("device and flow commands", () => {
  test("maps device record stop with an absolute output path", async () => {
    const mock = client()
    await runCommand({
      client: mock as any,
      args: parseArguments(["device", "record", "stop", "emulator-5554", "--out", "/tmp/run.mp4"]),
    })

    expect(mock.callTool).toHaveBeenCalledWith("device_record_stop", {
      deviceId: "emulator-5554",
      outputPath: "/tmp/run.mp4",
    })
  })

  test("defaults device appearance to toggle", async () => {
    const mock = client()
    await runCommand({ client: mock as any, args: parseArguments(["device", "appearance", "SIM-1"]) })

    expect(mock.callTool).toHaveBeenCalledWith("device_appearance", {
      deviceId: "SIM-1",
      appearance: "toggle",
    })
  })

  test("reports a failed flow as an error with the failing step", async () => {
    const mock = client()
    mock.callTool.mockResolvedValue({
      data: {
        status: "failed",
        steps: 2,
        ran: 1,
        results: [{ index: 0, ok: false, message: "app did not answer" }],
      },
      artifacts: [],
      isError: false,
    })

    const result = await runCommand({
      client: mock as any,
      args: parseArguments(["flow", "run", "/tmp/login.json"]),
    })

    expect(mock.callTool).toHaveBeenCalledWith("flow_run", {
      path: "/tmp/login.json",
      continueOnFailure: false,
    })
    expect(result.status).toBe("error")
    expect(result.summary).toBe("Flow failed at step 1: app did not answer")
  })
})
