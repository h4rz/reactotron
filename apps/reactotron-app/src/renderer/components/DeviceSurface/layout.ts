export type PaneSize = {
  width: number
  height: number
}

export type DeviceFrameKind = "phone" | "tablet"

export type DeviceFrameLayout = {
  kind: DeviceFrameKind
  width: number
  height: number
  bezel: number
  outerRadius: number
}

export type SimulatorScreenConfig = {
  screenSize: PaneSize
  orientation?: "portrait" | "landscape_left" | "portrait_upside_down" | "landscape_right"
  supportsHingeAngle?: boolean
  hingeAngle?: number
  hingePose?: "closed" | "book" | "open" | "laptop" | "tent"
  screenId?: number
}

const fitMarginPx = 0.5

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

// Matches Orca's emulator sizing rule: choose one screen size that fits the
// available pane in both directions, then account for the physical frame.
function fitScreenToPane(paneSize: PaneSize | null, aspectRatio: number): PaneSize | null {
  if (!paneSize || paneSize.width <= 0 || paneSize.height <= 0 || aspectRatio <= 0) {
    return null
  }

  if (paneSize.width / paneSize.height > aspectRatio) {
    return { width: Math.max(1, paneSize.height * aspectRatio), height: paneSize.height }
  }

  return { width: paneSize.width, height: Math.max(1, paneSize.width / aspectRatio) }
}

export function resolveDeviceFrameKind(
  deviceName: string | undefined,
  screenAspectRatio: number
): DeviceFrameKind {
  if (deviceName && /ipad/i.test(deviceName)) return "tablet"
  if (deviceName && /iphone/i.test(deviceName)) return "phone"
  return screenAspectRatio > 0.62 && screenAspectRatio < 1.62 ? "tablet" : "phone"
}

export function resolveVisualScreenAspectRatio(
  screenSize: PaneSize | undefined,
  orientation: NonNullable<SimulatorScreenConfig["orientation"]>
): number {
  // serve-sim may retain portrait pixel dimensions after a successful rotate.
  // Match Orca: the visual screen follows the requested orientation while the
  // renderer rotates those stale pixels into the physical frame.
  const width = screenSize?.width ?? 9
  const height = screenSize?.height ?? 19.5
  const shortSide = Math.min(width, height)
  const longSide = Math.max(width, height)
  return orientation.startsWith("landscape") ? longSide / shortSide : shortSide / longSide
}

export function resolveStreamRotation(
  screenSize: PaneSize | undefined,
  orientation: NonNullable<SimulatorScreenConfig["orientation"]>
): -90 | 0 | 90 {
  if (!screenSize || screenSize.width === screenSize.height) return 0
  const streamIsLandscape = screenSize.width > screenSize.height
  const visualIsLandscape = orientation.startsWith("landscape")
  if (streamIsLandscape === visualIsLandscape) return 0
  if (visualIsLandscape) return orientation === "landscape_right" ? -90 : 90
  return orientation === "portrait_upside_down" ? 90 : -90
}

export function mapPointToStream(
  point: { x: number; y: number },
  rotation: -90 | 0 | 90
): { x: number; y: number } {
  if (rotation === 90) return { x: point.y, y: 1 - point.x }
  if (rotation === -90) return { x: 1 - point.y, y: point.x }
  return point
}

export function parseSimulatorScreenConfigFrame(
  frame: ArrayBuffer | Uint8Array
): SimulatorScreenConfig | null {
  const bytes = frame instanceof Uint8Array ? frame : new Uint8Array(frame)
  if (bytes[0] !== 130) return null

  try {
    const config = JSON.parse(new TextDecoder().decode(bytes.subarray(1))) as {
      width?: unknown
      height?: unknown
      orientation?: unknown
      supportsHingeAngle?: unknown
      hingeAngle?: unknown
      hingePose?: unknown
      screenId?: unknown
    }
    if (
      typeof config.width !== "number" ||
      typeof config.height !== "number" ||
      !Number.isFinite(config.width) ||
      !Number.isFinite(config.height) ||
      config.width <= 0 ||
      config.height <= 0
    ) {
      return null
    }

    return {
      screenSize: { width: config.width, height: config.height },
      orientation:
        config.orientation === "portrait" ||
        config.orientation === "landscape_left" ||
        config.orientation === "portrait_upside_down" ||
        config.orientation === "landscape_right"
          ? config.orientation
          : undefined,
      ...(typeof config.supportsHingeAngle === "boolean"
        ? { supportsHingeAngle: config.supportsHingeAngle }
        : {}),
      ...(typeof config.hingeAngle === "number" &&
      Number.isFinite(config.hingeAngle) &&
      config.hingeAngle >= 0 &&
      config.hingeAngle <= 180
        ? { hingeAngle: config.hingeAngle }
        : {}),
      ...(config.hingePose === "closed" ||
      config.hingePose === "book" ||
      config.hingePose === "open" ||
      config.hingePose === "laptop" ||
      config.hingePose === "tent"
        ? { hingePose: config.hingePose }
        : {}),
      ...(typeof config.screenId === "number" && Number.isInteger(config.screenId)
        ? { screenId: config.screenId }
        : {}),
    }
  } catch {
    return null
  }
}

function measureChrome(screenSize: PaneSize, kind: DeviceFrameKind) {
  const shortSide = Math.min(screenSize.width, screenSize.height)
  return {
    bezel: kind === "phone" ? clamp(shortSide * 0.021, 7, 15) : clamp(shortSide * 0.026, 8, 22),
    outerRadius:
      kind === "phone" ? clamp(shortSide * 0.135, 34, 92) : clamp(shortSide * 0.065, 24, 56),
  }
}

export function fitDeviceFrameToPane(
  paneSize: PaneSize | null,
  screenAspectRatio: number,
  kind: DeviceFrameKind
): DeviceFrameLayout | null {
  let screenSize = fitScreenToPane(paneSize, screenAspectRatio)

  // The bezel itself scales with the device. Re-fit after measuring it so the
  // complete outer frame is contained by the pane during narrow resizes.
  for (let index = 0; index < 4; index += 1) {
    if (!screenSize || !paneSize) {
      return null
    }
    const { bezel } = measureChrome(screenSize, kind)
    screenSize = fitScreenToPane(
      {
        width: Math.max(1, paneSize.width - bezel * 2 - fitMarginPx),
        height: Math.max(1, paneSize.height - bezel * 2 - fitMarginPx),
      },
      screenAspectRatio
    )
  }

  if (!screenSize) {
    return null
  }

  const { bezel, outerRadius } = measureChrome(screenSize, kind)

  return {
    kind,
    width: screenSize.width + bezel * 2,
    height: screenSize.height + bezel * 2,
    bezel,
    outerRadius,
  }
}
