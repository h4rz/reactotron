import fs from "fs"
import os from "os"
import path from "path"
import { ipcMain } from "electron"

import { androidSdkDirectories } from "./adb-path"

/**
 * Realistic device bodies are Apple's AR models. They carry no redistribution
 * license, so Reactotron never bundles them. When another app on this machine
 * already ships converted copies (T3 Code does, in every release channel), the
 * device hub reads them in place; otherwise it falls back to procedural bodies.
 */
export type DeviceModelId = "iphone-18-pro" | "iphone-18-pro-max" | "ipad-pro-13-m5" | "iphone-duo"

type FoundModel = { id: DeviceModelId; file: string; app: string }

// Matches T3 Code's build output, e.g. `iphone-18-pro-Crheuaz9.glb`, and unhashed copies.
// Order matters: the Max must be tried before the plain Pro.
const MODEL_FILE =
  /^(iphone-duo|iphone-18-pro-max|iphone-18-pro|ipad-pro-13-m5)(?:-[A-Za-z0-9_-]{8})?\.glb$/
const MODEL_IDS: DeviceModelId[] = [
  "iphone-18-pro",
  "iphone-18-pro-max",
  "ipad-pro-13-m5",
  "iphone-duo",
]
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git", "locales", "Frameworks"])
const MAX_DEPTH = 8
const MAX_ENTRIES_PER_APP = 40_000

let discovery: Promise<Map<DeviceModelId, FoundModel>> | null = null

async function isDirectory(target: string) {
  try {
    return (await fs.promises.stat(target)).isDirectory()
  } catch {
    return false
  }
}

/** Walks an app's resources, including inside app.asar, which Electron's fs reads transparently. */
async function scanResources(root: string, app: string, found: Map<DeviceModelId, FoundModel>) {
  let visited = 0
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || visited > MAX_ENTRIES_PER_APP) return
    let names: string[]
    try {
      names = await fs.promises.readdir(directory)
    } catch {
      return
    }
    for (const name of names) {
      visited += 1
      if (visited > MAX_ENTRIES_PER_APP) return
      const match = MODEL_FILE.exec(name)
      if (match) {
        const id = match[1] as DeviceModelId
        if (!found.has(id)) found.set(id, { id, file: path.join(directory, name), app })
        continue
      }
      if (SKIPPED_DIRECTORIES.has(name) || name.startsWith(".")) continue
      const child = path.join(directory, name)
      // Only descend into directories and archives; most entries are plain files.
      if (name.endsWith(".asar") || !path.extname(name)) {
        if (await isDirectory(child)) await walk(child, depth + 1)
      }
    }
  }
  await walk(root, 0)
}

async function discoverDeviceModels() {
  const found = new Map<DeviceModelId, FoundModel>()
  const roots = ["/Applications", path.join(os.homedir(), "Applications")]
  const apps: string[] = []
  for (const root of roots) {
    try {
      for (const name of await fs.promises.readdir(root)) {
        if (name.endsWith(".app")) apps.push(path.join(root, name))
      }
    } catch {
      // A missing ~/Applications is normal.
    }
  }
  // T3 Code is the known source; check it first so a full set usually comes from one build.
  apps.sort(
    (a, b) => Number(/T3 Code/i.test(path.basename(b))) - Number(/T3 Code/i.test(path.basename(a)))
  )

  for (const app of apps) {
    const resources = path.join(app, "Contents", "Resources")
    // Electron apps keep their web assets in app.asar, app.asar.unpacked or app/.
    for (const candidate of ["app.asar", "app.asar.unpacked", "app"]) {
      const target = path.join(resources, candidate)
      if (await isDirectory(target)) await scanResources(target, path.basename(app, ".app"), found)
    }
    if (MODEL_IDS.every((id) => found.has(id))) break
  }
  return found
}

function deviceModels() {
  if (!discovery) discovery = discoverDeviceModels().catch(() => new Map())
  return discovery
}

function isGlb(data: Buffer) {
  // Binary glTF starts with the ASCII magic "glTF" followed by container version 2.
  return data.length > 20 && data.toString("ascii", 0, 4) === "glTF" && data.readUInt32LE(4) === 2
}

/**
 * Google's official device frames: the emulator skins in the Android SDK, also
 * carried by Android Studio. Each is a 2D front face plus a `layout` file that
 * says where the display sits. Like Apple's models they are read in place and
 * never bundled.
 */
export type AndroidSkin = {
  image: Buffer
  mimeType: string
  /** Display-sized overlay: transparent except the camera cutout. */
  mask: { image: Buffer; mimeType: string } | null
  frame: { width: number; height: number }
  display: { x: number; y: number; width: number; height: number; cornerRadius: number }
  source: string
}

function androidSkinDirectories() {
  const roots = androidSdkDirectories().map((directory) => path.join(directory, "skins"))
  if (process.platform === "darwin") {
    try {
      for (const name of fs.readdirSync("/Applications")) {
        if (!/^Android Studio.*\.app$/.test(name)) continue
        roots.push(
          path.join(
            "/Applications",
            name,
            "Contents/plugins/android/resources/device-art-resources"
          )
        )
      }
    } catch {
      // No /Applications listing; the SDK skins still apply.
    }
  }
  return roots
}

/** "Pixel 9 Pro" -> "pixel_9_pro", the SDK's skin folder naming. */
export function androidSkinName(model: string) {
  return model
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function readNumber(block: string, key: string) {
  const match = new RegExp(`\\b${key}\\s+(-?\\d+)`).exec(block)
  return match ? Number(match[1]) : null
}

/** Reads the parts the hub needs from an emulator skin `layout` file. */
export function parseSkinLayout(layout: string) {
  const display = /display\s*\{([^}]*)\}/.exec(layout)?.[1]
  const portraitLayout = /layouts\s*\{\s*portrait\s*\{([\s\S]*)/.exec(layout)?.[1]
  if (!display || !portraitLayout) return null
  const devicePart = /part\d+\s*\{[^}]*name\s+device[^}]*\}/.exec(portraitLayout)?.[0]
  const values = {
    displayWidth: readNumber(display, "width"),
    displayHeight: readNumber(display, "height"),
    cornerRadius: readNumber(display, "corner_radius") ?? 0,
    frameWidth: readNumber(portraitLayout, "width"),
    frameHeight: readNumber(portraitLayout, "height"),
    x: devicePart ? readNumber(devicePart, "x") : null,
    y: devicePart ? readNumber(devicePart, "y") : null,
  }
  if (Object.values(values).some((value) => value === null || !Number.isFinite(value))) return null
  return {
    frame: { width: values.frameWidth!, height: values.frameHeight! },
    display: {
      x: values.x!,
      y: values.y!,
      width: values.displayWidth!,
      height: values.displayHeight!,
      cornerRadius: values.cornerRadius,
    },
  }
}

function mimeTypeFor(name: string) {
  return name.endsWith(".webp") ? "image/webp" : "image/png"
}

async function readAndroidSkin(model: string): Promise<AndroidSkin | null> {
  const name = androidSkinName(model)
  if (!name) return null
  for (const root of androidSkinDirectories()) {
    const directory = path.join(root, name)
    try {
      const text = await fs.promises.readFile(path.join(directory, "layout"), "utf8")
      const layout = parseSkinLayout(text)
      // Only the front-face background is used; its display area is drawn over by the stream.
      const imageName = /background\s*\{[^}]*image\s+(\S+)/.exec(text)?.[1]
      if (!layout || !imageName || imageName.includes("/")) continue
      const image = await fs.promises.readFile(path.join(directory, imageName))
      const maskName = /foreground\s*\{[^}]*mask\s+(\S+)/.exec(text)?.[1]
      const mask =
        maskName && !maskName.includes("/")
          ? await fs.promises
              .readFile(path.join(directory, maskName))
              .then((data) => ({ image: data, mimeType: mimeTypeFor(maskName) }))
              .catch(() => null)
          : null
      return { image, mimeType: mimeTypeFor(imageName), mask, ...layout, source: directory }
    } catch {
      // Try the next location.
    }
  }
  return null
}

export function registerDeviceModelHandlers() {
  ipcMain.handle("read-android-skin", async (_event, model: unknown) => {
    if (typeof model !== "string" || model.length > 80) {
      return { ok: false, message: "Invalid device model." }
    }
    const skin = await readAndroidSkin(model)
    return skin ? { ok: true, skin } : { ok: false, message: "No official frame for this device." }
  })

  if (process.platform !== "darwin") return

  ipcMain.handle("read-device-model", async (_event, id: unknown) => {
    if (typeof id !== "string" || !MODEL_IDS.includes(id as DeviceModelId)) {
      return { ok: false, message: "Unknown device model." }
    }
    const model = (await deviceModels()).get(id as DeviceModelId)
    if (!model) return { ok: false, message: "No local copy of this device model was found." }
    try {
      const data = await fs.promises.readFile(model.file)
      if (!isGlb(data)) return { ok: false, message: `${model.file} is not a binary glTF model.` }
      return { ok: true, data, app: model.app }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })
}
