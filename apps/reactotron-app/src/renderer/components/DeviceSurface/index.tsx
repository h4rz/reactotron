import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ipcRenderer } from "electron"
import { MdAdd, MdClose, MdPhoneIphone, MdRefresh } from "react-icons/md"
import { SiAndroid, SiApple } from "react-icons/si"
import {
  FiArrowLeft,
  FiBox,
  FiCamera,
  FiCompass,
  FiCrosshair,
  FiDisc,
  FiGrid,
  FiHome,
  FiLink,
  FiMoon,
  FiMoreHorizontal,
  FiPower,
  FiRefreshCw,
  FiRotateCw,
  FiTool,
  FiType,
  FiVolume2,
  FiVolumeX,
  FiX,
} from "react-icons/fi"
import styled from "styled-components"

import { isIOSSimulatorSupported } from "../../../platform"
import {
  deviceCommandEvent,
  formatBindingText,
  type DeviceCommand,
  useKeybindings,
} from "../../keybindings"
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
import DeviceViewport, { useFrameSignal, type SourceLimit } from "./DeviceViewport"
import { createMjpegFrameParser } from "./mjpegFrameParser"
import { resolveDeviceModelId } from "./scene/modelScene"
import type { DeviceOrientation, ScreenPoint } from "./scene/phoneScene"
import { resolveDeviceShape } from "./scene/shapeProfile"
import type { DuoState } from "./scene/viewer"

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

type PhysicalIOSDevice = {
  udid: string
  name: string
  productVersion: string
  available: boolean
}

type PhysicalIOSSurface = PhysicalIOSDevice & {
  streamUrl: string
  screenSize: { width: number; height: number }
}

type Surface = Simulator & {
  previewUrl: string
  streamUrl: string
  wsUrl: string
  orientation: "portrait" | "landscape_left" | "portrait_upside_down" | "landscape_right"
  recording?: boolean
  screenSize?: { width: number; height: number }
  supportsHingeAngle?: boolean
  hingeAngle?: number
  hingePose?: "closed" | "book" | "open" | "laptop" | "tent"
  screenId?: number
}

type DuoPose = NonNullable<Surface["hingePose"]>

const duoPoses: Array<{ id: DuoPose; label: string }> = [
  { id: "closed", label: "Closed" },
  { id: "book", label: "Book" },
  { id: "open", label: "Open" },
  { id: "laptop", label: "Laptop" },
  { id: "tent", label: "Tent" },
]

// Hinge angles for each pose, used until serve-sim reports a measured angle.
const duoPoseAngles: Record<DuoPose, number> = {
  closed: 0,
  book: 90,
  open: 180,
  laptop: 90,
  tent: 80,
}

function DuoPoseGlyph({ pose }: { pose: DuoPose }) {
  const paths: Record<DuoPose, string> = {
    closed: "M10 4v16m4-16v16",
    book: "M3 5l9 14 9-14",
    open: "M3 7v10h8V7zm10 0v10h8V7z",
    laptop: "M4 18h16M8 16l4-11",
    tent: "M3 19 12 4l9 15",
  }
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={paths[pose]} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  )
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
const DEVICE_3D_STORAGE_KEY = "reactotron.deviceHub.render3d"

const Panel = styled.aside<{
  $isOpen: boolean
  $isResizing: boolean
  $width: number
}>`
  display: flex;
  position: relative;
  flex: 0 0 ${(props) => (props.$isOpen ? `${props.$width}px` : "0")};
  width: ${(props) => (props.$isOpen ? `${props.$width}px` : "0")};
  min-width: ${(props) => (props.$isOpen ? "300px" : "0")};
  overflow: hidden;
  border-left: ${(props) => (props.$isOpen ? `1px solid ${props.theme.borderSubtle}` : "0")};
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
    background-color: ${(props) => props.theme.surfaceRaised};
    color: ${(props) => props.theme.foreground};
  }

  &:disabled {
    cursor: wait;
    opacity: 0.55;
  }
`

const RecordingButton = styled(IconButton)<{ $recording: boolean }>`
  width: 36px;
  min-height: 36px;
  border-radius: 8px;
  color: ${(props) => (props.$recording ? "#ef5c62" : props.theme.foregroundDark)};

  &:focus-visible {
    outline: 2px solid ${(props) => props.theme.highlight};
    outline-offset: -2px;
  }

  &:hover:not(:disabled) {
    background: ${(props) =>
      props.$recording ? "rgb(239 92 98 / 0.16)" : props.theme.surfaceRaised};
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
  gap: 4px;
  box-sizing: border-box;
  padding: 6px 44px 6px 8px;
  overflow: hidden;
  border-bottom: 1px solid ${(props) => props.theme.borderSubtle};
  background-color: ${(props) => props.theme.surfacePanel};
`

const DeviceTabs = styled.div`
  display: flex;
  min-width: 0;
  flex: 1;
  gap: 4px;
  overflow-x: auto;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
`

const DeviceTab = styled.div<{ $active: boolean }>`
  display: flex;
  width: 156px;
  height: 30px;
  /* Fixed so the strip does not reflow with device names; long names are cut off. */
  flex: 0 0 156px;
  align-items: center;
  box-sizing: border-box;
  border: 1px solid ${(props) => (props.$active ? props.theme.borderSubtle : "transparent")};
  border-radius: 8px;
  background: ${(props) => (props.$active ? props.theme.surfaceRaised : "transparent")};
  color: ${(props) => (props.$active ? props.theme.foreground : props.theme.foregroundDark)};

  &:hover {
    color: ${(props) => props.theme.foreground};
  }
`

const DeviceTabButton = styled.button`
  display: flex;
  min-width: 0;
  flex: 1;
  height: 100%;
  align-items: center;
  gap: 6px;
  padding: 0 4px 0 9px;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 600;

  > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &:focus-visible {
    border-radius: 7px;
    outline: 2px solid ${(props) => props.theme.highlight};
    outline-offset: -2px;
  }
`

const DeviceTabClose = styled(IconButton)`
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  margin-right: 3px;
  border-radius: 6px;
`

const PlatformMark = styled.span`
  display: grid;
  width: 15px;
  height: 15px;
  flex: 0 0 15px;
  place-items: center;
`

// Google's brand colour for the Android robot.
const ANDROID_GREEN = "#3ddc84"

/** Shown after the name only when a device needs attention: connecting or recording. */
const StatusDot = styled.span<{ $tone: "ok" | "pending" | "recording" }>`
  width: 6px;
  height: 6px;
  flex: 0 0 6px;
  margin-left: auto;
  border-radius: 50%;
  background: ${(props) =>
    props.$tone === "recording"
      ? "#ef5c62"
      : props.$tone === "ok"
        ? "#63b76c"
        : props.theme.warning};
  box-shadow: ${(props) =>
    props.$tone === "recording" ? "0 0 0 3px rgb(239 92 98 / 0.16)" : "none"};
`

const ControlsRail = styled.aside`
  position: absolute;
  z-index: 4;
  top: 50%;
  right: 10px;
  display: flex;
  width: 44px;
  align-items: center;
  flex-direction: column;
  gap: 2px;
  box-sizing: border-box;
  padding: 7px 3px;
  overflow-x: hidden;
  overflow-y: auto;
  max-height: calc(100% - 24px);
  border: 1px solid ${(props) => props.theme.borderSubtle};
  border-radius: 24px;
  background: color-mix(in srgb, ${(props) => props.theme.surfacePanel} 92%, transparent);
  box-shadow: 0 8px 28px rgb(0 0 0 / 0.24);
  scrollbar-width: none;
  transform: translateY(-50%);

  &::-webkit-scrollbar {
    display: none;
  }
`

const RailButton = styled(IconButton)<{ $active?: boolean }>`
  width: 38px;
  min-height: 38px;
  border-radius: 12px;
  background: ${(props) => (props.$active ? props.theme.surfaceRaised : "transparent")};
  color: ${(props) => (props.$active ? props.theme.highlight : props.theme.foregroundDark)};

  &:focus-visible {
    outline: 2px solid ${(props) => props.theme.highlight};
    outline-offset: -2px;
  }

  &:active:not(:disabled) {
    transform: scale(0.96);
  }
`

const ToolsDrawer = styled.section`
  position: absolute;
  z-index: 5;
  top: 12px;
  right: 62px;
  bottom: 12px;
  width: min(400px, calc(100% - 76px));
  box-sizing: border-box;
  overflow-y: auto;
  border: 1px solid ${(props) => props.theme.borderSubtle};
  border-radius: 12px;
  background: ${(props) => props.theme.surfacePanel};
  box-shadow: 0 16px 44px rgb(0 0 0 / 0.35);
`

const ToolsHeader = styled.div`
  display: flex;
  height: 48px;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  border-bottom: 1px solid ${(props) => props.theme.borderSubtle};
  color: ${(props) => props.theme.foreground};
  font-size: 13px;
  font-weight: 700;
`

const ToolsSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 12px;
  border-bottom: 1px solid ${(props) => props.theme.borderSubtle};

  > strong {
    margin: 0 4px 5px;
    color: ${(props) => props.theme.foregroundDark};
    font-size: 11px;
    font-weight: 600;
  }
`

const ToolsAction = styled.button`
  display: flex;
  min-height: 36px;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: ${(props) => props.theme.foregroundLight};
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  text-align: left;

  &:hover:not(:disabled),
  &:focus-visible {
    background: ${(props) => props.theme.surfaceRaised};
    color: ${(props) => props.theme.foreground};
  }

  &:focus-visible {
    outline: 2px solid ${(props) => props.theme.highlight};
    outline-offset: -2px;
  }

  &:disabled {
    opacity: 0.5;
  }
`

const RailDivider = styled.div`
  width: 22px;
  height: 1px;
  min-height: 1px;
  margin: 3px 0;
  background: ${(props) => props.theme.borderSubtle};
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

const PhysicalIOSPreview = styled.img`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  user-select: none;
  pointer-events: none;
`

const PreviewContainer = styled.div`
  position: relative;
  display: flex;
  min-height: 0;
  flex: 1;
  background: radial-gradient(
      ellipse at 50% 44%,
      color-mix(in srgb, ${(props) => props.theme.highlight} 16%, transparent),
      transparent 64%
    ),
    ${(props) => props.theme.background};
`

const KeyboardNotice = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 12px;
  border-bottom: 1px solid ${(props) => props.theme.borderSubtle};
  background: color-mix(in srgb, ${(props) => props.theme.warning} 10%, transparent);
  color: ${(props) => props.theme.foreground};
  font-size: 11px;
  line-height: 16px;
`

const KeyboardAccessButton = styled.button`
  min-height: 30px;
  flex: 0 0 auto;
  padding: 0 10px;
  border: 1px solid ${(props) => props.theme.warning};
  border-radius: 7px;
  background: ${(props) => props.theme.surfaceRaised};
  color: ${(props) => props.theme.foregroundLight};
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  font-weight: 650;

  &:focus-visible {
    outline: 2px solid ${(props) => props.theme.highlight};
    outline-offset: 2px;
  }
`

const PreviewPane = styled.div`
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  align-self: stretch;
  align-items: center;
  justify-content: center;
  margin: 12px 60px 12px 10px;
  overflow: hidden;
`

const DuoBar = styled.div`
  position: absolute;
  z-index: 3;
  bottom: 14px;
  left: calc(50% - 25px);
  display: flex;
  max-width: calc(100% - 90px);
  align-items: center;
  gap: 2px;
  box-sizing: border-box;
  padding: 3px;
  overflow-x: auto;
  border: 1px solid ${(props) => props.theme.borderSubtle};
  border-radius: 12px;
  background: color-mix(in srgb, ${(props) => props.theme.surfacePanel} 92%, transparent);
  box-shadow: 0 8px 28px rgb(0 0 0 / 0.24);
  scrollbar-width: none;
  transform: translateX(-50%);
`

const DuoPoseButton = styled.button<{ $active: boolean }>`
  display: grid;
  width: 34px;
  height: 30px;
  flex: 0 0 34px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 9px;
  background: ${(props) => (props.$active ? props.theme.surfaceRaised : "transparent")};
  color: ${(props) => (props.$active ? props.theme.highlight : props.theme.foregroundDark)};
  cursor: pointer;

  &:hover:not(:disabled) {
    color: ${(props) => props.theme.foreground};
  }

  &:focus-visible {
    outline: 2px solid ${(props) => props.theme.highlight};
    outline-offset: -2px;
  }

  &:disabled {
    cursor: wait;
    opacity: 0.5;
  }
`

const DuoAngleInput = styled.input`
  width: 96px;
  flex: 0 0 96px;
  margin: 0 8px 0 6px;
  accent-color: ${(props) => props.theme.highlight};
  cursor: pointer;

  &:disabled {
    cursor: wait;
    opacity: 0.5;
  }
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
  border: 1px solid ${(props) => props.theme.borderSubtle};
  border-radius: 8px;
  background: ${(props) => props.theme.surfaceRaised};
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
  border: 1px solid ${(props) => props.theme.borderSubtle};
  border-radius: 4px;
  outline: none;
  background: ${(props) => props.theme.surfaceRaised};
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
  border-color: ${(props) => props.theme.borderSubtle};
  background: ${(props) => props.theme.surfaceRaised};
  color: ${(props) => props.theme.foregroundLight};
`

const Status = styled.p<{ $error: boolean }>`
  max-width: 300px;
  margin: 14px 0 0;
  color: ${(props) => (props.$error ? props.theme.warning : props.theme.foregroundDark)};
  font-size: 12px;
  line-height: 1.4;
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

/**
 * Paint a decoded frame into the source canvas. While the 3D view is showing it
 * sets a height limit near its own drawing size: uploading a native 1206x2622
 * frame into WebGL every frame was the bulk of the GPU process's load, and the
 * 3D screen is never drawn taller than its canvas anyway. Flat mode has no limit.
 */
function drawLimited(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  width: number,
  height: number,
  limit: number | null
) {
  const scale = limit && height > limit ? limit / height : 1
  const targetWidth = Math.max(1, Math.round(width * scale))
  const targetHeight = Math.max(1, Math.round(height * scale))
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth
    canvas.height = targetHeight
  }
  const context = canvas.getContext("2d")
  if (!context) return
  context.imageSmoothingQuality = "high"
  context.drawImage(source, 0, 0, targetWidth, targetHeight)
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
  onUnsupported: () => void,
  frameListener: React.MutableRefObject<((sourceUrl: string) => void) | null>,
  sourceLimit: SourceLimit
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
      drawLimited(canvas, source, width, height, sourceLimit.height)
      if (streamUrl) frameListener.current?.(streamUrl)
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
  }, [enabled, frameListener, sourceLimit, streamUrl])

  return { canvasRef, isStreaming }
}

function useIOSVideoStream(
  streamUrl: string | undefined,
  enabled: boolean,
  frameListener: React.MutableRefObject<((sourceUrl: string) => void) | null>,
  sourceLimit: SourceLimit
) {
  const supportsAvcc =
    typeof (globalThis as any).VideoDecoder === "function" &&
    typeof (globalThis as any).EncodedVideoChunk === "function"
  const [useMjpegFallback, setUseMjpegFallback] = useState(!supportsAvcc)

  useEffect(() => setUseMjpegFallback(!supportsAvcc), [streamUrl, supportsAvcc])

  const avcc = useIOSAvccStream(
    streamUrl,
    enabled && !useMjpegFallback,
    () => setUseMjpegFallback(true),
    frameListener,
    sourceLimit
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
  onSize: (size: { width: number; height: number }) => void,
  onFrame: () => void,
  sourceLimit: SourceLimit
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const onSizeRef = useRef(onSize)
  onSizeRef.current = onSize
  const onFrameRef = useRef(onFrame)
  onFrameRef.current = onFrame
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
    let lastFrameSize = { width: 0, height: 0 }
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
          if (
            lastFrameSize.width !== frame.displayWidth ||
            lastFrameSize.height !== frame.displayHeight
          ) {
            lastFrameSize = { width: frame.displayWidth, height: frame.displayHeight }
            onSizeRef.current(lastFrameSize)
          }
          drawLimited(canvas, frame, frame.displayWidth, frame.displayHeight, sourceLimit.height)
          onFrameRef.current()
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
  }, [deviceId, enabled, sourceLimit])

  return { canvasRef, error }
}

function DeviceSurface({ isOpen }: { isOpen: boolean }) {
  const { bindings } = useKeybindings()
  const panelRef = useRef<HTMLElement>(null)
  const [previewPane, setPreviewPane] = useState<HTMLDivElement | null>(null)
  const [isResizing, setIsResizing] = useState(false)
  const [panelWidth, setPanelWidth] = useState(400)
  const [prefers3D, setPrefers3D] = useState(
    () => window.localStorage.getItem(DEVICE_3D_STORAGE_KEY) !== "false"
  )
  const [webglUnavailable, setWebglUnavailable] = useState(false)
  const render3D = prefers3D && !webglUnavailable
  const frames = useFrameSignal()
  const resetPoseRef = useRef<(() => void) | null>(null)
  const onResetReady = useCallback((reset: (() => void) | null) => {
    resetPoseRef.current = reset
  }, [])
  const on3DUnavailable = useCallback(() => setWebglUnavailable(true), [])
  const toggle3D = () => {
    const next = !render3D
    window.localStorage.setItem(DEVICE_3D_STORAGE_KEY, String(next))
    setPrefers3D(next)
    setWebglUnavailable(false)
  }
  const [deviceFrameLayout, setDeviceFrameLayout] = useState<DeviceFrameLayout | null>(null)
  const [simulators, setSimulators] = useState<Simulator[]>([])
  const [physicalIOSDevices, setPhysicalIOSDevices] = useState<PhysicalIOSDevice[]>([])
  const [selectedPhysicalIOSUdid, setSelectedPhysicalIOSUdid] = useState("")
  const [physicalIOSSurface, setPhysicalIOSSurface] = useState<PhysicalIOSSurface | null>(null)
  const [activePhysicalIOSUdid, setActivePhysicalIOSUdid] = useState<string | null>(null)
  const [androidDevices, setAndroidDevices] = useState<AndroidDevice[]>([])
  const [selectedAndroidDeviceId, setSelectedAndroidDeviceId] = useState("")
  const [activeAndroidDevice, setActiveAndroidDevice] = useState<AndroidDevice | null>(null)
  const [androidScreenSize, setAndroidScreenSize] = useState({ width: 1080, height: 1920 })
  const [isAndroidRecording, setIsAndroidRecording] = useState(false)
  const [isAndroidMuted, setIsAndroidMuted] = useState(false)
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
  const [keyboardAccess, setKeyboardAccess] = useState<{
    required: boolean
    trusted: boolean
    xcodeMajorVersion: number | null
  } | null>(null)
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
  const physicalTouchRef = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const iosTouchActiveRef = useRef(false)
  const [duoAngleDraft, setDuoAngleDraft] = useState<number | null>(null)
  const iosFrameListener = useRef<((sourceUrl: string) => void) | null>(null)
  const duoRequestRef = useRef<{ id: number; timer: number } | null>(null)
  const nextDuoRequestIdRef = useRef(1)
  const duoAwaitFrameRef = useRef(false)
  const lastDuoScreenIdRef = useRef<number | undefined>()
  const [duoPending, setDuoPending] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const toolsCloseRef = useRef<HTMLButtonElement>(null)
  const toolsTriggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!toolsOpen) return undefined
    const trigger = toolsTriggerRef.current
    toolsCloseRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setToolsOpen(false)
    }
    window.addEventListener("keydown", closeOnEscape)
    return () => {
      window.removeEventListener("keydown", closeOnEscape)
      trigger?.focus()
    }
  }, [toolsOpen])

  useEffect(() => setToolsOpen(false), [activeUdid, activePhysicalIOSUdid, activeAndroidDevice?.id])

  const activeSurface = useMemo(
    () => surfaces.find((surface) => surface.udid === activeUdid) ?? null,
    [activeUdid, surfaces]
  )
  const activePhysicalIOS =
    physicalIOSSurface?.udid === activePhysicalIOSUdid ? physicalIOSSurface : null
  const isAndroidSurfaceActive =
    activeAndroidDevice !== null && activeUdid === null && activePhysicalIOS === null
  const activeWsUrl = isOpen ? activeSurface?.wsUrl : undefined
  const activePreviewStreamUrl = activeSurface?.streamUrl
  const activeVideoStreamUrl =
    activePreviewStreamUrl && activeSurface?.supportsHingeAngle
      ? `${activePreviewStreamUrl}?screen=${activeSurface.screenId ?? 0}`
      : activePreviewStreamUrl
  const activeVideoStreamUrlRef = useRef(activeVideoStreamUrl)
  activeVideoStreamUrlRef.current = activeVideoStreamUrl
  iosFrameListener.current = (sourceUrl) => {
    if (sourceUrl !== activeVideoStreamUrlRef.current) return
    if (duoAwaitFrameRef.current && !duoRequestRef.current) duoAwaitFrameRef.current = false
    frames.notify()
  }
  const activeScreenAspectRatio = activePhysicalIOS
    ? activePhysicalIOS.screenSize.width / activePhysicalIOS.screenSize.height
    : isAndroidSurfaceActive
      ? androidScreenSize.width / androidScreenSize.height
      : resolveVisualScreenAspectRatio(
          activeSurface?.screenSize,
          activeSurface?.orientation ?? "portrait"
        )
  const activeFrameKind = resolveDeviceFrameKind(
    activePhysicalIOS?.name ??
      (isAndroidSurfaceActive ? activeAndroidDevice?.model : activeSurface?.name),
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
  } = useIOSVideoStream(
    activeVideoStreamUrl,
    isOpen && Boolean(activeSurface) && !isChoosing,
    iosFrameListener,
    frames.limit
  )

  useEffect(() => {
    lastDuoScreenIdRef.current = undefined
    duoAwaitFrameRef.current = false
    if (duoRequestRef.current) window.clearTimeout(duoRequestRef.current.timer)
    duoRequestRef.current = null
    setDuoPending(false)
  }, [activeUdid])
  const { canvasRef: androidVideoCanvasRef, error: androidVideoError } = useAndroidVideoStream(
    activeAndroidDevice?.id,
    isOpen && isAndroidSurfaceActive && !isChoosing,
    setAndroidScreenSize,
    frames.notify,
    frames.limit
  )

  useEffect(() => {
    if (!isOpen || !activeSurface) return undefined
    const refresh = () => {
      ipcRenderer
        .invoke("ios-simulator-keyboard-access")
        .then(setKeyboardAccess)
        .catch(() => setKeyboardAccess(null))
    }
    refresh()
    window.addEventListener("focus", refresh)
    return () => window.removeEventListener("focus", refresh)
  }, [activeSurface, isOpen])

  const requestKeyboardAccess = async () => {
    const result = await ipcRenderer.invoke("ios-simulator-keyboard-access", true)
    setKeyboardAccess(result)
    if (!result.trusted) {
      await ipcRenderer.invoke("open-ios-simulator-keyboard-settings")
      setStatus("Enable Reactotron in Accessibility, then fully quit and reopen it.")
      setIsError(true)
    }
  }

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

  const loadPhysicalIOSDevices = useCallback(async () => {
    const result = (await ipcRenderer.invoke("list-physical-ios-devices")) as IPCResponse & {
      devices: PhysicalIOSDevice[]
    }
    if (!result.ok) {
      setStatus(result.message || "Could not list connected iPhones.")
      setIsError(true)
      return
    }
    setPhysicalIOSDevices(result.devices)
    setSelectedPhysicalIOSUdid((current) =>
      result.devices.some((device) => device.udid === current)
        ? current
        : result.devices.find((device) => device.available)?.udid || ""
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
      loadPhysicalIOSDevices().catch(() => undefined)
    }
    loadAndroidDevices().catch(() => undefined)
  }, [loadAndroidDevices, loadCreationOptions, loadPhysicalIOSDevices, loadSimulators])

  const openPhysicalIOS = async () => {
    if (!selectedPhysicalIOSUdid) return
    setIsLoading(true)
    setStatus(
      "Starting physical iPhone preview. First-time WebDriverAgent setup may take several minutes..."
    )
    setIsError(false)
    const result = (await ipcRenderer.invoke(
      "open-physical-ios-device",
      selectedPhysicalIOSUdid
    )) as IPCResponse & {
      streamUrl?: string
      screenSize?: { width: number; height: number }
    }
    setIsLoading(false)
    if (!result.ok || !result.streamUrl || !result.screenSize) {
      setStatus(result.message || "Could not open physical iPhone preview.")
      setIsError(true)
      return
    }
    const device = physicalIOSDevices.find((item) => item.udid === selectedPhysicalIOSUdid)
    if (!device) return
    setPhysicalIOSSurface({
      ...device,
      streamUrl: result.streamUrl,
      screenSize: result.screenSize,
    })
    setActivePhysicalIOSUdid(device.udid)
    setActiveUdid(null)
    setIsChoosing(false)
    setStatus("")
    setIsError(false)
  }

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
    setActivePhysicalIOSUdid(null)
    setAndroidScreenSize({ width: 1080, height: 1920 })
    setIsChoosing(false)
  }

  const runAndroidCommand = useCallback(
    async (
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
    },
    [activeAndroidDevice]
  )

  const toggleAndroidMute = useCallback(async () => {
    if (!activeAndroidDevice) return
    const result = (await ipcRenderer.invoke(
      "toggle-android-device-mute",
      activeAndroidDevice.id
    )) as IPCResponse & { muted?: boolean }
    if (!result.ok) {
      setStatus(result.message || "Could not change Android media volume.")
      setIsError(true)
      return
    }
    setIsAndroidMuted(Boolean(result.muted))
    setStatus(result.muted ? "Android media muted." : "Android media unmuted.")
    setIsError(false)
  }, [activeAndroidDevice])

  useEffect(() => {
    if (!activeAndroidDevice) return undefined
    let canceled = false
    ipcRenderer
      .invoke("get-android-device-mute", activeAndroidDevice.id)
      .then((result: IPCResponse & { muted?: boolean }) => {
        if (!canceled && result.ok) setIsAndroidMuted(Boolean(result.muted))
      })
      .catch(() => undefined)
    return () => {
      canceled = true
    }
  }, [activeAndroidDevice])

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

  const sendPhysicalIOSInput = async (body: Record<string, string | number>) => {
    if (!activePhysicalIOS) return
    const result = (await ipcRenderer.invoke(
      "physical-ios-input",
      activePhysicalIOS.udid,
      body
    )) as IPCResponse
    if (!result.ok) {
      setStatus(result.message || "iPhone input failed.")
      setIsError(true)
    }
  }

  const completePhysicalIOSGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    const touch = physicalTouchRef.current
    if (!touch || touch.pointerId !== event.pointerId) return
    physicalTouchRef.current = null
    const end = androidScreenPoint(event)
    const moved = Math.hypot(end.x - touch.x, end.y - touch.y) > 0.015
    sendPhysicalIOSInput(
      moved
        ? { type: "drag", x: touch.x, y: touch.y, x2: end.x, y2: end.y }
        : { type: "tap", x: touch.x, y: touch.y }
    ).catch(() => undefined)
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
        ? `Recording Android video. Press ${formatBindingText(bindings.DeviceRecord)} or the red button to stop.`
        : result.canceled
          ? "Recording discarded."
          : `Saved recording to ${result.filePath}.`
    )
    setIsError(false)
  }, [activeAndroidDevice, bindings.DeviceRecord])

  const openSurface = useCallback(
    async (udid = selectedUdid) => {
      const simulator = simulators.find((item) => item.udid === udid)
      if (!simulator) return

      const existingSurface = surfaces.find((surface) => surface.udid === simulator.udid)
      if (existingSurface) {
        setActiveUdid(existingSurface.udid)
        setActivePhysicalIOSUdid(null)
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
      setActivePhysicalIOSUdid(null)
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
    setActivePhysicalIOSUdid(null)
    setIsChoosing(false)
    setStatus("")
  }

  const runSurfaceCommand = useCallback(
    async (command: "home" | "landscape_left" | "portrait") => {
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
        setSurfaces((current) =>
          current.map((surface) =>
            surface.udid === activeSurface.udid ? { ...surface, orientation: command } : surface
          )
        )
      }
    },
    [activeSurface]
  )

  const reload = useCallback(async () => {
    const result = (await ipcRenderer.invoke("reload-ios-simulator")) as IPCResponse
    setStatus(result.message || (result.ok ? "Reload requested." : "The reload request failed."))
    setIsError(!result.ok)
  }, [])

  const reconnect = useCallback(async () => {
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
  }, [activeSurface])

  const repairInput = useCallback(async () => {
    if (!activeSurface) return

    setStatus("Repairing simulator input…")
    setIsError(false)
    const result = (await ipcRenderer.invoke(
      "repair-ios-simulator-input",
      activeSurface.udid
    )) as IPCResponse & {
      cancelled?: boolean
      previewUrl?: string
      streamUrl?: string
      wsUrl?: string
    }
    if (result.cancelled) {
      setStatus("")
      return
    }
    if (!result.ok || !result.previewUrl || !result.streamUrl || !result.wsUrl) {
      setStatus(result.message || "Could not repair simulator input.")
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
    setStatus(result.message || "Simulator input repaired. Reopen your app, then try typing.")
  }, [activeSurface])

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
    const nextSurface = remainingSurfaces[Math.max(0, activeIndex - 1)]
    setActiveUdid(nextSurface?.udid || null)
    setActivePhysicalIOSUdid(nextSurface ? null : physicalIOSSurface?.udid ?? null)
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
      setActivePhysicalIOSUdid(nextSurface ? null : physicalIOSSurface?.udid ?? null)
      setIsChoosing(!nextSurface && !activeAndroidDevice && !physicalIOSSurface)
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
    setActivePhysicalIOSUdid(surfaces.length === 0 ? physicalIOSSurface?.udid ?? null : null)
    setIsChoosing(surfaces.length === 0 && !physicalIOSSurface)
    setStatus("")
    setIsError(false)
  }

  const closePhysicalIOSSurface = async () => {
    if (!physicalIOSSurface) return
    const udid = physicalIOSSurface.udid
    setPhysicalIOSSurface(null)
    setActivePhysicalIOSUdid(null)
    setActiveUdid(surfaces[0]?.udid ?? null)
    setIsChoosing(surfaces.length === 0 && !activeAndroidDevice)
    const result = (await ipcRenderer.invoke("close-physical-ios-device", udid)) as IPCResponse
    setStatus(result.ok ? "" : result.message || "Could not stop the iPhone preview.")
    setIsError(!result.ok)
  }

  const selectActiveDevice = (value: string) => {
    if (value.startsWith("ios:")) {
      setActiveUdid(value.slice("ios:".length))
      setActivePhysicalIOSUdid(null)
      setIsChoosing(false)
      return
    }
    if (
      value.startsWith("physical-ios:") &&
      physicalIOSSurface?.udid === value.slice("physical-ios:".length)
    ) {
      setActiveUdid(null)
      setActivePhysicalIOSUdid(physicalIOSSurface.udid)
      setIsChoosing(false)
      return
    }
    if (
      value.startsWith("android:") &&
      activeAndroidDevice?.id === value.slice("android:".length)
    ) {
      setActiveUdid(null)
      setActivePhysicalIOSUdid(null)
      setIsChoosing(false)
    }
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
        ? `Recording simulator video. Press ${formatBindingText(bindings.DeviceRecord)} or the red button to stop.`
        : result.canceled
          ? "Recording discarded."
          : `Saved recording to ${result.filePath}.`
    )
    setIsError(false)
  }, [activeSurface, bindings.DeviceRecord])

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

  const changeSimulatorUi = useCallback(
    async (setting: "contrast" | "text-larger" | "text-smaller") => {
      if (!activeSurface) return
      const result = (await ipcRenderer.invoke(
        "ios-simulator-ui-setting",
        activeSurface.udid,
        setting
      )) as IPCResponse
      setStatus(result.message || "Could not change simulator settings.")
      setIsError(!result.ok)
    },
    [activeSurface]
  )

  useEffect(() => {
    const handleShortcut = (event: Event) => {
      const shortcut = (event as CustomEvent<DeviceCommand>).detail
      if (activeSurface) {
        if (shortcut === "home") runSurfaceCommand("home").catch(() => undefined)
        if (shortcut === "reload") reload().catch(() => undefined)
        if (shortcut === "reconnect") reconnect().catch(() => undefined)
        if (shortcut === "rotate") {
          runSurfaceCommand(
            activeSurface.orientation === "portrait" ? "landscape_left" : "portrait"
          ).catch(() => undefined)
        }
        if (shortcut === "screenshot") takeScreenshot().catch(() => undefined)
        if (shortcut === "record") toggleRecording().catch(() => undefined)
        if (shortcut === "appearance") toggleAppearance().catch(() => undefined)
      }
      if (activeAndroidDevice) {
        if (shortcut === "home" || shortcut === "back" || shortcut === "recents") {
          runAndroidCommand(shortcut).catch(() => undefined)
        }
        if (shortcut === "reload") runAndroidCommand("reload").catch(() => undefined)
        if (shortcut === "reconnect") runAndroidCommand("reverse").catch(() => undefined)
        if (shortcut === "rotate") runAndroidCommand("rotate").catch(() => undefined)
        if (shortcut === "screenshot") takeAndroidScreenshot().catch(() => undefined)
        if (shortcut === "record") toggleAndroidRecording().catch(() => undefined)
      }
    }

    window.addEventListener(deviceCommandEvent, handleShortcut)
    return () => {
      window.removeEventListener(deviceCommandEvent, handleShortcut)
    }
  }, [
    activeAndroidDevice,
    activeSurface,
    reconnect,
    reload,
    runAndroidCommand,
    runSurfaceCommand,
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
        if (duoRequestRef.current) {
          window.clearTimeout(duoRequestRef.current.timer)
          duoRequestRef.current = null
          duoAwaitFrameRef.current = false
          setDuoPending(false)
          setStatus("Duo control connection was lost. Reconnect the simulator preview.")
          setIsError(true)
        }
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
        if (event.data instanceof ArrayBuffer) {
          const bytes = new Uint8Array(event.data)
          if (bytes[0] === 0x90 && duoRequestRef.current) {
            try {
              const reply = JSON.parse(new TextDecoder().decode(bytes.subarray(1))) as {
                requestId?: number
                ok?: boolean
                error?: string
              }
              if (reply.requestId === duoRequestRef.current.id) {
                window.clearTimeout(duoRequestRef.current.timer)
                duoRequestRef.current = null
                setDuoPending(false)
                if (!reply.ok) {
                  setStatus(reply.error || "Could not change the Duo position.")
                  setIsError(true)
                }
              }
            } catch {
              // Ignore malformed acknowledgements from the device helper.
            }
            return
          }
        }
        const config = parseSimulatorScreenConfigFrame(event.data)
        if (!config || !activeUdid) return

        if (
          config.screenId !== undefined &&
          lastDuoScreenIdRef.current !== undefined &&
          config.screenId !== lastDuoScreenIdRef.current
        ) {
          duoAwaitFrameRef.current = true
          if (activePreviewStreamUrl) {
            activeVideoStreamUrlRef.current = `${activePreviewStreamUrl}?screen=${config.screenId}`
          }
        }
        lastDuoScreenIdRef.current = config.screenId

        setSurfaces((current) =>
          current.map((surface) =>
            surface.udid === activeUdid
              ? {
                  ...surface,
                  screenSize: config.screenSize,
                  orientation: config.orientation ?? surface.orientation,
                  supportsHingeAngle: config.supportsHingeAngle,
                  hingeAngle: config.hingeAngle,
                  hingePose: config.hingePose,
                  screenId: config.screenId,
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
  }, [activePreviewStreamUrl, activeUdid, activeWsUrl])

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

  const sendDuoCommand = (
    command: { control: "pose"; value: DuoPose } | { control: "angle"; value: number }
  ) => {
    if (duoRequestRef.current || !activeSurface?.supportsHingeAngle) return
    const id = nextDuoRequestIdRef.current++
    duoAwaitFrameRef.current = true
    const sent = sendControl(0x10, { requestId: id, command })
    if (!sent) {
      duoAwaitFrameRef.current = false
      setStatus("Duo controls are disconnected. Reconnect the simulator preview.")
      setIsError(true)
      return
    }
    const timer = window.setTimeout(() => {
      if (duoRequestRef.current?.id !== id) return
      duoRequestRef.current = null
      setDuoPending(false)
      setStatus("The Duo control timed out; its position is unknown. Reconnect the preview.")
      setIsError(true)
    }, 5000)
    duoRequestRef.current = { id, timer }
    setDuoPending(true)
  }

  // The slider moves freely while held; only the released angle goes to the hinge.
  const commitDuoAngle = () => {
    if (duoAngleDraft === null) return
    sendDuoCommand({ control: "angle", value: duoAngleDraft })
    setDuoAngleDraft(null)
  }

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
    if (duoRequestRef.current || duoAwaitFrameRef.current) return
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

  // Android encoders rotate the framebuffer itself, so a wide frame means the
  // device is on its side; the 3D body turns to match and maps the picture upright.
  const activeOrientation: DeviceOrientation = isAndroidSurfaceActive
    ? androidScreenSize.width > androidScreenSize.height
      ? "landscape_left"
      : "portrait"
    : activeSurface?.orientation ?? "portrait"
  const activeProfile = useMemo(
    () =>
      resolveDeviceShape({
        platform: isAndroidSurfaceActive ? "android" : "ios",
        name: isAndroidSurfaceActive ? activeAndroidDevice?.model : activeSurface?.name,
        portraitAspect: Math.min(activeScreenAspectRatio, 1 / activeScreenAspectRatio),
      }),
    [
      activeAndroidDevice?.model,
      activeScreenAspectRatio,
      activeSurface?.name,
      isAndroidSurfaceActive,
    ]
  )
  const activeDuo: DuoState | null = activeSurface?.supportsHingeAngle
    ? {
        angle:
          activeSurface.hingeAngle ??
          (activeSurface.hingePose ? duoPoseAngles[activeSurface.hingePose] : 180),
        // serve-sim reports screen 1 for the cover display and 3 for the inner one.
        coverActive: activeSurface.screenId === 1,
      }
    : null

  const onIOSTouch = (phase: "begin" | "move" | "end", point: ScreenPoint) => {
    if (phase === "begin") {
      iosTouchActiveRef.current = !duoRequestRef.current && !duoAwaitFrameRef.current
    }
    if (!iosTouchActiveRef.current) return
    if (phase === "end") iosTouchActiveRef.current = false
    sendControl(3, { type: phase, ...point })
  }

  const onAndroidTouch = (phase: "begin" | "move" | "end", point: ScreenPoint) => {
    if (phase === "begin") {
      androidTouchRef.current = {
        pointerId: -1,
        startX: point.x,
        startY: point.y,
        x: point.x,
        y: point.y,
      }
      return
    }
    const touch = androidTouchRef.current
    if (!touch) return
    if (phase === "move") {
      androidTouchRef.current = { ...touch, x: point.x, y: point.y }
      return
    }
    androidTouchRef.current = null
    const moved = Math.hypot(point.x - touch.startX, point.y - touch.startY) > 0.015
    runAndroidCommand(
      moved ? "swipe" : "tap",
      moved
        ? { x: touch.startX, y: touch.startY, endX: point.x, endY: point.y }
        : { x: touch.startX, y: touch.startY }
    ).catch(() => undefined)
  }

  const viewControls = (
    <>
      <RailButton
        type="button"
        aria-label={render3D ? "Show flat device frame" : "Show 3D device"}
        title={
          webglUnavailable
            ? "3D preview is unavailable on this machine"
            : render3D
              ? "Show flat device frame"
              : "Show 3D device"
        }
        aria-pressed={render3D}
        $active={render3D}
        onClick={toggle3D}
      >
        <FiBox size={18} />
      </RailButton>
      {/* Always rendered so the centered rail does not shift under the 3D toggle. */}
      <RailButton
        type="button"
        aria-label="Face the device forward"
        title="Face the device forward"
        disabled={!render3D}
        onClick={() => resetPoseRef.current?.()}
      >
        <FiCompass size={18} />
      </RailButton>
    </>
  )

  return (
    <Panel
      ref={panelRef}
      $isOpen={isOpen}
      $isResizing={isResizing}
      $width={panelWidth}
      aria-label="mobile device surface"
    >
      {isOpen && (
        <ResizeHandle
          role="separator"
          aria-label="Resize device panel"
          aria-orientation="vertical"
          aria-valuenow={panelWidth}
          aria-valuemin={340}
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
            event.preventDefault()
            const mainWidth =
              panelRef.current?.previousElementSibling?.getBoundingClientRect().width ?? 350
            const maxWidth = Math.max(340, panelWidth + mainWidth - 350)
            setPanelWidth((width) =>
              Math.min(maxWidth, Math.max(340, width + (event.key === "ArrowLeft" ? 16 : -16)))
            )
          }}
        />
      )}
      {isOpen && (
        <Content>
          <DeviceBar>
            <DeviceTabs role="tablist" aria-label="Open devices">
              {surfaces.map((surface) => {
                const active = !isChoosing && activeSurface?.udid === surface.udid
                return (
                  <DeviceTab key={surface.udid} $active={active}>
                    <DeviceTabButton
                      type="button"
                      role="tab"
                      aria-selected={active}
                      title={`${surface.name} · ${surface.runtime}`}
                      onClick={() => selectActiveDevice(`ios:${surface.udid}`)}
                    >
                      <PlatformMark>
                        <SiApple size={14} aria-hidden />
                      </PlatformMark>
                      <span>{surface.name}</span>
                      {(surface.recording || (active && !isControlConnected)) && (
                        <StatusDot
                          $tone={
                            surface.recording
                              ? "recording"
                              : active && !isControlConnected
                                ? "pending"
                                : "ok"
                          }
                          aria-label={
                            surface.recording
                              ? "Recording"
                              : active && !isControlConnected
                                ? "Connecting"
                                : "Connected"
                          }
                        />
                      )}
                    </DeviceTabButton>
                    <DeviceTabClose
                      type="button"
                      aria-label={`Close ${surface.name}`}
                      title={`Close ${surface.name}`}
                      onClick={() => closeSurface(surface.udid).catch(() => undefined)}
                    >
                      <MdClose size={13} />
                    </DeviceTabClose>
                  </DeviceTab>
                )
              })}
              {physicalIOSSurface && (
                <DeviceTab $active={!isChoosing && Boolean(activePhysicalIOS)}>
                  <DeviceTabButton
                    type="button"
                    role="tab"
                    aria-selected={!isChoosing && Boolean(activePhysicalIOS)}
                    title={`${physicalIOSSurface.name} · iOS ${physicalIOSSurface.productVersion} · USB, experimental`}
                    onClick={() => selectActiveDevice(`physical-ios:${physicalIOSSurface.udid}`)}
                  >
                    <PlatformMark>
                      <SiApple size={14} aria-hidden />
                    </PlatformMark>
                    <span>{physicalIOSSurface.name}</span>
                  </DeviceTabButton>
                  <DeviceTabClose
                    type="button"
                    aria-label={`Close ${physicalIOSSurface.name}`}
                    title={`Close ${physicalIOSSurface.name}`}
                    onClick={() => closePhysicalIOSSurface().catch(() => undefined)}
                  >
                    <MdClose size={13} />
                  </DeviceTabClose>
                </DeviceTab>
              )}
              {activeAndroidDevice && (
                <DeviceTab $active={!isChoosing && isAndroidSurfaceActive}>
                  <DeviceTabButton
                    type="button"
                    role="tab"
                    aria-selected={!isChoosing && isAndroidSurfaceActive}
                    title={`${activeAndroidDevice.model} · ${
                      activeAndroidDevice.type === "emulator" ? "Emulator" : "Physical device"
                    } · ${activeAndroidDevice.id}`}
                    onClick={() => selectActiveDevice(`android:${activeAndroidDevice.id}`)}
                  >
                    <PlatformMark>
                      <SiAndroid size={15} color={ANDROID_GREEN} aria-hidden />
                    </PlatformMark>
                    <span>{activeAndroidDevice.model}</span>
                    {isAndroidRecording && <StatusDot $tone="recording" aria-label="Recording" />}
                  </DeviceTabButton>
                  <DeviceTabClose
                    type="button"
                    aria-label={`Close ${activeAndroidDevice.model}`}
                    title={`Close ${activeAndroidDevice.model}`}
                    onClick={closeAndroidSurface}
                  >
                    <MdClose size={13} />
                  </DeviceTabClose>
                </DeviceTab>
              )}
            </DeviceTabs>
            <IconButton
              type="button"
              aria-label="Add a mobile device"
              title="Add a mobile device"
              aria-pressed={isChoosing}
              onClick={() => {
                setIsChoosing(true)
                loadSimulators().catch(() => undefined)
                loadPhysicalIOSDevices().catch(() => undefined)
                loadAndroidDevices().catch(() => undefined)
              }}
            >
              <MdAdd size={19} />
            </IconButton>
          </DeviceBar>
          {activeSurface && !isChoosing ? (
            <>
              {keyboardAccess?.required && !keyboardAccess.trusted && (
                <KeyboardNotice role="status">
                  <span>
                    Xcode {keyboardAccess.xcodeMajorVersion} keyboard input needs Accessibility
                    access. Keep Device Hub visible with this simulator selected.
                  </span>
                  <KeyboardAccessButton
                    type="button"
                    onClick={() => requestKeyboardAccess().catch(() => undefined)}
                  >
                    Enable keyboard
                  </KeyboardAccessButton>
                </KeyboardNotice>
              )}
              <PreviewContainer>
                <PreviewPane ref={setPreviewPane}>
                  {render3D && (
                    <DeviceViewport
                      label={`${activeSurface.name} simulator, 3D`}
                      sourceRef={iosUsesMjpeg ? iosVideoImageRef : iosVideoCanvasRef}
                      sourceKey={`ios:${activeSurface.udid}:${iosUsesMjpeg ? "mjpeg" : "avcc"}`}
                      frames={frames}
                      orientation={activeOrientation}
                      profile={activeProfile}
                      duo={activeDuo}
                      modelId={resolveDeviceModelId("ios", activeSurface.name)}
                      skinModel={null}
                      onTouch={onIOSTouch}
                      onUnavailable={on3DUnavailable}
                      onResetReady={onResetReady}
                      onKeyDown={onScreenKeyDown}
                      onPaste={onScreenPaste}
                    />
                  )}
                  <DeviceFrame
                    hidden={render3D}
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
                    tabIndex={render3D ? -1 : 0}
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
                {activeSurface.supportsHingeAngle && (
                  <DuoBar role="group" aria-label="iPhone Duo hinge">
                    {duoPoses.map((pose) => (
                      <DuoPoseButton
                        key={pose.id}
                        type="button"
                        $active={activeSurface.hingePose === pose.id}
                        aria-pressed={activeSurface.hingePose === pose.id}
                        aria-label={`${pose.label} pose`}
                        title={`${pose.label} pose`}
                        disabled={!isControlConnected || duoPending}
                        onClick={() => sendDuoCommand({ control: "pose", value: pose.id })}
                      >
                        <DuoPoseGlyph pose={pose.id} />
                      </DuoPoseButton>
                    ))}
                    <DuoAngleInput
                      type="range"
                      min={0}
                      max={180}
                      step={1}
                      aria-label="Hinge angle"
                      title={`Hinge angle: ${Math.round(duoAngleDraft ?? activeDuo?.angle ?? 180)}°`}
                      disabled={!isControlConnected || duoPending}
                      value={Math.round(duoAngleDraft ?? activeDuo?.angle ?? 180)}
                      onChange={(event) => setDuoAngleDraft(Number(event.target.value))}
                      onPointerUp={commitDuoAngle}
                      onKeyUp={commitDuoAngle}
                      onBlur={() => setDuoAngleDraft(null)}
                    />
                  </DuoBar>
                )}
                <ControlsRail aria-label="iOS simulator controls">
                  <RailButton
                    type="button"
                    aria-label="Home"
                    title="Home"
                    onClick={() => runSurfaceCommand("home").catch(() => undefined)}
                  >
                    <FiHome size={18} />
                  </RailButton>
                  <RailButton
                    type="button"
                    aria-label="Reload app"
                    title="Reload app"
                    onClick={() => reload().catch(() => undefined)}
                  >
                    <FiRefreshCw size={18} />
                  </RailButton>
                  <RailButton
                    type="button"
                    aria-label="Rotate simulator"
                    title="Rotate simulator"
                    onClick={() =>
                      runSurfaceCommand(
                        activeSurface.orientation === "portrait" ? "landscape_left" : "portrait"
                      ).catch(() => undefined)
                    }
                  >
                    <FiRotateCw size={18} />
                  </RailButton>
                  <RailButton
                    type="button"
                    aria-label="Toggle simulator light or dark appearance"
                    title="Toggle simulator light or dark appearance"
                    onClick={() => toggleAppearance().catch(() => undefined)}
                  >
                    <FiMoon size={18} />
                  </RailButton>
                  <RailDivider />
                  <RailButton
                    type="button"
                    aria-label="Screenshot"
                    title={`Screenshot: copy or save (${formatBindingText(bindings.DeviceScreenshot)})`}
                    onClick={() => takeScreenshot().catch(() => undefined)}
                  >
                    <FiCamera size={18} />
                  </RailButton>
                  <RecordingButton
                    $recording={Boolean(activeSurface.recording)}
                    type="button"
                    aria-label={activeSurface.recording ? "Stop recording" : "Start recording"}
                    title={activeSurface.recording ? "Stop recording" : "Start screen recording"}
                    onClick={() => toggleRecording().catch(() => undefined)}
                  >
                    <FiDisc size={18} />
                  </RecordingButton>
                  <RailDivider />
                  {viewControls}
                  <RailButton
                    ref={toolsTriggerRef}
                    type="button"
                    aria-label="More simulator tools"
                    title="More simulator tools"
                    aria-expanded={toolsOpen}
                    aria-controls="ios-device-tools"
                    $active={toolsOpen}
                    onClick={() => setToolsOpen((current) => !current)}
                  >
                    <FiMoreHorizontal size={19} />
                  </RailButton>
                </ControlsRail>
                {toolsOpen && (
                  <ToolsDrawer id="ios-device-tools" aria-label="Simulator tools">
                    <ToolsHeader>
                      <span>Simulator tools</span>
                      <RailButton
                        ref={toolsCloseRef}
                        type="button"
                        aria-label="Close simulator tools"
                        onClick={() => setToolsOpen(false)}
                      >
                        <FiX size={18} />
                      </RailButton>
                    </ToolsHeader>
                    <ToolsSection>
                      <strong>Device</strong>
                      <ToolsAction
                        type="button"
                        onClick={() => changeSimulatorUi("text-larger").catch(() => undefined)}
                      >
                        <FiType size={16} /> Increase text size
                      </ToolsAction>
                      <ToolsAction
                        type="button"
                        onClick={() => changeSimulatorUi("text-smaller").catch(() => undefined)}
                      >
                        <FiType size={16} /> Decrease text size
                      </ToolsAction>
                      <ToolsAction
                        type="button"
                        onClick={() => changeSimulatorUi("contrast").catch(() => undefined)}
                      >
                        <FiCrosshair size={16} /> Toggle Increase Contrast
                      </ToolsAction>
                      <ToolsAction type="button" onClick={() => reconnect().catch(() => undefined)}>
                        <FiLink size={16} /> Reconnect preview
                      </ToolsAction>
                      <ToolsAction
                        type="button"
                        onClick={() => repairInput().catch(() => undefined)}
                      >
                        <FiTool size={16} /> Repair keyboard and touch
                      </ToolsAction>
                    </ToolsSection>
                    <ToolsSection>
                      <strong>Session</strong>
                      <ToolsAction type="button" onClick={() => shutdown().catch(() => undefined)}>
                        <FiPower size={16} /> Shut down simulator
                      </ToolsAction>
                    </ToolsSection>
                  </ToolsDrawer>
                )}
              </PreviewContainer>
              {status && <Status $error={isError}>{status}</Status>}
            </>
          ) : activePhysicalIOS && !isChoosing ? (
            <>
              <PreviewContainer>
                <PreviewPane ref={setPreviewPane}>
                  <DeviceFrame
                    $layout={deviceFrameLayout}
                    $platform="ios"
                    aria-label={`${activePhysicalIOS.name} physical iPhone screen`}
                    onPointerDown={(event) => {
                      if (event.button !== 0) return
                      event.preventDefault()
                      const point = androidScreenPoint(event)
                      physicalTouchRef.current = { pointerId: event.pointerId, ...point }
                      event.currentTarget.setPointerCapture(event.pointerId)
                    }}
                    onPointerUp={completePhysicalIOSGesture}
                    onPointerCancel={(event) => {
                      if (physicalTouchRef.current?.pointerId === event.pointerId)
                        physicalTouchRef.current = null
                    }}
                    role="application"
                    tabIndex={0}
                  >
                    <PhysicalIOSPreview src={activePhysicalIOS.streamUrl} alt="" />
                  </DeviceFrame>
                </PreviewPane>
                <ControlsRail aria-label="Physical iPhone controls">
                  <RailButton
                    type="button"
                    aria-label="Home"
                    title="Home"
                    onClick={() =>
                      sendPhysicalIOSInput({ type: "button", name: "home" }).catch(() => undefined)
                    }
                  >
                    <FiHome size={18} />
                  </RailButton>
                </ControlsRail>
              </PreviewContainer>
              {status && <Status $error={isError}>{status}</Status>}
            </>
          ) : activeAndroidDevice && !isChoosing ? (
            <>
              <PreviewContainer>
                <PreviewPane ref={setPreviewPane}>
                  {render3D && (
                    <DeviceViewport
                      label={`${activeAndroidDevice.model} Android device, 3D`}
                      sourceRef={androidVideoCanvasRef}
                      sourceKey={`android:${activeAndroidDevice.id}`}
                      frames={frames}
                      orientation={activeOrientation}
                      profile={activeProfile}
                      duo={null}
                      modelId={null}
                      skinModel={activeAndroidDevice.model}
                      onTouch={onAndroidTouch}
                      onUnavailable={on3DUnavailable}
                      onResetReady={onResetReady}
                      onKeyDown={onAndroidKeyDown}
                      onPaste={onAndroidPaste}
                    />
                  )}
                  <DeviceFrame
                    hidden={render3D}
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
                    tabIndex={render3D ? -1 : 0}
                  >
                    <AndroidVideoPreview ref={androidVideoCanvasRef} />
                  </DeviceFrame>
                </PreviewPane>
                <ControlsRail aria-label="Android device controls">
                  <RailButton
                    type="button"
                    aria-label="Back"
                    title="Back"
                    onClick={() => runAndroidCommand("back").catch(() => undefined)}
                  >
                    <FiArrowLeft size={18} />
                  </RailButton>
                  <RailButton
                    type="button"
                    aria-label="Home"
                    title="Home"
                    onClick={() => runAndroidCommand("home").catch(() => undefined)}
                  >
                    <FiHome size={18} />
                  </RailButton>
                  <RailButton
                    type="button"
                    aria-label="Recent apps"
                    title="Recent apps"
                    onClick={() => runAndroidCommand("recents").catch(() => undefined)}
                  >
                    <FiGrid size={18} />
                  </RailButton>
                  <RailDivider />
                  <RailButton
                    type="button"
                    aria-label="Reload app"
                    title="Reload app"
                    onClick={() => runAndroidCommand("reload").catch(() => undefined)}
                  >
                    <FiRefreshCw size={18} />
                  </RailButton>
                  <RailButton
                    type="button"
                    aria-label="Rotate device"
                    title="Rotate device"
                    onClick={() => runAndroidCommand("rotate").catch(() => undefined)}
                  >
                    <FiRotateCw size={18} />
                  </RailButton>
                  <RailButton
                    type="button"
                    aria-label={isAndroidMuted ? "Unmute Android media" : "Mute Android media"}
                    title={isAndroidMuted ? "Unmute Android media" : "Mute Android media"}
                    aria-pressed={isAndroidMuted}
                    onClick={() => toggleAndroidMute().catch(() => undefined)}
                  >
                    {isAndroidMuted ? <FiVolumeX size={18} /> : <FiVolume2 size={18} />}
                  </RailButton>
                  <RailDivider />
                  <RailButton
                    type="button"
                    aria-label="Screenshot"
                    title={`Screenshot: copy or save (${formatBindingText(bindings.DeviceScreenshot)})`}
                    onClick={() => takeAndroidScreenshot().catch(() => undefined)}
                  >
                    <FiCamera size={18} />
                  </RailButton>
                  <RecordingButton
                    $recording={isAndroidRecording}
                    type="button"
                    aria-label={isAndroidRecording ? "Stop recording" : "Start recording"}
                    title={
                      isAndroidRecording
                        ? `Stop recording and choose where to save (${formatBindingText(bindings.DeviceRecord)})`
                        : `Start screen recording (${formatBindingText(bindings.DeviceRecord)})`
                    }
                    onClick={() => toggleAndroidRecording().catch(() => undefined)}
                  >
                    <FiDisc size={18} />
                  </RecordingButton>
                  <RailDivider />
                  {viewControls}
                  <RailButton
                    ref={toolsTriggerRef}
                    type="button"
                    aria-label="More Android device tools"
                    title="More Android device tools"
                    aria-expanded={toolsOpen}
                    aria-controls="android-device-tools"
                    $active={toolsOpen}
                    onClick={() => setToolsOpen((current) => !current)}
                  >
                    <FiMoreHorizontal size={19} />
                  </RailButton>
                </ControlsRail>
                {toolsOpen && (
                  <ToolsDrawer id="android-device-tools" aria-label="Android device tools">
                    <ToolsHeader>
                      <span>Android device tools</span>
                      <RailButton
                        ref={toolsCloseRef}
                        type="button"
                        aria-label="Close Android device tools"
                        onClick={() => setToolsOpen(false)}
                      >
                        <FiX size={18} />
                      </RailButton>
                    </ToolsHeader>
                    <ToolsSection>
                      <strong>Device</strong>
                      <ToolsAction
                        type="button"
                        onClick={() => runAndroidCommand("reverse").catch(() => undefined)}
                      >
                        <FiLink size={16} /> Configure ADB reverse for Reactotron
                      </ToolsAction>
                    </ToolsSection>
                  </ToolsDrawer>
                )}
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
                    <ActionSection>
                      <ActionLabel>Physical iPhone · experimental</ActionLabel>
                      <DeviceSelect
                        aria-label="Connected physical iPhones"
                        value={selectedPhysicalIOSUdid}
                        disabled={isLoading || physicalIOSDevices.length === 0}
                        onChange={(event) => setSelectedPhysicalIOSUdid(event.target.value)}
                      >
                        {physicalIOSDevices.map((device) => (
                          <option
                            key={device.udid}
                            value={device.udid}
                            disabled={!device.available}
                          >
                            {device.name} ({device.productVersion})
                            {device.available ? "" : " - connect USB"}
                          </option>
                        ))}
                      </DeviceSelect>
                      <SecondaryButton
                        type="button"
                        disabled={isLoading || !selectedPhysicalIOSUdid}
                        onClick={() => openPhysicalIOS().catch(() => undefined)}
                      >
                        {isLoading ? "Starting..." : "Try physical iPhone"}
                      </SecondaryButton>
                      <EmptyCopy>
                        Connect and trust a USB iPhone. A signed WebDriverAgent streams it in this
                        panel.
                      </EmptyCopy>
                    </ActionSection>
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
                  if (supportsIOSSimulator) loadPhysicalIOSDevices().catch(() => undefined)
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
