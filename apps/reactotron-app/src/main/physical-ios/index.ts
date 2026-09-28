import childProcess from "child_process"
import { randomBytes } from "crypto"
import net from "net"
import {
  defaultWdaConfig,
  findPymobiledevice3,
  listRealDevices,
  startDeviceServer,
  type DeviceServer,
  type RealDevice,
  WdaSession,
} from "@h4rz/serve-sim-device"

type ConnectedDevice = RealDevice & { available: boolean }
type PreviewDetails = {
  streamUrl: string
  screenSize: { width: number; height: number }
}
type Preview = { session: WdaSession; server: DeviceServer; details: PreviewDetails }
export type PhysicalIOSInput = {
  type: "tap" | "drag" | "button"
  x?: number
  y?: number
  x2?: number
  y2?: number
  name?: string
}

const previews = new Map<string, Preview>()
const pending = new Map<string, Promise<PreviewDetails>>()

function freeLocalPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      server.close(() => {
        if (!address || typeof address === "string") reject(new Error("No local port available."))
        else resolve(address.port)
      })
    })
  })
}

export function listPhysicalIOSDevices(): Promise<ConnectedDevice[]> {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn("xcrun", ["xcdevice", "list", "--json"], { shell: false })
    let output = ""
    let error = ""
    child.stdout.on("data", (chunk) => (output += chunk.toString()))
    child.stderr.on("data", (chunk) => (error += chunk.toString()))
    child.once("error", reject)
    child.once("close", (code) => {
      if (code !== 0) return reject(new Error(error || `xcdevice exited with code ${code}.`))
      try {
        const devices = JSON.parse(output) as Array<Record<string, unknown>>
        const usbDevices = new Set(listRealDevices().map((device) => device.udid.toLowerCase()))
        resolve(
          devices
            .filter(
              (device) =>
                device.simulator === false && device.platform === "com.apple.platform.iphoneos"
            )
            .map((device) => ({
              udid: String(device.identifier),
              name: String(device.name || "iPhone"),
              productType: String(device.modelCode || "iPhone"),
              productVersion: String(device.operatingSystemVersion || ""),
              available:
                device.available === true &&
                usbDevices.has(String(device.identifier).toLowerCase()),
            }))
        )
      } catch (cause) {
        reject(cause)
      }
    })
  })
}

export function openPhysicalIOSDevice(udid: string): Promise<PreviewDetails> {
  const existing = previews.get(udid)
  if (existing) return Promise.resolve(existing.details)
  const starting = pending.get(udid)
  if (starting) return starting
  const start = openPhysicalIOSDeviceUnguarded(udid).finally(() => pending.delete(udid))
  pending.set(udid, start)
  return start
}

async function openPhysicalIOSDeviceUnguarded(udid: string): Promise<PreviewDetails> {
  const device = (await listPhysicalIOSDevices()).find((item) => item.udid === udid)
  if (!device || !device.available) {
    throw new Error("Connect and trust the iPhone with a USB data cable, then refresh devices.")
  }
  if (!findPymobiledevice3()) {
    throw new Error(
      "Physical iPhone preview needs pymobiledevice3. Install it with: pipx install pymobiledevice3"
    )
  }

  const config = defaultWdaConfig()
  config.controlPort = await freeLocalPort()
  do {
    config.mjpegPort = await freeLocalPort()
  } while (config.mjpegPort === config.controlPort)
  const session = new WdaSession(device, config)
  let server: DeviceServer | undefined
  try {
    await session.start()
    server = await startDeviceServer({ session, port: 0, token: randomBytes(24).toString("hex") })
    const url = new URL(server.url)
    const details: PreviewDetails = {
      streamUrl: new URL(`/stream.mjpeg${url.search}`, url).toString(),
      screenSize: session.getWindowSize() ?? { width: 393, height: 852 },
    }
    previews.set(udid, { session, server, details })
    return details
  } catch (error) {
    await server?.stop()
    await session.stop()
    throw error
  }
}

export async function sendPhysicalIOSInput(udid: string, input: PhysicalIOSInput): Promise<void> {
  const session = previews.get(udid)?.session
  const size = session?.getWindowSize()
  if (!session || !size) throw new Error("Physical iPhone preview is not connected.")
  const coordinate = (value: number | undefined, maximum: number) =>
    Math.min(1, Math.max(0, Number.isFinite(value) ? value! : 0)) * maximum
  if (input.type === "button") {
    if (input.name !== "home") throw new Error("Unsupported iPhone button.")
    await session.pressButton("home")
  } else if (input.type === "drag") {
    await session.drag(
      coordinate(input.x, size.width),
      coordinate(input.y, size.height),
      coordinate(input.x2, size.width),
      coordinate(input.y2, size.height)
    )
  } else if (input.type === "tap") {
    await session.tap(coordinate(input.x, size.width), coordinate(input.y, size.height))
  } else {
    throw new Error("Unsupported iPhone input.")
  }
}

export async function closePhysicalIOSDevice(udid: string): Promise<void> {
  await pending.get(udid)?.catch(() => undefined)
  const preview = previews.get(udid)
  if (!preview) return
  previews.delete(udid)
  await preview.server.stop()
  await preview.session.stop()
}

export function stopPhysicalIOSPreviews(): void {
  const udids = Array.from(
    new Set([...Array.from(previews.keys()), ...Array.from(pending.keys())])
  )
  for (const udid of udids) {
    closePhysicalIOSDevice(udid).catch(() => undefined)
  }
}
