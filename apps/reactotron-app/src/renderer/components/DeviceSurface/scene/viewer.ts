// Adapted from T3 Code (MIT), packages/client-runtime/src/device/phoneViewer.ts and
// renderScheduler.ts. See THIRD_PARTY_NOTICES.md.
import {
  type Group,
  AmbientLight,
  Box3,
  CanvasTexture,
  DirectionalLight,
  LinearFilter,
  LinearMipmapLinearFilter,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from "three"

import { createDuoScene, DEFAULT_DUO_INNER_ASPECT, isDuoInnerAspect } from "./duoScene"
import { createDeviceFraming } from "./framing"
import { createImportedPhoneScene } from "./modelScene"
import { createDeviceMotion, nearestDeviceView } from "./motion"
import {
  createPhoneScene,
  displayLayout,
  type DeviceSkin,
  type DeviceOrientation,
  type ScreenPoint,
} from "./phoneScene"
import { IOS_PHONE_SHAPE, type DeviceShapeProfile } from "./shapeProfile"

/** The decoded picture. The caller owns it and the stream that fills it. */
export type FrameSource = HTMLCanvasElement | HTMLImageElement

/** A WebCodecs VideoFrame handed over by the decoder; the viewer closes it. */
export type DecodedFrame = {
  readonly displayWidth: number
  readonly displayHeight: number
  close(): void
}

/** Hinge state for an iPhone Duo; null renders a single-slab phone or tablet. */
export type DuoState = { angle: number; coverActive: boolean }

export interface DeviceViewer {
  readonly frameUpdated: () => void
  readonly setScreen: (orientation: DeviceOrientation, profile: DeviceShapeProfile) => void
  readonly setDuo: (duo: DuoState | null) => void
  /** A realistic body found on this machine, or null for the procedural one. */
  readonly setModel: (model: Group | null) => void
  /** An official 2D front face for the procedural body (Android emulator skins). */
  readonly setSkin: (skin: DeviceSkin | null) => void
  readonly resize: (width: number, height: number, pixelRatio: number) => void
  readonly screenPoint: (x: number, y: number, captured?: boolean) => ScreenPoint | null
  readonly orbit: (deltaX: number, deltaY: number) => void
  readonly setInteractionActive: (active: boolean, mode: "touch" | "orbit") => void
  readonly resetPose: () => void
  readonly dispose: () => void
}

const DUO_TURN_MS = 650
// Each screen update still costs a texture upload, a mipmap rebuild and a redraw.
// 20 a second looked choppy; 30 keeps navigation smooth.
const MIN_FRAME_INTERVAL_MS = 1000 / 30

function sourceSize(source: FrameSource) {
  return source instanceof HTMLImageElement
    ? { width: source.naturalWidth, height: source.naturalHeight }
    : { width: source.width, height: source.height }
}

/** Supersample on standard-density displays; the browser's downscale keeps text crisp. */
export function renderPixelRatio(devicePixelRatio: number) {
  return Math.min(3, Math.max(2, devicePixelRatio))
}

/** Coalesces invalidations into one render. No work is scheduled while the view is idle. */
function createRenderScheduler(render: () => void) {
  let pending: number | null = null
  let disposed = false
  return {
    invalidate() {
      if (disposed || pending !== null) return
      pending = requestAnimationFrame(() => {
        pending = null
        if (!disposed) render()
      })
    },
    dispose() {
      disposed = true
      if (pending !== null) cancelAnimationFrame(pending)
      pending = null
    },
  }
}

/** Owns only presentation resources. Throws when WebGL is unavailable so the caller can fall back. */
export function createDeviceViewer(options: {
  readonly canvas: HTMLCanvasElement
  readonly source: FrameSource
  readonly onUnavailable: () => void
  readonly orientation: DeviceOrientation
  readonly profile?: DeviceShapeProfile
  readonly duo?: DuoState | null
  readonly model?: Group | null
  readonly skin?: DeviceSkin | null
  readonly onModelRejected?: (cause: unknown) => void
  /** The newest decoded frame not yet taken, or null; snapshots `source` when absent. */
  readonly takeFrame?: () => DecodedFrame | null
}): DeviceViewer {
  const renderer = new WebGLRenderer({
    canvas: options.canvas,
    alpha: true,
    // The canvas is already drawn at 2x or more (renderPixelRatio), so multisampling
    // adds GPU work without a visible gain.
    antialias: false,
    powerPreference: "low-power",
  })
  renderer.outputColorSpace = SRGBColorSpace
  const source = options.source
  // Simulator framebuffers are native resolution (1206x2622 for an iPhone 18 Pro)
  // and land on a screen a few hundred pixels wide. Plain bilinear sampling skips
  // most of those pixels and shimmers; trilinear mipmaps average them as the flat
  // <canvas> downscale does.
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  const makeTexture = () => {
    const next = new CanvasTexture(source)
    next.colorSpace = SRGBColorSpace
    next.minFilter = LinearMipmapLinearFilter
    next.magFilter = LinearFilter
    next.generateMipmaps = true
    next.anisotropy = anisotropy
    return next
  }
  let texture = makeTexture()
  let textureSize = sourceSize(source)
  // The size the texture's storage was allocated at. three.js cannot resize it in
  // place, so an image of another size needs a fresh texture.
  let uploadSize = textureSize
  const scene = new Scene()
  const camera = new PerspectiveCamera(32, 1, 0.1, 30)
  camera.position.z = 5.5
  const key = new DirectionalLight(0xe4edff, 5)
  key.position.set(-3, 4, 5)
  const rim = new DirectionalLight(0xffffff, 4)
  rim.position.set(3, 1, -3)
  const fill = new DirectionalLight(0x9facd4, 2)
  fill.position.set(-2, -2, -4)
  scene.add(new AmbientLight(0xffffff, 2.4), key, rim, fill)

  let orientation = options.orientation
  let profile = options.profile ?? IOS_PHONE_SHAPE
  let duo = options.duo ?? null
  let model = options.model ?? null
  let skin = options.skin ?? null
  // A skin drawn for a different screen shape would misplace the picture; skip it.
  const usableSkin = () =>
    skin && Math.abs(skin.display.width / skin.display.height - layout.aspect) <= 0.02 ? skin : null
  let layout = displayLayout(orientation, textureSize.width, textureSize.height)
  const rawAspect = () => {
    const { width, height } = sourceSize(source)
    return width && height ? width / height : 0
  }
  let duoAspect = isDuoInnerAspect(rawAspect()) ? rawAspect() : DEFAULT_DUO_INNER_ASPECT
  let duoTurn: { from: number; to: number; startedAt: number } | null = null

  const buildScene = () => {
    if (duo) {
      const next = createDuoScene(texture, layout, duo.angle, duoAspect)
      next.setDisplay(texture, layout, duo.coverActive)
      return next
    }
    if (model) {
      let imported: ReturnType<typeof createImportedPhoneScene> | null = null
      try {
        imported = createImportedPhoneScene(model, texture, layout)
      } catch (cause) {
        // Structurally unusable; stay on the procedural body for this viewer's lifetime.
        model = null
        options.onModelRejected?.(cause)
      }
      // A model built for another screen shape would stretch the picture. Draw a body
      // until frames arrive in the shape it was made for (layout changes rebuild).
      if (imported && Math.abs(imported.aspect - layout.aspect) <= 0.02) return imported
      imported?.dispose()
    }
    return createPhoneScene(texture, layout, profile, usableSkin())
  }
  let device:
    | ReturnType<typeof createPhoneScene>
    | ReturnType<typeof createDuoScene>
    | ReturnType<typeof createImportedPhoneScene> = buildScene()
  scene.add(device.root)
  const replaceScene = () => {
    scene.remove(device.root)
    device.dispose()
    device = buildScene()
    scene.add(device.root)
  }

  let disposed = false
  const rest = new Quaternion()
  const motion = createDeviceMotion({
    choose: (rotation) =>
      nearestDeviceView(rotation, [{ rotation: new Quaternion(), yawLimit: Math.PI / 3 }])!
        .rotation,
  })
  motion.setPose(rest, performance.now(), true)
  const framing = createDeviceFraming()
  const reducedMotion = () =>
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  let viewport = { width: 0, height: 0, pixelRatio: 1 }
  let drawingBuffer = { width: 0, height: 0, pixelRatio: 0 }

  // A Duo turns as a whole with its hinge; a slab turns its body to the OS orientation.
  const bodyRotation = () => (duo ? 0 : layout.rotation)
  const applyPose = () => {
    device.root.quaternion.copy(motion.rotation)
    device.orientation.rotation.z = bodyRotation()
  }
  const applyCamera = () => {
    camera.position.set(framing.center.x, framing.center.y, framing.distance())
    camera.lookAt(framing.center.x, framing.center.y, 0)
    camera.updateProjectionMatrix()
  }
  const fit = (immediate = false) => {
    if (!viewport.width || !viewport.height) return
    camera.aspect = viewport.width / viewport.height
    device.root.updateMatrixWorld(true)
    framing.setBounds(
      new Box3().setFromObject(device.root),
      (camera.fov * Math.PI) / 360,
      camera.aspect,
      performance.now(),
      immediate
    )
    applyCamera()
  }

  const scheduler = createRenderScheduler(() => {
    if (disposed || !viewport.width || !viewport.height) return
    try {
      if (
        drawingBuffer.width !== viewport.width ||
        drawingBuffer.height !== viewport.height ||
        drawingBuffer.pixelRatio !== viewport.pixelRatio
      ) {
        // Canvas allocation clears the previous image. Commit it with the redraw,
        // rather than exposing an empty buffer between ResizeObserver and the next frame.
        renderer.setDrawingBufferSize(viewport.width, viewport.height, viewport.pixelRatio)
        drawingBuffer = viewport
      }
      const now = performance.now()
      if (motion.advance(now, reducedMotion())) {
        applyPose()
        fit(reducedMotion())
      }
      if (duoTurn && "setAngle" in device) {
        const progress = Math.min(1, (now - duoTurn.startedAt) / DUO_TURN_MS)
        const eased = progress * progress * (3 - 2 * progress)
        device.setAngle(duoTurn.from + (duoTurn.to - duoTurn.from) * eased)
        if (progress === 1) duoTurn = null
        fit(reducedMotion())
      }
      framing.advance(now, reducedMotion())
      applyCamera()
      renderer.render(scene, camera)
      unuploaded = null
      while (retiredImages.length) retiredImages.pop()?.close()
      if (motion.needsFrame() || framing.needsFrame() || duoTurn) scheduler.invalidate()
    } catch {
      options.onUnavailable()
    }
  })

  const updateLayout = () => {
    const size = sourceSize(source)
    if (!size.width || !size.height) return
    const next = displayLayout(orientation, size.width, size.height)
    const resized = textureSize.width !== size.width || textureSize.height !== size.height
    if (resized) {
      // The body and renderer survive framebuffer rotation and native resolution changes.
      const previous = texture
      texture = makeTexture()
      textureSize = size
      uploadSize = size
      retire(previous.image)
      previous.dispose()
    }
    const aspect = rawAspect()
    const duoBodyChanged =
      duo !== null && !duo.coverActive && isDuoInnerAspect(aspect) && aspect !== duoAspect
    if (duoBodyChanged) duoAspect = aspect
    const slabChanged =
      duo === null && (next.aspect !== layout.aspect || next.rawLandscape !== layout.rawLandscape)
    const rotated = next.rotation !== layout.rotation
    layout = next
    if (duoBodyChanged || slabChanged) {
      replaceScene()
    } else if (resized || rotated) {
      if ("setAngle" in device) device.setDisplay(texture, layout, duo?.coverActive ?? false)
      else device.setDisplay(texture, layout)
    }
    if (resized || duoBodyChanged || slabChanged || rotated) {
      applyPose()
      fit(true)
    }
  }

  let lastFrameAt = -Infinity
  let frameTimer: number | undefined
  // Images already uploaded; released once the next frame has rendered.
  const retiredImages: { close(): void }[] = []
  // The newest image, until a render uploads it. A hidden window never renders, so
  // replacing it closes it at once; queuing it would hold every decoded frame and
  // starve the decoder's frame pool.
  let unuploaded: unknown = null
  const retire = (image: unknown) => {
    const closable = image as { close?: () => void } | null
    if (typeof closable?.close !== "function") return
    if (image === unuploaded) {
      closable.close()
      unuploaded = null
    } else {
      retiredImages.push(closable as { close(): void })
    }
  }
  const showImage = (image: object, size: { width: number; height: number }, flipY: boolean) => {
    if (size.width !== uploadSize.width || size.height !== uploadSize.height) {
      const previous = texture
      texture = makeTexture()
      uploadSize = size
      retire(previous.image)
      previous.dispose()
      if ("setAngle" in device) device.setDisplay(texture, layout, duo?.coverActive ?? false)
      else device.setDisplay(texture, layout)
    }
    retire(texture.image)
    texture.image = image
    unuploaded = image
    texture.flipY = flipY
    texture.needsUpdate = true
    scheduler.invalidate()
  }
  let snapshotPending = false
  const applyFrame = () => {
    frameTimer = undefined
    if (disposed) return
    lastFrameAt = performance.now()
    updateLayout()
    // A decoded frame uploads GPU to GPU. Snapshotting the 2D canvas instead held
    // the GPU process's main thread for up to 150 ms a frame during navigation.
    const frame = options.takeFrame?.()
    if (frame) {
      const size = { width: frame.displayWidth, height: frame.displayHeight }
      // three.js sizes textures from width and height, which a VideoFrame lacks.
      Object.defineProperties(frame, {
        width: { value: size.width },
        height: { value: size.height },
      })
      showImage(frame, size, true)
      return
    }
    // Uploading the 2D canvas itself makes Chromium read it back on every frame.
    // An ImageBitmap snapshot stays on the GPU, so the upload is a GPU copy.
    if (typeof createImageBitmap !== "function" || snapshotPending) {
      if (!snapshotPending) {
        texture.needsUpdate = true
        scheduler.invalidate()
      }
      return
    }
    snapshotPending = true
    createImageBitmap(source, { imageOrientation: "flipY" })
      .then((bitmap) => {
        snapshotPending = false
        if (disposed) {
          bitmap.close()
          return
        }
        // createImageBitmap already flipped it; WebGL ignores UNPACK_FLIP_Y for bitmaps.
        showImage(bitmap, { width: bitmap.width, height: bitmap.height }, false)
      })
      .catch(() => {
        snapshotPending = false
        texture.needsUpdate = true
        scheduler.invalidate()
      })
  }

  const contextLost = (event: Event) => {
    event.preventDefault()
    options.onUnavailable()
  }
  options.canvas.addEventListener("webglcontextlost", contextLost)
  applyPose()

  return {
    frameUpdated() {
      if (disposed || frameTimer !== undefined) return
      // A busy simulator streams up to 60 frames a second, and every one used to
      // cost a texture upload, a mipmap rebuild and a full redraw in the GPU
      // process. Apply at most one frame per interval; the trailing timer still
      // shows the newest frame once the stream goes quiet.
      const wait = lastFrameAt + MIN_FRAME_INTERVAL_MS - performance.now()
      if (wait > 0) {
        frameTimer = window.setTimeout(applyFrame, wait)
        return
      }
      applyFrame()
    },
    setScreen(nextOrientation, nextProfile) {
      if (disposed) return
      const profileChanged = nextProfile !== profile
      orientation = nextOrientation
      profile = nextProfile
      if (profileChanged && !duo) {
        replaceScene()
        applyPose()
        fit(true)
      }
      updateLayout()
      scheduler.invalidate()
    },
    setModel(next) {
      if (disposed || next === model) return
      model = next
      if (duo) return
      replaceScene()
      applyPose()
      fit(true)
      scheduler.invalidate()
    },
    setSkin(next) {
      if (disposed || next === skin) return
      skin = next
      if (duo || model) return
      replaceScene()
      applyPose()
      fit(true)
      scheduler.invalidate()
    },
    setDuo(next) {
      if (disposed) return
      const previous = duo
      duo = next
      if (!next || !previous || !("setAngle" in device)) {
        duoTurn = null
        replaceScene()
        applyPose()
        fit(true)
      } else {
        if (next.coverActive !== previous.coverActive) {
          device.setDisplay(texture, layout, next.coverActive)
        }
        if (next.angle !== previous.angle) {
          if (reducedMotion()) {
            duoTurn = null
            device.setAngle(next.angle)
            fit(true)
          } else {
            duoTurn = { from: device.angle, to: next.angle, startedAt: performance.now() }
          }
        }
      }
      scheduler.invalidate()
    },
    resize(width, height, pixelRatio) {
      if (disposed) return
      if (![width, height, pixelRatio].every(Number.isFinite) || width <= 0 || height <= 0) return
      const ratio = renderPixelRatio(pixelRatio)
      if (viewport.width === width && viewport.height === height && viewport.pixelRatio === ratio)
        return
      viewport = { width, height, pixelRatio: ratio }
      fit(true)
      scheduler.invalidate()
    },
    screenPoint(x, y, captured = false) {
      if (disposed) return null
      applyPose()
      return device.screenPoint(x, y, camera, captured)
    },
    orbit(deltaX, deltaY) {
      if (disposed) return
      motion.orbit(deltaX * viewport.width, deltaY * viewport.height, performance.now())
      scheduler.invalidate()
    },
    setInteractionActive(active, mode) {
      if (disposed) return
      const now = performance.now()
      if (mode === "orbit") motion.dragActive(active, now)
      else {
        motion.hold(active, now)
        framing.hold(active, now)
      }
      scheduler.invalidate()
    },
    resetPose() {
      if (disposed) return
      motion.reset(rest, performance.now())
      scheduler.invalidate()
    },
    dispose() {
      if (disposed) return
      disposed = true
      window.clearTimeout(frameTimer)
      scheduler.dispose()
      options.canvas.removeEventListener("webglcontextlost", contextLost)
      scene.remove(device.root)
      device.dispose()
      retire(texture.image)
      while (retiredImages.length) retiredImages.pop()?.close()
      texture.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
}
