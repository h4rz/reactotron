import { useCallback, useEffect, useState } from "react"
import type { KeyEventName } from "react-hotkeys"

export type DeviceCommand =
  | "appearance"
  | "back"
  | "home"
  | "reconnect"
  | "recents"
  | "record"
  | "reload"
  | "rotate"
  | "screenshot"

export type KeybindingId =
  | "ToggleSidebar"
  | "ToggleSearch"
  | "OpenHomeTab"
  | "OpenTimelineTab"
  | "OpenStateTab"
  | "OpenReactNativeTab"
  | "OpenCustomCommandsTab"
  | "OpenSettingsTab"
  | "OpenHelpTab"
  | "ClearTimeline"
  | "OpenSubscriptionModal"
  | "OpenDispatchModal"
  | "TakeSnapshot"
  | "DeviceHome"
  | "DeviceBack"
  | "DeviceRecents"
  | "DeviceReload"
  | "DeviceReconnect"
  | "DeviceRotate"
  | "DeviceScreenshot"
  | "DeviceRecord"
  | "DeviceAppearance"

export type KeybindingDefinition = {
  id: KeybindingId
  name: string
  description: string
  group: "Application" | "Navigation" | "Timeline" | "State" | "Simulator & emulator"
  defaultBinding: string
  deviceCommand?: DeviceCommand
}

export type KeybindingValues = Record<KeybindingId, string | null>

export const keybindingDefinitions: readonly KeybindingDefinition[] = [
  {
    id: "ToggleSidebar",
    name: "Toggle sidebar",
    description: "Show or hide the main navigation.",
    group: "Application",
    defaultBinding: "mod+shift+s",
  },
  {
    id: "ToggleSearch",
    name: "Toggle timeline search",
    description: "Open Timeline and toggle its search field.",
    group: "Application",
    defaultBinding: "mod+shift+l",
  },
  {
    id: "OpenHomeTab",
    name: "Open Home",
    description: "Navigate to the connection overview.",
    group: "Navigation",
    defaultBinding: "mod+1",
  },
  {
    id: "OpenTimelineTab",
    name: "Open Timeline",
    description: "Navigate to the event timeline.",
    group: "Navigation",
    defaultBinding: "mod+2",
  },
  {
    id: "OpenStateTab",
    name: "Open State",
    description: "Navigate to state subscriptions.",
    group: "Navigation",
    defaultBinding: "mod+3",
  },
  {
    id: "OpenReactNativeTab",
    name: "Open React Native",
    description: "Navigate to React Native tools.",
    group: "Navigation",
    defaultBinding: "mod+4",
  },
  {
    id: "OpenCustomCommandsTab",
    name: "Open Custom Commands",
    description: "Navigate to custom commands.",
    group: "Navigation",
    defaultBinding: "mod+5",
  },
  {
    id: "OpenSettingsTab",
    name: "Open Settings",
    description: "Navigate to Reactotron settings.",
    group: "Navigation",
    defaultBinding: "mod+,",
  },
  {
    id: "OpenHelpTab",
    name: "Open Support",
    description: "Navigate to support and project links.",
    group: "Navigation",
    defaultBinding: "mod+?",
  },
  {
    id: "ClearTimeline",
    name: "Clear timeline",
    description: "Remove all events from the active timeline.",
    group: "Timeline",
    defaultBinding: "mod+k",
  },
  {
    id: "OpenSubscriptionModal",
    name: "Add subscription",
    description: "Open the state subscription dialog.",
    group: "State",
    defaultBinding: "mod+n",
  },
  {
    id: "OpenDispatchModal",
    name: "Dispatch action",
    description: "Open the Redux dispatch dialog.",
    group: "State",
    defaultBinding: "mod+d",
  },
  {
    id: "TakeSnapshot",
    name: "Take state snapshot",
    description: "Capture the current application state.",
    group: "State",
    defaultBinding: "mod+shift+n",
  },
  {
    id: "DeviceHome",
    name: "Home",
    description: "Press Home on the active simulator or emulator.",
    group: "Simulator & emulator",
    defaultBinding: "mod+shift+h",
    deviceCommand: "home",
  },
  {
    id: "DeviceBack",
    name: "Back",
    description: "Press Back on the active Android device.",
    group: "Simulator & emulator",
    defaultBinding: "mod+shift+b",
    deviceCommand: "back",
  },
  {
    id: "DeviceRecents",
    name: "Recent apps",
    description: "Open recent apps on the active Android device.",
    group: "Simulator & emulator",
    defaultBinding: "mod+shift+e",
    deviceCommand: "recents",
  },
  {
    id: "DeviceReload",
    name: "Reload app",
    description: "Reload the app on the active simulator or emulator.",
    group: "Simulator & emulator",
    defaultBinding: "mod+shift+r",
    deviceCommand: "reload",
  },
  {
    id: "DeviceReconnect",
    name: "Reconnect",
    description: "Reconnect iOS preview or configure Android adb reverse.",
    group: "Simulator & emulator",
    defaultBinding: "mod+shift+c",
    deviceCommand: "reconnect",
  },
  {
    id: "DeviceRotate",
    name: "Rotate device",
    description: "Rotate the active simulator or emulator.",
    group: "Simulator & emulator",
    defaultBinding: "mod+shift+o",
    deviceCommand: "rotate",
  },
  {
    id: "DeviceScreenshot",
    name: "Capture screenshot",
    description: "Copy or save a screenshot from the active device.",
    group: "Simulator & emulator",
    defaultBinding: "mod+s",
    deviceCommand: "screenshot",
  },
  {
    id: "DeviceRecord",
    name: "Toggle recording",
    description: "Start or stop recording the active device.",
    group: "Simulator & emulator",
    defaultBinding: "mod+r",
    deviceCommand: "record",
  },
  {
    id: "DeviceAppearance",
    name: "Toggle appearance",
    description: "Switch the active iOS simulator between light and dark.",
    group: "Simulator & emulator",
    defaultBinding: "mod+shift+a",
    deviceCommand: "appearance",
  },
]

export const deviceCommandEvent = "reactotron-device-command"

const storageKey = "reactotron.keybindings"
const changedEvent = "reactotron-keybindings-changed"
const definitionIds = new Set<KeybindingId>(keybindingDefinitions.map(({ id }) => id))

export function getDefaultKeybindings(): KeybindingValues {
  return Object.fromEntries(
    keybindingDefinitions.map(({ id, defaultBinding }) => [id, defaultBinding])
  ) as KeybindingValues
}

export function readKeybindings(): KeybindingValues {
  const defaults = getDefaultKeybindings()
  if (typeof window === "undefined") return defaults

  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey) || "{}") as Record<
      string,
      unknown
    >
    Object.entries(saved).forEach(([id, binding]) => {
      if (!definitionIds.has(id as KeybindingId)) return
      if (binding === null || typeof binding === "string") {
        defaults[id as KeybindingId] = binding as string | null
      }
    })
  } catch {
    // Ignore malformed values and keep the defaults.
  }
  return defaults
}

function persistKeybindings(values: KeybindingValues) {
  window.localStorage.setItem(storageKey, JSON.stringify(values))
  window.dispatchEvent(new CustomEvent(changedEvent))
}

export function useKeybindings() {
  const [bindings, setBindings] = useState<KeybindingValues>(readKeybindings)

  useEffect(() => {
    const refresh = () => setBindings(readKeybindings())
    window.addEventListener(changedEvent, refresh)
    window.addEventListener("storage", refresh)
    return () => {
      window.removeEventListener(changedEvent, refresh)
      window.removeEventListener("storage", refresh)
    }
  }, [])

  const setBinding = useCallback((id: KeybindingId, binding: string | null) => {
    persistKeybindings({ ...readKeybindings(), [id]: binding })
  }, [])
  const resetBinding = useCallback((id: KeybindingId) => {
    const definition = keybindingDefinitions.find((item) => item.id === id)
    if (definition) persistKeybindings({ ...readKeybindings(), [id]: definition.defaultBinding })
  }, [])
  const resetAll = useCallback(() => persistKeybindings(getDefaultKeybindings()), [])
  return { bindings, setBinding, resetBinding, resetAll }
}

export function resolveKeySequence(binding: string): string {
  const primaryModifier = window.process.platform === "darwin" ? "command" : "ctrl"
  return binding.replace(/^mod(?=\+|$)/, primaryModifier)
}

export function createKeyMap(bindings: KeybindingValues) {
  return Object.fromEntries(
    keybindingDefinitions.map((definition) => [
      definition.id,
      {
        name: definition.name,
        group: definition.group,
        sequences: bindings[definition.id] ? [resolveKeySequence(bindings[definition.id]!)] : [],
        action: "keyup" as KeyEventName,
      },
    ])
  )
}

const keyAliases: Record<string, string> = {
  " ": "space",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  Escape: "escape",
}

export function bindingFromKeyboardEvent(event: React.KeyboardEvent): string | null {
  if (["Alt", "Control", "Meta", "Shift"].includes(event.key)) return null
  const modifiers: string[] = []
  const isMac = window.process.platform === "darwin"
  if (event.metaKey || (!isMac && event.ctrlKey)) modifiers.push("mod")
  if (isMac && event.ctrlKey) modifiers.push("ctrl")
  if (event.altKey) modifiers.push("alt")
  if (event.shiftKey) modifiers.push("shift")
  const key = (keyAliases[event.key] || event.key).toLowerCase()
  if (!modifiers.length && !/^f(?:[1-9]|1[0-2])$/.test(key)) return null
  return [...modifiers, key].join("+")
}

export function formatBinding(binding: string | null): string[] {
  if (!binding) return ["Unassigned"]
  const isMac = typeof window !== "undefined" && window.process.platform === "darwin"
  const labels: Record<string, string> = isMac
    ? { mod: "⌘", ctrl: "⌃", alt: "⌥", shift: "⇧" }
    : { mod: "Ctrl", ctrl: "Ctrl", alt: "Alt", shift: "Shift" }
  return binding.split("+").map((part) => {
    if (labels[part]) return labels[part]
    if (part === "space") return "Space"
    if (part.length === 1) return part.toUpperCase()
    return part.replace(/^./, (character) => character.toUpperCase())
  })
}

export function formatBindingText(binding: string | null): string {
  const parts = formatBinding(binding)
  return parts.length === 1 ? parts[0] : parts.join("")
}
