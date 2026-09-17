import { app, BrowserWindow, ipcMain } from "electron"
import path from "path"
import { format as formatUrl } from "url"
import log from "electron-log"
import Store from "electron-store"
import { autoUpdater } from "electron-updater"
import windowStateKeeper from "electron-window-state"

import createMenu from "./menu"
import { killOrphanedServeSimProcesses } from "./serve-sim-cleanup"
import {
  setupAndroidDeviceIPCCommands,
  setupSimulatorIPCCommands,
  stopIOSSimulatorSurfaces,
} from "./utils"

const isDevelopment = process.env.NODE_ENV !== "production"
const isDevApp = process.env.REACTOTRON_DEV_APP === "1"
const appName = isDevApp ? "Reactotron Dev" : "Reactotron"

Store.initRenderer()

if (isDevApp) {
  app.setName(appName)
  app.setPath("userData", path.join(app.getPath("appData"), appName))
}

ipcMain.on("get-runtime-config", (event) => {
  const defaultServerPort = Number(process.env.REACTOTRON_SERVER_PORT ?? (isDevApp ? 9091 : 9090))
  const defaultMcpPort = Number(process.env.REACTOTRON_MCP_PORT ?? (isDevApp ? 4568 : 4567))

  event.returnValue = {
    isDevApp,
    defaultServerPort,
    defaultMcpPort,
  }
})

class AppUpdater {
  constructor() {
    log.transports.file.level = "debug"
    autoUpdater.logger = log
    autoUpdater.checkForUpdatesAndNotify()
  }
}

let mainWindow: BrowserWindow | null

function createMainWindow() {
  const mainWindowState = windowStateKeeper({
    file: isDevApp ? "reactotron-dev-window-state.json" : "reactotron-window-state.json",
    defaultWidth: 650,
    defaultHeight: 800,
  })

  const window = new BrowserWindow({
    title: appName,
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    minWidth: 800,
    minHeight: 700,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webgl: false, // Disable webGL for performance reasons
      spellcheck: false, // Disable spellcheck for performance reasons
    },
    show: false, // We don't show immediately to avoid flickering while the web content is loading.
  })

  // Shows the main window once the web content is loaded.
  window.once("ready-to-show", () => {
    window.show()

    if (isDevelopment) {
      window.webContents.openDevTools()
    }
  })

  window.setBackgroundColor("#1a1b26") // see @hurajgor/reactotron-core-ui for background color

  mainWindowState.manage(window)

  if (isDevelopment) {
    window.loadURL(`http://localhost:${process.env.ELECTRON_WEBPACK_WDS_PORT}`)
  } else {
    window.loadURL(
      formatUrl({
        pathname: path.join(__dirname, "index.html"),
        protocol: "file",
        slashes: true,
      })
    )
  }

  window.on("closed", () => {
    mainWindow = null
  })

  window.webContents.on("devtools-opened", () => {
    window.focus()
    setImmediate(() => {
      window.focus()
    })
  })

  window.webContents.on("render-process-gone", (_event, details) => {
    if (window.isDestroyed() || details.reason === "clean-exit") return
    log.error(`Renderer exited (${details.reason}); reloading the window.`)
    window.webContents.reload()
  })

  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !input.meta) return

    const key = input.key.toLowerCase()
    const shortcut =
      input.shift && key === "a"
        ? "appearance"
        : key === "s"
          ? "screenshot"
          : key === "r"
            ? "record"
            : null
    if (!shortcut) return

    event.preventDefault()
    window.webContents.send("ios-simulator-shortcut", shortcut)
  })

  createMenu(window, isDevelopment)

  new AppUpdater() // eslint-disable-line no-new

  return window
}

// quit application when all windows are closed
app.on("window-all-closed", app.quit)

app.on("before-quit", stopIOSSimulatorSurfaces)

app.on("activate", () => {
  // on macOS it is common to re-create a window even after all windows have been closed
  if (mainWindow === null) {
    mainWindow = createMainWindow()
  }
})

// A second copy would bind its own simulator preview servers and race the first
// one for ports, so hand focus back to the window that is already open. The dev
// app sets its own name above and therefore takes a separate lock, which keeps
// it usable alongside an installed Reactotron.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  // create main BrowserWindow when electron is ready
  app.on("ready", () => {
    // Runs before any surface starts so a stranded server from a previous run
    // cannot keep holding the port this one is about to ask for.
    killOrphanedServeSimProcesses()

    mainWindow = createMainWindow()

    // Sets up the electron IPC commands for android functionality on the Help screen.
    setupAndroidDeviceIPCCommands(mainWindow)
    setupSimulatorIPCCommands(mainWindow)
  })
}
