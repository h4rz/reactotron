// Adapted from T3 Code (MIT), packages/client-runtime/src/device/shapeProfile.ts.
// See THIRD_PARTY_NOTICES.md.

export type DevicePlatform = "ios" | "android"

export interface DeviceShapeProfile {
  readonly id: "ios-phone" | "ios-tablet" | "android-phone" | "android-tablet" | "pixel-phone"
  readonly bezel: number
  readonly bodyRadius: number
  readonly screenRadius: number
  readonly depth: number
  readonly backColor: number
  /** Matte glass backs (Pixel) scatter light; polished ones reflect it. */
  readonly backRoughness?: number
  readonly buttons: ReadonlyArray<{
    readonly edge: "left" | "right" | "top"
    readonly offset: number
    readonly length: number
  }>
  readonly camera: {
    /** "plate": a corner island (iPhone and generic). "bar": a full-width visor (Pixel 6 onwards). */
    readonly style?: "plate" | "bar"
    readonly width: number
    readonly height: number
    readonly insetX: number
    readonly insetY: number
    readonly lensRadius: number
    readonly lenses: ReadonlyArray<readonly [number, number]>
    readonly flash: readonly [number, number] | null
  }
}

/** Original family silhouettes, rather than claims to reproduce individual hardware models. */
export const IOS_PHONE_SHAPE: DeviceShapeProfile = {
  id: "ios-phone",
  bezel: 0.055,
  bodyRadius: 0.15,
  screenRadius: 0.105,
  depth: 0.085,
  backColor: 0x424b5d,
  buttons: [
    { edge: "right", offset: 0.35, length: 0.3 },
    { edge: "left", offset: 0.48, length: 0.18 },
    { edge: "left", offset: 0.22, length: 0.18 },
  ],
  camera: {
    width: 0.39,
    height: 0.44,
    insetX: 0.25,
    insetY: 0.29,
    lensRadius: 0.068,
    lenses: [
      [-0.08, 0.095],
      [0.08, -0.095],
    ],
    flash: [0.085, 0.11],
  },
}

export const IOS_TABLET_SHAPE: DeviceShapeProfile = {
  id: "ios-tablet",
  bezel: 0.065,
  bodyRadius: 0.105,
  screenRadius: 0.045,
  depth: 0.055,
  backColor: 0x9ca5af,
  buttons: [
    { edge: "top", offset: 0.5, length: 0.15 },
    { edge: "right", offset: 0.78, length: 0.13 },
    { edge: "right", offset: 0.58, length: 0.13 },
  ],
  camera: {
    width: 0.19,
    height: 0.19,
    insetX: 0.15,
    insetY: 0.15,
    lensRadius: 0.045,
    lenses: [[0, 0]],
    flash: null,
  },
}

export const ANDROID_PHONE_SHAPE: DeviceShapeProfile = {
  id: "android-phone",
  bezel: 0.035,
  bodyRadius: 0.115,
  screenRadius: 0.08,
  depth: 0.085,
  backColor: 0x344449,
  buttons: [
    { edge: "right", offset: 0.2, length: 0.24 },
    { edge: "right", offset: 0.65, length: 0.32 },
  ],
  camera: {
    width: 0.24,
    height: 0.47,
    insetX: 0.18,
    insetY: 0.29,
    lensRadius: 0.056,
    lenses: [
      [0, 0.11],
      [0, -0.11],
    ],
    flash: [0.1, 0],
  },
}

/**
 * Pixel 6 onwards: a pill-shaped metal camera bar across the back holding a
 * black glass strip with the lenses, flash and sensor beside it. Proportions
 * follow the Pixel 9 Pro (72 mm wide, a ~60 x 20 mm bar ~15 mm from the top).
 */
export const PIXEL_PHONE_SHAPE: DeviceShapeProfile = {
  ...ANDROID_PHONE_SHAPE,
  id: "pixel-phone",
  backColor: 0x26292c,
  backRoughness: 0.62,
  buttons: [],
  camera: {
    style: "bar",
    // Fractions of the body width (width/height) and of the body height (insetY).
    width: 0.84,
    height: 0.28,
    insetX: 0,
    insetY: 0.1,
    lensRadius: 0.07,
    // Lens centres across the glass strip, as fractions of the bar width from its left end.
    lenses: [
      [0.14, 0],
      [0.3, 0],
      [0.46, 0],
    ],
    flash: [0.66, 0.03],
  },
}

const ANDROID_TABLET_SHAPE: DeviceShapeProfile = {
  ...IOS_TABLET_SHAPE,
  id: "android-tablet",
  backColor: 0x697b80,
}

/** Names identify a family when available; wide unknown screens get a generic tablet shell. */
export function resolveDeviceShape(options: {
  platform: DevicePlatform
  name?: string
  portraitAspect: number
}): DeviceShapeProfile {
  const name = options.name ?? ""
  const namedTablet = /\b(ipad|tablet)\b/i.test(name)
  const namedPhone = /\b(iphone|phone)\b/i.test(name)
  const tablet = namedTablet || (!namedPhone && options.portraitAspect >= 0.6)
  if (options.platform === "ios") return tablet ? IOS_TABLET_SHAPE : IOS_PHONE_SHAPE
  if (tablet) return ANDROID_TABLET_SHAPE
  // Pixel 6 onwards share the camera bar; older Pixels and other phones get the generic back.
  const pixel = /\bpixel[\s_]+(\d+)/i.exec(name)
  return pixel && Number(pixel[1]) >= 6 ? PIXEL_PHONE_SHAPE : ANDROID_PHONE_SHAPE
}
