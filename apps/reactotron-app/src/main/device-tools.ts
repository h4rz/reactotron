import childProcess from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { BrowserWindow, dialog, ipcMain, shell } from "electron"

import { getAdbPath } from "./adb-path"

/**
 * Developer tools for the device hub: deep links, app lifecycle, permissions,
 * location and push notifications.
 *
 * iOS simulators use simctl and the bundled serve-sim CLI, Android devices use
 * adb, and physical iPhones use devicectl. Every value from the renderer is
 * validated here before it reaches a command line; adb shell arguments are
 * quoted because adb joins them into a shell string on the device.
 */

export type DeviceToolTarget =
  | { kind: "ios-simulator"; id: string }
  | { kind: "ios-physical"; id: string }
  | { kind: "android"; id: string; emulator: boolean }

type RunOptions = { env?: NodeJS.ProcessEnv; timeoutMs?: number; input?: string }

/** Runs a command without a shell; rejects with its stderr on a non-zero exit or timeout. */
function run(command: string, args: string[], options: RunOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(command, args, { shell: false, env: options.env })
    let output = ""
    let errorOutput = ""
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error(`${path.basename(command)} did not finish in time.`))
    }, options.timeoutMs ?? 30_000)
    child.stdout.on("data", (data) => (output += data.toString()))
    child.stderr.on("data", (data) => (errorOutput += data.toString()))
    child.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(output)
      else
        reject(
          new Error(
            errorOutput.trim() ||
              output.trim() ||
              `${path.basename(command)} exited with code ${code}.`
          )
        )
    })
    if (options.input !== undefined) child.stdin.end(options.input)
    else child.stdin.end()
  })
}

type ServeSimRunner = (args: string[]) => {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
}

type AppEntry = { id: string; name?: string }

export type ToolResult =
  | {
      ok: true
      message?: string
      apps?: AppEntry[]
      crashes?: Array<{ path: string; title: string; time: number }>
      ui?: Record<string, string>
    }
  | { ok: false; message: string }

const SIMULATOR_UDID = /^[A-F0-9-]{36}$/i
const PHYSICAL_UDID = /^[A-F0-9-]{24,40}$/i
const ADB_SERIAL = /^[A-Za-z0-9._:-]{1,128}$/
const APP_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/

// serve-sim's permission names; reset additionally accepts "all".
const IOS_PERMISSIONS = [
  "notifications",
  "location",
  "camera",
  "microphone",
  "photos",
  "photos-add",
  "contacts",
  "calendar",
  "reminders",
  "motion",
  "media-library",
  "siri",
  "speech",
  "faceid",
  "user-tracking",
  "homekit",
]

// Runtime permissions a React Native app commonly asks for.
const ANDROID_PERMISSIONS: Record<string, string[]> = {
  camera: ["android.permission.CAMERA"],
  location: [
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.ACCESS_COARSE_LOCATION",
  ],
  microphone: ["android.permission.RECORD_AUDIO"],
  notifications: ["android.permission.POST_NOTIFICATIONS"],
  photos: ["android.permission.READ_MEDIA_IMAGES", "android.permission.READ_MEDIA_VIDEO"],
  contacts: ["android.permission.READ_CONTACTS"],
  calendar: ["android.permission.READ_CALENDAR", "android.permission.WRITE_CALENDAR"],
}

const TEXT_SIZES = [
  "extra-small",
  "small",
  "medium",
  "large",
  "extra-large",
  "extra-extra-large",
  "extra-extra-extra-large",
  "accessibility-medium",
  "accessibility-large",
  "accessibility-extra-large",
  "accessibility-extra-extra-large",
  "accessibility-extra-extra-extra-large",
]
const ON_OFF = ["on", "off"]
// serve-sim `ui` options and the values it accepts.
const UI_OPTIONS: Record<string, string[]> = {
  "text-size": TEXT_SIZES,
  "reduce-motion": ON_OFF,
  "increase-contrast": ON_OFF,
  "reduce-transparency": ON_OFF,
  "show-borders": ON_OFF,
  voiceover: ON_OFF,
  "liquid-glass": ["clear", "tinted"],
  "color-filter": ["none", "grayscale", "red-green", "green-red", "blue-yellow"],
}
const ANDROID_FONT_SCALES = [0.85, 1, 1.15, 1.3, 1.5, 1.8, 2]

export const DEVICE_TOOL_PERMISSIONS = {
  ios: IOS_PERMISSIONS,
  android: Object.keys(ANDROID_PERMISSIONS),
}

function fail(message: string): never {
  throw new Error(message)
}

function assertTarget(target: unknown): DeviceToolTarget {
  const value = target as Partial<DeviceToolTarget> | null
  if (!value || typeof value !== "object" || typeof value.id !== "string") fail("Missing device.")
  if (value.kind === "ios-simulator" && SIMULATOR_UDID.test(value.id))
    return value as DeviceToolTarget
  if (value.kind === "ios-physical" && PHYSICAL_UDID.test(value.id))
    return value as DeviceToolTarget
  if (value.kind === "android" && ADB_SERIAL.test(value.id)) {
    return {
      kind: "android",
      id: value.id,
      emulator: Boolean((value as { emulator?: unknown }).emulator),
    }
  }
  return fail("Unknown device.")
}

function assertAppId(appId: unknown): string {
  if (typeof appId !== "string" || !appId) fail("Choose an app first.")
  if (!APP_ID.test(appId)) fail("That is not a valid bundle or package identifier.")
  return appId
}

function assertUrl(url: unknown): string {
  if (typeof url !== "string") fail("Enter a URL.")
  const trimmed = url.trim()
  if (!trimmed || trimmed.length > 2048 || /\s/.test(trimmed)) fail("Enter a URL without spaces.")
  // Any scheme: https links and app deep links (myapp://...) are both valid targets.
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed))
    fail("The URL needs a scheme, like https:// or myapp://.")
  return trimmed
}

function assertCoordinate(value: unknown, limit: number, label: string): number {
  const number = typeof value === "string" ? Number(value) : value
  if (typeof number !== "number" || !Number.isFinite(number) || Math.abs(number) > limit) {
    fail(`Enter a ${label} between -${limit} and ${limit}.`)
  }
  return number
}

function assertPayload(payload: unknown): string {
  if (typeof payload !== "string" || payload.length > 4096) fail("The payload must be under 4 KB.")
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    fail("The payload is not valid JSON.")
  }
  if (!parsed || typeof parsed !== "object" || !("aps" in (parsed as object))) {
    fail('The payload needs an "aps" object, e.g. {"aps":{"alert":"Hello"}}.')
  }
  return payload
}

/** Single-quote a value for the device-side shell adb runs. */
function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function withTemporaryFile<T>(
  contents: string,
  extension: string,
  use: (file: string) => Promise<T>
) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "reactotron-device-tool-"))
  const file = path.join(directory, `payload${extension}`)
  try {
    await fs.promises.writeFile(file, contents)
    return await use(file)
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true })
  }
}

/** Finds every value of `key` in a JSON document, wherever devicectl nests it. */
function collect(value: unknown, key: string, out: Array<Record<string, unknown>> = []) {
  if (Array.isArray(value)) value.forEach((item) => collect(item, key, out))
  else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    if (typeof record[key] === "string") out.push(record)
    Object.values(record).forEach((item) => collect(item, key, out))
  }
  return out
}

// Physical-iPhone location keeps devicectl running for as long as the point is held.
const physicalLocations = new Map<string, childProcess.ChildProcess>()

export function stopDeviceToolProcesses() {
  physicalLocations.forEach((process) => process.kill("SIGINT"))
  physicalLocations.clear()
}

export function registerDeviceToolHandlers(serveSim: ServeSimRunner) {
  const adb = (target: DeviceToolTarget, ...args: string[]) =>
    run(getAdbPath(), ["-s", target.id, ...args])
  const adbShell = (target: DeviceToolTarget, ...args: string[]) =>
    adb(
      target,
      "shell",
      args.map((arg) => (/^[A-Za-z0-9._:/=-]+$/.test(arg) ? arg : shellQuote(arg))).join(" ")
    )
  const simctl = (...args: string[]) => run("xcrun", ["simctl", ...args])
  const devicectl = (...args: string[]) =>
    run("xcrun", ["devicectl", ...args], { timeoutMs: 60_000 })
  const serveSimCli = (args: string[], timeoutMs = 60_000) => {
    const runner = serveSim(args)
    return run(runner.command, runner.args, { env: runner.env, timeoutMs })
  }

  /** devicectl acts on pids: find the running process inside the app's bundle. */
  const physicalPid = async (target: DeviceToolTarget, appId: string) => {
    const appsJson = await devicectl(
      "device",
      "info",
      "apps",
      "--device",
      target.id,
      "--json-output",
      "-",
      "--quiet"
    )
    const bundleUrl = collect(JSON.parse(appsJson), "bundleIdentifier").find(
      (app) => app.bundleIdentifier === appId
    )?.url
    if (typeof bundleUrl !== "string") fail(`${appId} is not installed.`)
    const processJson = await devicectl(
      "device",
      "info",
      "processes",
      "--device",
      target.id,
      "--json-output",
      "-",
      "--quiet"
    )
    const running = collect(JSON.parse(processJson), "executable").find((process) =>
      String(process.executable).startsWith(bundleUrl)
    )
    if (!running || typeof running.processIdentifier !== "number") fail(`${appId} is not running.`)
    return running.processIdentifier
  }

  const handlers: Record<
    string,
    (
      target: DeviceToolTarget,
      args: Record<string, unknown>,
      sender: Electron.WebContents
    ) => Promise<ToolResult>
  > = {
    async "list-apps"(target) {
      if (target.kind === "ios-simulator") {
        const plist = await simctl("listapps", target.id)
        const json = await run("plutil", ["-convert", "json", "-o", "-", "--", "-"], {
          input: plist,
        })
        const apps = Object.values(JSON.parse(json) as Record<string, Record<string, string>>)
          .filter((app) => app.ApplicationType === "User")
          .map((app) => ({
            id: app.CFBundleIdentifier,
            name: app.CFBundleDisplayName || app.CFBundleName,
          }))
        return { ok: true, apps }
      }
      if (target.kind === "android") {
        const output = await adbShell(target, "pm", "list", "packages", "-3")
        const apps = output
          .split("\n")
          .map((line) => line.trim().replace(/^package:/, ""))
          .filter((id) => APP_ID.test(id))
          .map((id) => ({ id }))
        return { ok: true, apps }
      }
      const json = await devicectl(
        "device",
        "info",
        "apps",
        "--device",
        target.id,
        "--json-output",
        "-",
        "--quiet"
      )
      const apps = collect(JSON.parse(json), "bundleIdentifier")
        .filter((app) => app.appClip !== true && app.builtByDeveloper !== false)
        .map((app) => ({
          id: String(app.bundleIdentifier),
          name: typeof app.name === "string" ? app.name : undefined,
        }))
      return { ok: true, apps }
    },

    async "open-url"(target, args) {
      const url = assertUrl(args.url)
      if (target.kind === "ios-simulator") await simctl("openurl", target.id, url)
      else if (target.kind === "android") {
        const app =
          typeof args.appId === "string" && APP_ID.test(args.appId) ? ["-p", args.appId] : []
        const output = await adbShell(
          target,
          "am",
          "start",
          "-a",
          "android.intent.action.VIEW",
          "-d",
          url,
          ...app
        )
        if (/Error:/.test(output)) fail(output.trim())
      } else await devicectl("device", "process", "openURL", "--device", target.id, url)
      return { ok: true, message: `Opened ${url}` }
    },

    async terminate(target, args) {
      const appId = assertAppId(args.appId)
      if (target.kind === "ios-simulator") await simctl("terminate", target.id, appId)
      else if (target.kind === "android") await adbShell(target, "am", "force-stop", appId)
      else {
        const pid = await physicalPid(target, appId)
        await devicectl(
          "device",
          "process",
          "terminate",
          "--device",
          target.id,
          "--pid",
          String(pid)
        )
      }
      return { ok: true, message: `Terminated ${appId}` }
    },

    async relaunch(target, args) {
      const appId = assertAppId(args.appId)
      if (target.kind === "ios-simulator")
        await simctl("launch", "--terminate-running-process", target.id, appId)
      else if (target.kind === "android") {
        await adbShell(target, "am", "force-stop", appId)
        const output = await adbShell(
          target,
          "monkey",
          "-p",
          appId,
          "-c",
          "android.intent.category.LAUNCHER",
          "1"
        )
        if (/No activities found/.test(output)) fail(`${appId} has no launcher activity.`)
      } else
        await devicectl(
          "device",
          "process",
          "launch",
          "--device",
          target.id,
          "--terminate-existing",
          appId
        )
      return { ok: true, message: `Relaunched ${appId}` }
    },

    async permission(target, args) {
      const appId = assertAppId(args.appId)
      const mode = args.mode
      if (mode !== "grant" && mode !== "revoke" && mode !== "reset")
        fail("Unknown permission action.")
      const permission = String(args.permission)
      if (target.kind === "ios-simulator") {
        if (!IOS_PERMISSIONS.includes(permission) && !(mode === "reset" && permission === "all")) {
          fail("Unknown permission.")
        }
        await serveSimCli(["permissions", mode, permission, appId, "-d", target.id])
        if (permission === "notifications" || permission === "all") {
          // serve-sim writes the BulletinBoard settings file, but SpringBoard keeps its
          // own copy and keeps rejecting pushes ("Source is not authorized") until it
          // restarts. A respring backgrounds the app; its process keeps running.
          await simctl(
            "spawn",
            target.id,
            "launchctl",
            "kickstart",
            "-k",
            "system/com.apple.SpringBoard"
          )
          // Give usernotificationsd time to reconnect before anything is sent.
          await new Promise((resolve) => setTimeout(resolve, 4000))
          const verb = mode === "grant" ? "Granted" : mode === "revoke" ? "Revoked" : "Reset"
          return {
            ok: true,
            message: `${verb} ${permission} for ${appId}. Restarted SpringBoard to apply it; reopen the app.`,
          }
        }
      } else if (target.kind === "android") {
        const names =
          permission === "all"
            ? Object.values(ANDROID_PERMISSIONS).flat()
            : ANDROID_PERMISSIONS[permission]
        if (!names) fail("Unknown permission.")
        const failures: string[] = []
        for (const name of names) {
          try {
            if (mode === "grant") await adbShell(target, "pm", "grant", appId, name)
            else await adbShell(target, "pm", "revoke", appId, name)
            // Reset also clears "don't ask again", so the app's prompt appears next time.
            if (mode === "reset") {
              await adbShell(
                target,
                "pm",
                "clear-permission-flags",
                appId,
                name,
                "user-set",
                "user-fixed"
              )
            }
          } catch (error) {
            // Undeclared permissions cannot be granted; report rather than abort the rest.
            failures.push(
              `${name.replace("android.permission.", "")}: ${error instanceof Error ? error.message.trim().split("\n")[0] : String(error)}`
            )
          }
        }
        if (failures.length === names.length) fail(failures.join("; "))
        if (failures.length) return { ok: true, message: `Partly done. ${failures.join("; ")}` }
      } else {
        fail("Physical iPhones do not allow changing app permissions from a computer.")
      }
      const verb = mode === "grant" ? "Granted" : mode === "revoke" ? "Revoked" : "Reset"
      return { ok: true, message: `${verb} ${permission} for ${appId}` }
    },

    async location(target, args) {
      const latitude = assertCoordinate(args.latitude, 90, "latitude")
      const longitude = assertCoordinate(args.longitude, 180, "longitude")
      if (target.kind === "ios-simulator")
        await simctl("location", target.id, "set", `${latitude},${longitude}`)
      else if (target.kind === "android") {
        if (!target.emulator)
          fail("Physical Android devices only take a simulated location from a mock-location app.")
        // geo fix takes longitude first.
        await adb(target, "emu", "geo", "fix", String(longitude), String(latitude))
      } else {
        physicalLocations.get(target.id)?.kill("SIGINT")
        // A route whose waypoints are the same point holds the device there.
        const route = JSON.stringify({
          mode: "interval",
          interval: 1,
          speed: 1,
          waypoints: [
            { latitude, longitude },
            { latitude, longitude },
          ],
        })
        const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "reactotron-location-"))
        const file = path.join(directory, "route.json")
        await fs.promises.writeFile(file, route)
        const process = childProcess.spawn(
          "xcrun",
          [
            "devicectl",
            "device",
            "simulate",
            "location",
            "route",
            "--device",
            target.id,
            "--route-file",
            file,
          ],
          { shell: false }
        )
        physicalLocations.set(target.id, process)
        process.on("close", () => {
          if (physicalLocations.get(target.id) === process) physicalLocations.delete(target.id)
          fs.promises.rm(directory, { recursive: true, force: true }).catch(() => undefined)
        })
      }
      return { ok: true, message: `Location set to ${latitude}, ${longitude}` }
    },

    async "clear-location"(target) {
      if (target.kind === "ios-simulator") await simctl("location", target.id, "clear")
      else if (target.kind === "android")
        fail("Android emulators keep the last location; set a new one instead.")
      else {
        physicalLocations.get(target.id)?.kill("SIGINT")
        physicalLocations.delete(target.id)
        await devicectl("device", "simulate", "location", "clear", "--device", target.id)
      }
      return { ok: true, message: "Location cleared" }
    },

    async push(target, args) {
      if (target.kind !== "ios-simulator") {
        fail(
          target.kind === "android"
            ? "Android push needs Firebase Cloud Messaging; it cannot be sent from the computer."
            : "Push to a physical iPhone goes through Apple's push service, not the computer."
        )
      }
      const appId = assertAppId(args.appId)
      const payload = assertPayload(args.payload)
      await withTemporaryFile(payload, ".apns", (file) =>
        simctl("push", target.id, appId, file)
      ).catch((error: Error) => {
        // UNErrorDomain 2003: the app has not been allowed to show notifications.
        if (/code=2003|not authorized/i.test(error.message)) {
          fail(
            `Notifications are off for ${appId}. Grant the "notifications" permission above, then send again.`
          )
        }
        throw error
      })
      return { ok: true, message: `Sent push to ${appId}` }
    },

    async "add-media"(target, args, sender) {
      if (target.kind === "ios-physical") {
        fail("Adding photos to a physical iPhone's library is not possible from a computer.")
      }
      const window = BrowserWindow.fromWebContents(sender)
      const choice = await dialog.showOpenDialog(window ?? undefined, {
        title: "Add photos or videos to the device",
        properties: ["openFile", "multiSelections"],
        filters: [
          {
            name: "Photos and videos",
            extensions: ["png", "jpg", "jpeg", "heic", "gif", "mp4", "mov", "m4v"],
          },
        ],
      })
      if (choice.canceled || choice.filePaths.length === 0) return { ok: true }
      const files = choice.filePaths
      if (target.kind === "ios-simulator") {
        await simctl("addmedia", target.id, ...files)
      } else {
        const directory = "/sdcard/Pictures/Reactotron"
        await adbShell(target, "mkdir", "-p", directory)
        for (const file of files) {
          const remote = `${directory}/${path.basename(file).replace(/[^\w.-]/g, "_")}`
          await adb(target, "push", file, remote)
          // Register the file so gallery and picker apps list it immediately.
          await adbShell(
            target,
            "am",
            "broadcast",
            "-a",
            "android.intent.action.MEDIA_SCANNER_SCAN_FILE",
            "-d",
            `file://${remote}`
          ).catch(() => undefined)
        }
        await adbShell(
          target,
          "content",
          "call",
          "--uri",
          "content://media",
          "--method",
          "scan_volume",
          "--arg",
          "external_primary"
        ).catch(() => undefined)
      }
      return {
        ok: true,
        message: `Added ${files.length} file${files.length === 1 ? "" : "s"} to the library`,
      }
    },

    async biometrics(target, args) {
      const mode = args.mode
      if (mode !== "enroll" && mode !== "unenroll" && mode !== "match" && mode !== "fail") {
        fail("Unknown biometric action.")
      }
      if (target.kind === "ios-simulator") {
        const notify = (...notifyArgs: string[]) =>
          simctl("spawn", target.id, "notifyutil", ...notifyArgs)
        if (mode === "enroll" || mode === "unenroll") {
          await notify(
            "-s",
            "com.apple.BiometricKit.enrollmentChanged",
            mode === "enroll" ? "1" : "0"
          )
          await notify("-p", "com.apple.BiometricKit.enrollmentChanged")
          return {
            ok: true,
            message: mode === "enroll" ? "Face ID enrolled" : "Face ID unenrolled",
          }
        }
        // Face ID ("pearl") and Touch ID ("fingerTouch") devices listen on different names.
        const suffix = mode === "match" ? "match" : "nomatch"
        await notify("-p", `com.apple.BiometricKit_Sim.pearl.${suffix}`)
        await notify("-p", `com.apple.BiometricKit_Sim.fingerTouch.${suffix}`)
        return {
          ok: true,
          message: mode === "match" ? "Sent a matching face" : "Sent a non-matching face",
        }
      }
      if (target.kind === "android") {
        if (!target.emulator) fail("Physical Android devices need a real fingerprint.")
        if (mode === "enroll" || mode === "unenroll") {
          fail(
            "Enroll a fingerprint in the emulator's Settings › Security; then use Match and Fail here."
          )
        }
        // Finger 1 is the one Settings enrolls first; an unenrolled id is a non-match.
        await adb(target, "emu", "finger", "touch", mode === "match" ? "1" : "99")
        return {
          ok: true,
          message: mode === "match" ? "Touched an enrolled finger" : "Touched an unknown finger",
        }
      }
      if (mode === "enroll" || mode === "unenroll")
        fail("Physical iPhones use the Face ID set up on the device.")
      await devicectl(
        "device",
        "simulate",
        "biometrics",
        "--device",
        target.id,
        mode === "match" ? "--success" : "--failure"
      )
      return {
        ok: true,
        message: mode === "match" ? "Simulated a successful match" : "Simulated a failed match",
      }
    },

    async reset(target, args) {
      const kind = args.kind
      if (target.kind === "ios-physical") fail("Physical iPhones cannot be reset from a computer.")
      if (kind === "keychain") {
        if (target.kind !== "ios-simulator")
          fail("Android has no shared keychain; clear the app's data instead.")
        await simctl("keychain", target.id, "reset")
        return { ok: true, message: "Reset the simulator keychain (every app's saved logins)" }
      }
      if (kind !== "app-data") fail("Unknown reset.")
      const appId = assertAppId(args.appId)
      if (target.kind === "android") {
        await adbShell(target, "pm", "clear", appId)
        return { ok: true, message: `Cleared ${appId}'s data` }
      }
      await simctl("terminate", target.id, appId).catch(() => undefined)
      const container = (await simctl("get_app_container", target.id, appId, "data")).trim()
      // Never delete outside this simulator's own data containers.
      const root = path.join(
        os.homedir(),
        "Library/Developer/CoreSimulator/Devices",
        target.id,
        "data/Containers/Data/Application"
      )
      if (!container.startsWith(`${root}/`) || container.includes("..")) {
        fail("Could not locate the app's data container.")
      }
      for (const entry of await fs.promises.readdir(container)) {
        // The bundle metadata plist identifies the container; everything else is app data.
        if (entry === ".com.apple.mobile_container_manager.metadata.plist") continue
        await fs.promises.rm(path.join(container, entry), { recursive: true, force: true })
      }
      // An empty container still needs the standard folders the app expects at launch.
      for (const folder of [
        "Documents",
        "Library",
        "Library/Caches",
        "Library/Preferences",
        "tmp",
      ]) {
        await fs.promises.mkdir(path.join(container, folder), { recursive: true })
      }
      return { ok: true, message: `Cleared ${appId}'s data. Relaunch it to start fresh.` }
    },

    async crashes(target, args) {
      const appId = assertAppId(args.appId)
      if (target.kind === "ios-physical") {
        fail("Physical iPhone crash logs are in Xcode's Organizer or the device's Analytics data.")
      }
      if (target.kind === "android") {
        const output = await adb(target, "logcat", "-b", "crash", "-d", "-v", "time")
        const lines = output.split("\n")
        const related = lines.filter((line) => line.includes(appId))
        const file = path.join(os.tmpdir(), `reactotron-android-crashes-${Date.now()}.txt`)
        await fs.promises.writeFile(file, output || "No crashes in the device's crash buffer.\n")
        await shell.openPath(file)
        return {
          ok: true,
          message: related.length
            ? `Opened the crash buffer (${related.length} lines mention ${appId})`
            : `Opened the crash buffer; no entries mention ${appId}`,
        }
      }
      const directory = path.join(os.homedir(), "Library/Logs/DiagnosticReports")
      const names = (await fs.promises.readdir(directory).catch(() => [] as string[])).filter(
        (name) => name.endsWith(".ips")
      )
      const crashes: Array<{ path: string; title: string; time: number }> = []
      for (const name of names) {
        const file = path.join(directory, name)
        try {
          const handle = await fs.promises.open(file, "r")
          const buffer = Buffer.alloc(4096)
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
          await handle.close()
          // .ips files start with a one-line JSON header naming the app and bundle.
          const header = JSON.parse(buffer.toString("utf8", 0, bytesRead).split("\n")[0])
          if (header.bundleID !== appId) continue
          const time =
            Date.parse(header.timestamp?.replace(/\.\d+ /, " ")) ||
            (await fs.promises.stat(file)).mtimeMs
          crashes.push({
            path: file,
            title: `${header.app_name ?? appId} ${header.bug_type === "309" ? "crash" : "report"}`,
            time,
          })
        } catch {
          // Not a readable .ips header; skip it.
        }
      }
      crashes.sort((a, b) => b.time - a.time)
      return {
        ok: true,
        crashes: crashes.slice(0, 10),
        message: crashes.length ? undefined : `No crash reports for ${appId} on this Mac`,
      }
    },

    async "open-crash"(_target, args) {
      const file = typeof args.path === "string" ? args.path : ""
      const directory = path.join(os.homedir(), "Library/Logs/DiagnosticReports")
      if (!file.startsWith(`${directory}/`) || !file.endsWith(".ips") || file.includes("..")) {
        fail("Unknown crash report.")
      }
      const error = await shell.openPath(file)
      if (error) fail(error)
      return { ok: true }
    },

    async "status-bar"(target, args) {
      const clean = args.mode === "clean"
      if (args.mode !== "clean" && args.mode !== "clear") fail("Unknown status bar action.")
      if (target.kind === "ios-simulator") {
        if (clean) {
          await simctl(
            "status_bar",
            target.id,
            "override",
            "--time",
            "9:41",
            "--dataNetwork",
            "wifi",
            "--wifiMode",
            "active",
            "--wifiBars",
            "3",
            "--cellularMode",
            "active",
            "--cellularBars",
            "4",
            "--batteryState",
            "charged",
            "--batteryLevel",
            "100"
          )
        } else await simctl("status_bar", target.id, "clear")
      } else if (target.kind === "android") {
        if (clean) {
          await adbShell(target, "settings", "put", "global", "sysui_demo_allowed", "1")
          const demo = (...extras: string[]) =>
            adbShell(target, "am", "broadcast", "-a", "com.android.systemui.demo", ...extras)
          await demo("-e", "command", "enter")
          await demo("-e", "command", "clock", "-e", "hhmm", "0941")
          await demo("-e", "command", "battery", "-e", "level", "100", "-e", "plugged", "false")
          await demo("-e", "command", "network", "-e", "wifi", "show", "-e", "level", "4")
          await demo(
            "-e",
            "command",
            "network",
            "-e",
            "mobile",
            "show",
            "-e",
            "level",
            "4",
            "-e",
            "datatype",
            "none"
          )
          await demo("-e", "command", "notifications", "-e", "visible", "false")
        } else {
          await adbShell(
            target,
            "am",
            "broadcast",
            "-a",
            "com.android.systemui.demo",
            "-e",
            "command",
            "exit"
          )
        }
      } else if (clean) {
        await devicectl(
          "device",
          "simulate",
          "statusBar",
          "preset",
          "screenshot",
          "--device",
          target.id
        )
      } else await devicectl("device", "simulate", "statusBar", "clear", "--device", target.id)
      return {
        ok: true,
        message: clean ? "Status bar set to 9:41, full battery and signal" : "Status bar restored",
      }
    },

    async "memory-warning"(target, args) {
      if (target.kind === "ios-simulator") {
        await serveSimCli(["memory-warning", "-d", target.id])
        return { ok: true, message: "Sent a memory warning" }
      }
      const appId = assertAppId(args.appId)
      if (target.kind === "android") {
        await adbShell(target, "am", "send-trim-memory", appId, "RUNNING_CRITICAL")
      } else {
        const pid = await physicalPid(target, appId)
        await devicectl(
          "device",
          "process",
          "sendMemoryWarning",
          "--device",
          target.id,
          "--pid",
          String(pid)
        )
      }
      return { ok: true, message: `Sent a memory warning to ${appId}` }
    },

    async "ui-status"(target) {
      if (target.kind === "ios-simulator") {
        const ui = JSON.parse(
          await serveSimCli(["ui", "status", "--json", "-d", target.id])
        ) as Record<string, string>
        return { ok: true, ui }
      }
      if (target.kind === "android") {
        const fontScale =
          Number((await adbShell(target, "settings", "get", "system", "font_scale")).trim()) || 1
        const animator = (
          await adbShell(target, "settings", "get", "global", "animator_duration_scale")
        ).trim()
        return {
          ok: true,
          ui: {
            "text-size": String(fontScale),
            "reduce-motion": animator === "0" || animator === "0.0" ? "on" : "off",
          },
        }
      }
      return { ok: true, ui: {} }
    },

    async ui(target, args) {
      const option = String(args.option)
      const value = String(args.value)
      if (target.kind === "ios-simulator") {
        const allowed = UI_OPTIONS[option]
        if (!allowed || !allowed.includes(value)) fail("Unknown display option.")
        await serveSimCli(["ui", option, value, "-d", target.id])
        return { ok: true, message: `${option} → ${value}` }
      }
      if (target.kind === "android") {
        if (option === "text-size") {
          const scale = Number(value)
          if (!ANDROID_FONT_SCALES.includes(scale)) fail("Unknown text size.")
          await adbShell(target, "settings", "put", "system", "font_scale", String(scale))
          return { ok: true, message: `Font scale ${scale}×` }
        }
        if (option === "reduce-motion" && (value === "on" || value === "off")) {
          const scale = value === "on" ? "0" : "1"
          for (const key of [
            "animator_duration_scale",
            "transition_animation_scale",
            "window_animation_scale",
          ]) {
            await adbShell(target, "settings", "put", "global", key, scale)
          }
          return { ok: true, message: value === "on" ? "Animations off" : "Animations on" }
        }
        fail("That option is only available on iOS simulators.")
      }
      return fail("Display options cannot be changed on a physical iPhone from a computer.")
    },

    async clipboard(target, args) {
      const text = typeof args.text === "string" ? args.text : ""
      if (!text || text.length > 10_000) fail("Enter up to 10,000 characters.")
      if (target.kind === "ios-simulator") {
        // simctl pbcopy reports success but leaves an iOS 27 simulator's pasteboard
        // empty, so type the text into the focused field instead.
        await withTemporaryFile(text, ".txt", (file) =>
          serveSimCli(["type", "--file", file, "-d", target.id])
        )
        return { ok: true, message: "Typed into the focused field" }
      }
      if (target.kind === "ios-physical") {
        await run("xcrun", ["devicectl", "device", "pasteboard", "copy", "--device", target.id], {
          input: text,
          timeoutMs: 60_000,
        })
        return { ok: true, message: "Copied to the iPhone's clipboard; paste in the app" }
      }
      // adb has no clipboard command; type into the focused field instead.
      // input text treats spaces as separators, so they are sent as %s.
      await adbShell(target, "input", "text", text.replace(/ /g, "%s"))
      return { ok: true, message: "Typed into the focused field" }
    },
  }

  ipcMain.handle("device-tool", async (event, target: unknown, action: unknown, args: unknown) => {
    try {
      const handler =
        typeof action === "string" && Object.prototype.hasOwnProperty.call(handlers, action)
          ? handlers[action]
          : null
      if (!handler) fail("Unknown device tool.")
      return await handler(
        assertTarget(target),
        (args && typeof args === "object" ? args : {}) as Record<string, unknown>,
        event.sender
      )
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message.trim() : String(error) }
    }
  })
}
