import React, { useEffect, useMemo, useRef } from "react"
import { ipcRenderer } from "electron"
import { SRGBColorSpace, Texture } from "three"
import styled from "styled-components"

import {
  bindTrackpadOrbit,
  createDeviceInteraction,
  type DeviceInteraction,
} from "./scene/interaction"
import { parseDeviceModel, type DeviceModelId } from "./scene/modelScene"
import type { DeviceOrientation, DeviceSkin, ScreenPoint } from "./scene/phoneScene"
import type { DeviceShapeProfile } from "./scene/shapeProfile"
import {
  createDeviceViewer,
  renderPixelRatio,
  type DeviceViewer,
  type DuoState,
  type FrameSource,
} from "./scene/viewer"

type SkinResult = {
  ok: boolean
  skin?: {
    image: Uint8Array
    mimeType: string
    mask: { image: Uint8Array; mimeType: string } | null
    frame: DeviceSkin["frame"]
    display: DeviceSkin["display"]
  }
}
const skinReads = new Map<string, Promise<SkinResult["skin"] | null>>()

function readAndroidSkin(deviceModel: string) {
  let pending = skinReads.get(deviceModel)
  if (!pending) {
    pending = ipcRenderer
      .invoke("read-android-skin", deviceModel)
      .then((result: SkinResult) => (result.ok && result.skin ? result.skin : null))
      .catch(() => null)
    skinReads.set(deviceModel, pending)
  }
  return pending
}

async function loadSkinTexture(image: { image: Uint8Array; mimeType: string }) {
  const url = URL.createObjectURL(new Blob([image.image], { type: image.mimeType }))
  try {
    const element = new Image()
    element.src = url
    await element.decode()
    const texture = new Texture(element)
    texture.colorSpace = SRGBColorSpace
    texture.anisotropy = 4
    texture.needsUpdate = true
    return texture
  } finally {
    URL.revokeObjectURL(url)
  }
}

// One read per model per session; each viewer parses its own copy of the bytes.
const modelBytes = new Map<DeviceModelId, Promise<ArrayBuffer | null>>()

function readDeviceModel(id: DeviceModelId) {
  let pending = modelBytes.get(id)
  if (!pending) {
    pending = ipcRenderer
      .invoke("read-device-model", id)
      .then((result: { ok: boolean; data?: Uint8Array }) => {
        if (!result.ok || !result.data) return null
        const { buffer, byteOffset, byteLength } = result.data
        return buffer.slice(byteOffset, byteOffset + byteLength) as ArrayBuffer
      })
      .catch(() => null)
    modelBytes.set(id, pending)
  }
  return pending
}

/** The tallest source frame worth decoding into the canvas; null means full size. */
export type SourceLimit = { height: number | null }

export type FrameSignal = {
  limit: SourceLimit
  notify: () => void
  subscribe: (listener: () => void) => () => void
}

/** Decoders announce painted frames here so the 3D view uploads a texture only when one changed. */
export function useFrameSignal(): FrameSignal {
  const listeners = useRef(new Set<() => void>())
  return useMemo(
    () => ({
      limit: { height: null },
      notify: () => listeners.current.forEach((listener) => listener()),
      subscribe: (listener) => {
        listeners.current.add(listener)
        return () => {
          listeners.current.delete(listener)
        }
      },
    }),
    []
  )
}

const Host = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  outline: none;

  &:focus-visible {
    border-radius: 12px;
    box-shadow: 0 0 0 2px ${(props) => props.theme.highlight};
  }
`

const Canvas = styled.canvas`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  touch-action: none;
  cursor: grab;

  &:active {
    cursor: grabbing;
  }
`

const Shadow = styled.div`
  position: absolute;
  bottom: 5%;
  left: 50%;
  width: 40%;
  height: 18px;
  border-radius: 50%;
  background: rgb(0 0 0 / 0.35);
  filter: blur(14px);
  pointer-events: none;
  transform: translateX(-50%);
`

/**
 * Interactive 3D device body. Pressing the screen drives the device; pressing
 * beside it, or swiping with two fingers, turns the body, which springs back
 * to face the viewer on release.
 */
function DeviceViewport({
  label,
  sourceRef,
  sourceKey,
  frames,
  orientation,
  profile,
  duo,
  modelId,
  skinModel,
  onTouch,
  onUnavailable,
  onResetReady,
  onKeyDown,
  onPaste,
}: {
  label: string
  sourceRef: React.RefObject<FrameSource>
  /** Changes whenever the decoded element or the stream feeding it is replaced. */
  sourceKey: string
  frames: FrameSignal
  orientation: DeviceOrientation
  profile: DeviceShapeProfile
  duo: DuoState | null
  /** A realistic body to look for on this machine; the procedural one renders meanwhile. */
  modelId: DeviceModelId | null
  /** An Android model name ("Pixel 9 Pro") whose official emulator skin may be installed. */
  skinModel: string | null
  onTouch: (phase: "begin" | "move" | "end", point: ScreenPoint) => void
  onUnavailable: () => void
  onResetReady: (reset: (() => void) | null) => void
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void
  onPaste?: (event: React.ClipboardEvent<HTMLDivElement>) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewerRef = useRef<DeviceViewer | null>(null)
  const interactionRef = useRef<DeviceInteraction | null>(null)
  const latest = useRef({ orientation, profile, duo, onTouch, onUnavailable })
  latest.current = { orientation, profile, duo, onTouch, onUnavailable }

  useEffect(() => {
    viewerRef.current?.setScreen(orientation, profile)
  }, [orientation, profile])

  const duoAngle = duo?.angle
  const duoCover = duo?.coverActive
  useEffect(() => {
    viewerRef.current?.setDuo(
      duoAngle === undefined ? null : { angle: duoAngle, coverActive: Boolean(duoCover) }
    )
  }, [duoAngle, duoCover])

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    const source = sourceRef.current
    if (!host || !canvas || !source) return undefined

    let viewer: DeviceViewer
    try {
      viewer = createDeviceViewer({
        canvas,
        source,
        orientation: latest.current.orientation,
        profile: latest.current.profile,
        duo: latest.current.duo,
        onUnavailable: () => latest.current.onUnavailable(),
      })
    } catch {
      latest.current.onUnavailable()
      return undefined
    }
    viewerRef.current = viewer
    const interaction = createDeviceInteraction({
      screenPoint: (point, captured) => viewer.screenPoint(point.x, point.y, captured),
      touch: (phase, point) => latest.current.onTouch(phase, point),
      orbit: viewer.orbit,
      onInteractionActive: viewer.setInteractionActive,
    })
    interactionRef.current = interaction
    const trackpad = bindTrackpadOrbit(canvas, interaction)
    onResetReady(viewer.resetPose)

    const resize = () => {
      const { width, height } = host.getBoundingClientRect()
      viewer.resize(width, height, window.devicePixelRatio)
      frames.limit.height = Math.ceil(height * renderPixelRatio(window.devicePixelRatio))
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    const blur = () => {
      interaction.end()
      trackpad.cancel()
    }
    window.addEventListener("blur", blur)
    const unsubscribe = frames.subscribe(viewer.frameUpdated)
    // Blob-backed MJPEG frames arrive as image loads rather than canvas paints.
    const onImageLoad = () => viewer.frameUpdated()
    if (source instanceof HTMLImageElement) source.addEventListener("load", onImageLoad)
    resize()
    viewer.frameUpdated()

    return () => {
      frames.limit.height = null
      unsubscribe()
      if (source instanceof HTMLImageElement) source.removeEventListener("load", onImageLoad)
      window.removeEventListener("blur", blur)
      observer.disconnect()
      trackpad.dispose()
      interaction.end()
      interactionRef.current = null
      onResetReady(null)
      viewer.dispose()
      viewerRef.current = null
    }
  }, [frames, onResetReady, sourceKey, sourceRef])

  useEffect(() => {
    if (!modelId) return undefined
    let canceled = false
    let loaded: Awaited<ReturnType<typeof parseDeviceModel>> | null = null
    readDeviceModel(modelId)
      .then((data) => (data && !canceled ? parseDeviceModel(data) : null))
      .then((model) => {
        if (!model) return
        if (canceled || !viewerRef.current) {
          model.dispose()
          return
        }
        loaded = model
        viewerRef.current.setModel(model.asset)
      })
      .catch(() => undefined)
    return () => {
      canceled = true
      if (!loaded) return
      viewerRef.current?.setModel(null)
      loaded.dispose()
    }
    // A new viewer (sourceKey) starts on the procedural body and needs the model again.
  }, [modelId, sourceKey])

  useEffect(() => {
    if (!skinModel) return undefined
    let canceled = false
    let textures: Texture[] = []
    readAndroidSkin(skinModel)
      .then(async (skin) => {
        if (!skin || canceled) return
        const face = await loadSkinTexture(skin)
        const mask = skin.mask ? await loadSkinTexture(skin.mask).catch(() => null) : null
        textures = mask ? [face, mask] : [face]
        if (canceled || !viewerRef.current) {
          textures.forEach((texture) => texture.dispose())
          textures = []
          return
        }
        viewerRef.current.setSkin({
          texture: face,
          mask,
          frame: skin.frame,
          display: skin.display,
        })
      })
      .catch(() => undefined)
    return () => {
      canceled = true
      if (!textures.length) return
      viewerRef.current?.setSkin(null)
      textures.forEach((texture) => texture.dispose())
    }
    // A new viewer (sourceKey) starts without the skin and needs it again.
  }, [skinModel, sourceKey])

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    }
  }

  return (
    <Host
      ref={hostRef}
      role="application"
      aria-label={label}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
    >
      <Shadow aria-hidden />
      <Canvas
        ref={canvasRef}
        title="Drag the screen to use the device. Drag beside it, or swipe with two fingers, to turn it."
        onPointerDown={(event) => {
          if (event.button !== 0) return
          if (!interactionRef.current?.begin(event.pointerId, point(event), event.altKey)) return
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          hostRef.current?.focus({ preventScroll: true })
        }}
        onPointerMove={(event) => interactionRef.current?.move(event.pointerId, point(event))}
        onPointerUp={(event) => {
          interactionRef.current?.move(event.pointerId, point(event))
          interactionRef.current?.end(event.pointerId)
        }}
        onPointerCancel={(event) => interactionRef.current?.end(event.pointerId)}
        onLostPointerCapture={(event) => interactionRef.current?.end(event.pointerId)}
      />
    </Host>
  )
}

export default DeviceViewport
