import {
  type InferFeatures,
  type LoggerPlugin,
  type ReactotronCore,
  assertHasLoggerPlugin,
  type Plugin,
} from "@hurajgor/reactotron-core-client"

type ConsoleMethod = "log" | "info" | "warn" | "debug"

/**
 * Track calls to console.log, console.info, console.warn, and console.debug and send them to Reactotron logger
 */
const trackGlobalLogs = () => (reactotron: ReactotronCore) => {
  assertHasLoggerPlugin(reactotron)
  const client = reactotron as ReactotronCore & InferFeatures<ReactotronCore, LoggerPlugin>
  const serializeArgs = (args: unknown[]) => (args.length === 1 ? args[0] : args)

  /**
   * The console methods as they were before this plugin patched them.
   *
   * onConnect fires again on every reconnect. Without tracking the originals
   * and restoring them, each reconnect wraps the already-patched console, so
   * the underlying console and the client both receive one call per layer.
   */
  let originals: Pick<Console, ConsoleMethod> | null = null

  const restore = () => {
    if (!originals) return

    console.log = originals.log
    console.info = originals.info
    console.warn = originals.warn
    console.debug = originals.debug
    originals = null
  }

  return {
    onConnect: () => {
      // Keep the same wrapper across reconnects so console calls made while
      // the socket is down are queued by the core client instead of lost.
      if (originals) return

      originals = {
        log: console.log,
        info: console.info,
        warn: console.warn,
        debug: console.debug,
      }

      const { log: originalConsoleLog, info: originalConsoleInfo } = originals
      const { warn: originalConsoleWarn, debug: originalConsoleDebug } = originals

      console.log = (...args: Parameters<typeof console.log>) => {
        originalConsoleLog(...args)
        client.log(...args)
      }

      console.info = (...args: Parameters<typeof console.info>) => {
        originalConsoleInfo(...args)
        client.send("log", { level: "info", message: serializeArgs(args) as any }, false)
      }

      console.warn = (...args: Parameters<typeof console.warn>) => {
        originalConsoleWarn(...args)
        client.warn(serializeArgs(args))
      }

      console.debug = (...args: Parameters<typeof console.debug>) => {
        originalConsoleDebug(...args)
        client.debug(serializeArgs(args))
      }

      // console.error is taken care of by ./trackGlobalErrors.ts
    },
    onDisconnect: () => {
      // close() sets connected=false. Unexpected closes keep it true while
      // reconnecting, so leave the wrapper installed for the send queue.
      const reconnecting =
        (client as typeof client & { connected?: boolean }).connected === true &&
        client.options.reconnect !== false
      if (!reconnecting) restore()
    },
  } satisfies Plugin<ReactotronCore>
}

export default trackGlobalLogs
