import React, { useCallback, useMemo, useState } from "react"
import {
  themeStyles,
  themeVariants,
  type ThemeName,
  type ThemeStyle,
} from "@hurajgor/reactotron-core-ui"

import {
  clampInterfaceFontSize,
  clampMonospaceFontSize,
  defaultInterfaceFont,
  defaultInterfaceFontSize,
  defaultMonospaceFont,
  defaultMonospaceFontSize,
  isInterfaceFont,
  isMonospaceFont,
  type InterfaceFont,
  type MonospaceFont,
} from "../../typography"

export type ThemeAppearance = "system" | "dark" | "light"

const themeModeStorageKey = "reactotron.themeMode"
const themeStyleStorageKey = "reactotron.themeStyle"
const lightThemeStyleStorageKey = "reactotron.lightThemeStyle"
const darkThemeStyleStorageKey = "reactotron.darkThemeStyle"
const themeAppearanceStorageKey = "reactotron.themeAppearance"
const newTimelineStorageKey = "reactotron.enableNewTimeline"
const startWithCompactSidebarStorageKey = "reactotron.startWithCompactSidebar"
const maxCommandsStorageKey = "reactotron.maxCommands"
const interfaceFontStorageKey = "reactotron.interfaceFont"
const interfaceFontSizeStorageKey = "reactotron.interfaceFontSize"
const monospaceFontStorageKey = "reactotron.monospaceFont"
const monospaceFontSizeStorageKey = "reactotron.monospaceFontSize"
const fontSmoothingStorageKey = "reactotron.fontSmoothing"
const themeModeChangeEvent = "reactotron-theme-mode-changed"

/**
 * How many commands each connection retains before the oldest are purged.
 * Long sessions otherwise grow the timeline without bound, which costs both
 * memory and per-command render work.
 */
export const defaultMaxCommands = 2000
export const minMaxCommands = 100
export const maxMaxCommands = 50000

const legacyThemeMigrations: Record<
  string,
  { themeStyle: ThemeStyle; themeAppearance: ThemeAppearance }
> = {
  tokyoNight: { themeStyle: "kanagawa", themeAppearance: "dark" },
  githubDark: { themeStyle: "one", themeAppearance: "dark" },
  rosePine: { themeStyle: "kanagawa", themeAppearance: "dark" },
  ayuMirage: { themeStyle: "everforest", themeAppearance: "dark" },
}

const retainedThemeStyles: readonly ThemeStyle[] = [
  "ocean",
  "iris",
  "one",
  "solarized",
  "kanagawa",
  "everforest",
  "gruvbox",
]

function isRetainedThemeStyle(value: string | null): value is ThemeStyle {
  return retainedThemeStyles.includes(value as ThemeStyle)
}

function normalizeThemeStyle(themeStyle: ThemeStyle): ThemeStyle {
  return isRetainedThemeStyle(themeStyle) ? themeStyle : "ocean"
}

interface Context {
  themeMode: ThemeName
  themeStyle: ThemeStyle
  setThemeStyle: (themeStyle: ThemeStyle) => void
  lightThemeStyle: ThemeStyle
  darkThemeStyle: ThemeStyle
  setThemeStyleForAppearance: (
    appearance: Exclude<ThemeAppearance, "system">,
    themeStyle: ThemeStyle
  ) => void
  themeAppearance: ThemeAppearance
  setThemeAppearance: (themeAppearance: ThemeAppearance) => void
  enableNewTimeline: boolean
  setEnableNewTimeline: (isEnabled: boolean) => void
  startWithCompactSidebar: boolean
  setStartWithCompactSidebar: (isEnabled: boolean) => void
  maxCommands: number
  setMaxCommands: (maxCommands: number) => void
}

interface TypographyContext {
  interfaceFont: InterfaceFont
  setInterfaceFont: (font: InterfaceFont) => void
  interfaceFontSize: number
  setInterfaceFontSize: (size: number) => void
  monospaceFont: MonospaceFont
  setMonospaceFont: (font: MonospaceFont) => void
  monospaceFontSize: number
  setMonospaceFontSize: (size: number) => void
  fontSmoothing: boolean
  setFontSmoothing: (isEnabled: boolean) => void
}

const noop = (): void => {
  throw Error(
    "Noop function called. This is a bug. Please report it to the Reactotron team. Thanks! :)"
  )
}

function readLegacyThemePreference(): {
  themeStyle: ThemeStyle
  themeAppearance: ThemeAppearance
} | null {
  if (typeof window === "undefined") return null

  const savedThemeMode = window.localStorage.getItem(themeModeStorageKey)
  if (!savedThemeMode) return null

  const migratedTheme = legacyThemeMigrations[savedThemeMode]
  if (migratedTheme) return migratedTheme

  const match = themeStyles.find((style) => {
    const variants = themeVariants[style]
    return variants.dark === savedThemeMode || variants.light === savedThemeMode
  })
  if (!match || !isRetainedThemeStyle(match)) return null

  return {
    themeStyle: match,
    themeAppearance: themeVariants[match].dark === savedThemeMode ? "dark" : "light",
  }
}

function readThemeStyle(): ThemeStyle {
  if (typeof window === "undefined") return "ocean"

  const savedThemeStyle = window.localStorage.getItem(themeStyleStorageKey)
  if (isRetainedThemeStyle(savedThemeStyle)) return savedThemeStyle

  return readLegacyThemePreference()?.themeStyle ?? "ocean"
}

function readThemeStyleForAppearance(storageKey: string): ThemeStyle {
  if (typeof window === "undefined") return "ocean"

  const savedThemeStyle = window.localStorage.getItem(storageKey)
  if (isRetainedThemeStyle(savedThemeStyle)) return savedThemeStyle

  return readThemeStyle()
}

function readThemeAppearance(): ThemeAppearance {
  if (typeof window === "undefined") return "system"

  const savedThemeAppearance = window.localStorage.getItem(themeAppearanceStorageKey)
  if (
    savedThemeAppearance === "system" ||
    savedThemeAppearance === "dark" ||
    savedThemeAppearance === "light"
  ) {
    return savedThemeAppearance
  }

  return readLegacyThemePreference()?.themeAppearance ?? "system"
}

function getSystemAppearance(): "dark" | "light" {
  if (typeof window === "undefined") return "dark"
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

function readEnableNewTimeline(): boolean {
  if (typeof window === "undefined") return true

  const savedNewTimelinePreference = window.localStorage.getItem(newTimelineStorageKey)
  if (savedNewTimelinePreference === null) return true

  return savedNewTimelinePreference === "true"
}

function readStartWithCompactSidebar(): boolean {
  if (typeof window === "undefined") return true

  const savedStartWithCompactSidebar = window.localStorage.getItem(
    startWithCompactSidebarStorageKey
  )
  if (savedStartWithCompactSidebar === null) return true

  return savedStartWithCompactSidebar === "true"
}

function clampMaxCommands(value: number): number {
  return Math.min(maxMaxCommands, Math.max(minMaxCommands, Math.round(value)))
}

function readMaxCommands(): number {
  if (typeof window === "undefined") return defaultMaxCommands

  const savedMaxCommands = window.localStorage.getItem(maxCommandsStorageKey)
  if (savedMaxCommands === null) return defaultMaxCommands

  const parsed = Number(savedMaxCommands)
  if (!Number.isFinite(parsed)) return defaultMaxCommands

  return clampMaxCommands(parsed)
}

function readInterfaceFont(): InterfaceFont {
  if (typeof window === "undefined") return defaultInterfaceFont
  const saved = window.localStorage.getItem(interfaceFontStorageKey)
  return isInterfaceFont(saved) ? saved : defaultInterfaceFont
}

function readMonospaceFont(): MonospaceFont {
  if (typeof window === "undefined") return defaultMonospaceFont
  const saved = window.localStorage.getItem(monospaceFontStorageKey)
  return isMonospaceFont(saved) ? saved : defaultMonospaceFont
}

function readStoredNumber(storageKey: string, fallback: number, clamp: (value: number) => number) {
  if (typeof window === "undefined") return fallback
  const saved = window.localStorage.getItem(storageKey)
  if (saved === null) return fallback
  const parsed = Number(saved)
  return Number.isFinite(parsed) ? clamp(parsed) : fallback
}

function readFontSmoothing(): boolean {
  if (typeof window === "undefined") return true
  const saved = window.localStorage.getItem(fontSmoothingStorageKey)
  return saved === null ? true : saved === "true"
}

const AppPreferencesContext = React.createContext<Context>({
  themeMode: "oceanDark",
  themeStyle: "ocean",
  setThemeStyle: noop,
  lightThemeStyle: "ocean",
  darkThemeStyle: "ocean",
  setThemeStyleForAppearance: noop,
  themeAppearance: "system",
  setThemeAppearance: noop,
  enableNewTimeline: true,
  setEnableNewTimeline: noop,
  startWithCompactSidebar: true,
  setStartWithCompactSidebar: noop,
  maxCommands: defaultMaxCommands,
  setMaxCommands: noop,
})

const TypographyPreferencesContext = React.createContext<TypographyContext>({
  interfaceFont: defaultInterfaceFont,
  setInterfaceFont: noop,
  interfaceFontSize: defaultInterfaceFontSize,
  setInterfaceFontSize: noop,
  monospaceFont: defaultMonospaceFont,
  setMonospaceFont: noop,
  monospaceFontSize: defaultMonospaceFontSize,
  setMonospaceFontSize: noop,
  fontSmoothing: true,
  setFontSmoothing: noop,
})

const Provider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lightThemeStyle, setLightThemeStyle] = useState<ThemeStyle>(() =>
    readThemeStyleForAppearance(lightThemeStyleStorageKey)
  )
  const [darkThemeStyle, setDarkThemeStyle] = useState<ThemeStyle>(() =>
    readThemeStyleForAppearance(darkThemeStyleStorageKey)
  )
  const [themeAppearance, setThemeAppearanceState] = useState<ThemeAppearance>(readThemeAppearance)
  const [systemAppearance, setSystemAppearance] = useState<"dark" | "light">(getSystemAppearance)
  const [enableNewTimeline, setEnableNewTimelineState] = useState(readEnableNewTimeline)
  const [startWithCompactSidebar, setStartWithCompactSidebarState] = useState(
    readStartWithCompactSidebar
  )
  const [maxCommands, setMaxCommandsState] = useState(readMaxCommands)
  const [interfaceFont, setInterfaceFontState] = useState(readInterfaceFont)
  const [interfaceFontSize, setInterfaceFontSizeState] = useState(() =>
    readStoredNumber(interfaceFontSizeStorageKey, defaultInterfaceFontSize, clampInterfaceFontSize)
  )
  const [monospaceFont, setMonospaceFontState] = useState(readMonospaceFont)
  const [monospaceFontSize, setMonospaceFontSizeState] = useState(() =>
    readStoredNumber(monospaceFontSizeStorageKey, defaultMonospaceFontSize, clampMonospaceFontSize)
  )
  const [fontSmoothing, setFontSmoothingState] = useState(readFontSmoothing)

  React.useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
    const handleChange = () => setSystemAppearance(getSystemAppearance())

    mediaQuery.addEventListener("change", handleChange)
    return () => mediaQuery.removeEventListener("change", handleChange)
  }, [])

  const resolvedAppearance = themeAppearance === "system" ? systemAppearance : themeAppearance
  const themeStyle = resolvedAppearance === "dark" ? darkThemeStyle : lightThemeStyle
  const themeMode = themeVariants[themeStyle][resolvedAppearance]

  React.useEffect(() => {
    if (typeof window === "undefined") return

    window.localStorage.setItem(themeModeStorageKey, themeMode)
    window.dispatchEvent(new CustomEvent(themeModeChangeEvent, { detail: themeMode }))
  }, [themeMode])

  const setThemeStyle = useCallback((nextThemeStyle: ThemeStyle) => {
    const normalizedThemeStyle = normalizeThemeStyle(nextThemeStyle)
    setLightThemeStyle(normalizedThemeStyle)
    setDarkThemeStyle(normalizedThemeStyle)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(themeStyleStorageKey, normalizedThemeStyle)
      window.localStorage.setItem(lightThemeStyleStorageKey, normalizedThemeStyle)
      window.localStorage.setItem(darkThemeStyleStorageKey, normalizedThemeStyle)
    }
  }, [])

  const setThemeStyleForAppearance = useCallback(
    (appearance: Exclude<ThemeAppearance, "system">, nextThemeStyle: ThemeStyle) => {
      const normalizedThemeStyle = normalizeThemeStyle(nextThemeStyle)
      if (appearance === "light") {
        setLightThemeStyle(normalizedThemeStyle)
      } else {
        setDarkThemeStyle(normalizedThemeStyle)
      }

      if (typeof window === "undefined") return
      const storageKey =
        appearance === "light" ? lightThemeStyleStorageKey : darkThemeStyleStorageKey
      window.localStorage.setItem(storageKey, normalizedThemeStyle)
    },
    []
  )

  const setThemeAppearance = useCallback((nextThemeAppearance: ThemeAppearance) => {
    setThemeAppearanceState(nextThemeAppearance)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(themeAppearanceStorageKey, nextThemeAppearance)
    }
  }, [])

  const setEnableNewTimeline = useCallback((isEnabled: boolean) => {
    setEnableNewTimelineState(isEnabled)
    if (typeof window === "undefined") return

    window.localStorage.setItem(newTimelineStorageKey, isEnabled ? "true" : "false")
  }, [])

  const setStartWithCompactSidebar = useCallback((isEnabled: boolean) => {
    setStartWithCompactSidebarState(isEnabled)
    if (typeof window === "undefined") return

    window.localStorage.setItem(startWithCompactSidebarStorageKey, isEnabled ? "true" : "false")
  }, [])

  const setMaxCommands = useCallback((nextMaxCommands: number) => {
    const clamped = clampMaxCommands(nextMaxCommands)
    setMaxCommandsState(clamped)
    if (typeof window === "undefined") return

    window.localStorage.setItem(maxCommandsStorageKey, String(clamped))
  }, [])

  const setInterfaceFont = useCallback((nextFont: InterfaceFont) => {
    setInterfaceFontState(nextFont)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(interfaceFontStorageKey, nextFont)
    }
  }, [])

  const setInterfaceFontSize = useCallback((nextSize: number) => {
    const clamped = clampInterfaceFontSize(nextSize)
    setInterfaceFontSizeState(clamped)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(interfaceFontSizeStorageKey, String(clamped))
    }
  }, [])

  const setMonospaceFont = useCallback((nextFont: MonospaceFont) => {
    setMonospaceFontState(nextFont)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(monospaceFontStorageKey, nextFont)
    }
  }, [])

  const setMonospaceFontSize = useCallback((nextSize: number) => {
    const clamped = clampMonospaceFontSize(nextSize)
    setMonospaceFontSizeState(clamped)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(monospaceFontSizeStorageKey, String(clamped))
    }
  }, [])

  const setFontSmoothing = useCallback((isEnabled: boolean) => {
    setFontSmoothingState(isEnabled)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(fontSmoothingStorageKey, isEnabled ? "true" : "false")
    }
  }, [])

  const value = useMemo(
    () => ({
      themeMode,
      themeStyle,
      setThemeStyle,
      lightThemeStyle,
      darkThemeStyle,
      setThemeStyleForAppearance,
      themeAppearance,
      setThemeAppearance,
      enableNewTimeline,
      setEnableNewTimeline,
      startWithCompactSidebar,
      setStartWithCompactSidebar,
      maxCommands,
      setMaxCommands,
    }),
    [
      enableNewTimeline,
      darkThemeStyle,
      lightThemeStyle,
      maxCommands,
      setMaxCommands,
      setEnableNewTimeline,
      setStartWithCompactSidebar,
      setThemeAppearance,
      setThemeStyle,
      setThemeStyleForAppearance,
      startWithCompactSidebar,
      themeAppearance,
      themeMode,
      themeStyle,
    ]
  )

  const typographyValue = useMemo(
    () => ({
      interfaceFont,
      setInterfaceFont,
      interfaceFontSize,
      setInterfaceFontSize,
      monospaceFont,
      setMonospaceFont,
      monospaceFontSize,
      setMonospaceFontSize,
      fontSmoothing,
      setFontSmoothing,
    }),
    [
      fontSmoothing,
      interfaceFont,
      interfaceFontSize,
      monospaceFont,
      monospaceFontSize,
      setFontSmoothing,
      setInterfaceFont,
      setInterfaceFontSize,
      setMonospaceFont,
      setMonospaceFontSize,
    ]
  )

  return (
    <AppPreferencesContext.Provider value={value}>
      <TypographyPreferencesContext.Provider value={typographyValue}>
        {children}
      </TypographyPreferencesContext.Provider>
    </AppPreferencesContext.Provider>
  )
}

export {
  maxCommandsStorageKey,
  fontSmoothingStorageKey,
  interfaceFontSizeStorageKey,
  interfaceFontStorageKey,
  monospaceFontSizeStorageKey,
  monospaceFontStorageKey,
  darkThemeStyleStorageKey,
  lightThemeStyleStorageKey,
  startWithCompactSidebarStorageKey,
  themeAppearanceStorageKey,
  themeModeChangeEvent,
  themeModeStorageKey,
  themeStyleStorageKey,
}
export default AppPreferencesContext
export { TypographyPreferencesContext }
export const AppPreferencesProvider = Provider
