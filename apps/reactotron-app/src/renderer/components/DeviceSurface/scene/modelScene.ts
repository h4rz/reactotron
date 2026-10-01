// Adapted from T3 Code (MIT), packages/client-runtime/src/device/model.ts and modelScene.ts.
// See THIRD_PARTY_NOTICES.md.
//
// The models themselves are never bundled. The main process finds converted
// copies another app already installed on this machine (see main/device-models.ts).
import { Box3, Group, Mesh, MeshBasicMaterial, Texture, type Material, type Object3D } from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"

import {
  createDisplayProjection,
  SCREEN_HEIGHT,
  updateDisplayUv,
  type DisplayLayout,
} from "./phoneScene"
import type { DevicePlatform } from "./shapeProfile"

export type DeviceModelId = "iphone-18-pro" | "iphone-18-pro-max" | "ipad-pro-13-m5"

/** Match actual hardware; never stretch an available model to impersonate another device. */
export function resolveDeviceModelId(
  platform: DevicePlatform,
  name: string | undefined
): DeviceModelId | null {
  if (platform !== "ios" || !name) return null
  if (/^iPhone 18 Pro Max$/i.test(name)) return "iphone-18-pro-max"
  if (/^iPhone 18 Pro$/i.test(name)) return "iphone-18-pro"
  if (/^iPad Pro 13-inch \(M5\)/i.test(name)) return "ipad-pro-13-m5"
  return null
}

export type LoadedDeviceModel = { asset: Group; dispose: () => void }

/** GLB resources belong to one viewer; the live framebuffer texture belongs to the stream. */
function disposeDeviceModel(root: Object3D) {
  const geometries = new Set<Mesh["geometry"]>()
  const materials = new Set<Material>()
  const textures = new Set<Texture>()
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    geometries.add(object.geometry)
    const list: Material[] = Array.isArray(object.material) ? object.material : [object.material]
    list.forEach((material) => {
      materials.add(material)
      Object.keys(material).forEach((key) => {
        const value = (material as unknown as Record<string, unknown>)[key]
        if (value instanceof Texture) textures.add(value)
      })
    })
  })
  geometries.forEach((geometry) => geometry.dispose())
  materials.forEach((material) => material.dispose())
  textures.forEach((texture) => {
    texture.dispose()
    if (typeof ImageBitmap !== "undefined" && texture.image instanceof ImageBitmap) {
      texture.image.close()
    }
  })
}

export async function parseDeviceModel(data: ArrayBuffer): Promise<LoadedDeviceModel> {
  const gltf = await new GLTFLoader().parseAsync(data, "")
  return { asset: gltf.scene, dispose: () => disposeDeviceModel(gltf.scene) }
}

/**
 * Assets are converted offline: portrait, front +Z, centered display of height
 * 2.2 and planar display UVs. Anything else is rejected so the caller can fall
 * back to a procedural body rather than show a misplaced screen.
 */
export function createImportedPhoneScene(asset: Group, texture: Texture, initial: DisplayLayout) {
  const screens: Mesh[] = []
  asset.traverse((object) => {
    if (object instanceof Mesh && object.name === "device-screen") screens.push(object)
  })
  const display = screens[0]
  if (!display || screens.length !== 1) {
    throw new Error("Device model must have one device-screen mesh")
  }
  asset.updateMatrixWorld(true)
  const screenBounds = new Box3().setFromObject(display)
  const screenWidth = screenBounds.max.x - screenBounds.min.x
  const screenHeight = screenBounds.max.y - screenBounds.min.y
  if (
    display.matrixWorld.elements.some(
      (value, index) =>
        !Number.isFinite(value) || Math.abs(value - (index % 5 === 0 ? 1 : 0)) > 0.001
    ) ||
    !Number.isFinite(screenWidth) ||
    !Number.isFinite(screenHeight) ||
    screenWidth <= 0 ||
    Math.abs(screenHeight - SCREEN_HEIGHT) > 0.001 ||
    Math.abs(screenBounds.min.x + screenBounds.max.x) > 0.001 ||
    Math.abs(screenBounds.min.y + screenBounds.max.y) > 0.001 ||
    screenBounds.max.z - screenBounds.min.z > 0.001
  ) {
    throw new Error("Device model display is not normalized")
  }
  updateDisplayUv(display.geometry, screenWidth, screenHeight, initial)
  const originalMaterial = display.material
  const screenMaterial = new MeshBasicMaterial({ map: texture, toneMapped: false })
  display.material = screenMaterial
  const root = new Group()
  const orientation = new Group()
  orientation.add(asset)
  root.add(orientation)
  const bounds = new Box3().setFromObject(asset)
  let layout = initial
  const screenPoint = createDisplayProjection(
    display,
    orientation,
    screenWidth,
    screenHeight,
    () => layout
  )
  return {
    root,
    orientation,
    width: bounds.max.x - bounds.min.x,
    height: bounds.max.y - bounds.min.y,
    /** The screen aspect this body was built for; a different framebuffer shape needs another body. */
    aspect: screenWidth / screenHeight,
    setDisplay(nextTexture: Texture, nextLayout: DisplayLayout) {
      layout = nextLayout
      screenMaterial.map = nextTexture
      updateDisplayUv(display.geometry, screenWidth, screenHeight, layout)
    },
    screenPoint,
    dispose() {
      // The loaded model owns imported resources; this scene owns only its replacement material.
      display.material = originalMaterial
      screenMaterial.map = null
      screenMaterial.dispose()
      orientation.remove(asset)
    },
  }
}

export type ImportedPhoneScene = ReturnType<typeof createImportedPhoneScene>
