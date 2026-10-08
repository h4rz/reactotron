import { spawn, type ChildProcess } from "child_process"
import fs from "fs"
import http from "http"
import os from "os"
import path from "path"

/**
 * Plain Node device control for iOS simulators (simctl) and Android devices or
 * emulators (adb). It needs neither Electron nor the desktop app, so the same
 * host serves the desktop MCP server and the headless CLI server.
 */

export type DevicePlatform = "ios" | "android"

export type DeviceInfo = {
  id: string
  name: string
  platform: DevicePlatform
  state: string
  runtime?: string
  /** Android Virtual Device name, set for AVDs that are not running yet. */
  avd?: string
}

export type DeviceResult = {
  ok: boolean
  message?: string
  [key: string]: unknown
}

export interface DeviceHost {
  listDevices(): Promise<DeviceResult & { devices?: DeviceInfo[] }>
  bootDevice(id: string): Promise<DeviceResult>
  shutdownDevice(id: string): Promise<DeviceResult>
  screenshot(id: string): Promise<DeviceResult & { imageBase64?: string; mimeType?: string; filePath?: string }>
  startRecording(id: string): Promise<DeviceResult>
  stopRecording(id: string, outputPath?: string): Promise<DeviceResult & { filePath?: string }>
  pressHome(id: string): Promise<DeviceResult>
  setAppearance(id: string, appearance: "light" | "dark" | "toggle"): Promise<DeviceResult>
  rotate(id: string, orientation: "portrait" | "landscape"): Promise<DeviceResult>
  openUrl(id: string, url: string): Promise<DeviceResult>
  launchApp(id: string, appId: string): Promise<DeviceResult>
  terminateApp(id: string, appId: string): Promise<DeviceResult>
  reloadApp(metroPort?: number): Promise<DeviceResult>
  /** Stop recordings this host started. Called when the server shuts down. */
  dispose(): void
}

const SIMULATOR_UDID = /^[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}$/i
const ADB_SERIAL = /^[A-Za-z0-9._:-]{1,128}$/
const AVD_NAME = /^[A-Za-z0-9._-]{1,128}$/
const APP_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/
const RECORDING_START_TIMEOUT_MS = 8000

function run(command: string, args: string[], options: { timeoutMs?: number; binary?: boolean } = {}) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(command, args, { shell: false })
    const stdout: Buffer[] = []
    let stderr = ""
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error(`${command} ${args[0] ?? ""} timed out.`))
    }, options.timeoutMs ?? 30000)
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(Buffer.concat(stdout))
      else reject(new Error(stderr.trim() || `${command} exited with code ${code}.`))
    })
  })
}

const runText = async (command: string, args: string[], timeoutMs?: number) =>
  (await run(command, args, { timeoutMs })).toString("utf8")

function sdkDirectories() {
  const home = os.homedir()
  const defaults =
    process.platform === "darwin"
      ? [path.join(home, "Library", "Android", "sdk")]
      : process.platform === "win32"
        ? process.env.LOCALAPPDATA
          ? [path.join(process.env.LOCALAPPDATA, "Android", "Sdk")]
          : []
        : [path.join(home, "Android", "Sdk"), path.join(home, "android-sdk")]
  return [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, ...defaults].filter(
    (directory): directory is string => Boolean(directory)
  )
}

function isExecutable(filePath: string) {
  try {
    if (!fs.statSync(filePath).isFile()) return false
    fs.accessSync(filePath, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Find an Android SDK tool even when PATH lacks platform-tools, as under Finder or CI. */
function sdkTool(subdirectory: string, name: string, override?: string) {
  const executable = process.platform === "win32" ? `${name}.exe` : name
  const candidates = [
    override,
    ...sdkDirectories().map((directory) => path.join(directory, subdirectory, executable)),
    `/opt/homebrew/bin/${executable}`,
    `/usr/local/bin/${executable}`,
  ].filter((candidate): candidate is string => Boolean(candidate))
  return candidates.find(isExecutable) ?? executable
}

function fail(message: string): never {
  throw new Error(message)
}

function platformOf(id: string): DevicePlatform {
  if (SIMULATOR_UDID.test(id)) return "ios"
  if (ADB_SERIAL.test(id)) return "android"
  return fail(`Invalid device id: ${id}`)
}

function assertAppId(appId: string) {
  if (!APP_ID.test(appId)) fail(`Invalid app id: ${appId}`)
}

function assertUrl(url: string) {
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url) || url.length > 2048) fail(`Invalid URL: ${url}`)
}

/** Single-quote a value for the device-side shell adb runs. */
function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function artifactDirectory(kind: string) {
  const directory = path.join(os.tmpdir(), "reactotron", kind)
  fs.mkdirSync(directory, { recursive: true })
  return directory
}

function waitForRecordingStart(child: ChildProcess) {
  return new Promise<{ ok: true } | { ok: false; message: string }>((resolve) => {
    let stderr = ""
    let settled = false
    const finish = (result: { ok: true } | { ok: false; message: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    // simctl reports "Recording started" once the encoder runs; before that it
    // can still refuse, e.g. when another recorder holds the simulator.
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
      if (/Recording started/i.test(stderr)) finish({ ok: true })
    })
    child.once("close", () =>
      finish({ ok: false, message: stderr.trim().split("\n").pop() || "The recording did not start." })
    )
    child.once("error", (error) => finish({ ok: false, message: error.message }))
    const timer = setTimeout(
      () => finish({ ok: false, message: "The recording did not start in time." }),
      RECORDING_START_TIMEOUT_MS
    )
  })
}

function reloadViaMetro(metroPort: number) {
  return new Promise<void>((resolve, reject) => {
    const request = http.get({ host: "localhost", port: metroPort, path: "/reload" }, (response) => {
      response.resume()
      response.on("end", () =>
        response.statusCode && response.statusCode >= 400
          ? reject(new Error(`Metro returned ${response.statusCode}.`))
          : resolve()
      )
    })
    request.setTimeout(3000, () => request.destroy(new Error(`Metro did not respond on port ${metroPort}.`)))
    request.on("error", reject)
  })
}

async function attempt<T extends DeviceResult>(operation: () => Promise<T>): Promise<T | DeviceResult> {
  try {
    return await operation()
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

type Recording = { process: ChildProcess; platform: DevicePlatform; filePath: string; remotePath?: string }

export function createNodeDeviceHost(): DeviceHost {
  const adbPath = () => sdkTool("platform-tools", "adb", process.env.REACTOTRON_ADB_PATH)
  const emulatorPath = () => sdkTool("emulator", "emulator")
  const simctl = (...args: string[]) => runText("xcrun", ["simctl", ...args])
  const adb = (serial: string, ...args: string[]) => runText(adbPath(), ["-s", serial, ...args])
  const adbShell = (serial: string, ...args: string[]) =>
    adb(serial, "shell", args.map(shellQuote).join(" "))
  const recordings = new Map<string, Recording>()

  async function listIOS(): Promise<DeviceInfo[]> {
    if (process.platform !== "darwin") return []
    const parsed = JSON.parse(await simctl("list", "devices", "available", "--json"))
    return Object.entries(parsed.devices ?? {}).flatMap(([runtime, devices]) =>
      (devices as any[]).map((device) => ({
        id: device.udid,
        name: device.name,
        platform: "ios" as const,
        state: String(device.state ?? "unknown").toLowerCase(),
        runtime: runtime.replace(/^com\.apple\.CoreSimulator\.SimRuntime\./, "").replace(/-/g, "."),
      }))
    )
  }

  async function listAndroid(): Promise<DeviceInfo[]> {
    const output = await runText(adbPath(), ["devices", "-l"])
    const running = output
      .split("\n")
      .slice(1)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [id, state] = line.split(/\s+/)
        const model = /model:(\S+)/.exec(line)?.[1]
        return { id, name: model?.replace(/_/g, " ") ?? id, platform: "android" as const, state }
      })
    // AVDs that are not running cannot be addressed by serial, so they are
    // listed by name and booted through the emulator binary.
    const avds = await runText(emulatorPath(), ["-list-avds"]).catch(() => "")
    const stopped = avds
      .split("\n")
      .map((name) => name.trim())
      .filter((name) => AVD_NAME.test(name))
      .map((name) => ({ id: `avd:${name}`, name, platform: "android" as const, state: "shutdown", avd: name }))
    return [...running, ...stopped]
  }

  const host: DeviceHost = {
    listDevices: () =>
      attempt(async () => {
        const [ios, android] = await Promise.all([listIOS().catch(() => []), listAndroid().catch(() => [])])
        return { ok: true, devices: [...ios, ...android] }
      }),

    bootDevice: (id) =>
      attempt(async () => {
        if (id.startsWith("avd:")) {
          const avd = id.slice(4)
          if (!AVD_NAME.test(avd)) fail(`Invalid AVD name: ${avd}`)
          const child = spawn(emulatorPath(), ["-avd", avd], { detached: true, stdio: "ignore" })
          child.unref()
          return { ok: true, message: `Starting emulator ${avd}. It appears in list_devices once adb sees it.` }
        }
        if (platformOf(id) === "android") return { ok: true, message: "Android devices are already running." }
        await simctl("boot", id).catch((error: Error) => {
          if (!/current state: Booted/i.test(error.message)) throw error
        })
        await runText("open", ["-a", "Simulator", "--args", "-CurrentDeviceUDID", id]).catch(() => undefined)
        return { ok: true, message: "Simulator booted." }
      }),

    shutdownDevice: (id) =>
      attempt(async () => {
        if (platformOf(id) === "ios") await simctl("shutdown", id)
        else await adb(id, "emu", "kill")
        return { ok: true, message: "Device shut down." }
      }),

    screenshot: (id) =>
      attempt(async () => {
        const filePath = path.join(artifactDirectory("screenshots"), `screenshot-${Date.now()}.png`)
        if (platformOf(id) === "ios") {
          await simctl("io", id, "screenshot", filePath)
        } else {
          const png = await run(adbPath(), ["-s", id, "exec-out", "screencap", "-p"])
          await fs.promises.writeFile(filePath, png)
        }
        const image = await fs.promises.readFile(filePath)
        return { ok: true, filePath, mimeType: "image/png", imageBase64: image.toString("base64") }
      }),

    startRecording: (id) =>
      attempt(async () => {
        if (recordings.has(id)) fail("A recording is already running on this device.")
        const platform = platformOf(id)
        if (platform === "ios") {
          const filePath = path.join(artifactDirectory("recordings"), `recording-${Date.now()}.mp4`)
          const child = spawn("xcrun", ["simctl", "io", id, "recordVideo", "--codec=h264", "--force", filePath])
          const started = await waitForRecordingStart(child)
          if ("message" in started) {
            if (child.exitCode === null) child.kill("SIGINT")
            fail(started.message)
          }
          recordings.set(id, { process: child, platform, filePath })
        } else {
          const remotePath = `/sdcard/reactotron-recording-${Date.now()}.mp4`
          // screenrecord stops by itself after 180 seconds; stop still pulls what it wrote.
          const child = spawn(adbPath(), ["-s", id, "shell", "screenrecord", "--bit-rate", "12000000", remotePath])
          recordings.set(id, { process: child, platform, filePath: "", remotePath })
        }
        return { ok: true, message: "Recording started.", recording: true }
      }),

    stopRecording: (id, outputPath) =>
      attempt(async () => {
        const recording = recordings.get(id)
        if (!recording) fail("No recording is running on this device.")
        recordings.delete(id)
        const finished = new Promise<void>((resolve) =>
          recording.process.exitCode !== null ? resolve() : recording.process.once("close", () => resolve())
        )
        let filePath = recording.filePath
        if (recording.platform === "ios") {
          recording.process.kill("SIGINT")
          await finished
        } else {
          // Killing the adb client corrupts the MP4; interrupt screenrecord on
          // the device so it writes the trailer first.
          if (recording.process.exitCode === null) {
            await adb(id, "shell", "pkill", "-INT", "screenrecord").catch(() => undefined)
            await finished
          }
          filePath = path.join(artifactDirectory("recordings"), `recording-${Date.now()}.mp4`)
          await adb(id, "pull", recording.remotePath!, filePath)
          await adb(id, "shell", "rm", "-f", recording.remotePath!).catch(() => undefined)
        }
        if (outputPath) {
          const target = path.resolve(outputPath)
          await fs.promises.mkdir(path.dirname(target), { recursive: true })
          await fs.promises.copyFile(filePath, target)
          await fs.promises.rm(filePath, { force: true })
          filePath = target
        }
        return { ok: true, message: "Recording saved.", filePath }
      }),

    pressHome: (id) =>
      attempt(async () => {
        if (platformOf(id) === "ios") {
          fail("simctl has no home button. Use control_ios_simulator in the desktop app.")
        }
        await adbShell(id, "input", "keyevent", "KEYCODE_HOME")
        return { ok: true }
      }),

    setAppearance: (id, appearance) =>
      attempt(async () => {
        if (platformOf(id) === "ios") {
          const target =
            appearance === "toggle"
              ? (await simctl("ui", id, "appearance")).trim() === "dark"
                ? "light"
                : "dark"
              : appearance
          await simctl("ui", id, "appearance", target)
          return { ok: true, appearance: target }
        }
        const current = (await adbShell(id, "cmd", "uimode", "night")).includes("yes") ? "dark" : "light"
        const target = appearance === "toggle" ? (current === "dark" ? "light" : "dark") : appearance
        await adbShell(id, "cmd", "uimode", "night", target === "dark" ? "yes" : "no")
        return { ok: true, appearance: target }
      }),

    rotate: (id, orientation) =>
      attempt(async () => {
        if (platformOf(id) === "ios") {
          fail("simctl cannot rotate a simulator. Use control_ios_simulator in the desktop app.")
        }
        await adbShell(id, "settings", "put", "system", "accelerometer_rotation", "0")
        await adbShell(id, "settings", "put", "system", "user_rotation", orientation === "landscape" ? "1" : "0")
        return { ok: true, orientation }
      }),

    openUrl: (id, url) =>
      attempt(async () => {
        assertUrl(url)
        if (platformOf(id) === "ios") await simctl("openurl", id, url)
        else await adbShell(id, "am", "start", "-a", "android.intent.action.VIEW", "-d", url)
        return { ok: true }
      }),

    launchApp: (id, appId) =>
      attempt(async () => {
        assertAppId(appId)
        if (platformOf(id) === "ios") await simctl("launch", "--terminate-running-process", id, appId)
        else await adbShell(id, "monkey", "-p", appId, "-c", "android.intent.category.LAUNCHER", "1")
        return { ok: true }
      }),

    terminateApp: (id, appId) =>
      attempt(async () => {
        assertAppId(appId)
        if (platformOf(id) === "ios") await simctl("terminate", id, appId)
        else await adbShell(id, "am", "force-stop", appId)
        return { ok: true }
      }),

    reloadApp: (metroPort) =>
      attempt(async () => {
        const port = metroPort ?? Number(process.env.REACTOTRON_METRO_PORT ?? process.env.METRO_PORT ?? 8081)
        await reloadViaMetro(port)
        return { ok: true, message: `Sent reload request to Metro on port ${port}.` }
      }),

    dispose() {
      recordings.forEach(({ process }) => process.kill("SIGINT"))
      recordings.clear()
    },
  }

  return host
}
