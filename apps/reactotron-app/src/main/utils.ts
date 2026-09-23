import childProcess from "child_process"
import fs from "fs"
import http from "http"
import net from "net"
import path from "path"
import { isIOSSimulatorSupported } from "../platform"
import { getAdbPath } from "./adb-path"
import { startAndroidScrcpyStream, type AndroidScrcpyStream } from "./android-scrcpy"
import {
  app,
  type BrowserWindow,
  BrowserWindow as ElectronBrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
} from "electron"

type IOSSimulator = {
  name: string
  state: string
  udid: string
  runtime: string
}

type IOSSimulatorCreationOption = {
  deviceTypeIdentifier: string
  name: string
  runtimeIdentifier: string
  runtimeName: string
}

type AndroidDevice = {
  id: string
  model: string
  type: "emulator" | "physical"
}

const serveSimProcesses = new Map<
  string,
  { process: childProcess.ChildProcess; previewUrl: string }
>()
const simulatorRecordings = new Map<
  string,
  { filePath: string; process: childProcess.ChildProcess }
>()
const androidRecordings = new Map<
  string,
  { remotePath: string; process: childProcess.ChildProcess }
>()
const serveSimStarts = new Map<
  string,
  Promise<{ previewUrl: string; streamUrl: string; wsUrl: string }>
>()
let simulatorSurfaceWindow: BrowserWindow | null = null
const iosSimulatorUdid = /^[A-Fa-f0-9-]{36}$/
const SERVE_SIM_PORT_ATTEMPTS = 5
const SERVE_SIM_EXIT_TIMEOUT = 3000
const SERVE_SIM_FORCE_KILL_TIMEOUT = 500
const androidVideoStreams = new Map<string, AndroidScrcpyStream>()

function runCommand(
  command: string,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = childProcess.spawn(command, args, { shell: false, env: options?.env })
    let output = ""
    let errorOutput = ""

    process.stdout.on("data", (data) => {
      output += data.toString()
    })
    process.stderr.on("data", (data) => {
      errorOutput += data.toString()
    })
    process.on("error", reject)
    process.on("close", (code) => {
      if (code === 0) {
        resolve(output)
        return
      }

      reject(new Error(errorOutput || output || `${command} exited with code ${code}.`))
    })
  })
}

function assertAndroidDeviceId(deviceId: unknown): asserts deviceId is string {
  if (typeof deviceId !== "string" || !/^[A-Za-z0-9._:-]+$/.test(deviceId)) {
    throw new Error("Invalid Android device identifier.")
  }
}

async function getAndroidDevices(): Promise<AndroidDevice[]> {
  const output = await runCommand(getAdbPath(), ["devices", "-l"])
  return output
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id, state, ...details] = line.split(/\s+/)
      const model = details
        .find((detail) => detail.startsWith("model:"))
        ?.replace("model:", "")
        .replace(/_/g, " ")
      return { id, state, model: model || id }
    })
    .filter((device) => device.state === "device")
    .map(({ id, model }) => ({
      id,
      model,
      type: id.startsWith("emulator-") ? "emulator" : "physical",
    }))
}

async function captureAndroidDeviceScreenshotPng(deviceId: string): Promise<Buffer> {
  assertAndroidDeviceId(deviceId)
  return new Promise<Buffer>((resolve, reject) => {
    const process = childProcess.spawn(
      getAdbPath(),
      ["-s", deviceId, "exec-out", "screencap", "-p"],
      {
        shell: false,
      }
    )
    const image: Buffer[] = []
    let errorOutput = ""
    process.stdout.on("data", (chunk) => image.push(Buffer.from(chunk)))
    process.stderr.on("data", (chunk) => {
      errorOutput += chunk.toString()
    })
    process.on("error", reject)
    process.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(errorOutput || `adb screencap exited with code ${code}.`))
        return
      }
      resolve(Buffer.concat(image))
    })
  })
}

async function captureAndroidDeviceScreenshot(deviceId: string) {
  const screenshot = nativeImage.createFromBuffer(await captureAndroidDeviceScreenshotPng(deviceId))
  return screenshot.resize({ width: 480 }).toPNG().toString("base64")
}

async function runAndroidDeviceCommand(
  deviceId: string,
  command: "home" | "back" | "recents" | "reload" | "reverse" | "tap" | "swipe" | "rotate" | "type",
  x?: number,
  y?: number,
  reactotronPort?: number,
  endX?: number,
  endY?: number,
  text?: string
) {
  assertAndroidDeviceId(deviceId)
  if (command === "home")
    return runCommand(getAdbPath(), ["-s", deviceId, "shell", "input", "keyevent", "3"])
  if (command === "back")
    return runCommand(getAdbPath(), ["-s", deviceId, "shell", "input", "keyevent", "4"])
  if (command === "recents")
    return runCommand(getAdbPath(), ["-s", deviceId, "shell", "input", "keyevent", "187"])
  if (command === "reload")
    return runCommand(getAdbPath(), ["-s", deviceId, "shell", "input", "text", "RR"])
  if (command === "reverse") {
    if (!Number.isInteger(reactotronPort) || !reactotronPort || reactotronPort > 65535) {
      throw new Error("Invalid Reactotron server port.")
    }
    return runCommand(getAdbPath(), [
      "-s",
      deviceId,
      "reverse",
      `tcp:${reactotronPort}`,
      `tcp:${reactotronPort}`,
    ])
  }
  if (command === "rotate") {
    const currentRotation = (
      await runCommand(getAdbPath(), [
        "-s",
        deviceId,
        "shell",
        "settings",
        "get",
        "system",
        "user_rotation",
      ])
    ).trim()
    await runCommand(getAdbPath(), [
      "-s",
      deviceId,
      "shell",
      "settings",
      "put",
      "system",
      "accelerometer_rotation",
      "0",
    ])
    return runCommand(getAdbPath(), [
      "-s",
      deviceId,
      "shell",
      "settings",
      "put",
      "system",
      "user_rotation",
      currentRotation === "0" ? "1" : "0",
    ])
  }
  if (command === "type") {
    if (typeof text !== "string" || !/^[\x20-\x7e]{1,1000}$/.test(text)) {
      throw new Error("Android keyboard input must be printable ASCII text.")
    }
    return runCommand(getAdbPath(), [
      "-s",
      deviceId,
      "shell",
      "input",
      "text",
      text.replace(/ /g, "%s"),
    ])
  }
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x! < 0 ||
    x! > 1 ||
    y! < 0 ||
    y! > 1 ||
    (command === "swipe" &&
      (!Number.isFinite(endX) ||
        !Number.isFinite(endY) ||
        endX! < 0 ||
        endX! > 1 ||
        endY! < 0 ||
        endY! > 1))
  ) {
    throw new Error("Invalid Android gesture coordinates.")
  }
  const size = await runCommand(getAdbPath(), ["-s", deviceId, "shell", "wm", "size"])
  const match = size.match(/(?:Physical size|Override size):\s*(\d+)x(\d+)/)
  if (!match) throw new Error("Could not determine Android device screen size.")
  const width = Number(match[1])
  const height = Number(match[2])
  const startX = Math.round(x! * (width - 1))
  const startY = Math.round(y! * (height - 1))
  if (command === "swipe") {
    return runCommand(getAdbPath(), [
      "-s",
      deviceId,
      "shell",
      "input",
      "swipe",
      String(startX),
      String(startY),
      String(Math.round(endX! * (width - 1))),
      String(Math.round(endY! * (height - 1))),
      "250",
    ])
  }
  return runCommand(getAdbPath(), [
    "-s",
    deviceId,
    "shell",
    "input",
    "tap",
    String(startX),
    String(startY),
  ])
}

function getServeSimCliPath(): string {
  const cliPath = path.join("node_modules", "serve-sim", "dist", "serve-sim.js")
  const candidates = new Set([
    path.join(process.resourcesPath, "app.asar.unpacked", cliPath),
    path.join(process.resourcesPath, "app", cliPath),
  ])

  for (const startDirectory of [process.cwd(), app.getAppPath(), __dirname]) {
    let directory = startDirectory
    let parentDirectory = path.dirname(directory)
    while (directory !== parentDirectory) {
      candidates.add(path.join(directory, cliPath))
      directory = parentDirectory
      parentDirectory = path.dirname(directory)
    }
  }

  const pathToCli = Array.from(candidates).find((candidate) => fs.existsSync(candidate))

  if (!pathToCli) {
    throw new Error("serve-sim is not installed. Reinstall Reactotron and try again.")
  }

  return pathToCli
}

/**
 * Resolve the Node runtime used to launch the bundled serve-sim CLI.
 *
 * When Reactotron is opened from Finder/Dock the process inherits a minimal
 * PATH that usually does not include a user-installed Node (nvm, Homebrew),
 * so spawning a bare "node" fails with ENOENT. Electron ships its own Node,
 * so by default we re-invoke our own executable with ELECTRON_RUN_AS_NODE=1.
 * Electron's Node 18 runtime does not expose the WebSocket global that
 * serve-sim's control commands require, so the bootstrap supplies it from the
 * bundled `ws` dependency. REACTOTRON_NODE_PATH still overrides this for
 * anyone who needs a specific runtime.
 */
function getServeSimRunner(args: string[]): {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
} {
  const cliPath = getServeSimCliPath()
  const overridePath = process.env.REACTOTRON_NODE_PATH

  if (overridePath) {
    return { command: overridePath, args: [cliPath, ...args], env: process.env }
  }

  return {
    command: process.execPath,
    args: [
      "-e",
      "globalThis.WebSocket ??= require(require('node:path').join(require('node:path').dirname(process.argv[1]), '..', 'node_modules', 'ws')).WebSocket; import(require('node:url').pathToFileURL(process.argv[1]).href)",
      cliPath,
      ...args,
    ],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  }
}

const DEVICE_HUB_INPUT_STATE = "com.apple.coredevice.dtuhidd.active"

async function repairIOSSimulatorInput(udid: string): Promise<string> {
  const simulatorCommand = ["simctl", "spawn", udid]
  const state = await runCommand("xcrun", [
    ...simulatorCommand,
    "notifyutil",
    "-g",
    DEVICE_HUB_INPUT_STATE,
  ])

  if (state.trim() !== `${DEVICE_HUB_INPUT_STATE} 1`) {
    return "Input is not shadowed by Device Hub; no restart was needed."
  }

  await runCommand("xcrun", [...simulatorCommand, "notifyutil", "-s", DEVICE_HUB_INPUT_STATE, "0"])
  await runCommand("xcrun", [
    ...simulatorCommand,
    "launchctl",
    "kickstart",
    "-k",
    "system/com.apple.backboardd",
  ])
  return "Input repaired. Reopen your app, then try typing."
}

function getAvailablePort(startingPort = 3200): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (port: number) => {
      const server = net.createServer()
      server.once("error", () => {
        if (port >= startingPort + 49) {
          reject(new Error("No available local port for the simulator preview."))
          return
        }
        tryPort(port + 1)
      })
      server.once("listening", () => {
        server.close(() => resolve(port))
      })
      server.listen(port, "127.0.0.1")
    }

    tryPort(startingPort)
  })
}

/**
 * Find a port for a new serve-sim process.
 *
 * Probing can only report that a port was free a moment ago: the probe socket
 * has to close before serve-sim can bind, and the previous process for this
 * surface may still be releasing the same port. Ports already handed to a live
 * serve-sim are skipped so that two surfaces starting at once cannot both be
 * told to use the lowest free port, and the caller retries when serve-sim
 * reports the port taken anyway.
 */
async function getServeSimPort(): Promise<number> {
  const portsInUse = new Set<number>()
  serveSimProcesses.forEach(({ previewUrl, process: serveSimProcess }) => {
    if (serveSimProcess.exitCode !== null) return
    const assignedPort = Number(new URL(previewUrl).port)
    if (Number.isInteger(assignedPort)) portsInUse.add(assignedPort)
  })

  let candidate = await getAvailablePort()
  while (portsInUse.has(candidate)) {
    candidate = await getAvailablePort(candidate + 1)
  }

  return candidate
}

async function captureIOSSimulatorScreenshot(udid: string) {
  assertIOSSimulatorUdid(udid)
  const directory = path.join(app.getPath("temp"), "reactotron", "simulator-screenshots")
  await fs.promises.mkdir(directory, { recursive: true })
  const filePath = path.join(directory, `simulator-${udid}-${Date.now()}.png`)
  await runCommand("xcrun", ["simctl", "io", udid, "screenshot", filePath])
  return filePath
}

async function getAvailableIOSSimulators(): Promise<IOSSimulator[]> {
  const output = await runCommand("xcrun", ["simctl", "list", "devices", "--json"])
  const devices = JSON.parse(output).devices as Record<string, Array<Record<string, unknown>>>

  return Object.entries(devices)
    .filter(([runtime]) => runtime.includes("SimRuntime.iOS"))
    .flatMap(([runtime, runtimeDevices]) =>
      runtimeDevices
        .filter((device) => device.isAvailable !== false)
        .map((device) => ({
          name: String(device.name),
          state: String(device.state),
          udid: String(device.udid),
          runtime: runtime.replace("com.apple.CoreSimulator.SimRuntime.", ""),
        }))
    )
}

async function bootIOSSimulator(udid: string): Promise<IOSSimulator> {
  const simulators = await getAvailableIOSSimulators()
  const simulator = simulators.find((item) => item.udid === udid)
  if (!simulator) throw new Error("That iOS simulator is no longer available.")

  if (simulator.state !== "Booted") {
    await runCommand("xcrun", ["simctl", "boot", udid])
    await runCommand("xcrun", ["simctl", "bootstatus", udid, "-b"])
  }

  return { ...simulator, state: "Booted" }
}

async function getIOSSimulatorCreationOptions(): Promise<IOSSimulatorCreationOption[]> {
  const output = await runCommand("xcrun", ["simctl", "list", "runtimes", "--json"])
  const runtimes = JSON.parse(output).runtimes as Array<Record<string, unknown>>
  const [runtime] = runtimes
    .filter(
      (item) =>
        item.platform === "iOS" &&
        item.isAvailable === true &&
        Array.isArray(item.supportedDeviceTypes)
    )
    .sort((left, right) =>
      String(right.version).localeCompare(String(left.version), undefined, { numeric: true })
    )

  if (!runtime) throw new Error("No available iOS Simulator runtime is installed.")

  return (runtime.supportedDeviceTypes as Array<Record<string, unknown>>)
    .filter((deviceType) => deviceType.productFamily === "iPhone")
    .map((deviceType) => ({
      deviceTypeIdentifier: String(deviceType.identifier),
      name: String(deviceType.name),
      runtimeIdentifier: String(runtime.identifier),
      runtimeName: String(runtime.name),
    }))
}

function startServeSim(
  udid: string
): Promise<{ previewUrl: string; streamUrl: string; wsUrl: string }> {
  // Opening a surface and reconnecting it can both be in flight at once, and a
  // process is only registered after it reports a successful start. Two callers
  // arriving before that point would each see no server and spawn their own,
  // leaving a pair of them fighting over the same port while the renderer
  // watches the connection reset. Sharing the in-flight start keeps one server
  // per surface.
  const pending = serveSimStarts.get(udid)
  if (pending) return pending

  const start = startServeSimUnguarded(udid).finally(() => {
    if (serveSimStarts.get(udid) === start) serveSimStarts.delete(udid)
  })
  serveSimStarts.set(udid, start)
  return start
}

/**
 * Bring a surface back after its server exited on its own, and tell the
 * renderer which address to use now.
 */
function restartServeSimForSurface(udid: string): void {
  startServeSim(udid)
    .then((surface) => {
      const target = simulatorSurfaceWindow
      if (!target || target.isDestroyed()) return
      console.log(`[Reactotron Desktop] simulator preview moved to ${surface.previewUrl}.`)
      target.webContents.send("ios-simulator-surface-moved", { udid, ...surface })
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      console.log(`[Reactotron Desktop] could not restart the simulator preview. ${message}`)
    })
}

/**
 * Replace the server behind a surface, sharing the guard with `startServeSim`
 * so the teardown and the spawn cannot be interleaved with another start.
 */
function restartServeSim(
  udid: string
): Promise<{ previewUrl: string; streamUrl: string; wsUrl: string }> {
  const restart = stopServeSim(udid)
    .then(() => {
      // stopServeSim clears the guard, so claim it again for the spawn that
      // follows rather than leaving a window with no entry set.
      serveSimStarts.set(udid, restart)
      return startServeSimUnguarded(udid)
    })
    .finally(() => {
      if (serveSimStarts.get(udid) === restart) serveSimStarts.delete(udid)
    })
  serveSimStarts.set(udid, restart)
  return restart
}

async function startServeSimUnguarded(
  udid: string
): Promise<{ previewUrl: string; streamUrl: string; wsUrl: string }> {
  const existingSurface = serveSimProcesses.get(udid)
  if (existingSurface && existingSurface.process.exitCode === null) {
    const previewUrl = existingSurface.previewUrl
    return {
      previewUrl,
      streamUrl: `${previewUrl.replace(/\?.*$/, "")}/helper/${udid}/stream.mjpeg`,
      wsUrl: `ws://127.0.0.1:${new URL(previewUrl).port}/helper/${udid}/ws`,
    }
  }

  // A port that probed as free can still be taken by the time serve-sim binds,
  // most often by the process this surface just replaced. Losing that race used
  // to surface a preview URL for a server that never started, so retry on the
  // next port rather than handing the renderer somewhere to fail.
  let lastError: Error | undefined
  for (let attempt = 0; attempt < SERVE_SIM_PORT_ATTEMPTS; attempt += 1) {
    try {
      return await spawnServeSim(udid)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      console.log(
        `[Reactotron Desktop] serve-sim attempt ${attempt + 1} failed: ${lastError.message}`
      )
      if (!/already in use/i.test(lastError.message)) throw lastError
    }
  }

  throw lastError ?? new Error("Could not start the simulator preview.")
}

async function spawnServeSim(
  udid: string
): Promise<{ previewUrl: string; streamUrl: string; wsUrl: string }> {
  const port = await getServeSimPort()
  const previewUrl = `http://127.0.0.1:${port}?device=${udid}&session=${Date.now()}`
  const runner = getServeSimRunner(["--port", String(port), "--codec", "auto", udid])
  const serveSimProcess = childProcess.spawn(runner.command, runner.args, {
    shell: false,
    env: runner.env,
  })

  return new Promise((resolve, reject) => {
    let output = ""
    let settled = false
    const timeout = setTimeout(() => {
      finish(new Error("Timed out waiting for serve-sim to start."))
    }, 20000)

    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (error) {
        // A half-started serve-sim has been seen ignoring SIGTERM and staying
        // attached to the simulator, which starves the attempt that replaces
        // it, so make sure this one cannot survive its own failure.
        serveSimProcess.kill()
        setTimeout(() => {
          if (serveSimProcess.exitCode === null && serveSimProcess.signalCode === null) {
            serveSimProcess.kill("SIGKILL")
          }
        }, SERVE_SIM_EXIT_TIMEOUT).unref()
        reject(error)
      } else {
        serveSimProcesses.set(udid, { process: serveSimProcess, previewUrl })
        resolve({
          previewUrl,
          streamUrl: `http://127.0.0.1:${port}/helper/${udid}/stream.mjpeg`,
          wsUrl: `ws://127.0.0.1:${port}/helper/${udid}/ws`,
        })
      }
    }

    const receiveOutput = (data: Buffer) => {
      const chunk = data.toString()
      output += chunk
      // serve-sim reports its capture and encoder state on stdout. Forwarding it
      // is the only view into why a stream answers with headers and then no
      // frames, which is otherwise invisible from the Reactotron side.
      chunk
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => console.log(`[serve-sim ${port}] ${line}`))
      // serve-sim prints its banner from the requested port before the listen
      // succeeds, so the banner alone does not mean the port was actually
      // claimed. Fail fast when it reports the collision instead.
      if (/already in use/i.test(output)) {
        finish(new Error(`Port ${port} is already in use.`))
        return
      }
      if (output.includes(`http://localhost:${port}`)) finish()
    }

    serveSimProcess.stdout.on("data", receiveOutput)
    serveSimProcess.stderr.on("data", receiveOutput)
    serveSimProcess.on("error", (error) => finish(error))
    serveSimProcess.on("close", (code) => {
      console.log(`[serve-sim ${port}] exited with code ${code}.`)
      const wasCurrent = serveSimProcesses.get(udid)?.process === serveSimProcess
      if (wasCurrent) serveSimProcesses.delete(udid)
      if (!settled) {
        finish(new Error(output || `serve-sim exited with code ${code}.`))
        return
      }

      // serve-sim shuts itself down when its helper child exits, and the
      // replacement rarely reclaims the same port. The renderer is still
      // pointed at the old one, so it would retry a dead address forever
      // unless it is told where the preview moved to.
      if (wasCurrent) restartServeSimForSurface(udid)
    })
  })
}

/**
 * Stop the serve-sim process backing a simulator surface and wait for it to
 * exit.
 *
 * Reconnecting spawns a replacement immediately afterwards, so returning
 * before the old process has released its port leaves the two racing: the
 * orphan keeps serving the port the surface is still pointed at while the
 * replacement binds somewhere else. Escalate to SIGKILL for a process that
 * ignores SIGTERM, which is how these end up running long after the surface
 * that started them has closed.
 */
async function stopServeSim(udid: string): Promise<void> {
  // Drop any shared in-flight start so a reconnect cannot hand back the server
  // being torn down here.
  serveSimStarts.delete(udid)
  const existingSurface = serveSimProcesses.get(udid)
  serveSimProcesses.delete(udid)
  if (!existingSurface) return

  const { process: serveSimProcess } = existingSurface
  if (serveSimProcess.exitCode !== null || serveSimProcess.signalCode !== null) return

  await new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(forceKillTimeout)
      resolve()
    }

    const forceKillTimeout = setTimeout(() => {
      serveSimProcess.kill("SIGKILL")
      // A killed process still has to be reaped before the port is free, so
      // keep waiting for the exit rather than resolving on the signal.
      setTimeout(finish, SERVE_SIM_FORCE_KILL_TIMEOUT)
    }, SERVE_SIM_EXIT_TIMEOUT)

    serveSimProcess.once("exit", finish)
    serveSimProcess.once("error", finish)
    serveSimProcess.kill()
  })
}

function assertIOSSimulatorUdid(udid: unknown): asserts udid is string {
  if (typeof udid !== "string" || !iosSimulatorUdid.test(udid)) {
    throw new Error("Invalid iOS simulator identifier.")
  }
}

function sendServeSimControl(
  udid: string,
  opcode: number,
  message: Record<string, string>,
  requestedWsUrl?: unknown
): Promise<void> {
  const surface = serveSimProcesses.get(udid)
  const wsUrl = typeof requestedWsUrl === "string" ? requestedWsUrl : undefined
  if (!wsUrl && (!surface || surface.process.exitCode !== null)) {
    return Promise.reject(new Error("No simulator preview is running for this device."))
  }

  const controlUrl =
    wsUrl ?? `ws://127.0.0.1:${new URL(surface!.previewUrl).port}/helper/${udid}/ws`
  const url = new URL(controlUrl)
  if (
    url.protocol !== "ws:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.pathname !== `/helper/${udid}/ws`
  ) {
    return Promise.reject(new Error("Invalid simulator preview control address."))
  }
  // serve-sim already provides this dependency; use its control protocol
  // directly so the command and preview always share the same server.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const WebSocket = require("ws") as typeof import("ws")

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(controlUrl)
    let finished = false
    const finish = (error?: Error) => {
      if (finished) return
      finished = true
      socket.close()
      if (error) reject(error)
      else resolve()
    }

    socket.on("open", () => {
      const payload = Buffer.from(JSON.stringify(message))
      socket.send(Buffer.concat([Buffer.from([opcode]), payload]))
      setTimeout(() => finish(), 50)
    })
    socket.on("error", (error) => finish(error))
  })
}

const reloadReactNativeViaMetro = (metroPort: number) =>
  new Promise<string>((resolve, reject) => {
    const request = http.get(
      {
        host: "localhost",
        port: metroPort,
        path: "/reload",
      },
      (response) => {
        let body = ""

        response.setEncoding("utf8")
        response.on("data", (chunk) => {
          body += chunk
        })
        response.on("end", () => {
          if (response.statusCode && response.statusCode >= 400) {
            reject(new Error(`Metro returned ${response.statusCode}: ${body}`))
            return
          }

          resolve(body)
        })
      }
    )

    request.setTimeout(3000, () => {
      request.destroy(new Error(`Metro did not respond on port ${metroPort}.`))
    })
    request.on("error", reject)
  })

export const setupSimulatorIPCCommands = (mainWindow?: BrowserWindow) => {
  ipcMain.handle("android-device-screenshot-action", async (event, deviceId: unknown) => {
    try {
      assertAndroidDeviceId(deviceId)
      const window = ElectronBrowserWindow.fromWebContents(event.sender)
      const choice = await dialog.showMessageBox(window ?? undefined, {
        title: "Android Screenshot",
        message: "What would you like to do with this screenshot?",
        buttons: ["Save to File", "Copy to Clipboard", "Cancel"],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      })
      if (choice.response === 2) return { ok: true, canceled: true }

      const png = await captureAndroidDeviceScreenshotPng(deviceId)
      if (choice.response === 1) {
        clipboard.writeImage(nativeImage.createFromBuffer(png))
        return { ok: true, action: "copied" }
      }
      const save = await dialog.showSaveDialog(window ?? undefined, {
        title: "Save Android Screenshot",
        defaultPath: "android-screenshot.png",
        filters: [{ name: "PNG image", extensions: ["png"] }],
      })
      if (save.canceled || !save.filePath) return { ok: true, canceled: true }
      await fs.promises.writeFile(save.filePath, png)
      return { ok: true, action: "saved", filePath: save.filePath }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle("toggle-android-device-recording", async (event, deviceId: unknown) => {
    try {
      assertAndroidDeviceId(deviceId)
      const activeRecording = androidRecordings.get(deviceId)
      if (activeRecording) {
        if (activeRecording.process.exitCode === null) {
          const finished = new Promise<void>((resolve) =>
            activeRecording.process.once("close", resolve)
          )
          // Stopping the adb client interrupts the transport and leaves a corrupt
          // MP4. Signal screenrecord on the device so it writes its trailer first.
          await runCommand(getAdbPath(), ["-s", deviceId, "shell", "pkill", "-INT", "screenrecord"])
          await finished
        }
        // Keep naturally completed recordings in the registry until the user
        // presses stop, so the finalized MP4 can still be saved.
        androidRecordings.delete(deviceId)
        const directory = path.join(app.getPath("temp"), "reactotron", "android-recordings")
        await fs.promises.mkdir(directory, { recursive: true })
        const temporaryPath = path.join(directory, `android-recording-${Date.now()}.mp4`)
        await runCommand(getAdbPath(), [
          "-s",
          deviceId,
          "pull",
          activeRecording.remotePath,
          temporaryPath,
        ])
        await runCommand(getAdbPath(), [
          "-s",
          deviceId,
          "shell",
          "rm",
          "-f",
          activeRecording.remotePath,
        ])
        const window = ElectronBrowserWindow.fromWebContents(event.sender)
        const save = await dialog.showSaveDialog(window ?? undefined, {
          title: "Save Android Recording",
          defaultPath: "android-recording.mp4",
          filters: [{ name: "MPEG-4 video", extensions: ["mp4"] }],
        })
        if (save.canceled || !save.filePath) {
          await fs.promises.rm(temporaryPath, { force: true })
          return { ok: true, canceled: true, recording: false }
        }
        await fs.promises.copyFile(temporaryPath, save.filePath)
        await fs.promises.rm(temporaryPath, { force: true })
        return { ok: true, recording: false, filePath: save.filePath }
      }

      const remotePath = "/sdcard/reactotron-recording.mp4"
      const recordingProcess = childProcess.spawn(
        getAdbPath(),
        ["-s", deviceId, "shell", "screenrecord", "--bit-rate", "12000000", remotePath],
        { shell: false }
      )
      androidRecordings.set(deviceId, { process: recordingProcess, remotePath })
      recordingProcess.on("error", () => {
        if (androidRecordings.get(deviceId)?.process === recordingProcess) {
          androidRecordings.delete(deviceId)
        }
      })
      return { ok: true, recording: true }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle(
    "start-android-video-stream",
    async (event, deviceId: unknown, streamId: unknown) => {
      try {
        assertAndroidDeviceId(deviceId)
        if (typeof streamId !== "string" || streamId.length > 128) {
          throw new Error("Invalid Android video stream identifier.")
        }
        androidVideoStreams.get(streamId)?.close()
        const stream = await startAndroidScrcpyStream(
          deviceId,
          path.join(app.getPath("userData"), "scrcpy"),
          {
            onMeta: (meta) => {
              if (!event.sender.isDestroyed()) {
                event.sender.send("android-video-stream-meta", { streamId, deviceId, meta })
              }
            },
            onFrame: (frame) => {
              if (!event.sender.isDestroyed()) {
                event.sender.send("android-video-stream-frame", {
                  streamId,
                  deviceId,
                  config: frame.config,
                  keyFrame: frame.keyFrame,
                  data: frame.data,
                })
              }
            },
            onError: (message) => {
              if (!event.sender.isDestroyed()) {
                event.sender.send("android-video-stream-error", { streamId, deviceId, message })
              }
            },
            onClose: () => {
              if (androidVideoStreams.get(streamId) === stream) {
                androidVideoStreams.delete(streamId)
              }
            },
          }
        )
        androidVideoStreams.set(streamId, stream)
        event.sender.once("destroyed", () => stream.close())
        return { ok: true }
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
    }
  )

  ipcMain.handle("stop-android-video-stream", async (_event, streamId: unknown) => {
    if (typeof streamId === "string") {
      androidVideoStreams.get(streamId)?.close()
    }
    return { ok: true }
  })

  ipcMain.handle("list-android-devices", async () => {
    try {
      return { ok: true, devices: await getAndroidDevices() }
    } catch (error) {
      return {
        ok: false,
        devices: [],
        message: error instanceof Error ? error.message : String(error),
      }
    }
  })

  ipcMain.handle("android-device-screenshot", async (_event, deviceId: unknown) => {
    try {
      assertAndroidDeviceId(deviceId)
      return { ok: true, imageBase64: await captureAndroidDeviceScreenshot(deviceId) }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle(
    "android-device-command",
    async (
      _event,
      deviceId: unknown,
      command: unknown,
      options?: {
        x?: unknown
        y?: unknown
        endX?: unknown
        endY?: unknown
        port?: unknown
        text?: unknown
      }
    ) => {
      try {
        assertAndroidDeviceId(deviceId)
        if (
          ![
            "home",
            "back",
            "recents",
            "reload",
            "reverse",
            "tap",
            "swipe",
            "rotate",
            "type",
          ].includes(String(command))
        ) {
          throw new Error("Unsupported Android device command.")
        }
        await runAndroidDeviceCommand(
          deviceId,
          command as
            | "home"
            | "back"
            | "recents"
            | "reload"
            | "reverse"
            | "tap"
            | "swipe"
            | "rotate"
            | "type",
          Number(options?.x),
          Number(options?.y),
          Number(options?.port),
          Number(options?.endX),
          Number(options?.endY),
          typeof options?.text === "string" ? options.text : undefined
        )
        return { ok: true }
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
    }
  )

  if (!isIOSSimulatorSupported(process.platform)) return

  simulatorSurfaceWindow = mainWindow ?? null

  ipcMain.handle("list-booted-ios-simulators", async () => {
    try {
      return { ok: true, simulators: await getAvailableIOSSimulators() }
    } catch (error) {
      return {
        ok: false,
        simulators: [],
        message: error instanceof Error ? error.message : String(error),
      }
    }
  })

  ipcMain.handle("list-ios-simulator-surfaces", async () => {
    try {
      const simulators = await getAvailableIOSSimulators()
      return {
        ok: true,
        simulators: simulators.map((simulator) => ({
          ...simulator,
          streaming: serveSimProcesses.has(simulator.udid),
        })),
      }
    } catch (error) {
      return {
        ok: false,
        simulators: [],
        message: error instanceof Error ? error.message : String(error),
      }
    }
  })

  ipcMain.handle("start-ios-simulator-surface", async (_event, udid: unknown) => {
    try {
      assertIOSSimulatorUdid(udid)
      const simulator = await bootIOSSimulator(udid)
      return { ok: true, simulator, ...(await startServeSim(udid)) }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle("reconnect-ios-simulator-surface", async (_event, udid: unknown) => {
    try {
      assertIOSSimulatorUdid(udid)
      // Stopping and starting has to be a single in-flight operation: clearing
      // the guard first would let a start that arrives in between spawn its own
      // server alongside this one.
      return { ok: true, ...(await restartServeSim(udid)) }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle("repair-ios-simulator-input", async (event, udid: unknown) => {
    try {
      assertIOSSimulatorUdid(udid)
      const window = ElectronBrowserWindow.fromWebContents(event.sender)
      const confirmation = await dialog.showMessageBox(window ?? undefined, {
        type: "warning",
        title: "Repair Simulator Input?",
        message: "Repair keyboard and touch input?",
        detail:
          "Xcode Device Hub will restart SpringBoard and close every app currently running in this simulator.",
        buttons: ["Repair Input", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      })
      if (confirmation.response !== 0) return { ok: false, cancelled: true }

      await stopServeSim(udid)
      const message = await repairIOSSimulatorInput(udid)
      return { ok: true, message, ...(await startServeSim(udid)) }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle("close-ios-simulator-surface", async (_event, udid: unknown) => {
    try {
      assertIOSSimulatorUdid(udid)
      await stopServeSim(udid)
      return { ok: true }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle("shutdown-ios-simulator-surface", async (_event, udid: unknown) => {
    try {
      assertIOSSimulatorUdid(udid)
      await stopServeSim(udid)
      await runCommand("xcrun", ["simctl", "shutdown", udid])
      return { ok: true }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle("list-ios-simulator-creation-options", async () => {
    try {
      return { ok: true, options: await getIOSSimulatorCreationOptions() }
    } catch (error) {
      return {
        ok: false,
        options: [],
        message: error instanceof Error ? error.message : String(error),
      }
    }
  })

  ipcMain.handle("create-ios-simulator-surface", async (_event, deviceTypeIdentifier: unknown) => {
    try {
      if (typeof deviceTypeIdentifier !== "string") throw new Error("Invalid iOS simulator type.")
      const options = await getIOSSimulatorCreationOptions()
      const option = options.find((item) => item.deviceTypeIdentifier === deviceTypeIdentifier)
      if (!option) throw new Error("That iOS simulator type is not available.")

      const name = `Reactotron ${option.name} ${new Date().toISOString().replace(/[:.]/g, "-")}`
      const udid = (
        await runCommand("xcrun", [
          "simctl",
          "create",
          name,
          option.deviceTypeIdentifier,
          option.runtimeIdentifier,
        ])
      ).trim()
      assertIOSSimulatorUdid(udid)
      await runCommand("xcrun", ["simctl", "boot", udid])
      await runCommand("xcrun", ["simctl", "bootstatus", udid, "-b"])

      return {
        ok: true,
        simulator: { name, runtime: option.runtimeName, state: "Booted", udid },
        ...(await startServeSim(udid)),
      }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle(
    "ios-simulator-surface-command",
    async (_event, udid: unknown, command: unknown, wsUrl: unknown) => {
      try {
        assertIOSSimulatorUdid(udid)
        if (command === "home") {
          await sendServeSimControl(udid, 4, { button: "home" }, wsUrl)
        } else if (command === "landscape_left" || command === "portrait") {
          await sendServeSimControl(udid, 7, { orientation: command }, wsUrl)
        } else {
          throw new Error("Unsupported iOS simulator command.")
        }
        return { ok: true }
      } catch (error) {
        console.error("iOS simulator surface command failed", error)
        return { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
    }
  )

  ipcMain.handle("save-ios-simulator-screenshot", async (event, udid: unknown) => {
    try {
      assertIOSSimulatorUdid(udid)
      const window = ElectronBrowserWindow.fromWebContents(event.sender)
      const result = await dialog.showSaveDialog(window ?? undefined, {
        title: "Save Simulator Screenshot",
        defaultPath: "simulator-screenshot.png",
        filters: [{ name: "PNG image", extensions: ["png"] }],
      })
      if (result.canceled || !result.filePath) return { ok: true, canceled: true }

      const temporaryScreenshot = await captureIOSSimulatorScreenshot(udid)
      await fs.promises.copyFile(temporaryScreenshot, result.filePath)
      return { ok: true, filePath: result.filePath }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle("ios-simulator-screenshot", async (event, udid: unknown) => {
    try {
      assertIOSSimulatorUdid(udid)
      const window = ElectronBrowserWindow.fromWebContents(event.sender)
      const choice = await dialog.showMessageBox(window ?? undefined, {
        title: "Simulator Screenshot",
        message: "What would you like to do with this screenshot?",
        buttons: ["Save to File", "Copy to Clipboard", "Cancel"],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      })
      if (choice.response === 2) return { ok: true, canceled: true }

      const temporaryScreenshot = await captureIOSSimulatorScreenshot(udid)
      if (choice.response === 1) {
        clipboard.writeImage(nativeImage.createFromPath(temporaryScreenshot))
        return { ok: true, action: "copied" }
      }

      const save = await dialog.showSaveDialog(window ?? undefined, {
        title: "Save Simulator Screenshot",
        defaultPath: "simulator-screenshot.png",
        filters: [{ name: "PNG image", extensions: ["png"] }],
      })
      if (save.canceled || !save.filePath) return { ok: true, canceled: true }
      await fs.promises.copyFile(temporaryScreenshot, save.filePath)
      return { ok: true, action: "saved", filePath: save.filePath }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle("capture-ios-simulator-screenshot", async (_event, udid: unknown) => {
    try {
      assertIOSSimulatorUdid(udid)
      const filePath = await captureIOSSimulatorScreenshot(udid)
      const imageBase64 = await fs.promises.readFile(filePath, "base64")
      return { ok: true, filePath, imageBase64, mimeType: "image/png" }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle("toggle-ios-simulator-recording", async (event, udid: unknown) => {
    try {
      assertIOSSimulatorUdid(udid)
      const activeRecording = simulatorRecordings.get(udid)
      if (activeRecording) {
        const finished = new Promise<void>((resolve) =>
          activeRecording.process.once("close", resolve)
        )
        activeRecording.process.kill("SIGINT")
        await finished
        simulatorRecordings.delete(udid)
        const window = ElectronBrowserWindow.fromWebContents(event.sender)
        const save = await dialog.showSaveDialog(window ?? undefined, {
          title: "Save Simulator Recording",
          defaultPath: "simulator-recording.mov",
          filters: [{ name: "QuickTime movie", extensions: ["mov"] }],
        })
        if (save.canceled || !save.filePath) {
          await fs.promises.rm(activeRecording.filePath, { force: true })
          return { ok: true, canceled: true, recording: false }
        }
        await fs.promises.copyFile(activeRecording.filePath, save.filePath)
        await fs.promises.rm(activeRecording.filePath, { force: true })
        return { ok: true, recording: false, filePath: save.filePath }
      }

      const directory = path.join(app.getPath("temp"), "reactotron", "simulator-recordings")
      await fs.promises.mkdir(directory, { recursive: true })
      const filePath = path.join(directory, `simulator-recording-${udid}-${Date.now()}.mov`)

      const recordingProcess = childProcess.spawn(
        "xcrun",
        ["simctl", "io", udid, "recordVideo", filePath],
        { shell: false }
      )
      simulatorRecordings.set(udid, { process: recordingProcess, filePath })
      recordingProcess.on("close", () => {
        if (simulatorRecordings.get(udid)?.process === recordingProcess) {
          simulatorRecordings.delete(udid)
        }
      })
      recordingProcess.on("error", () => {
        if (simulatorRecordings.get(udid)?.process === recordingProcess) {
          simulatorRecordings.delete(udid)
        }
      })
      return { ok: true, recording: true }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle("toggle-ios-simulator-appearance", async (_event, udid: unknown) => {
    try {
      assertIOSSimulatorUdid(udid)
      const currentAppearance = (
        await runCommand("xcrun", ["simctl", "ui", udid, "appearance"])
      ).trim()
      const appearance = currentAppearance === "dark" ? "light" : "dark"
      await runCommand("xcrun", ["simctl", "ui", udid, "appearance", appearance])
      return { ok: true, appearance }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle("reload-ios-simulator", async () => {
    const metroPort = Number(process.env.REACTOTRON_METRO_PORT ?? process.env.METRO_PORT ?? 8081)
    console.log(`[Reactotron Desktop] React Native reload requested via Metro port ${metroPort}.`)

    try {
      await reloadReactNativeViaMetro(metroPort)

      const message = `Sent reload request to Metro on port ${metroPort}.`
      console.log(`[Reactotron Desktop] ${message}`)
      return { ok: true, message }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.log("[Reactotron Desktop] Failed to reload via Metro.", message)
      return { ok: false, message }
    }
  })
}

export const stopIOSSimulatorSurfaces = () => {
  // "before-quit" does not await, so there is no opportunity to check whether
  // a serve-sim process honoured SIGTERM before the app goes away. Send
  // SIGKILL outright rather than risk leaving one running after quit.
  serveSimProcesses.forEach(({ process }) => process.kill("SIGKILL"))
  serveSimProcesses.clear()
  simulatorRecordings.forEach(({ process }) => process.kill("SIGINT"))
  simulatorRecordings.clear()
}

// This function sets up numerous IPC commands for communicating with android devices.
// It also watches for android devices being plugged in and unplugged.
//
export const setupAndroidDeviceIPCCommands = (mainWindow: BrowserWindow) => {
  // Allows the main renderer to communicate with the main process and get a list of connected android devices.
  ipcMain.on("get-device-list", () => {
    console.log("Getting Android device list")
    const devicesProcess = childProcess.spawn(getAdbPath(), ["devices"])
    devicesProcess.stdout.setEncoding("utf8")
    devicesProcess.stdout.on("data", (data) => {
      data = data.toString()
      console.log("Got adb device list", data)
      mainWindow.webContents.send("device-list", data)
    })
  })

  // Creates a reverse tunnel to an android device for reactotron and metro.
  ipcMain.on("reverse-tunnel-device", (_event, deviceId, reactotronPort, metroPort) => {
    console.log("Reverse Tunneling Android device", deviceId, reactotronPort, metroPort)

    // First do the reverse tunnel for reactotron:
    const reactotronReverseProcess = childProcess.spawn(getAdbPath(), [
      "-s",
      deviceId,
      "reverse",
      `tcp:${reactotronPort}`,
      `tcp:${reactotronPort}`,
    ])
    reactotronReverseProcess.stdout.setEncoding("utf8")
    reactotronReverseProcess.stdout.on("data", () => {
      console.log(`Reverse Tunneling To Reactotron Port ${reactotronPort} Complete.`)
    })

    // Now do the reverse tunnel for react native:
    const metroReverseProcess = childProcess.spawn(getAdbPath(), [
      "-s",
      deviceId,
      "reverse",
      `tcp:${metroPort}`,
      `tcp:${metroPort}`,
    ])
    metroReverseProcess.stdout.setEncoding("utf8")
    metroReverseProcess.stdout.on("data", () => {
      console.log(`Reverse Tunneling To Metro Port ${metroPort} Complete.`)
    })
  })

  // Reloads the app on the android device
  ipcMain.on("reload-app", (_event, arg) => {
    console.log("Reloading App on device", arg)
    const reloadAppProcess = childProcess.spawn(getAdbPath(), [
      "-s",
      arg,
      "shell",
      "input",
      "text",
      "RR",
    ])
    reloadAppProcess.stdout.setEncoding("utf8")
    reloadAppProcess.stdout.on("data", (data) => {
      data = data.toString()
      console.log("Reloading App Complete", data)
    })
  })

  // Reloads the app on the android device
  ipcMain.on("shake-device", (_event, arg) => {
    console.log("Showing react-native debug menu", arg)
    const shakeDeviceProcess = childProcess.spawn(getAdbPath(), [
      "-s",
      arg,
      "shell",
      "input",
      "keyevent",
      "82",
    ])
    shakeDeviceProcess.stdout.setEncoding("utf8")
    shakeDeviceProcess.stdout.on("data", (data) => {
      data = data.toString()
      console.log("Shaking Device Complete", data)
    })
  })

  // Now we need to start watching for android devices being plugged and unplugged
  const trackDevicesProcess = childProcess.spawn(getAdbPath(), ["track-devices"])
  trackDevicesProcess.on("error", (error) => {
    dialog.showMessageBox({
      title: "Android communication problem",
      type: "warning",
      message: "Error occurred running adb track-devices.\n" + error,
    })
  })
  trackDevicesProcess.stdout.setEncoding("utf8")
  trackDevicesProcess.stdout.on("data", (data) => {
    data = data.toString()
    console.log("Got adb track-devices output: ", data)
    ipcMain.emit("get-device-list")
  })
  trackDevicesProcess.stderr.setEncoding("utf8")
  trackDevicesProcess.stderr.on("data", (data) => {
    console.log(data)
  })
  trackDevicesProcess.on("close", (code) => {
    // Warn the user if the process closes.
    switch (code) {
      case 0:
        dialog.showMessageBox({
          title: "Closing adb track-devices",
          type: "info",
          message: "End process.\r\n",
        })
        break
    }
  })
}
