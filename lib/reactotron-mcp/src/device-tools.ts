import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod/v4"

import type { DeviceHost, DeviceResult } from "./device-host"
import { MAX_RESPONSE_CHARS, safeSerialize } from "./serialization"

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: safeSerialize(data, MAX_RESPONSE_CHARS) }] }
}

function resultOrError(result: DeviceResult) {
  return result.ok
    ? textResult({ status: "success", ...result })
    : textResult({ status: "error", message: result.message ?? "The device operation failed." })
}

const deviceId = z
  .string()
  .describe("Device id from list_devices: an iOS simulator UDID, an adb serial, or avd:<name> for boot_device.")

/** iOS simulator and Android tools that work with or without the desktop app. */
export function registerDeviceTools(mcp: McpServer, host: DeviceHost) {
  mcp.registerTool("list_devices", {
    description: "List iOS simulators and Android devices/emulators (including stopped AVDs) on this machine.",
  }, async () => resultOrError(await host.listDevices()))

  mcp.registerTool("boot_device", {
    description: "Boot an iOS simulator or start an Android emulator (pass avd:<name> from list_devices).",
    inputSchema: { deviceId },
  }, async (args) => resultOrError(await host.bootDevice(args.deviceId)))

  mcp.registerTool("shutdown_device", {
    description: "Shut down an iOS simulator or Android emulator. Requires explicit confirmation.",
    inputSchema: { deviceId, confirm: z.literal(true).describe("Must be true to shut the device down.") },
  }, async (args) => resultOrError(await host.shutdownDevice(args.deviceId)))

  mcp.registerTool("device_screenshot", {
    description: "Capture the current screen of an iOS simulator or Android device. Returns an inline PNG and its local path.",
    inputSchema: { deviceId },
  }, async (args) => {
    const result = await host.screenshot(args.deviceId)
    if (!result.ok || typeof result.imageBase64 !== "string") return resultOrError(result)
    return {
      content: [
        { type: "image" as const, data: result.imageBase64, mimeType: String(result.mimeType ?? "image/png") },
        { type: "text" as const, text: safeSerialize({ status: "success", filePath: result.filePath }, MAX_RESPONSE_CHARS) },
      ],
    }
  })

  mcp.registerTool("device_record_start", {
    description: "Start recording the screen of an iOS simulator or Android device to MP4. Stop with device_record_stop. Android caps a recording at 180 seconds.",
    inputSchema: { deviceId },
  }, async (args) => resultOrError(await host.startRecording(args.deviceId)))

  mcp.registerTool("device_record_stop", {
    description: "Stop a screen recording and return the local MP4 path.",
    inputSchema: {
      deviceId,
      outputPath: z.string().optional().describe("Optional path to save the MP4 to. Defaults to a temp file."),
    },
  }, async (args) => resultOrError(await host.stopRecording(args.deviceId, args.outputPath)))

  mcp.registerTool("device_home", {
    description: "Press the home button (Android). iOS simulators need the desktop app's control_ios_simulator.",
    inputSchema: { deviceId },
  }, async (args) => resultOrError(await host.pressHome(args.deviceId)))

  mcp.registerTool("device_appearance", {
    description: "Set or toggle light/dark appearance on an iOS simulator or Android device.",
    inputSchema: { deviceId, appearance: z.enum(["light", "dark", "toggle"]).describe("Target appearance.") },
  }, async (args) => resultOrError(await host.setAppearance(args.deviceId, args.appearance)))

  mcp.registerTool("device_rotate", {
    description: "Rotate an Android device. iOS simulators need the desktop app's control_ios_simulator.",
    inputSchema: { deviceId, orientation: z.enum(["portrait", "landscape"]).describe("Target orientation.") },
  }, async (args) => resultOrError(await host.rotate(args.deviceId, args.orientation)))

  mcp.registerTool("device_open_url", {
    description: "Open a URL or deep link on the device, e.g. myapp://lot/123.",
    inputSchema: { deviceId, url: z.string().describe("URL or deep link.") },
  }, async (args) => resultOrError(await host.openUrl(args.deviceId, args.url)))

  mcp.registerTool("device_launch_app", {
    description: "Launch (or relaunch) an app by bundle id / package name.",
    inputSchema: { deviceId, appId: z.string().describe("iOS bundle id or Android package name.") },
  }, async (args) => resultOrError(await host.launchApp(args.deviceId, args.appId)))

  mcp.registerTool("device_terminate_app", {
    description: "Force-stop an app by bundle id / package name.",
    inputSchema: { deviceId, appId: z.string().describe("iOS bundle id or Android package name.") },
  }, async (args) => resultOrError(await host.terminateApp(args.deviceId, args.appId)))

  mcp.registerTool("reload_app", {
    description: "Reload the React Native app through Metro (both platforms).",
    inputSchema: { metroPort: z.number().optional().describe("Metro port. Default 8081 or REACTOTRON_METRO_PORT.") },
  }, async (args) => resultOrError(await host.reloadApp(args.metroPort)))
}
