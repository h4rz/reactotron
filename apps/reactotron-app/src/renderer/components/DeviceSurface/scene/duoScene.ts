// Adapted from T3 Code (MIT), packages/client-runtime/src/device/androidFoldScene.ts.
// See THIRD_PARTY_NOTICES.md.
//
// T3 Code renders the iPhone Duo from Apple's AR model, which carries no
// redistribution license. This is an original procedural book-style body
// instead: one fixed half, one half turning on a shared hinge, the inner
// framebuffer spanning both halves and the cover framebuffer on the back.
import {
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Raycaster,
  Shape,
  ShapeGeometry,
  Vector2,
  type Camera,
  type Texture,
} from "three"

import { roundedPath, SCREEN_HEIGHT, type DisplayLayout, type ScreenPoint } from "./phoneScene"

const HEIGHT = SCREEN_HEIGHT
const DEPTH = 0.075
const INSET = 0.026
const CREASE = 0.004
const BEVEL = 0.008
// The hinge axis sits just above the inner screens so closed halves meet face to face.
const PIVOT_Z = DEPTH / 2 + 0.005
const SPINE_RADIUS = PIVOT_Z + DEPTH / 2 - 0.002
const SCREEN_RADIUS = 0.076

/** Width over height of the unfolded inner display until a live frame reports its own. */
export const DEFAULT_DUO_INNER_ASPECT = 1600 / 1125

/** Unfolded inner displays are near square. Cover displays are phone shaped and never retune the body. */
export const isDuoInnerAspect = (aspect: number) =>
  Number.isFinite(aspect) && aspect > 0.75 && aspect < 1.5

function panelPath(
  halfWidth: number,
  side: "left" | "right",
  inset: number,
  radius: number,
  hingeInset = 0
) {
  const left = side === "left" ? -halfWidth + inset : CREASE / 2 + hingeInset
  const right = side === "left" ? -CREASE / 2 - hingeInset : halfWidth - inset
  const bottom = -HEIGHT / 2 + inset
  const top = HEIGHT / 2 - inset
  const path = new Shape()
  if (side === "left") {
    path.moveTo(left + radius, bottom)
    path.lineTo(right, bottom)
    path.lineTo(right, top)
    path.lineTo(left + radius, top)
    path.quadraticCurveTo(left, top, left, top - radius)
    path.lineTo(left, bottom + radius)
    path.quadraticCurveTo(left, bottom, left + radius, bottom)
  } else {
    path.moveTo(left, bottom)
    path.lineTo(right - radius, bottom)
    path.quadraticCurveTo(right, bottom, right, bottom + radius)
    path.lineTo(right, top - radius)
    path.quadraticCurveTo(right, top, right - radius, top)
    path.lineTo(left, top)
  }
  path.closePath()
  return path
}

export function createDuoScene(
  texture: Texture,
  layout: DisplayLayout,
  initialAngle: number,
  innerAspect = DEFAULT_DUO_INNER_ASPECT
) {
  const screenHeight = HEIGHT - 2 * INSET
  const halfWidth = (innerAspect * screenHeight) / 2 + INSET
  const root = new Group()
  const orientation = new Group()
  root.add(orientation)
  const left = new Group()
  const right = new Group()
  orientation.add(left, right)
  const frameMetal = new MeshStandardMaterial({ color: 0xd9d6cf, metalness: 0.85, roughness: 0.3 })
  const polishedMetal = new MeshStandardMaterial({
    color: 0xe4e1da,
    metalness: 0.95,
    roughness: 0.16,
  })
  const bezel = new MeshPhysicalMaterial({
    color: 0x0b0d10,
    metalness: 0.1,
    roughness: 0.2,
    clearcoat: 1,
  })
  const backGlass = new MeshPhysicalMaterial({
    color: 0xe9e6df,
    metalness: 0.2,
    roughness: 0.5,
    clearcoat: 0.4,
    clearcoatRoughness: 0.6,
  })
  const island = new MeshPhysicalMaterial({
    color: 0xcfcac1,
    metalness: 0.55,
    roughness: 0.3,
    clearcoat: 1,
  })
  const lensMaterial = new MeshPhysicalMaterial({
    color: 0x061022,
    metalness: 0.6,
    roughness: 0.1,
    clearcoat: 1,
  })
  const flashMaterial = new MeshBasicMaterial({ color: 0xf2ead6 })
  const innerMaterial = new MeshBasicMaterial({ map: texture, toneMapped: false })
  const coverMaterial = new MeshBasicMaterial({ map: texture, toneMapped: false })
  const offMaterial = new MeshBasicMaterial({ color: 0x050608 })
  const materials = [
    frameMetal,
    polishedMetal,
    bezel,
    backGlass,
    island,
    lensMaterial,
    flashMaterial,
    innerMaterial,
    coverMaterial,
    offMaterial,
  ]

  // Each half's meshes live in body coordinates; `left` pivots them around the hinge axis.
  left.position.z = PIVOT_Z
  const leftBody = new Group()
  leftBody.position.z = -PIVOT_Z
  left.add(leftBody)

  function half(group: Group, side: "left" | "right", back: MeshPhysicalMaterial) {
    const body = new Mesh(
      new ExtrudeGeometry(panelPath(halfWidth, side, BEVEL, 0.1, BEVEL), {
        depth: DEPTH - BEVEL * 2,
        bevelEnabled: true,
        bevelSize: BEVEL,
        bevelThickness: BEVEL,
        bevelSegments: 3,
        curveSegments: 12,
      }),
      frameMetal
    )
    body.position.z = -DEPTH / 2 + BEVEL
    group.add(body)
    const frame = new Mesh(
      new ShapeGeometry(panelPath(halfWidth, side, 0.01, 0.095, 0.002), 12),
      bezel
    )
    frame.position.z = DEPTH / 2 + 0.001
    group.add(frame)
    // A back-facing shape mirrors X, so it is drawn from the opposite side's outline.
    const rear = new Mesh(
      new ShapeGeometry(
        panelPath(halfWidth, side === "left" ? "right" : "left", 0.01, 0.095, 0.002),
        12
      ),
      back
    )
    rear.rotation.y = Math.PI
    rear.position.set(0, 0, -DEPTH / 2 - 0.001)
    group.add(rear)
  }

  half(leftBody, "left", bezel)
  half(right, "right", backGlass)

  // One indexed surface keeps adjacent pixels joined at the crease. The
  // physical halves move separately underneath it.
  const screenWidth = 2 * (halfWidth - INSET)
  const screenGeometry = new PlaneGeometry(screenWidth, screenHeight, 40, 48)
  const screenPositions = screenGeometry.getAttribute("position")
  const screenUvs = screenGeometry.getAttribute("uv")
  const baseX = new Float32Array(screenPositions.count)
  for (let i = 0; i < screenPositions.count; i++) {
    const y = screenPositions.getY(i)
    const outerX = screenWidth / 2
    const outerY = screenHeight / 2
    const cornerY = Math.max(0, Math.abs(y) - (outerY - SCREEN_RADIUS))
    const limit =
      outerX -
      SCREEN_RADIUS +
      Math.sqrt(Math.max(0, SCREEN_RADIUS * SCREEN_RADIUS - cornerY * cornerY))
    const x = Math.max(-limit, Math.min(limit, screenPositions.getX(i)))
    baseX[i] = x
    screenUvs.setXY(i, x / screenWidth + 0.5, y / screenHeight + 0.5)
  }
  screenUvs.needsUpdate = true
  const innerSurface = new Mesh(screenGeometry, innerMaterial)
  orientation.add(innerSurface)

  // The outer half of the hinge housing. It tucks behind the back glass when
  // open and becomes the rounded spine when closed.
  const spineSlack = 0.15
  const spine = new Mesh(
    new CylinderGeometry(
      SPINE_RADIUS,
      SPINE_RADIUS,
      HEIGHT - 0.012,
      32,
      1,
      false,
      Math.PI / 2 + spineSlack,
      Math.PI - spineSlack * 2
    ),
    polishedMetal
  )
  spine.position.z = PIVOT_Z
  orientation.add(spine)

  const coverWidth = halfWidth - INSET * 2 - 0.02
  const coverHeight = HEIGHT - INSET * 2 - 0.04
  const coverGeometry = new ShapeGeometry(roundedPath(coverWidth, coverHeight, 0.07), 16)
  const coverUv = coverGeometry.getAttribute("uv")
  const coverPosition = coverGeometry.getAttribute("position")
  for (let i = 0; i < coverUv.count; i++) {
    // Drawn back-facing, so its X runs opposite to the viewer's left-to-right.
    coverUv.setXY(
      i,
      1 - (coverPosition.getX(i) + coverWidth / 2) / coverWidth,
      (coverPosition.getY(i) + coverHeight / 2) / coverHeight
    )
  }
  coverUv.needsUpdate = true
  const cover = new Mesh(coverGeometry, coverMaterial)
  cover.position.set(-halfWidth / 2, 0, -DEPTH / 2 - 0.003)
  cover.rotation.y = Math.PI
  leftBody.add(cover)

  // Rear components use back-surface coordinates, with outward positive Z.
  const rearCamera = new Group()
  const islandWidth = 0.46
  const islandHeight = 0.2
  rearCamera.position.set(
    halfWidth - 0.07 - islandWidth / 2,
    HEIGHT / 2 - 0.08 - islandHeight / 2,
    -DEPTH / 2 - 0.002
  )
  rearCamera.rotation.y = Math.PI
  right.add(rearCamera)
  const plateDepth = 0.02
  rearCamera.add(
    new Mesh(
      new ExtrudeGeometry(roundedPath(islandWidth, islandHeight, 0.07), {
        depth: plateDepth,
        bevelEnabled: true,
        bevelSize: 0.008,
        bevelThickness: 0.006,
        bevelSegments: 3,
        curveSegments: 12,
      }),
      island
    )
  )
  const plateFront = plateDepth + 0.006
  const lenses: Array<[number, number]> = [
    [-0.14, 0.05],
    [-0.01, 0.05],
    [0.105, 0.036],
  ]
  for (const [x, radius] of lenses) {
    const ring = new Mesh(
      new CylinderGeometry(radius + 0.012, radius + 0.012, 0.012, 32),
      frameMetal
    )
    ring.rotation.x = Math.PI / 2
    ring.position.set(x, 0, plateFront + 0.004)
    rearCamera.add(ring)
    const lens = new Mesh(new CircleGeometry(radius, 32), lensMaterial)
    lens.position.set(x, 0, plateFront + 0.0105)
    rearCamera.add(lens)
  }
  const flash = new Mesh(new CircleGeometry(0.018, 20), flashMaterial)
  flash.position.set(0.185, 0.045, plateFront + 0.0005)
  rearCamera.add(flash)

  // Power and volume keys sit on the fixed half's outer edge.
  const keys: Array<[number, number]> = [
    [0.52, 0.16],
    [0.2, 0.3],
  ]
  for (const [y, length] of keys) {
    const key = new Mesh(new BoxGeometry(0.02, length, DEPTH * 0.45), frameMetal)
    key.position.set(halfWidth + 0.008, y, 0)
    right.add(key)
  }

  const raycaster = new Raycaster()
  const pointer = new Vector2()
  let lastPoint: ScreenPoint | null = null
  let angle = initialAngle
  let coverActive = false

  // Only the display serve-sim is streaming carries the live picture; the
  // other one reads as switched off rather than showing the wrong content.
  const updateMaterials = () => {
    innerSurface.material = coverActive ? offMaterial : innerMaterial
    cover.material = coverActive ? coverMaterial : offMaterial
  }

  const setAngle = (next: number) => {
    angle = Math.max(0, Math.min(180, next))
    left.rotation.y = Math.PI * (1 - angle / 180)
    spine.rotation.y = left.rotation.y / 2
    const cosine = Math.cos(left.rotation.y)
    const sine = Math.sin(left.rotation.y)
    const frontZ = DEPTH / 2 + 0.004 - PIVOT_Z
    for (let i = 0; i < screenPositions.count; i++) {
      const x = baseX[i]
      if (x < 0) {
        screenPositions.setXYZ(
          i,
          x * cosine + frontZ * sine,
          screenPositions.getY(i),
          -x * sine + frontZ * cosine + PIVOT_Z
        )
      } else {
        screenPositions.setXYZ(i, x, screenPositions.getY(i), frontZ + PIVOT_Z)
      }
    }
    screenPositions.needsUpdate = true
    screenGeometry.computeBoundingBox()
    screenGeometry.computeBoundingSphere()
  }

  setAngle(initialAngle)
  updateMaterials()

  return {
    root,
    orientation,
    width: halfWidth * 2,
    height: HEIGHT,
    innerAspect,
    get angle() {
      return angle
    },
    setAngle,
    setDisplay(nextTexture: Texture, _layout: DisplayLayout, nextCoverActive: boolean) {
      innerMaterial.map = nextTexture
      coverMaterial.map = nextTexture
      coverActive = nextCoverActive
      updateMaterials()
    },
    screenPoint(x: number, y: number, camera: Camera, captured = false): ScreenPoint | null {
      orientation.updateWorldMatrix(true, true)
      camera.updateMatrixWorld(true)
      pointer.set(x * 2 - 1, 1 - y * 2)
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObject(coverActive ? cover : innerSurface, false)[0]
      if (!hit?.uv) {
        if (!captured) lastPoint = null
        return captured ? lastPoint : null
      }
      lastPoint = { x: hit.uv.x, y: 1 - hit.uv.y }
      return lastPoint
    },
    dispose() {
      root.traverse((object) => {
        if (object instanceof Mesh) object.geometry.dispose()
      })
      for (const material of materials) material.dispose()
    },
  }
}

export type DuoScene = ReturnType<typeof createDuoScene>
