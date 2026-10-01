// Adapted from T3 Code (MIT), packages/client-runtime/src/device/phoneScene.ts.
// See THIRD_PARTY_NOTICES.md.
import {
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Plane,
  PlaneGeometry,
  Raycaster,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Camera,
  type Texture,
} from "three"

import { IOS_PHONE_SHAPE, type DeviceShapeProfile } from "./shapeProfile"

export const SCREEN_HEIGHT = 2.2
// iOS starts Notification Center, Control Center and the home and back swipes
// only from the very edge of the glass. A pointer aimed at the edge of a small
// 3D screen lands a few points inside it (measured: 0.5%-4% of the height), so a
// touch that begins this close to an edge starts exactly on it, as a fingertip would.
const EDGE_SNAP_V = 0.06
const EDGE_SNAP_U = 0.03

export type DeviceOrientation =
  | "portrait"
  | "landscape_left"
  | "portrait_upside_down"
  | "landscape_right"

export type DisplayLayout = {
  /** Short side over long side of the framebuffer. */
  aspect: number
  /** Rotation of the whole body around the viewer's axis. */
  rotation: number
  /** The framebuffer itself is wider than tall. */
  rawLandscape: boolean
}

/** An official 2D device frame (an Android emulator skin) and where its display sits, in pixels. */
export type DeviceSkin = {
  texture: Texture
  /** Drawn over the live display: the camera cutout, transparent elsewhere. */
  mask: Texture | null
  frame: { width: number; height: number }
  display: { x: number; y: number; width: number; height: number; cornerRadius: number }
}

/** A normalized point in framebuffer space, top-left origin, as serve-sim and adb expect. */
export type ScreenPoint = { x: number; y: number }

export function roundedPath(width: number, height: number, radius: number, path = new Shape()) {
  const x = -width / 2
  const y = -height / 2
  path.moveTo(x + radius, y)
  path.lineTo(x + width - radius, y)
  path.quadraticCurveTo(x + width, y, x + width, y + radius)
  path.lineTo(x + width, y + height - radius)
  path.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  path.lineTo(x + radius, y + height)
  path.quadraticCurveTo(x, y + height, x, y + height - radius)
  path.lineTo(x, y + radius)
  path.quadraticCurveTo(x, y, x + radius, y)
  return path
}

/**
 * Display orientation is independent of orbit. Texture coordinates stay in raw
 * framebuffer space, so serve-sim may keep portrait pixels after a rotate and
 * the body still turns to match the requested orientation.
 */
export function displayLayout(
  orientation: DeviceOrientation | undefined,
  rawWidth: number,
  rawHeight: number
): DisplayLayout {
  const width = rawWidth || 900
  const height = rawHeight || 1950
  const rotation =
    orientation === "landscape_left"
      ? -Math.PI / 2
      : orientation === "landscape_right"
        ? Math.PI / 2
        : orientation === "portrait_upside_down"
          ? Math.PI
          : 0
  return {
    aspect: Math.min(width, height) / Math.max(width, height),
    rotation,
    rawLandscape: width > height,
  }
}

/** Canonical portrait coordinates (0..1, bottom-left origin) to texture coordinates. */
function canonicalToTexture(u: number, v: number, layout: DisplayLayout) {
  if (!layout.rawLandscape) return { u, v }
  return layout.rotation > 0 ? { u: 1 - v, v: u } : { u: v, v: 1 - u }
}

/** Canonical portrait geometry maps to raw framebuffer coordinates in every OS orientation. */
export function updateDisplayUv(
  geometry: BufferGeometry,
  width: number,
  height: number,
  layout: DisplayLayout
) {
  const position = geometry.getAttribute("position")
  if (!geometry.hasAttribute("uv")) {
    geometry.setAttribute("uv", new Float32BufferAttribute(new Float32Array(position.count * 2), 2))
  }
  const uv = geometry.getAttribute("uv")
  for (let i = 0; i < position.count; i++) {
    const mapped = canonicalToTexture(
      (position.getX(i) + width / 2) / width,
      (position.getY(i) + height / 2) / height,
      layout
    )
    uv.setXY(i, mapped.u, mapped.v)
  }
  uv.needsUpdate = true
}

/**
 * New touches hit only the front display; captured drags project onto its
 * plane and clamp, so a swipe that leaves the glass still ends cleanly.
 */
export function createDisplayProjection(
  display: Mesh,
  orientation: Group,
  width: number,
  height: number,
  getLayout: () => DisplayLayout
) {
  const raycaster = new Raycaster()
  const pointer = new Vector2()
  const local = new Vector3()
  display.geometry.computeBoundingBox()
  const z = display.position.z + (display.geometry.boundingBox?.max.z ?? 0)
  const plane = new Plane(new Vector3(0, 0, 1), -z)
  return (x: number, y: number, camera: Camera, captured = false): ScreenPoint | null => {
    orientation.updateWorldMatrix(true, true)
    camera.updateMatrixWorld(true)
    pointer.set(x * 2 - 1, 1 - y * 2)
    raycaster.setFromCamera(pointer, camera)
    // A press off the glass, including on the frame, turns the device; only a
    // touch already captured on the glass keeps projecting onto its plane.
    if (!captured) {
      const hit = raycaster.intersectObject(display, false)[0]
      if (!hit) return null
      local.copy(hit.point)
      orientation.worldToLocal(local)
    } else {
      const ray = raycaster.ray.clone().applyMatrix4(orientation.matrixWorld.clone().invert())
      if (!ray.intersectPlane(plane, local)) return null
    }
    let u = Math.min(1, Math.max(0, (local.x + width / 2) / width))
    let v = Math.min(1, Math.max(0, (local.y + height / 2) / height))
    if (!captured) {
      // Only the starting point snaps; the rest of the drag follows the pointer.
      if (u < EDGE_SNAP_U) u = 0
      else if (u > 1 - EDGE_SNAP_U) u = 1
      if (v < EDGE_SNAP_V) v = 0
      else if (v > 1 - EDGE_SNAP_V) v = 1
    }
    const texture = canonicalToTexture(u, v, getLayout())
    return { x: texture.u, y: 1 - texture.v }
  }
}

/** An original procedural device body. It makes no claim to reproduce a particular hardware model. */
export function createPhoneScene(
  texture: Texture,
  layout: DisplayLayout,
  profile: DeviceShapeProfile = IOS_PHONE_SHAPE,
  skin: DeviceSkin | null = null
) {
  const { aspect } = layout
  const root = new Group()
  const orientation = new Group()
  root.add(orientation)
  const screenWidth = SCREEN_HEIGHT * aspect
  // An official skin fixes the body's proportions; scene units follow its display height.
  const skinScale = skin ? SCREEN_HEIGHT / skin.display.height : 0
  // The skin's width includes side buttons drawn in profile; keep the body inside them.
  const width = skin ? skin.frame.width * skinScale - 0.03 : screenWidth + profile.bezel * 2
  const height = skin ? skin.frame.height * skinScale - 0.01 : SCREEN_HEIGHT + profile.bezel * 2
  const bodyRadius = skin
    ? (skin.display.cornerRadius + Math.min(skin.display.x, skin.display.y)) * skinScale
    : profile.bodyRadius
  const screenRadius = skin ? skin.display.cornerRadius * skinScale : profile.screenRadius
  const backZ = 0.01 - profile.depth
  const metal = new MeshStandardMaterial({ color: 0xb5bcc7, metalness: 0.88, roughness: 0.27 })
  const glass = new MeshPhysicalMaterial({
    color: 0x141820,
    metalness: 0.15,
    roughness: 0.2,
    clearcoat: 1,
  })
  const backMaterial = new MeshStandardMaterial({
    color: profile.backColor,
    metalness: profile.backRoughness ? 0.1 : 0.45,
    roughness: profile.backRoughness ?? 0.32,
  })
  const lensMaterial = new MeshPhysicalMaterial({
    color: 0x071326,
    metalness: 0.6,
    roughness: 0.12,
    clearcoat: 1,
  })
  const flashMaterial = new MeshBasicMaterial({ color: 0xf2ead6 })
  const screenMaterial = new MeshBasicMaterial({ map: texture, toneMapped: false })
  const materials = [metal, glass, backMaterial, lensMaterial, flashMaterial, screenMaterial]

  const body = new Mesh(
    new ExtrudeGeometry(roundedPath(width, height, bodyRadius), {
      depth: profile.depth,
      bevelEnabled: true,
      bevelSize: 0.012,
      bevelThickness: 0.012,
      bevelSegments: 3,
      steps: 1,
      curveSegments: 12,
    }),
    metal
  )
  body.position.z = 0.025 - profile.depth
  orientation.add(body)
  const face = new Mesh(
    new ShapeGeometry(roundedPath(width - 0.014, height - 0.014, bodyRadius - 0.01), 16),
    glass
  )
  face.position.z = 0.04
  orientation.add(face)
  const back = new Mesh(
    new ShapeGeometry(roundedPath(width - 0.012, height - 0.012, bodyRadius - 0.01), 16),
    backMaterial
  )
  back.rotation.y = Math.PI
  back.position.z = backZ
  orientation.add(back)

  const screenGeometry = new ShapeGeometry(
    roundedPath(screenWidth, SCREEN_HEIGHT, screenRadius),
    20
  )
  updateDisplayUv(screenGeometry, screenWidth, SCREEN_HEIGHT, layout)
  const display = new Mesh(screenGeometry, screenMaterial)
  display.position.z = 0.043
  orientation.add(display)

  if (skin) {
    // Google's front-face artwork sits just behind the live display, which covers its
    // blank screen area exactly; the procedural body supplies the sides and back.
    const skinMaterial = new MeshBasicMaterial({
      map: skin.texture,
      transparent: true,
      toneMapped: false,
    })
    materials.push(skinMaterial)
    const skinPlane = new Mesh(
      new PlaneGeometry(skin.frame.width * skinScale, skin.frame.height * skinScale),
      skinMaterial
    )
    skinPlane.position.set(
      (skin.frame.width / 2 - (skin.display.x + skin.display.width / 2)) * skinScale,
      (skin.display.y + skin.display.height / 2 - skin.frame.height / 2) * skinScale,
      0.0415
    )
    orientation.add(skinPlane)
    if (skin.mask) {
      const maskMaterial = new MeshBasicMaterial({
        map: skin.mask,
        transparent: true,
        toneMapped: false,
      })
      materials.push(maskMaterial)
      const maskPlane = new Mesh(new PlaneGeometry(screenWidth, SCREEN_HEIGHT), maskMaterial)
      maskPlane.position.z = 0.0435
      orientation.add(maskPlane)
    }
  }

  for (const { edge, offset, length } of skin ? [] : profile.buttons) {
    const button = new Mesh(
      new BoxGeometry(
        edge === "top" ? length : 0.026,
        edge === "top" ? 0.026 : length,
        profile.depth * 0.65
      ),
      metal
    )
    button.position.set(
      edge === "top" ? offset : (edge === "left" ? -1 : 1) * (width / 2 + 0.015),
      edge === "top" ? height / 2 + 0.015 : offset,
      (0.025 + backZ) / 2
    )
    orientation.add(button)
  }

  if (profile.camera.style === "bar") {
    addCameraBar()
  } else {
    addCameraPlate()
  }

  // A full-width pill visor (Pixel 6 onwards). Seen from behind, the lenses sit on the left.
  function addCameraBar() {
    const barWidth = width * profile.camera.width
    const barHeight = width * profile.camera.height
    const barDepth = 0.03
    const bar = new Group()
    bar.position.set(
      0,
      height / 2 - height * profile.camera.insetY - barHeight / 2,
      back.position.z + 0.001
    )
    // Rear components face outward; local -x is the viewer's left when looking at the back.
    bar.rotation.y = Math.PI
    orientation.add(bar)
    bar.add(
      new Mesh(
        new ExtrudeGeometry(roundedPath(barWidth, barHeight, barHeight / 2), {
          depth: barDepth,
          bevelEnabled: true,
          bevelSize: 0.012,
          bevelThickness: 0.01,
          bevelSegments: 4,
          curveSegments: 24,
        }),
        metal
      )
    )
    const front = barDepth + 0.01
    const stripWidth = barWidth * 0.56
    const stripHeight = barHeight - 0.07
    const strip = new Mesh(
      new ShapeGeometry(roundedPath(stripWidth, stripHeight, stripHeight / 2), 24),
      lensMaterial
    )
    strip.position.set(-barWidth / 2 + 0.035 + stripWidth / 2, 0, front + 0.0006)
    bar.add(strip)
    for (const [fraction, y] of profile.camera.lenses) {
      const x = -barWidth / 2 + fraction * barWidth
      const radius = profile.camera.lensRadius
      const ring = new Mesh(new CylinderGeometry(radius + 0.012, radius + 0.012, 0.008, 32), metal)
      ring.rotation.x = Math.PI / 2
      ring.position.set(x, y, front + 0.004)
      bar.add(ring)
      const lens = new Mesh(new CircleGeometry(radius, 32), glass)
      lens.position.set(x, y, front + 0.0085)
      bar.add(lens)
    }
    if (profile.camera.flash) {
      const [fraction, y] = profile.camera.flash
      const flash = new Mesh(new CircleGeometry(0.024, 20), flashMaterial)
      flash.position.set(-barWidth / 2 + fraction * barWidth, y, front + 0.0006)
      bar.add(flash)
      const sensor = new Mesh(new CircleGeometry(0.015, 16), lensMaterial)
      sensor.position.set(-barWidth / 2 + (fraction + 0.08) * barWidth, -y, front + 0.0006)
      bar.add(sensor)
    }
  }

  function addCameraPlate() {
    // Rear components share a surface-relative coordinate system, with outward positive Z.
    const rearCamera = new Group()
    rearCamera.position.set(
      width / 2 - profile.camera.insetX,
      height / 2 - profile.camera.insetY,
      back.position.z + 0.001
    )
    rearCamera.rotation.y = Math.PI
    orientation.add(rearCamera)
    const plateFront = 0.025 + 0.007
    const ringDepth = 0.025
    rearCamera.add(
      new Mesh(
        new ExtrudeGeometry(
          roundedPath(
            profile.camera.width,
            profile.camera.height,
            Math.min(profile.camera.width, profile.camera.height) / 4
          ),
          {
            depth: 0.025,
            bevelEnabled: true,
            bevelSize: 0.009,
            bevelThickness: 0.007,
            bevelSegments: 2,
          }
        ),
        backMaterial
      )
    )
    for (const [x, y] of profile.camera.lenses) {
      const radius = profile.camera.lensRadius
      const ring = new Mesh(new CylinderGeometry(radius + 0.014, radius + 0.014, 0.025, 32), metal)
      ring.rotation.x = Math.PI / 2
      ring.position.set(x, y, plateFront + ringDepth / 2 - 0.003)
      rearCamera.add(ring)
      const lens = new Mesh(new CircleGeometry(radius, 32), lensMaterial)
      lens.position.set(x, y, ring.position.z + ringDepth / 2 + 0.0005)
      rearCamera.add(lens)
    }
    if (profile.camera.flash) {
      const flash = new Mesh(new CircleGeometry(0.022, 20), flashMaterial)
      flash.position.set(profile.camera.flash[0], profile.camera.flash[1], plateFront + 0.0005)
      rearCamera.add(flash)
    }
  }

  let activeLayout = layout
  const screenPoint = createDisplayProjection(
    display,
    orientation,
    screenWidth,
    SCREEN_HEIGHT,
    () => activeLayout
  )
  return {
    root,
    orientation,
    width,
    height,
    screenPoint,
    setDisplay(nextTexture: Texture, nextLayout: DisplayLayout) {
      activeLayout = nextLayout
      screenMaterial.map = nextTexture
      updateDisplayUv(screenGeometry, screenWidth, SCREEN_HEIGHT, activeLayout)
    },
    dispose() {
      root.traverse((object) => {
        if (object instanceof Mesh) object.geometry.dispose()
      })
      for (const material of materials) material.dispose()
    },
  }
}

export type PhoneScene = ReturnType<typeof createPhoneScene>
