import trackGlobalLogs from "./trackGlobalLogs"

const originalConsole = {
  debug: console.debug,
  info: console.info,
  log: console.log,
  warn: console.warn,
}

afterEach(() => {
  console.debug = originalConsole.debug
  console.info = originalConsole.info
  console.log = originalConsole.log
  console.warn = originalConsole.warn
  jest.restoreAllMocks()
})

test("tracks console.info as a Reactotron log", () => {
  const originalInfo = jest.fn()
  const reactotronSend = jest.fn()
  console.info = originalInfo

  const plugin = trackGlobalLogs()({
    debug: jest.fn(),
    log: jest.fn(),
    logImportant: jest.fn(),
    send: reactotronSend,
    warn: jest.fn(),
    error: jest.fn(),
  } as any)

  plugin.onConnect()
  console.info("received message", { formatName: "SOLD" })

  expect(originalInfo).toHaveBeenCalledWith("received message", { formatName: "SOLD" })
  expect(reactotronSend).toHaveBeenCalledWith(
    "log",
    { level: "info", message: ["received message", { formatName: "SOLD" }] },
    false
  )
})

function buildClient() {
  return {
    debug: jest.fn(),
    log: jest.fn(),
    logImportant: jest.fn(),
    send: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as any
}

/**
 * onConnect fires again on every reconnect. Patching unconditionally wraps the
 * already-patched console, so each reconnect adds another layer that forwards
 * to the previous one - the underlying console receives one call per layer.
 */
test("does not stack console patches across reconnects", () => {
  const originalInfo = jest.fn()
  console.info = originalInfo

  const client = buildClient()
  const plugin = trackGlobalLogs()(client)

  plugin.onConnect()
  plugin.onDisconnect?.()
  plugin.onConnect()
  plugin.onDisconnect?.()
  plugin.onConnect()

  console.info("auction update")

  // the real console.info is called exactly once, not once per reconnect
  expect(originalInfo).toHaveBeenCalledTimes(1)
  // and the command reaches the client exactly once
  expect(client.send).toHaveBeenCalledTimes(1)
})

test("restores the original console methods after a permanent close", () => {
  const originalInfo = jest.fn()
  const originalLog = jest.fn()
  const originalWarn = jest.fn()
  const originalDebug = jest.fn()
  console.info = originalInfo
  console.log = originalLog
  console.warn = originalWarn
  console.debug = originalDebug

  const plugin = trackGlobalLogs()({
    ...buildClient(),
    connected: false,
    options: { reconnect: true },
  })

  plugin.onConnect()
  plugin.onDisconnect?.()

  expect(console.info).toBe(originalInfo)
  expect(console.log).toBe(originalLog)
  expect(console.warn).toBe(originalWarn)
  expect(console.debug).toBe(originalDebug)
})

test("tracks console calls during a transient disconnect without stacking wrappers", () => {
  const originalInfo = jest.fn()
  console.info = originalInfo

  const client = {
    ...buildClient(),
    connected: true,
    options: { reconnect: true },
  }
  const plugin = trackGlobalLogs()(client)

  plugin.onConnect()
  plugin.onDisconnect?.()
  console.info("auction update", { currentBid: 125 })
  plugin.onConnect()
  console.info("auction update", { currentBid: 150 })

  expect(originalInfo).toHaveBeenCalledTimes(2)
  expect(client.send).toHaveBeenCalledTimes(2)
  expect(client.send).toHaveBeenNthCalledWith(
    1,
    "log",
    { level: "info", message: ["auction update", { currentBid: 125 }] },
    false
  )

  client.connected = false
  plugin.onDisconnect?.()
  expect(console.info).toBe(originalInfo)
})

/**
 * A reconnect hands the plugin a fresh socket. Logs after that reconnect must
 * route to the current client, not to a closure captured on an earlier connect.
 */
test("routes logs to the client after a reconnect", () => {
  console.info = jest.fn()

  const client = buildClient()
  const plugin = trackGlobalLogs()(client)

  plugin.onConnect()
  plugin.onDisconnect?.()
  plugin.onConnect()

  console.info("auction update")

  expect(client.send).toHaveBeenCalledWith(
    "log",
    { level: "info", message: "auction update" },
    false
  )
})
