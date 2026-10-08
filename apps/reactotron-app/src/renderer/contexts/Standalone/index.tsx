import React, { useRef, useEffect, useCallback, useState, useMemo, useContext } from "react"
import { ipcRenderer } from "electron"
import Server, { createServer } from "reactotron-core-server"
import {
  createMcpServer,
  createNodeDeviceHost,
  type ReactotronDesktopHost,
  type ReactotronMcpServer,
  type McpRedactionServerConfig,
} from "reactotron-mcp"
import type { McpRedactionConfig } from "@hurajgor/reactotron-core-contract"

import ReactotronBrain from "../../ReactotronBrain"
import config, { getConfiguredMcpPort, getConfiguredServerPort } from "../../config"

import AppPreferencesContext from "../AppPreferences"
import useStandalone, { Connection, ReactotronConnection, ServerStatus } from "./useStandalone"

export type McpStatus = "stopped" | "started" | "error"

const PORT_RECOVERY_RELOADS_KEY = "reactotronPortRecoveryReloads"

const desktopMcpHost: ReactotronDesktopHost = {
  listIOSSimulators: () => ipcRenderer.invoke("list-ios-simulator-surfaces"),
  listIOSSimulatorCreationOptions: () => ipcRenderer.invoke("list-ios-simulator-creation-options"),
  openIOSSimulator: (udid) => ipcRenderer.invoke("start-ios-simulator-surface", udid),
  createIOSSimulator: (deviceTypeIdentifier) =>
    ipcRenderer.invoke("create-ios-simulator-surface", deviceTypeIdentifier),
  reconnectIOSSimulator: (udid) => ipcRenderer.invoke("reconnect-ios-simulator-surface", udid),
  shutdownIOSSimulator: (udid) => ipcRenderer.invoke("shutdown-ios-simulator-surface", udid),
  controlIOSSimulator: (udid, command) =>
    ipcRenderer.invoke("ios-simulator-surface-command", udid, command),
  reloadIOSSimulator: () => ipcRenderer.invoke("reload-ios-simulator"),
  toggleIOSSimulatorAppearance: (udid) =>
    ipcRenderer.invoke("toggle-ios-simulator-appearance", udid),
  captureIOSSimulatorScreenshot: (udid) =>
    ipcRenderer.invoke("capture-ios-simulator-screenshot", udid),
}

// Same simctl/adb tools the headless CLI server exposes, so agents get one tool set either way.
const deviceMcpHost = createNodeDeviceHost()

type ReactotronGlobal = typeof globalThis & {
  __REACTOTRON_DESKTOP_SERVER__?: Server
}

function readRedactionConfig(): McpRedactionServerConfig {
  return {
    defaults: {
      sensitiveKeys: config.get("mcpRedactionSensitiveKeys") as string[],
      statePathPatterns: config.get("mcpRedactionStatePathPatterns") as string[],
      valuePatterns: config.get("mcpRedactionValuePatterns") as string[],
    },
    allowClientDisable: config.get("mcpAllowClientDisable") as boolean,
    allowClientRemoveRules: config.get("mcpAllowClientRemoveRules") as boolean,
  }
}

// TODO: Move up to better places like core somewhere!
interface Context {
  serverStatus: ServerStatus
  connections: Connection[]
  selectedConnection: Connection
  selectConnection: (clientId: string) => void
  refreshConnections: () => void
  restartServer: () => void
  mcpStatus: McpStatus
  mcpPort: number | null
  toggleMcp: () => void
  mcpRedactionEnforced: boolean
  openMcpSettings: () => void
  closeMcpSettings: () => void
  mcpSettingsOpen: boolean
  updateMcpRedactionConfig: (cfg: Partial<McpRedactionServerConfig>) => void
  mcpRedactionConfig: McpRedactionServerConfig
}

const StandaloneContext = React.createContext<Context>({
  serverStatus: "stopped",
  connections: [],
  selectedConnection: null,
  selectConnection: null,
  refreshConnections: () => {},
  restartServer: () => {},
  mcpStatus: "stopped",
  mcpPort: null,
  toggleMcp: () => {},
  mcpRedactionEnforced: true,
  openMcpSettings: () => {},
  closeMcpSettings: () => {},
  mcpSettingsOpen: false,
  updateMcpRedactionConfig: () => {},
  mcpRedactionConfig: readRedactionConfig(),
})

const Provider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const reactotronServer = useRef<Server>(null)
  const portRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { maxCommands } = useContext(AppPreferencesContext)

  const {
    serverStatus,
    connections,
    selectedClientId,
    selectedConnection,
    selectConnection,
    clearSelectedConnectionCommands,
    serverStarted,
    serverStopped,
    connectionEstablished,
    commandReceived,
    connectionDisconnected,
    syncConnections,
    addCommandListener,
    portUnavailable,
  } = useStandalone({ maxCommands })

  const refreshConnections = useCallback(() => {
    if (!reactotronServer.current) return

    syncConnections(
      (reactotronServer.current.connections as ReactotronConnection[]).map((connection) => ({
        ...connection,
      }))
    )
  }, [syncConnections])

  const attachServerEventHandlers = useCallback(
    (server: Server) => {
      server.on("start", () => {
        console.log(`[Reactotron Desktop] Server started on port ${getConfiguredServerPort()}.`)
        serverStarted()
      })
      server.on("stop", () => {
        console.log("[Reactotron Desktop] Server stopped.")
        serverStopped()
      })
      server.on("connectionEstablished", (connection) => {
        console.log("[Reactotron Desktop] Connection established.", connection)
        connectionEstablished(connection)
      })
      server.on("command", commandReceived)
      server.on("disconnect", (connection) => {
        console.log("[Reactotron Desktop] Connection disconnected.", connection)
        connectionDisconnected(connection)
      })
      server.on("portUnavailable", (port) => {
        console.warn(`[Reactotron Desktop] Port ${port} unavailable.`)
        portUnavailable()
      })
    },
    [
      serverStarted,
      serverStopped,
      connectionEstablished,
      commandReceived,
      connectionDisconnected,
      portUnavailable,
    ]
  )

  const startReactotronServer = useCallback(() => {
    const globalServer = (globalThis as ReactotronGlobal).__REACTOTRON_DESKTOP_SERVER__
    if (globalServer && globalServer !== reactotronServer.current) {
      try {
        globalServer.stop()
      } catch (error) {
        console.warn("Unable to stop previous Reactotron server before start", error)
      }
    }

    const server = createServer({ port: getConfiguredServerPort() })
    attachServerEventHandlers(server)
    reactotronServer.current = server
    ;(globalThis as ReactotronGlobal).__REACTOTRON_DESKTOP_SERVER__ = server

    console.log(`[Reactotron Desktop] Starting server on port ${getConfiguredServerPort()}.`)
    server.start()

    return server
  }, [attachServerEventHandlers])

  useEffect(() => {
    const timer = setInterval(refreshConnections, 5000)
    return () => clearInterval(timer)
  }, [refreshConnections])

  const restartServer = useCallback(() => {
    if (restartTimer.current) {
      clearTimeout(restartTimer.current)
    }

    if (reactotronServer.current) {
      try {
        reactotronServer.current.stop()
      } catch (error) {
        console.warn("Unable to stop Reactotron server before restart", error)
      }
      reactotronServer.current = null
    }

    restartTimer.current = setTimeout(() => {
      startReactotronServer()
      restartTimer.current = null
    }, 250)
  }, [startReactotronServer])

  useEffect(() => {
    startReactotronServer()

    return () => {
      if (restartTimer.current) {
        clearTimeout(restartTimer.current)
      }
      if (portRetryTimer.current) {
        clearTimeout(portRetryTimer.current)
      }
      try {
        reactotronServer.current?.stop()
      } catch (error) {
        console.warn("Unable to stop Reactotron server during cleanup", error)
      }
      if (
        (globalThis as ReactotronGlobal).__REACTOTRON_DESKTOP_SERVER__ === reactotronServer.current
      ) {
        delete (globalThis as ReactotronGlobal).__REACTOTRON_DESKTOP_SERVER__
      }
      reactotronServer.current = null
    }
  }, [startReactotronServer])

  useEffect(() => {
    if (serverStatus === "started") {
      sessionStorage.removeItem(PORT_RECOVERY_RELOADS_KEY)
    }
  }, [serverStatus])

  useEffect(() => {
    if (serverStatus !== "portUnavailable") return undefined

    portRetryTimer.current = setTimeout(() => {
      restartServer()
      portRetryTimer.current = null
    }, 1000)

    const portRecoveryReloadTimer = setTimeout(() => {
      const reloads = Number(sessionStorage.getItem(PORT_RECOVERY_RELOADS_KEY) ?? 0)
      if (reloads > 0) return

      sessionStorage.setItem(PORT_RECOVERY_RELOADS_KEY, String(reloads + 1))
      window.location.reload()
    }, 3000)

    return () => {
      if (portRetryTimer.current) {
        clearTimeout(portRetryTimer.current)
        portRetryTimer.current = null
      }
      clearTimeout(portRecoveryReloadTimer)
    }
  }, [restartServer, serverStatus])

  const mcpServerRef = useRef<ReactotronMcpServer>(null)
  const [mcpStatus, setMcpStatus] = useState<McpStatus>("stopped")
  const [mcpPort, setMcpPort] = useState<number | null>(null)
  const [mcpSettingsOpen, setMcpSettingsOpen] = useState(false)
  const [mcpRedactionConfig, setMcpRedactionConfig] =
    useState<McpRedactionServerConfig>(readRedactionConfig)

  // True unless a connected client has actually opted out via a permission
  // the server is honoring. Toggling permissions alone doesn't flip this.
  const mcpRedactionEnforced = useMemo(() => {
    const { allowClientDisable, allowClientRemoveRules } = mcpRedactionConfig
    if (!allowClientDisable && !allowClientRemoveRules) return true
    return !connections.some((c) => {
      const cfg = (c as unknown as { mcpRedaction?: McpRedactionConfig }).mcpRedaction
      if (!cfg) return false
      if (allowClientDisable && cfg.disableRedaction) return true
      if (allowClientRemoveRules && cfg.removeRules) return true
      return false
    })
  }, [
    connections,
    mcpRedactionConfig.allowClientDisable,
    mcpRedactionConfig.allowClientRemoveRules,
  ])

  const openMcpSettings = useCallback(() => setMcpSettingsOpen(true), [])
  const closeMcpSettings = useCallback(() => setMcpSettingsOpen(false), [])

  const updateMcpRedactionConfig = useCallback((cfg: Partial<McpRedactionServerConfig>) => {
    setMcpRedactionConfig((prev) => {
      const next: McpRedactionServerConfig = {
        ...prev,
        ...cfg,
        defaults: cfg.defaults ? { ...prev.defaults, ...cfg.defaults } : prev.defaults,
      }
      // Persist to electron-store
      config.set("mcpRedactionSensitiveKeys", next.defaults.sensitiveKeys ?? [])
      config.set("mcpRedactionStatePathPatterns", next.defaults.statePathPatterns ?? [])
      config.set("mcpRedactionValuePatterns", next.defaults.valuePatterns ?? [])
      config.set("mcpAllowClientDisable", next.allowClientDisable)
      config.set("mcpAllowClientRemoveRules", next.allowClientRemoveRules)
      // Update running MCP server if active
      if (mcpServerRef.current) {
        mcpServerRef.current.updateRedactionConfig(next)
      }
      return next
    })
  }, [])

  // Clean up MCP server on unmount
  useEffect(() => {
    return () => {
      if (mcpServerRef.current) {
        mcpServerRef.current.stop()
        mcpServerRef.current = null
      }
    }
  }, [])

  const toggleMcp = useCallback(() => {
    if (!reactotronServer.current) return

    if (mcpStatus === "started") {
      if (mcpServerRef.current) {
        mcpServerRef.current.stop()
        mcpServerRef.current = null
      }
      setMcpStatus("stopped")
      setMcpPort(null)
    } else {
      const port = getConfiguredMcpPort()
      const mcp = createMcpServer(
        reactotronServer.current,
        mcpRedactionConfig,
        desktopMcpHost,
        deviceMcpHost
      )
      mcp
        .start(port)
        .then(() => {
          mcpServerRef.current = mcp
          setMcpStatus("started")
          setMcpPort(port)
        })
        .catch(() => {
          setMcpStatus("error")
          setMcpPort(null)
        })
    }
  }, [mcpStatus, mcpRedactionConfig])

  const sendCommand = useCallback(
    (type: string, payload: any, clientId?: string) => {
      // TODO: Do better then just throwing these away...
      if (!reactotronServer.current) return

      reactotronServer.current.send(type, payload, clientId || selectedClientId)
    },
    [reactotronServer, selectedClientId]
  )

  return (
    <StandaloneContext.Provider
      value={{
        serverStatus,
        connections,
        selectedConnection,
        selectConnection,
        refreshConnections,
        restartServer,
        mcpStatus,
        mcpPort,
        toggleMcp,
        mcpRedactionEnforced,
        openMcpSettings,
        closeMcpSettings,
        mcpSettingsOpen,
        updateMcpRedactionConfig,
        mcpRedactionConfig,
      }}
    >
      <ReactotronBrain
        commands={(selectedConnection || { commands: [] }).commands}
        sendCommand={sendCommand}
        clearCommands={clearSelectedConnectionCommands}
        addCommandListener={addCommandListener}
      >
        {children}
      </ReactotronBrain>
    </StandaloneContext.Provider>
  )
}

export default StandaloneContext
export const StandaloneProvider = Provider
