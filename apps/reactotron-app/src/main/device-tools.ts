import childProcess from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { ipcMain } from "electron"

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
  | { ok: true; message?: string; apps?: AppEntry[] }
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
        // devicectl terminates by pid: find the running process inside the app's bundle.
        const apps = collect(
          JSON.parse(
            await devicectl(
              "device",
              "info",
              "apps",
              "--device",
              target.id,
              "--json-output",
              "-",
              "--quiet"
            )
          ),
          "bundleIdentifier"
        )
        const bundleUrl = apps.find((app) => app.bundleIdentifier === appId)?.url
        if (typeof bundleUrl !== "string") fail(`${appId} is not installed.`)
        const processes = collect(
          JSON.parse(
            await devicectl(
              "device",
              "info",
              "processes",
              "--device",
              target.id,
              "--json-output",
              "-",
              "--quiet"
            )
          ),
          "executable"
        )
        const running = processes.find((process) =>
          String(process.executable).startsWith(bundleUrl)
        )
        if (!running || typeof running.processIdentifier !== "number")
          fail(`${appId} is not running.`)
        await devicectl(
          "device",
          "process",
          "terminate",
          "--device",
          target.id,
          "--pid",
          String(running.processIdentifier)
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
