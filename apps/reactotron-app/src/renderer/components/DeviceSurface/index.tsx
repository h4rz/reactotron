import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ipcRenderer } from "electron"
import {
  MdAdd,
  MdApps,
  MdArrowBack,
  MdClose,
  MdFiberManualRecord,
  MdHome,
  MdOutlineLink,
  MdOutlinePowerSettingsNew,
  MdPhoneIphone,
  MdRefresh,
  MdRotateRight,
  MdScreenshot,
} from "react-icons/md"
import styled from "styled-components"

import { getDesktopShortcutModifier, isIOSSimulatorSupported } from "../../../platform"
import {
  fitDeviceFrameToPane,
  mapPointToStream,
  parseSimulatorScreenConfigFrame,
  resolveDeviceFrameKind,
  resolveStreamRotation,
  resolveVisualScreenAspectRatio,
  type DeviceFrameLayout,
} from "./layout"
import { AvccStreamParser, avcCodecString } from "./avccStream"
import { createMjpegFrameParser } from "./mjpegFrameParser"

import { getConfiguredServerPort } from "../../config"

type Simulator = {
  name: string
  runtime: string
  state: string
  udid: string
}

type SimulatorCreationOption = {
  deviceTypeIdentifier: string
  name: string
  runtimeName: string
}

type AndroidDevice = {
  id: string
  model: string
  type: "emulator" | "physical"
}

type Surface = Simulator & {
  previewUrl: string
  streamUrl: string
  wsUrl: string
  orientation: "portrait" | "landscape_left"
  recording?: boolean
  screenSize?: { width: number; height: number }
}

type IPCResponse = {
  ok: boolean
  message?: string
}

const CONTROL_SOCKET_RETRY_DELAY = 2000
const CONTROL_SOCKET_RETRY_LIMIT = 5
const PREVIEW_RETRY_DELAY = 1000
const PREVIEW_RETRY_LIMIT = 4
const IOS_DECODE_QUEUE_LIMIT = 8
const IOS_FRAME_DURATION_MICROSECONDS = 16_667
const supportsIOSSimulator = isIOSSimulatorSupported(window.process.platform)
const shortcutModifier = getDesktopShortcutModifier(window.process.platform)

const Panel = styled.aside<{ $isOpen: boolean; $isResizing: boolean; $width: number }>`
  display: flex;
  position: relative;
  flex: 0 0 ${(props) => (props.$isOpen ? `${props.$width}px` : "0")};
  width: ${(props) => (props.$isOpen ? `${props.$width}px` : "0")};
  min-width: ${(props) => (props.$isOpen ? "300px" : "0")};
  overflow: hidden;
  border-left: ${(props) => (props.$isOpen ? `1px solid ${props.theme.chromeLine}` : "0")};
  background-color: ${(props) => props.theme.background};
  transition: ${(props) =>
    props.$isResizing ? "none" : "width 150ms ease, flex-basis 150ms ease"};
`

const ResizeHandle = styled.div`
  position: absolute;
  z-index: 3;
  top: 0;
  bottom: 0;
  left: -6px;
  width: 12px;
  cursor: col-resize;
  touch-action: none;

  &:hover,
  &:active {
    background-color: ${(props) => props.theme.highlight};
  }
`

const IconButton = styled.button`
  display: grid;
  width: 28px;
  height: 28px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: ${(props) => props.theme.foregroundDark};
  cursor: pointer;

  &:hover:not(:disabled) {
    background-color: ${(props) => props.theme.backgroundLighter};
    color: ${(props) => props.theme.foreground};
  }

  &:disabled {
    cursor: wait;
    opacity: 0.55;
  }
`

const RecordingButton = styled(IconButton)<{ $recording: boolean }>`
  color: ${(props) => (props.$recording ? "#ef5c62" : props.theme.foregroundDark)};

  &:hover:not(:disabled) {
    background: ${(props) =>
      props.$recording ? "rgb(239 92 98 / 0.16)" : props.theme.backgroundLighter};
    color: ${(props) => (props.$recording ? "#ff7479" : props.theme.foreground)};
  }
`

const Content = styled.div`
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
`

const DeviceBar = styled.div`
  display: flex;
  height: 44px;
  min-height: 44px;
  align-items: center;
  gap: 3px;
  box-sizing: border-box;
  padding: 6px 44px 6px 8px;
  overflow: hidden;
  border-bottom: 1px solid ${(props) => props.theme.chromeLine};
  background-color: ${(props) => props.theme.backgroundSubtleLight};
`

const ActiveDeviceSelect = styled.select`
  width: 220px;
  height: 30px;
  flex: 0 0 220px;
  min-width: 0;
  padding: 0 9px;
  border: 1px solid ${(props) => props.theme.chromeLine};
  border-radius: 4px;
  outline: none;
  background: ${(props) => props.theme.backgroundLighter};
  color: ${(props) => props.theme.foreground};
  font-size: 12px;

  &:focus-visible {
    border-color: ${(props) => props.theme.highlight};
  }
`

const ToolBar = styled.div`
  display: flex;
  min-height: 44px;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  border-bottom: 1px solid ${(props) => props.theme.chromeLine};
`

const DeviceName = styled.div`
  overflow: hidden;
  color: ${(props) => props.theme.foregroundLight};
  font-size: 12px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const Actions = styled.div`
  display: flex;
  gap: 3px;
`

const Preview = styled.canvas<{
  $rotation: -90 | 0 | 90
  $screenWidth: number
  $screenHeight: number
}>`
  position: absolute;
  top: 50%;
  left: 50%;
  width: ${(props) => (props.$rotation === 0 ? "100%" : `${props.$screenHeight}px`)};
  height: ${(props) => (props.$rotation === 0 ? "100%" : `${props.$screenWidth}px`)};
  object-fit: contain;
  transform: translate(-50%, -50%) rotate(${(props) => props.$rotation}deg);
  user-select: none;
`

const FallbackPreview = styled.img<{
  $rotation: -90 | 0 | 90
  $screenWidth: number
  $screenHeight: number
}>`
  position: absolute;
  top: 50%;
  left: 50%;
  width: ${(props) => (props.$rotation === 0 ? "100%" : `${props.$screenHeight}px`)};
  height: ${(props) => (props.$rotation === 0 ? "100%" : `${props.$screenWidth}px`)};
  object-fit: contain;
  transform: translate(-50%, -50%) rotate(${(props) => props.$rotation}deg);
  user-select: none;
`

const AndroidVideoPreview = styled.canvas`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  user-select: none;
`

const PreviewContainer = styled.div`
  position: relative;
  display: flex;
  min-height: 0;
  flex: 1;
  background: radial-gradient(
      ellipse at 50% 42%,
      color-mix(in srgb, ${(props) => props.theme.highlight} 24%, transparent),
      transparent 62%
    ),
    linear-gradient(
      145deg,
      ${(props) => props.theme.backgroundLighter} 0%,
      ${(props) => props.theme.background} 55%,
      ${(props) => props.theme.backgroundDarker} 100%
    );

  &::before {
    position: absolute;
    inset: 0;
    background-image: linear-gradient(
      color-mix(in srgb, ${(props) => props.theme.foreground} 6%, transparent) 1px,
      transparent 1px
    );
    background-size: 100% 4px;
    content: "";
    opacity: 0.35;
    pointer-events: none;
  }
`

const PreviewPane = styled.div`
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  align-self: stretch;
  align-items: center;
  justify-content: center;
  margin: 28px 20px;
  overflow: hidden;
`

const DeviceFrame = styled.div<{
  $layout: DeviceFrameLayout | null
  $platform: "android" | "ios"
}>`
  position: relative;
  width: ${(props) => (props.$layout ? `${props.$layout.width}px` : "min(100%, 390px)")};
  height: ${(props) => (props.$layout ? `${props.$layout.height}px` : "auto")};
  box-sizing: border-box;
  aspect-ratio: ${(props) => (props.$layout ? "auto" : "9 / 19.5")};
  overflow: hidden;
  border: ${(props) => `${props.$layout?.bezel ?? 8}px`} solid #0a0a0a;
  border-radius: ${(props) =>
    `${Math.min(props.$layout?.outerRadius ?? 48, props.$platform === "android" ? 36 : 48)}px`};
  background: #000;
  box-shadow: 0 0 0 1px rgb(255 255 255 / 0.12);
  outline: none;
  touch-action: none;

  &:focus-visible {
    box-shadow:
      0 28px 56px rgb(0 0 0 / 0.58),
      0 0 0 3px ${(props) => props.theme.highlight};
  }

  &::after {
    position: absolute;
    z-index: 1;
    top: ${(props) => `${(props.$layout?.bezel ?? 8) + 7}px`};
    left: 50%;
    display: ${(props) => (props.$platform === "android" ? "block" : "none")};
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #090909;
    box-shadow: 0 0 0 1px rgb(255 255 255 / 0.08);
    content: "";
    pointer-events: none;
    transform: translateX(-50%);
  }
`

const EmptyState = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 28px;
  text-align: center;
`

const EmptyIcon = styled(MdPhoneIphone)`
  margin-bottom: 14px;
  color: ${(props) => props.theme.highlight};
`

const EmptyTitle = styled.h2`
  margin: 0;
  color: ${(props) => props.theme.foregroundLight};
  font-size: 17px;
`

const EmptyCopy = styled.p`
  max-width: 270px;
  margin: 8px 0 20px;
  color: ${(props) => props.theme.foregroundDark};
  font-size: 13px;
  line-height: 1.45;
`

const ActionStack = styled.div`
  display: flex;
  width: 100%;
  max-width: 340px;
  flex-direction: column;
  gap: 10px;
`

const ActionSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid ${(props) => props.theme.chromeLine};
  border-radius: 8px;
  background: ${(props) => props.theme.backgroundLighter};
`

const ActionLabel = styled.span`
  color: ${(props) => props.theme.foregroundDark};
  font-size: 12px;
  font-weight: 700;
  text-align: left;
`

const ActionDivider = styled.div`
  display: none;
`

const DeviceSelect = styled.select`
  width: 100%;
  min-height: 34px;
  padding: 0 9px;
  border: 1px solid ${(props) => props.theme.chromeLine};
  border-radius: 4px;
  outline: none;
  background: ${(props) => props.theme.backgroundLighter};
  color: ${(props) => props.theme.foreground};
`

const PrimaryButton = styled.button`
  width: 100%;
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid ${(props) => props.theme.highlight};
  border-radius: 4px;
  background: ${(props) => props.theme.highlight};
  color: ${(props) => props.theme.background};
  cursor: pointer;
  font-weight: 700;

  &:disabled {
    cursor: wait;
    opacity: 0.6;
  }
`

const SecondaryButton = styled(PrimaryButton)`
  border-color: ${(props) => props.theme.chromeLine};
  background: ${(props) => props.theme.backgroundLighter};
  color: ${(props) => props.theme.foregroundLight};
`

const Status = styled.p<{ $error: boolean }>`
  max-width: 300px;
  margin: 14px 0 0;
  color: ${(props) => (props.$error ? props.theme.warning : props.theme.foregroundDark)};
  font-size: 12px;
  line-height: 1.4;
`

const ConnectionStatus = styled.span<{ $connected: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: 8px;
  color: ${(props) => (props.$connected ? props.theme.foregroundDark : props.theme.warning)};
  font-size: 11px;
  font-weight: 500;

  &::before {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: ${(props) => (props.$connected ? "#63b76c" : props.theme.warning)};
    content: "";
  }
`

const RecordingStatus = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-left: 8px;
  color: #ef5c62;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.05em;

  &::before {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
    box-shadow: 0 0 0 3px rgb(239 92 98 / 0.16);
    content: "";
  }
`

type KeyboardFrame = { type: "down" | "up"; usage: number }

const keyboardUsages: Record<string, { usage: number; shift?: boolean }> = (() => {
  const usages: Record<string, { usage: number; shift?: boolean }> = {
    Enter: { usage: 40 },
    Tab: { usage: 43 },
    " ": { usage: 44 },
    Backspace: { usage: 42 },
    Escape: { usage: 41 },
    ArrowRight: { usage: 79 },
    ArrowLeft: { usage: 80 },
    ArrowDown: { usage: 81 },
    ArrowUp: { usage: 82 },
  }
  for (let index = 0; index < 26; index += 1) {
    usages[String.fromCharCode(97 + index)] = { usage: 4 + index }
    usages[String.fromCharCode(65 + index)] = { usage: 4 + index, shift: true }
  }
  const plain = "1234567890"
  const shifted = "!@#$%^&*()"
  for (let index = 0; index < plain.length; index += 1) {
    usages[plain[index]] = { usage: 30 + index }
    usages[shifted[index]] = { usage: 30 + index, shift: true }
  }
  for (const [normal, upper, usage] of [
    ["-", "_", 45],
    ["=", "+", 46],
    ["[", "{", 47],
    ["]", "}", 48],
    ["\\", "|", 49],
    [";", ":", 51],
    ["'", '"', 52],
    ["`", "~", 53],
    [",", "<", 54],
    [".", ">", 55],
    ["/", "?", 56],
  ] as Array<[string, string, number]>) {
    usages[normal] = { usage }
    usages[upper] = { usage, shift: true }
  }
  return usages
})()

function keyboardFrames(key: string, shift = false): KeyboardFrame[] | null {
  const mapping = keyboardUsages[key]
  if (!mapping) return null
  const frames: KeyboardFrame[] = [
    { type: "down", usage: mapping.usage },
    { type: "up", usage: mapping.usage },
  ]
  return mapping.shift || shift
    ? [{ type: "down", usage: 225 }, ...frames, { type: "up", usage: 225 }]
    : frames
}

function encodeControlFrame(tag: number, payload: object) {
  const json = new TextEncoder().encode(JSON.stringify(payload))
  const frame = new Uint8Array(1 + json.length)
  frame[0] = tag
  frame.set(json, 1)
  return frame
}

type AndroidVideoMeta = {
  streamId: string
  deviceId: string
  meta: { width: number; height: number }
}
type AndroidVideoFrame = {
  streamId: string
  deviceId: string
  config: boolean
  keyFrame: boolean
  data: ArrayBuffer
}

/**
 * Draw an MJPEG stream into an image.
 *
 * The obvious approach — pointing an <img> at the stream URL — fails in the
 * renderer: when the multipart response ends abnormally, which serve-sim does
 * whenever it restarts or a frame write is interrupted, Chromium marks the load
 * complete and *discards the decoded bitmap*. The element is left reporting
 * complete: true with naturalWidth 0, so the preview goes black even though the
 * server is still streaming and the element is laid out correctly.
 *
 * Reading the stream here keeps every decoded frame under our control. Blob URLs
 * preserve the last good frame across a broken response without allocating an
 * ImageBitmap for every frame.
 */
function useIOSMjpegStream(streamUrl: string | undefined, enabled: boolean) {
  const imageRef = useRef<HTMLImageElement>(null)
  const [isStreaming, setIsStreaming] = useState(false)

  useEffect(() => {
    if (!streamUrl || !enabled) {
      setIsStreaming(false)
      return undefined
    }

    let disposed = false
    let retryTimer: number | undefined
    let attempts = 0
    let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null
    let hasPaintedFrame = false
    let pendingFrameUrl: string | null = null
    let paintedFrameUrl: string | null = null
    let paintFrameId: number | undefined
    const controller = new AbortController()
    const image = imageRef.current

    const paintPendingFrame = () => {
      paintFrameId = undefined
      const nextFrameUrl = pendingFrameUrl
      pendingFrameUrl = null
      if (!nextFrameUrl) return
      if (!image || disposed) {
        URL.revokeObjectURL(nextFrameUrl)
        return
      }
      if (paintedFrameUrl) URL.revokeObjectURL(paintedFrameUrl)
      paintedFrameUrl = nextFrameUrl
      image.src = nextFrameUrl
    }

    const parser = createMjpegFrameParser((frame) => {
      const nextFrameUrl = URL.createObjectURL(new Blob([frame], { type: "image/jpeg" }))
      if (pendingFrameUrl) URL.revokeObjectURL(pendingFrameUrl)
      pendingFrameUrl = nextFrameUrl
      if (paintFrameId === undefined) paintFrameId = window.requestAnimationFrame(paintPendingFrame)
    })

    const onFrameLoaded = () => {
      if (disposed) return
      if (!hasPaintedFrame) {
        hasPaintedFrame = true
        setIsStreaming(true)
      }
      attempts = 0
    }
    image?.addEventListener("load", onFrameLoaded)

    const read = async () => {
      try {
        const response = await fetch(streamUrl, { signal: controller.signal })
        if (!response.body) throw new Error("The simulator preview returned no stream.")
        const reader = response.body.getReader()

        activeReader = reader

        for (;;) {
          const { done, value } = await reader.read()
          if (done || disposed) break
          parser.push(value)
        }
      } catch {
        // Fall through to the retry below.
      }

      if (disposed || controller.signal.aborted) return
      hasPaintedFrame = false
      setIsStreaming(false)
      if (attempts >= PREVIEW_RETRY_LIMIT) return
      const delay = PREVIEW_RETRY_DELAY * Math.pow(2, attempts)
      attempts += 1
      retryTimer = window.setTimeout(read, delay)
    }

    read().catch(() => undefined)

    return () => {
      disposed = true
      window.clearTimeout(retryTimer)
      if (paintFrameId !== undefined) window.cancelAnimationFrame(paintFrameId)
      if (pendingFrameUrl) URL.revokeObjectURL(pendingFrameUrl)
      if (paintedFrameUrl) URL.revokeObjectURL(paintedFrameUrl)
      image?.removeEventListener("load", onFrameLoaded)
      // Cancelling the reader closes the socket immediately. Aborting alone can
      // leave the previous connection draining, which shows up as a second
      // stream still attached to serve-sim.
      activeReader?.cancel().catch(() => undefined)
      activeReader = null
      controller.abort()
      setIsStreaming(false)
    }
  }, [enabled, streamUrl])

  return { imageRef, isStreaming }
}

function useIOSAvccStream(
  streamUrl: string | undefined,
  enabled: boolean,
  onUnsupported: () => void
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const onUnsupportedRef = useRef(onUnsupported)
  onUnsupportedRef.current = onUnsupported
  const [isStreaming, setIsStreaming] = useState(false)

  useEffect(() => {
    if (!streamUrl || !enabled) {
      setIsStreaming(false)
      return undefined
    }

    const VideoDecoderConstructor = (globalThis as any).VideoDecoder
    const EncodedVideoChunkConstructor = (globalThis as any).EncodedVideoChunk
    if (!VideoDecoderConstructor || !EncodedVideoChunkConstructor) {
      onUnsupportedRef.current()
      return undefined
    }

    let disposed = false
    let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null
    let decoder: any = null
    let retryTimer: number | undefined
    let timestamp = 0
    let attempts = 0
    let awaitingKeyframe = true
    const controller = new AbortController()
    const avccUrl = streamUrl.replace(/stream\.mjpeg(?:\?.*)?$/, "stream.avcc")

    const closeDecoder = () => {
      try {
        decoder?.close()
      } catch {
        // The decoder may already have closed itself after an error.
      }
      decoder = null
      awaitingKeyframe = true
    }

    const paint = (source: CanvasImageSource, width: number, height: number) => {
      const canvas = canvasRef.current
      if (disposed || !canvas) return
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      canvas.getContext("2d")?.drawImage(source, 0, 0, width, height)
      attempts = 0
      setIsStreaming(true)
    }

    const makeDecoder = () =>
      new VideoDecoderConstructor({
        output: (frame: any) => {
          try {
            paint(frame, frame.displayWidth, frame.displayHeight)
          } finally {
            frame.close()
          }
        },
        error: () => {
          closeDecoder()
          activeReader?.cancel().catch(() => undefined)
        },
      })

    const configureDecoder = async (description: Uint8Array) => {
      const config = {
        codec: avcCodecString(description),
        description,
        optimizeForLatency: true,
      }
      const support = await VideoDecoderConstructor.isConfigSupported(config).catch(() => ({
        supported: false,
      }))
      if (!support.supported || disposed) return false
      closeDecoder()
      decoder = makeDecoder()
      decoder.configure(config)
      awaitingKeyframe = true
      return true
    }

    const read = async () => {
      const parser = new AvccStreamParser()
      try {
        const response = await fetch(avccUrl, { signal: controller.signal })
        if (!response.ok || !response.body) {
          throw new Error(`The simulator AVCC stream returned ${response.status}.`)
        }
        const reader = response.body.getReader()
        activeReader = reader

        for (;;) {
          const { done, value } = await reader.read()
          if (done || disposed) break
          for (const chunk of parser.push(value)) {
            if (chunk.type === "seed") {
              let bitmap: ImageBitmap | undefined
              try {
                bitmap = await createImageBitmap(new Blob([chunk.payload], { type: "image/jpeg" }))
                paint(bitmap, bitmap.width, bitmap.height)
              } finally {
                bitmap?.close()
              }
              continue
            }
            if (chunk.type === "description") {
              if (!(await configureDecoder(chunk.payload))) {
                onUnsupportedRef.current()
                await reader.cancel().catch(() => undefined)
                return
              }
              continue
            }
            if (!decoder || decoder.state !== "configured") continue
            const isKeyframe = chunk.type === "keyframe"
            if (awaitingKeyframe) {
              if (!isKeyframe) continue
              awaitingKeyframe = false
            }
            if (decoder.decodeQueueSize > IOS_DECODE_QUEUE_LIMIT) {
              await reader.cancel().catch(() => undefined)
              break
            }
            decoder.decode(
              new EncodedVideoChunkConstructor({
                type: isKeyframe ? "key" : "delta",
                timestamp,
                data: chunk.payload,
              })
            )
            timestamp += IOS_FRAME_DURATION_MICROSECONDS
          }
        }
      } catch {
        // Retry below unless this effect was disposed.
      }

      closeDecoder()
      activeReader = null
      if (disposed || controller.signal.aborted) return
      setIsStreaming(false)
      if (attempts >= PREVIEW_RETRY_LIMIT) return
      const delay = PREVIEW_RETRY_DELAY * Math.pow(2, attempts)
      attempts += 1
      retryTimer = window.setTimeout(read, delay)
    }

    read().catch(() => undefined)

    return () => {
      disposed = true
      window.clearTimeout(retryTimer)
      activeReader?.cancel().catch(() => undefined)
      activeReader = null
      controller.abort()
      closeDecoder()
      setIsStreaming(false)
    }
  }, [enabled, streamUrl])

  return { canvasRef, isStreaming }
}

function useIOSVideoStream(streamUrl: string | undefined, enabled: boolean) {
  const supportsAvcc =
    typeof (globalThis as any).VideoDecoder === "function" &&
    typeof (globalThis as any).EncodedVideoChunk === "function"
  const [useMjpegFallback, setUseMjpegFallback] = useState(!supportsAvcc)

  useEffect(() => setUseMjpegFallback(!supportsAvcc), [streamUrl, supportsAvcc])

  const avcc = useIOSAvccStream(streamUrl, enabled && !useMjpegFallback, () =>
    setUseMjpegFallback(true)
  )
  const mjpeg = useIOSMjpegStream(streamUrl, enabled && useMjpegFallback)

  return {
    canvasRef: avcc.canvasRef,
    imageRef: mjpeg.imageRef,
    isStreaming: useMjpegFallback ? mjpeg.isStreaming : avcc.isStreaming,
    useMjpegFallback,
  }
}

function useAndroidVideoStream(
  deviceId: string | undefined,
  enabled: boolean,
  onSize: (size: { width: number; height: number }) => void
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const onSizeRef = useRef(onSize)
  onSizeRef.current = onSize
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!deviceId || !enabled) return undefined
    const VideoDecoderConstructor = (globalThis as any).VideoDecoder
    const EncodedVideoChunkConstructor = (globalThis as any).EncodedVideoChunk
    if (!VideoDecoderConstructor || !EncodedVideoChunkConstructor) {
      setError("This build does not support H.264 Android preview.")
      return undefined
    }

    const streamId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const canvas = canvasRef.current
    const context = canvas?.getContext("2d")
    let disposed = false
    let configured = false
    let timestamp = 0
    let configData: Uint8Array | null = null
    const stop = () => {
      ipcRenderer.invoke("stop-android-video-stream", streamId).catch(() => undefined)
    }
    const fail = (message: string) => {
      if (disposed) return
      setError(message)
      stop()
    }
    const decoder = new VideoDecoderConstructor({
      output: (frame: any) => {
        if (!disposed && canvas && context) {
          if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
            canvas.width = frame.displayWidth
            canvas.height = frame.displayHeight
            onSizeRef.current({ width: frame.displayWidth, height: frame.displayHeight })
          }
          context.drawImage(frame, 0, 0)
        }
        frame.close()
      },
      error: (videoError: Error) => fail(videoError.message),
    })
    const onMeta = (_event: unknown, message: AndroidVideoMeta) => {
      if (!disposed && message.streamId === streamId && message.deviceId === deviceId) {
        onSizeRef.current(message.meta)
      }
    }
    const onFrame = (_event: unknown, message: AndroidVideoFrame) => {
      if (disposed || message.streamId !== streamId || message.deviceId !== deviceId) return
      const data = new Uint8Array(message.data)
      if (message.config) {
        try {
          if (!configured) {
            decoder.configure({ codec: "avc1.640028", optimizeForLatency: true })
            configured = true
          }
          configData = data
        } catch (videoError) {
          fail(
            videoError instanceof Error ? videoError.message : "Could not configure Android video."
          )
        }
        return
      }
      if (!configured || decoder.state === "closed") return
      let chunkData = data
      if (message.keyFrame && configData) {
        chunkData = new Uint8Array(configData.length + data.length)
        chunkData.set(configData, 0)
        chunkData.set(data, configData.length)
      }
      if (message.keyFrame) configData = null
      try {
        // Keep the decode queue bounded if the renderer is briefly busy; the
        // next keyframe lets the preview catch up instead of accumulating lag.
        if (decoder.decodeQueueSize > 3 && !message.keyFrame) return
        decoder.decode(
          new EncodedVideoChunkConstructor({
            type: message.keyFrame ? "key" : "delta",
            timestamp: ++timestamp,
            data: chunkData,
          })
        )
      } catch (videoError) {
        fail(videoError instanceof Error ? videoError.message : "Could not decode Android video.")
      }
    }
    const onStreamError = (
      _event: unknown,
      message: { streamId: string; deviceId: string; message: string }
    ) => {
      if (!disposed && message.streamId === streamId && message.deviceId === deviceId)
        fail(message.message)
    }
    ipcRenderer.on("android-video-stream-meta", onMeta)
    ipcRenderer.on("android-video-stream-frame", onFrame)
    ipcRenderer.on("android-video-stream-error", onStreamError)
    setError(null)
    ipcRenderer
      .invoke("start-android-video-stream", deviceId, streamId)
      .then((result: IPCResponse) => {
        if (!result.ok) fail(result.message || "Could not start Android video stream.")
      })
      .catch((error: unknown) =>
        fail(error instanceof Error ? error.message : "Could not start Android video stream.")
      )
    return () => {
      disposed = true
      ipcRenderer.removeListener("android-video-stream-meta", onMeta)
      ipcRenderer.removeListener("android-video-stream-frame", onFrame)
      ipcRenderer.removeListener("android-video-stream-error", onStreamError)
      stop()
      if (decoder.state !== "closed") decoder.close()
    }
  }, [deviceId, enabled])

  return { canvasRef, error }
}

function DeviceSurface({ isOpen }: { isOpen: boolean }) {
  const panelRef = useRef<HTMLElement>(null)
  const [previewPane, setPreviewPane] = useState<HTMLDivElement | null>(null)
  const [isResizing, setIsResizing] = useState(false)
  const [panelWidth, setPanelWidth] = useState(400)
  const [deviceFrameLayout, setDeviceFrameLayout] = useState<DeviceFrameLayout | null>(null)
  const [simulators, setSimulators] = useState<Simulator[]>([])
  const [androidDevices, setAndroidDevices] = useState<AndroidDevice[]>([])
  const [selectedAndroidDeviceId, setSelectedAndroidDeviceId] = useState("")
  const [activeAndroidDevice, setActiveAndroidDevice] = useState<AndroidDevice | null>(null)
  const [androidScreenSize, setAndroidScreenSize] = useState({ width: 1080, height: 1920 })
  const [isAndroidRecording, setIsAndroidRecording] = useState(false)
  const [isAndroidLoading, setIsAndroidLoading] = useState(false)
  const [creationOptions, setCreationOptions] = useState<SimulatorCreationOption[]>([])
  const [surfaces, setSurfaces] = useState<Surface[]>([])
  const [activeUdid, setActiveUdid] = useState<string | null>(null)
  const [selectedUdid, setSelectedUdid] = useState("")
  const [selectedDeviceType, setSelectedDeviceType] = useState("")
  const [isChoosing, setIsChoosing] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [status, setStatus] = useState("")
  const [isError, setIsError] = useState(false)
  const [isControlConnected, setIsControlConnected] = useState(false)
  const autoOpenAttemptedRef = useRef(false)
  const controlSocketRef = useRef<WebSocket | null>(null)
  const keyboardTimersRef = useRef<number[]>([])
  const touchRef = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const androidTouchRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    x: number
    y: number
  } | null>(null)

  const activeSurface = useMemo(
    () => surfaces.find((surface) => surface.udid === activeUdid) ?? null,
    [activeUdid, surfaces]
  )
  const isAndroidSurfaceActive = activeAndroidDevice !== null && activeUdid === null
  const activeWsUrl = isOpen ? activeSurface?.wsUrl : undefined
  const activePreviewStreamUrl = activeSurface?.streamUrl
  const activeScreenAspectRatio = isAndroidSurfaceActive
    ? androidScreenSize.width / androidScreenSize.height
    : resolveVisualScreenAspectRatio(
        activeSurface?.screenSize,
        activeSurface?.orientation ?? "portrait"
      )
  const activeFrameKind = resolveDeviceFrameKind(
    isAndroidSurfaceActive ? activeAndroidDevice?.model : activeSurface?.name,
    activeScreenAspectRatio
  )
  const activeStreamRotation = resolveStreamRotation(
    activeSurface?.screenSize,
    activeSurface?.orientation ?? "portrait"
  )
  const activeScreenWidth = Math.max(
    0,
    (deviceFrameLayout?.width ?? 0) - (deviceFrameLayout?.bezel ?? 0) * 2
  )
  const activeScreenHeight = Math.max(
    0,
    (deviceFrameLayout?.height ?? 0) - (deviceFrameLayout?.bezel ?? 0) * 2
  )
  const {
    canvasRef: iosVideoCanvasRef,
    imageRef: iosVideoImageRef,
    useMjpegFallback: iosUsesMjpeg,
  } = useIOSVideoStream(activePreviewStreamUrl, isOpen && Boolean(activeSurface) && !isChoosing)
  const { canvasRef: androidVideoCanvasRef, error: androidVideoError } = useAndroidVideoStream(
    activeAndroidDevice?.id,
    isOpen && isAndroidSurfaceActive && !isChoosing,
    setAndroidScreenSize
  )

  useEffect(() => {
    if (!previewPane) return undefined
    let frameId: number | null = null

    const updateLayout = () => {
      const { width, height } = previewPane.getBoundingClientRect()
      const nextLayout = fitDeviceFrameToPane(
        { width: Math.floor(width), height: Math.floor(height) },
        activeScreenAspectRatio,
        activeFrameKind
      )
      setDeviceFrameLayout((current) =>
        current?.width === nextLayout?.width &&
        current?.height === nextLayout?.height &&
        current?.bezel === nextLayout?.bezel
          ? current
          : nextLayout
      )
    }
    const scheduleUpdate = () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId)
      }
      frameId = requestAnimationFrame(() => {
        frameId = null
        updateLayout()
      })
    }
    updateLayout()
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", scheduleUpdate)
      return () => {
        if (frameId !== null) {
          cancelAnimationFrame(frameId)
        }
        window.removeEventListener("resize", scheduleUpdate)
      }
    }
    const observer = new ResizeObserver(scheduleUpdate)
    observer.observe(previewPane)

    return () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId)
      }
      observer.disconnect()
    }
  }, [activeFrameKind, activeScreenAspectRatio, previewPane])

  const loadSimulators = useCallback(async () => {
    setIsLoading(true)
    const result = (await ipcRenderer.invoke("list-booted-ios-simulators")) as IPCResponse & {
      simulators: Simulator[]
    }
    setIsLoading(false)
    if (!result.ok) {
      setStatus(result.message || "Could not read iOS simulators.")
      setIsError(true)
      return
    }

    setSimulators(result.simulators)
    setSelectedUdid((current) =>
      result.simulators.some((simulator) => simulator.udid === current)
        ? current
        : result.simulators[0]?.udid || ""
    )
    setStatus(
      result.simulators.length === 0
        ? "No iOS simulators found. Create one here or add one in Xcode."
        : ""
    )
    setIsError(false)
  }, [])

  const loadCreationOptions = useCallback(async () => {
    const result = (await ipcRenderer.invoke(
      "list-ios-simulator-creation-options"
    )) as IPCResponse & {
      options: SimulatorCreationOption[]
    }
    if (!result.ok) return

    setCreationOptions(result.options)
    setSelectedDeviceType((current) =>
      result.options.some((option) => option.deviceTypeIdentifier === current)
        ? current
        : result.options[0]?.deviceTypeIdentifier || ""
    )
  }, [])

  const loadAndroidDevices = useCallback(async () => {
    setIsAndroidLoading(true)
    const result = (await ipcRenderer.invoke("list-android-devices")) as IPCResponse & {
      devices: AndroidDevice[]
    }
    setIsAndroidLoading(false)
    if (!result.ok) {
      setStatus(result.message || "Could not read Android devices. Is adb installed?")
      setIsError(true)
      return
    }

    setAndroidDevices(result.devices)
    setSelectedAndroidDeviceId((current) =>
      result.devices.some((device) => device.id === current) ? current : result.devices[0]?.id || ""
    )
    setIsError(false)
  }, [])

  useEffect(() => {
    if (supportsIOSSimulator) {
      loadSimulators().catch(() => undefined)
      loadCreationOptions().catch(() => undefined)
    }
    loadAndroidDevices().catch(() => undefined)
  }, [loadAndroidDevices, loadCreationOptions, loadSimulators])

  useEffect(() => {
    if (androidVideoError) {
      setStatus(androidVideoError)
      setIsError(true)
    }
  }, [androidVideoError])

  const openAndroidDevice = () => {
    const device = androidDevices.find((item) => item.id === selectedAndroidDeviceId)
    if (!device) return
    setActiveAndroidDevice(device)
    setActiveUdid(null)
    setAndroidScreenSize({ width: 1080, height: 1920 })
    setIsChoosing(false)
  }

  const runAndroidCommand = async (
    command:
      | "home"
      | "back"
      | "recents"
      | "reload"
      | "reverse"
      | "tap"
      | "swipe"
      | "rotate"
      | "type",
    options?: { x?: number; y?: number; endX?: number; endY?: number; text?: string }
  ) => {
    if (!activeAndroidDevice) return
    const result = (await ipcRenderer.invoke(
      "android-device-command",
      activeAndroidDevice.id,
      command,
      { ...options, port: getConfiguredServerPort() }
    )) as IPCResponse
    if (!result.ok) {
      setStatus(result.message || "The Android device command failed.")
      setIsError(true)
    }
  }

  const androidScreenPoint = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const bezel = deviceFrameLayout?.bezel ?? 0
    const screenWidth = Math.max(1, bounds.width - bezel * 2)
    const screenHeight = Math.max(1, bounds.height - bezel * 2)
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left - bezel) / screenWidth)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top - bezel) / screenHeight)),
    }
  }

  const completeAndroidGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    const touch = androidTouchRef.current
    if (!touch || touch.pointerId !== event.pointerId) return
    const end = androidScreenPoint(event)
    androidTouchRef.current = null
    const moved = Math.hypot(end.x - touch.startX, end.y - touch.startY) > 0.015
    runAndroidCommand(
      moved ? "swipe" : "tap",
      moved
        ? { x: touch.startX, y: touch.startY, endX: end.x, endY: end.y }
        : { x: touch.startX, y: touch.startY }
    ).catch(() => undefined)
  }

  const onAndroidKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.nativeEvent.isComposing) return
    if (event.key.length !== 1) return
    event.preventDefault()
    runAndroidCommand("type", { text: event.key }).catch(() => undefined)
  }

  const onAndroidPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const text = event.clipboardData.getData("text")
    if (!text) return
    event.preventDefault()
    runAndroidCommand("type", { text }).catch(() => undefined)
  }

  const takeAndroidScreenshot = useCallback(async () => {
    if (!activeAndroidDevice) return
    const result = (await ipcRenderer.invoke(
      "android-device-screenshot-action",
      activeAndroidDevice.id
    )) as IPCResponse & { action?: "copied" | "saved"; canceled?: boolean; filePath?: string }
    if (!result.canceled) {
      setStatus(
        result.message ||
          (result.ok
            ? result.action === "copied"
              ? "Screenshot copied to clipboard."
              : `Saved screenshot to ${result.filePath}`
            : "Could not capture Android screenshot.")
      )
      setIsError(!result.ok)
    }
  }, [activeAndroidDevice])

  const toggleAndroidRecording = useCallback(async () => {
    if (!activeAndroidDevice) return
    const result = (await ipcRenderer.invoke(
      "toggle-android-device-recording",
      activeAndroidDevice.id
    )) as IPCResponse & { canceled?: boolean; filePath?: string; recording?: boolean }
    if (!result.ok) {
      setStatus(result.message || "Could not change Android recording.")
      setIsError(true)
      return
    }
    setIsAndroidRecording(Boolean(result.recording))
    setStatus(
      result.recording
        ? `Recording Android video. Press ${shortcutModifier}+R or the red button to stop.`
        : result.canceled
          ? "Recording discarded."
          : `Saved recording to ${result.filePath}.`
    )
    setIsError(false)
  }, [activeAndroidDevice])

  const openSurface = useCallback(
    async (udid = selectedUdid) => {
      const simulator = simulators.find((item) => item.udid === udid)
      if (!simulator) return

      const existingSurface = surfaces.find((surface) => surface.udid === simulator.udid)
      if (existingSurface) {
        setActiveUdid(existingSurface.udid)
        setIsChoosing(false)
        return
      }

      setIsLoading(true)
      setStatus("Starting secure local simulator preview...")
      setIsError(false)
      const result = (await ipcRenderer.invoke(
        "start-ios-simulator-surface",
        simulator.udid
      )) as IPCResponse & {
        previewUrl?: string
        streamUrl?: string
        wsUrl?: string
        simulator?: Simulator
      }
      setIsLoading(false)
      if (!result.ok || !result.previewUrl || !result.streamUrl || !result.wsUrl) {
        setStatus(result.message || "Could not start the simulator preview.")
        setIsError(true)
        return
      }

      const surface: Surface = {
        ...simulator,
        ...result.simulator,
        previewUrl: result.previewUrl,
        streamUrl: result.streamUrl,
        wsUrl: result.wsUrl,
        orientation: "portrait",
      }
      setSimulators((current) =>
        current.map((item) =>
          item.udid === simulator.udid ? { ...item, ...result.simulator } : item
        )
      )
      setSurfaces((current) => [...current, surface])
      setActiveUdid(simulator.udid)
      setIsChoosing(false)
      setStatus("")
    },
    [selectedUdid, simulators, surfaces]
  )

  useEffect(() => {
    if (!isOpen || autoOpenAttemptedRef.current || simulators.length === 0) return

    const simulator = simulators.find((item) => item.state === "Booted") ?? simulators[0]
    autoOpenAttemptedRef.current = true
    setSelectedUdid(simulator.udid)
    openSurface(simulator.udid).catch(() => undefined)
  }, [isOpen, openSurface, simulators])

  const createSurface = async () => {
    if (!selectedDeviceType) return

    setIsLoading(true)
    setStatus("Creating and booting iOS Simulator...")
    setIsError(false)
    const result = (await ipcRenderer.invoke(
      "create-ios-simulator-surface",
      selectedDeviceType
    )) as IPCResponse & {
      previewUrl?: string
      streamUrl?: string
      wsUrl?: string
      simulator?: Simulator
    }
    setIsLoading(false)
    if (
      !result.ok ||
      !result.previewUrl ||
      !result.streamUrl ||
      !result.wsUrl ||
      !result.simulator
    ) {
      setStatus(result.message || "Could not create the iOS simulator.")
      setIsError(true)
      return
    }

    const surface: Surface = {
      ...result.simulator,
      previewUrl: result.previewUrl,
      streamUrl: result.streamUrl,
      wsUrl: result.wsUrl,
      orientation: "portrait",
    }
    setSimulators((current) => [...current, result.simulator!])
    setSurfaces((current) => [...current, surface])
    setActiveUdid(surface.udid)
    setIsChoosing(false)
    setStatus("")
  }

  const runSurfaceCommand = async (command: "home" | "landscape_left" | "portrait") => {
    if (!activeSurface) return
    const result = (await ipcRenderer.invoke(
      "ios-simulator-surface-command",
      activeSurface.udid,
      command,
      activeSurface.wsUrl
    )) as IPCResponse
    if (!result.ok) {
      setStatus(result.message || "The simulator command failed.")
      setIsError(true)
      return
    }

    if (command !== "home") {
      // This only records the next requested rotation. The frame itself follows
      // the MJPEG dimensions, so an asynchronous stream can never be stretched.
      setSurfaces((current) =>
        current.map((surface) =>
          surface.udid === activeSurface.udid ? { ...surface, orientation: command } : surface
        )
      )
    }
  }

  const reload = async () => {
    const result = (await ipcRenderer.invoke("reload-ios-simulator")) as IPCResponse
    setStatus(result.message || (result.ok ? "Reload requested." : "The reload request failed."))
    setIsError(!result.ok)
  }

  const reconnect = async () => {
    if (!activeSurface) return

    setStatus("Reconnecting simulator preview...")
    setIsError(false)
    const result = (await ipcRenderer.invoke(
      "reconnect-ios-simulator-surface",
      activeSurface.udid
    )) as IPCResponse & { previewUrl?: string; streamUrl?: string; wsUrl?: string }
    if (!result.ok || !result.previewUrl || !result.streamUrl || !result.wsUrl) {
      setStatus(result.message || "Could not reconnect the simulator preview.")
      setIsError(true)
      return
    }

    setSurfaces((current) =>
      current.map((surface) =>
        surface.udid === activeSurface.udid
          ? {
              ...surface,
              previewUrl: result.previewUrl!,
              streamUrl: result.streamUrl!,
              wsUrl: result.wsUrl!,
            }
          : surface
      )
    )
    setStatus("")
  }

  const shutdown = async () => {
    if (!activeSurface) return

    const result = (await ipcRenderer.invoke(
      "shutdown-ios-simulator-surface",
      activeSurface.udid
    )) as IPCResponse
    if (!result.ok) {
      setStatus(result.message || "Could not shut down the simulator.")
      setIsError(true)
      return
    }

    const activeIndex = surfaces.findIndex((surface) => surface.udid === activeSurface.udid)
    const remainingSurfaces = surfaces.filter((surface) => surface.udid !== activeSurface.udid)
    setSurfaces(remainingSurfaces)
    setSimulators((current) =>
      current.map((simulator) =>
        simulator.udid === activeSurface.udid ? { ...simulator, state: "Shutdown" } : simulator
      )
    )
    setActiveUdid(remainingSurfaces[Math.max(0, activeIndex - 1)]?.udid || null)
    setIsChoosing(remainingSurfaces.length === 0)
    setStatus("")
  }

  const closeSurface = async (udid: string) => {
    if (surfaces.find((surface) => surface.udid === udid)?.recording) {
      setStatus("Stop the simulator recording before closing this simulator.")
      setIsError(true)
      return
    }
    const result = (await ipcRenderer.invoke("close-ios-simulator-surface", udid)) as IPCResponse
    if (!result.ok) {
      setStatus(result.message || "Could not close the simulator.")
      setIsError(true)
      return
    }
    const activeIndex = surfaces.findIndex((surface) => surface.udid === udid)
    const remainingSurfaces = surfaces.filter((surface) => surface.udid !== udid)
    setSurfaces(remainingSurfaces)
    if (activeUdid === udid) {
      const nextSurface = remainingSurfaces[Math.max(0, activeIndex - 1)]
      setActiveUdid(nextSurface?.udid || null)
      setIsChoosing(!nextSurface && !activeAndroidDevice)
    }
    setStatus("")
    setIsError(false)
  }

  const closeAndroidSurface = () => {
    if (isAndroidRecording) {
      setStatus("Stop the Android recording before closing this device.")
      setIsError(true)
      return
    }
    setActiveAndroidDevice(null)
    setActiveUdid(surfaces[0]?.udid ?? null)
    setIsChoosing(surfaces.length === 0)
    setStatus("")
    setIsError(false)
  }

  const activeDeviceValue = isChoosing
    ? ""
    : activeSurface
      ? `ios:${activeSurface.udid}`
      : activeAndroidDevice
        ? `android:${activeAndroidDevice.id}`
        : ""
  const openDeviceCount = surfaces.length + (activeAndroidDevice ? 1 : 0)
  const activeDeviceName = activeSurface?.name ?? activeAndroidDevice?.model

  const selectActiveDevice = (value: string) => {
    if (value.startsWith("ios:")) {
      setActiveUdid(value.slice("ios:".length))
      setIsChoosing(false)
      return
    }
    if (
      value.startsWith("android:") &&
      activeAndroidDevice?.id === value.slice("android:".length)
    ) {
      setActiveUdid(null)
      setIsChoosing(false)
    }
  }

  const closeActiveDevice = () => {
    if (activeSurface) {
      closeSurface(activeSurface.udid).catch(() => undefined)
      return
    }
    if (activeAndroidDevice && !isChoosing) closeAndroidSurface()
  }

  const takeScreenshot = useCallback(async () => {
    if (!activeSurface) return
    const result = (await ipcRenderer.invoke(
      "ios-simulator-screenshot",
      activeSurface.udid
    )) as IPCResponse & {
      action?: "copied" | "saved"
      canceled?: boolean
      filePath?: string
    }
    if (!result.canceled) {
      setStatus(
        result.message ||
          (result.ok
            ? result.action === "copied"
              ? "Screenshot copied to clipboard."
              : `Saved screenshot to ${result.filePath}`
            : "Could not capture screenshot.")
      )
      setIsError(!result.ok)
    }
  }, [activeSurface])

  const toggleRecording = useCallback(async () => {
    if (!activeSurface) return

    const result = (await ipcRenderer.invoke(
      "toggle-ios-simulator-recording",
      activeSurface.udid
    )) as IPCResponse & { canceled?: boolean; filePath?: string; recording?: boolean }
    if (!result.ok) {
      setStatus(result.message || "Could not change simulator recording.")
      setIsError(true)
      return
    }
    setSurfaces((current) =>
      current.map((surface) =>
        surface.udid === activeSurface.udid ? { ...surface, recording: result.recording } : surface
      )
    )
    setStatus(
      result.recording
        ? `Recording simulator video. Press ${shortcutModifier}+R or the red button to stop.`
        : result.canceled
          ? "Recording discarded."
          : `Saved recording to ${result.filePath}.`
    )
    setIsError(false)
  }, [activeSurface])

  const toggleAppearance = useCallback(async () => {
    if (!activeSurface) return

    const result = (await ipcRenderer.invoke(
      "toggle-ios-simulator-appearance",
      activeSurface.udid
    )) as IPCResponse & { appearance?: string }
    setStatus(
      result.message ||
        (result.ok ? `Simulator appearance: ${result.appearance}.` : "Could not change appearance.")
    )
    setIsError(!result.ok)
  }, [activeSurface])

  useEffect(() => {
    const handleShortcut = (_event: unknown, shortcut: string) => {
      if (activeSurface) {
        if (shortcut === "screenshot") takeScreenshot().catch(() => undefined)
        if (shortcut === "record") toggleRecording().catch(() => undefined)
        if (shortcut === "appearance") toggleAppearance().catch(() => undefined)
      }
      if (activeAndroidDevice) {
        if (shortcut === "screenshot") takeAndroidScreenshot().catch(() => undefined)
        if (shortcut === "record") toggleAndroidRecording().catch(() => undefined)
      }
    }

    ipcRenderer.on("ios-simulator-shortcut", handleShortcut)
    return () => {
      ipcRenderer.removeListener("ios-simulator-shortcut", handleShortcut)
    }
  }, [
    activeAndroidDevice,
    activeSurface,
    takeAndroidScreenshot,
    takeScreenshot,
    toggleAndroidRecording,
    toggleAppearance,
    toggleRecording,
  ])

  // serve-sim exits on its own when its helper stops, and the replacement
  // usually lands on a different port. The main process restarts it and reports
  // the new address here so the preview follows it instead of retrying a dead
  // one forever.
  useEffect(() => {
    const handleMoved = (
      _event: unknown,
      moved: { udid: string; previewUrl: string; streamUrl: string; wsUrl: string }
    ) => {
      setSurfaces((current) =>
        current.map((surface) =>
          surface.udid === moved.udid
            ? {
                ...surface,
                previewUrl: moved.previewUrl,
                streamUrl: moved.streamUrl,
                wsUrl: moved.wsUrl,
              }
            : surface
        )
      )
    }

    ipcRenderer.on("ios-simulator-surface-moved", handleMoved)
    return () => {
      ipcRenderer.removeListener("ios-simulator-surface-moved", handleMoved)
    }
  }, [])

  useEffect(() => {
    keyboardTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    keyboardTimersRef.current = []
    setIsControlConnected(false)
    if (!activeWsUrl) {
      controlSocketRef.current = null
      return undefined
    }

    let disposed = false
    let retryTimer: number | undefined
    let attempts = 0

    // The control socket drops whenever serve-sim restarts or the machine
    // sleeps. Without a retry the surface stays on "Connecting" forever,
    // because this effect only re-runs when the device or its URL changes.
    //
    // Retrying is bounded and backs off: when serve-sim is not running at all
    // every attempt is refused immediately, and an unbounded retry turns that
    // into a console full of identical failures for as long as the surface
    // stays open. The manual reconnect control restarts serve-sim itself and is
    // the way back from an exhausted budget.
    const connect = () => {
      if (disposed) return

      const socket = new WebSocket(activeWsUrl)
      controlSocketRef.current = socket
      socket.binaryType = "arraybuffer"

      const scheduleRetry = () => {
        if (disposed) return
        setIsControlConnected(false)
        if (controlSocketRef.current === socket) controlSocketRef.current = null
        if (attempts >= CONTROL_SOCKET_RETRY_LIMIT) return
        const delay = CONTROL_SOCKET_RETRY_DELAY * Math.pow(2, attempts)
        attempts += 1
        window.clearTimeout(retryTimer)
        retryTimer = window.setTimeout(connect, delay)
      }

      socket.onopen = () => {
        if (disposed) return
        attempts = 0
        setIsControlConnected(true)
      }
      socket.onmessage = (event) => {
        const config = parseSimulatorScreenConfigFrame(event.data)
        if (!config || !activeUdid) return

        setSurfaces((current) =>
          current.map((surface) =>
            surface.udid === activeUdid
              ? {
                  ...surface,
                  screenSize: config.screenSize,
                  orientation: config.orientation ?? surface.orientation,
                }
              : surface
          )
        )
      }
      socket.onerror = scheduleRetry
      socket.onclose = scheduleRetry
    }

    connect()

    return () => {
      disposed = true
      window.clearTimeout(retryTimer)
      const socket = controlSocketRef.current
      socket?.close()
      controlSocketRef.current = null
      setIsControlConnected(false)
    }
  }, [activeUdid, activeWsUrl])

  const sendControl = useCallback((tag: number, payload: object) => {
    const socket = controlSocketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) return false
    try {
      socket.send(encodeControlFrame(tag, payload))
      return true
    } catch {
      return false
    }
  }, [])

  const sendKeyboardFrames = useCallback(
    (frames: KeyboardFrame[]) => {
      keyboardTimersRef.current.forEach((timer) => window.clearTimeout(timer))
      keyboardTimersRef.current = []
      if (!frames.length || !sendControl(6, frames[0])) return false
      frames.slice(1).forEach((frame, index) => {
        const timer = window.setTimeout(
          () => {
            keyboardTimersRef.current = keyboardTimersRef.current.filter((id) => id !== timer)
            sendControl(6, frame)
          },
          (index + 1) * 4
        )
        keyboardTimersRef.current.push(timer)
      })
      return true
    },
    [sendControl]
  )

  const screenPoint = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const point = {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    }
    return mapPointToStream(point, activeStreamRotation)
  }

  const onScreenPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
    const point = screenPoint(event)
    touchRef.current = { pointerId: event.pointerId, ...point }
    event.currentTarget.setPointerCapture(event.pointerId)
    sendControl(3, { type: "begin", ...point })
  }

  const onScreenPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (touchRef.current?.pointerId !== event.pointerId) return
    event.preventDefault()
    const point = screenPoint(event)
    touchRef.current = { pointerId: event.pointerId, ...point }
    sendControl(3, { type: "move", ...point })
  }

  const onScreenPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (touchRef.current?.pointerId !== event.pointerId) return
    event.preventDefault()
    const point = screenPoint(event)
    touchRef.current = null
    sendControl(3, { type: "end", ...point })
  }

  const onScreenKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey) return
    const frames = keyboardFrames(event.key, event.shiftKey)
    if (!frames || !sendKeyboardFrames(frames)) return
    event.preventDefault()
    event.stopPropagation()
  }

  const onScreenPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const text = event.clipboardData.getData("text")
    if (!text) return
    const characterFrames = Array.from(text).map((character) => keyboardFrames(character))
    if (characterFrames.some((frames) => !frames)) return
    const frames = characterFrames.flatMap((character) => character || [])
    if (sendKeyboardFrames(frames)) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsResizing(true)
    const startX = event.clientX
    const startWidth = panelRef.current?.clientWidth ?? panelWidth
    const mainWidth = panelRef.current?.previousElementSibling?.getBoundingClientRect().width ?? 350
    const maxWidth = Math.max(340, startWidth + mainWidth - 350)

    const resize = (moveEvent: PointerEvent) => {
      setPanelWidth(Math.min(maxWidth, Math.max(340, startWidth - (moveEvent.clientX - startX))))
    }
    const finishResize = () => {
      setIsResizing(false)
      document.removeEventListener("pointermove", resize)
      document.removeEventListener("pointerup", finishResize)
      document.removeEventListener("pointercancel", finishResize)
      window.removeEventListener("blur", finishResize)
    }

    document.addEventListener("pointermove", resize)
    document.addEventListener("pointerup", finishResize)
    document.addEventListener("pointercancel", finishResize)
    window.addEventListener("blur", finishResize)
  }

  return (
    <Panel
      ref={panelRef}
      $isOpen={isOpen}
      $isResizing={isResizing}
      $width={panelWidth}
      aria-label="mobile device surface"
    >
      {isOpen && (
        <ResizeHandle role="separator" aria-orientation="vertical" onPointerDown={startResize} />
      )}
      {isOpen && (
        <Content>
          <DeviceBar>
            <ActiveDeviceSelect
              aria-label="Active simulator or device"
              disabled={openDeviceCount === 0}
              value={activeDeviceValue}
              onChange={(event) => selectActiveDevice(event.target.value)}
            >
              <option value="" disabled>
                {openDeviceCount === 0 ? "No open devices" : "Select a device"}
              </option>
              {surfaces.length > 0 && (
                <optgroup label="iOS Simulators">
                  {surfaces.map((surface) => (
                    <option key={surface.udid} value={`ios:${surface.udid}`}>
                      {surface.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {activeAndroidDevice && (
                <optgroup label="Android">
                  <option value={`android:${activeAndroidDevice.id}`}>
                    {activeAndroidDevice.model}
                  </option>
                </optgroup>
              )}
            </ActiveDeviceSelect>
            <IconButton
              type="button"
              aria-label={activeDeviceName ? `Close ${activeDeviceName}` : "Close active device"}
              title={activeDeviceName ? `Close ${activeDeviceName}` : "Close active device"}
              disabled={!activeDeviceName || isChoosing}
              onClick={closeActiveDevice}
            >
              <MdClose size={14} />
            </IconButton>
            <IconButton
              type="button"
              aria-label="Add a mobile device"
              title="Add a mobile device"
              onClick={() => {
                setIsChoosing(true)
                loadSimulators().catch(() => undefined)
                loadAndroidDevices().catch(() => undefined)
              }}
            >
              <MdAdd size={19} />
            </IconButton>
          </DeviceBar>
          {activeSurface && !isChoosing ? (
            <>
              <ToolBar>
                <DeviceName title={`${activeSurface.name} ${activeSurface.runtime}`}>
                  {activeSurface.name}
                  <ConnectionStatus $connected={isControlConnected}>
                    {isControlConnected ? "Connected" : "Connecting"}
                  </ConnectionStatus>
                  {activeSurface.recording && <RecordingStatus>REC</RecordingStatus>}
                </DeviceName>
                <Actions>
                  <IconButton
                    type="button"
                    title="Home"
                    onClick={() => runSurfaceCommand("home").catch(() => undefined)}
                  >
                    <MdHome size={19} />
                  </IconButton>
                  <IconButton
                    type="button"
                    title="Reload app"
                    onClick={() => reload().catch(() => undefined)}
                  >
                    <MdRefresh size={18} />
                  </IconButton>
                  <IconButton
                    type="button"
                    title="Reconnect simulator preview"
                    onClick={() => reconnect().catch(() => undefined)}
                  >
                    <MdOutlineLink size={18} />
                  </IconButton>
                  <IconButton
                    type="button"
                    title="Shut down simulator"
                    onClick={() => shutdown().catch(() => undefined)}
                  >
                    <MdOutlinePowerSettingsNew size={18} />
                  </IconButton>
                  <IconButton
                    type="button"
                    title="Rotate simulator"
                    onClick={() =>
                      runSurfaceCommand(
                        activeSurface.orientation === "portrait" ? "landscape_left" : "portrait"
                      ).catch(() => undefined)
                    }
                  >
                    <MdRotateRight size={18} />
                  </IconButton>
                  <IconButton
                    type="button"
                    title={`Screenshot: copy or save (${shortcutModifier}+S)`}
                    onClick={() => takeScreenshot().catch(() => undefined)}
                  >
                    <MdScreenshot size={18} />
                  </IconButton>
                  <RecordingButton
                    $recording={Boolean(activeSurface.recording)}
                    type="button"
                    title={
                      activeSurface.recording
                        ? `Stop recording and choose where to save (${shortcutModifier}+R)`
                        : `Start screen recording (${shortcutModifier}+R)`
                    }
                    onClick={() => toggleRecording().catch(() => undefined)}
                  >
                    <MdFiberManualRecord size={19} />
                  </RecordingButton>
                </Actions>
              </ToolBar>
              <PreviewContainer>
                <PreviewPane ref={setPreviewPane}>
                  <DeviceFrame
                    $layout={deviceFrameLayout}
                    $platform="ios"
                    aria-label={`${activeSurface.name} simulator screen`}
                    onKeyDown={onScreenKeyDown}
                    onPaste={onScreenPaste}
                    onPointerCancel={onScreenPointerEnd}
                    onPointerDown={onScreenPointerDown}
                    onPointerMove={onScreenPointerMove}
                    onPointerUp={onScreenPointerEnd}
                    role="application"
                    tabIndex={0}
                  >
                    {iosUsesMjpeg ? (
                      <FallbackPreview
                        ref={iosVideoImageRef}
                        $rotation={activeStreamRotation}
                        $screenWidth={activeScreenWidth}
                        $screenHeight={activeScreenHeight}
                        aria-label={`${activeSurface.name} simulator screen`}
                      />
                    ) : (
                      <Preview
                        ref={iosVideoCanvasRef}
                        $rotation={activeStreamRotation}
                        $screenWidth={activeScreenWidth}
                        $screenHeight={activeScreenHeight}
                        aria-label={`${activeSurface.name} simulator screen`}
                        role="img"
                      />
                    )}
                  </DeviceFrame>
                </PreviewPane>
              </PreviewContainer>
              {status && <Status $error={isError}>{status}</Status>}
            </>
          ) : activeAndroidDevice && !isChoosing ? (
            <>
              <ToolBar>
                <DeviceName title={activeAndroidDevice.id}>
                  {activeAndroidDevice.model}
                  <ConnectionStatus $connected>
                    {activeAndroidDevice.type === "emulator" ? "Emulator" : "Physical device"}
                  </ConnectionStatus>
                </DeviceName>
                <Actions>
                  <IconButton
                    type="button"
                    title="Back"
                    onClick={() => runAndroidCommand("back").catch(() => undefined)}
                  >
                    <MdArrowBack size={19} />
                  </IconButton>
                  <IconButton
                    type="button"
                    title="Home"
                    onClick={() => runAndroidCommand("home").catch(() => undefined)}
                  >
                    <MdHome size={19} />
                  </IconButton>
                  <IconButton
                    type="button"
                    title="Recents"
                    onClick={() => runAndroidCommand("recents").catch(() => undefined)}
                  >
                    <MdApps size={19} />
                  </IconButton>
                  <IconButton
                    type="button"
                    title="Reload app"
                    onClick={() => runAndroidCommand("reload").catch(() => undefined)}
                  >
                    <MdRefresh size={18} />
                  </IconButton>
                  <IconButton
                    type="button"
                    title="Rotate device"
                    onClick={() => runAndroidCommand("rotate").catch(() => undefined)}
                  >
                    <MdRotateRight size={18} />
                  </IconButton>
                  <IconButton
                    type="button"
                    title="Configure adb reverse for Reactotron"
                    onClick={() => runAndroidCommand("reverse").catch(() => undefined)}
                  >
                    <MdOutlineLink size={18} />
                  </IconButton>
                  <IconButton
                    type="button"
                    title={`Screenshot: copy or save (${shortcutModifier}+S)`}
                    onClick={() => takeAndroidScreenshot().catch(() => undefined)}
                  >
                    <MdScreenshot size={18} />
                  </IconButton>
                  <RecordingButton
                    $recording={isAndroidRecording}
                    type="button"
                    title={
                      isAndroidRecording
                        ? `Stop recording and choose where to save (${shortcutModifier}+R)`
                        : `Start screen recording (${shortcutModifier}+R)`
                    }
                    onClick={() => toggleAndroidRecording().catch(() => undefined)}
                  >
                    <MdFiberManualRecord size={19} />
                  </RecordingButton>
                </Actions>
              </ToolBar>
              <PreviewContainer>
                <PreviewPane ref={setPreviewPane}>
                  <DeviceFrame
                    $layout={deviceFrameLayout}
                    $platform="android"
                    aria-label={`${activeAndroidDevice.model} Android screen`}
                    onKeyDown={onAndroidKeyDown}
                    onPaste={onAndroidPaste}
                    onPointerDown={(event) => {
                      if (event.button !== 0) return
                      event.preventDefault()
                      const point = androidScreenPoint(event)
                      androidTouchRef.current = {
                        pointerId: event.pointerId,
                        startX: point.x,
                        startY: point.y,
                        ...point,
                      }
                      event.currentTarget.setPointerCapture(event.pointerId)
                    }}
                    onPointerMove={(event) => {
                      if (androidTouchRef.current?.pointerId !== event.pointerId) return
                      event.preventDefault()
                      androidTouchRef.current = {
                        ...androidTouchRef.current,
                        ...androidScreenPoint(event),
                      }
                    }}
                    onPointerUp={completeAndroidGesture}
                    onPointerCancel={(event) => {
                      if (androidTouchRef.current?.pointerId === event.pointerId) {
                        androidTouchRef.current = null
                      }
                    }}
                    role="application"
                    tabIndex={0}
                  >
                    <AndroidVideoPreview ref={androidVideoCanvasRef} />
                  </DeviceFrame>
                </PreviewPane>
              </PreviewContainer>
              {status && <Status $error={isError}>{status}</Status>}
            </>
          ) : (
            <EmptyState>
              <EmptyIcon size={34} />
              <EmptyTitle>Open a surface</EmptyTitle>
              <EmptyCopy>
                {supportsIOSSimulator
                  ? "Attach a booted simulator, create one, or connect an Android device."
                  : "Connect an Android emulator or physical device with ADB."}
              </EmptyCopy>
              <ActionStack>
                {supportsIOSSimulator && (
                  <>
                    <ActionSection>
                      <ActionLabel>Available simulators</ActionLabel>
                      <DeviceSelect
                        aria-label="Available iOS simulators"
                        value={selectedUdid}
                        disabled={isLoading || simulators.length === 0}
                        onChange={(event) => setSelectedUdid(event.target.value)}
                      >
                        {simulators.map((simulator) => (
                          <option key={simulator.udid} value={simulator.udid}>
                            {simulator.name} ({simulator.runtime}){" "}
                            {simulator.state === "Booted" ? "- Booted" : ""}
                          </option>
                        ))}
                      </DeviceSelect>
                      <PrimaryButton
                        type="button"
                        disabled={!selectedUdid || isLoading}
                        onClick={() => openSurface().catch(() => undefined)}
                      >
                        {isLoading ? "Starting..." : "Open simulator"}
                      </PrimaryButton>
                    </ActionSection>
                    {creationOptions.length > 0 && (
                      <>
                        <ActionDivider />
                        <ActionSection>
                          <ActionLabel>Create simulator</ActionLabel>
                          <DeviceSelect
                            aria-label="New iOS simulator type"
                            value={selectedDeviceType}
                            disabled={isLoading}
                            onChange={(event) => setSelectedDeviceType(event.target.value)}
                          >
                            {creationOptions.map((option) => (
                              <option
                                key={option.deviceTypeIdentifier}
                                value={option.deviceTypeIdentifier}
                              >
                                {option.name} ({option.runtimeName})
                              </option>
                            ))}
                          </DeviceSelect>
                          <SecondaryButton
                            type="button"
                            disabled={isLoading}
                            onClick={() => createSurface().catch(() => undefined)}
                          >
                            {isLoading ? "Creating..." : "Create simulator"}
                          </SecondaryButton>
                        </ActionSection>
                      </>
                    )}
                    <ActionDivider />
                  </>
                )}
                <ActionSection>
                  <ActionLabel>Android emulators and devices</ActionLabel>
                  <DeviceSelect
                    aria-label="Available Android devices"
                    value={selectedAndroidDeviceId}
                    disabled={isAndroidLoading || androidDevices.length === 0}
                    onChange={(event) => setSelectedAndroidDeviceId(event.target.value)}
                  >
                    {androidDevices.map((device) => (
                      <option key={device.id} value={device.id}>
                        {device.model} ({device.type})
                      </option>
                    ))}
                  </DeviceSelect>
                  <SecondaryButton
                    type="button"
                    disabled={isAndroidLoading || !selectedAndroidDeviceId}
                    onClick={openAndroidDevice}
                  >
                    {isAndroidLoading ? "Finding Android devices..." : "Open Android device"}
                  </SecondaryButton>
                  <EmptyCopy>
                    Connect an emulator, USB device, or Wi-Fi ADB device. Opening it configures a
                    live preview and controls.
                  </EmptyCopy>
                </ActionSection>
              </ActionStack>
              <Status $error={isError}>{status}</Status>
              <IconButton
                type="button"
                title="Refresh mobile devices"
                disabled={isLoading || isAndroidLoading}
                onClick={() => {
                  if (supportsIOSSimulator) loadSimulators().catch(() => undefined)
                  loadAndroidDevices().catch(() => undefined)
                }}
              >
                <MdRefresh size={18} />
              </IconButton>
            </EmptyState>
          )}
        </Content>
      )}
    </Panel>
  )
}

export default DeviceSurface
