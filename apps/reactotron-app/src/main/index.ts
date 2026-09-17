import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Notification,
  shell,
  systemPreferences,
} from "electron"
import { execFile } from "child_process"
import path from "path"
import { format as formatUrl } from "url"
import log from "electron-log"
import Store from "electron-store"
import { autoUpdater } from "electron-updater"
import windowStateKeeper from "electron-window-state"

import { isIOSSimulatorSupported } from "../platform"
import createMenu from "./menu"
import { killOrphanedServeSimProcesses } from "./serve-sim-cleanup"
import {
  setupAndroidDeviceIPCCommands,
  setupSimulatorIPCCommands,
  stopIOSSimulatorSurfaces,
} from "./utils"

const isDevelopment = process.env.NODE_ENV !== "production"
const isDevApp = process.env.REACTOTRON_DEV_APP === "1"
const isMacOS = isIOSSimulatorSupported(process.platform)
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
  private manualCheck = false
  private restartPromptOpen = false

  constructor(private readonly window: BrowserWindow) {
    log.transports.file.level = "debug"
    autoUpdater.logger = log
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on("download-progress", ({ percent }) => {
      if (!this.window.isDestroyed()) this.window.setProgressBar(percent / 100)
    })
    autoUpdater.on("update-available", ({ version }) => {
      if (Notification.isSupported()) {
        new Notification({
          title: `Reactotron ${version} is available`,
          body: "Downloading in the background. Reactotron will let you know when it is ready.",
        }).show()
      }
      this.manualCheck = false
    })
    autoUpdater.on("update-not-available", () => {
      if (!this.manualCheck || this.window.isDestroyed()) return
      this.manualCheck = false
      dialog.showMessageBox(this.window, {
        type: "info",
        title: "Reactotron is up to date",
        message: `You are using the latest version of Reactotron (${app.getVersion()}).`,
        buttons: ["OK"],
      })
    })
    autoUpdater.on("update-downloaded", ({ version }) => {
      if (!this.window.isDestroyed()) this.window.setProgressBar(-1)
      if (this.restartPromptOpen || this.window.isDestroyed()) return
      this.restartPromptOpen = true
      dialog
        .showMessageBox(this.window, {
          type: "info",
          title: "Update ready",
          message: `Reactotron ${version} is ready to install.`,
          detail:
            "Restart now to finish the update, or choose Later to install when Reactotron quits.",
          buttons: ["Restart Now", "Later"],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
        })
        .then(({ response }) => {
          this.restartPromptOpen = false
          if (response === 0) autoUpdater.quitAndInstall(false, true)
        })
    })
    autoUpdater.on("error", (error) => {
      if (!this.window.isDestroyed()) this.window.setProgressBar(-1)
      log.error("Reactotron update failed", error)
    })
  }

  checkForUpdates(manual = false) {
    this.manualCheck = manual
    autoUpdater.checkForUpdates().catch((error) => {
      if (!manual || this.window.isDestroyed()) return
      this.manualCheck = false
      dialog.showMessageBox(this.window, {
        type: "error",
        title: "Could not check for updates",
        message: "Reactotron could not reach the update server.",
        detail: error instanceof Error ? error.message : String(error),
        buttons: ["OK"],
      })
    })
  }
}

function getXcodeMajorVersion(): Promise<number | null> {
  return new Promise((resolve) => {
    execFile("/usr/bin/xcodebuild", ["-version"], (error, stdout) => {
      if (error) return resolve(null)
      const match = stdout.match(/^Xcode\s+(\d+)/m)
      resolve(match ? Number(match[1]) : null)
    })
  })
}

ipcMain.handle("ios-simulator-keyboard-access", async (_event, prompt = false) => {
  if (!isMacOS) return { required: false, trusted: true, xcodeMajorVersion: null }
  const xcodeMajorVersion = await getXcodeMajorVersion()
  const required = xcodeMajorVersion !== null && xcodeMajorVersion >= 27
  const trusted = required ? systemPreferences.isTrustedAccessibilityClient(Boolean(prompt)) : true
  return { required, trusted, xcodeMajorVersion }
})

ipcMain.handle("open-ios-simulator-keyboard-settings", async () => {
  await shell.openExternal(
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
  )
  return { ok: true }
})

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

  const appUpdater = isDevelopment ? null : new AppUpdater(window)
  createMenu(window, isDevelopment, appUpdater ? () => appUpdater.checkForUpdates(true) : undefined)
  appUpdater?.checkForUpdates()

  return window
}

// quit application when all windows are closed
app.on("window-all-closed", app.quit)

if (isMacOS) app.on("before-quit", stopIOSSimulatorSurfaces)

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
    if (isMacOS) killOrphanedServeSimProcesses()

    mainWindow = createMainWindow()

    // Sets up the electron IPC commands for android functionality on the Help screen.
    setupAndroidDeviceIPCCommands(mainWindow)
    setupSimulatorIPCCommands(mainWindow)
  })
}
