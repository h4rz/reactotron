import React, { useCallback, useMemo, useState } from "react"
import {
  themeStyles,
  themeVariants,
  type ThemeName,
  type ThemeStyle,
} from "@hurajgor/reactotron-core-ui"

export type ThemeAppearance = "system" | "dark" | "light"

const themeModeStorageKey = "reactotron.themeMode"
const themeStyleStorageKey = "reactotron.themeStyle"
const lightThemeStyleStorageKey = "reactotron.lightThemeStyle"
const darkThemeStyleStorageKey = "reactotron.darkThemeStyle"
const themeAppearanceStorageKey = "reactotron.themeAppearance"
const newTimelineStorageKey = "reactotron.enableNewTimeline"
const startWithCompactSidebarStorageKey = "reactotron.startWithCompactSidebar"
const maxCommandsStorageKey = "reactotron.maxCommands"
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
  if (!match) return null

  return {
    themeStyle: match,
    themeAppearance: themeVariants[match].dark === savedThemeMode ? "dark" : "light",
  }
}

function readThemeStyle(): ThemeStyle {
  if (typeof window === "undefined") return "solarized"

  const savedThemeStyle = window.localStorage.getItem(themeStyleStorageKey)
  if (themeStyles.includes(savedThemeStyle as ThemeStyle)) return savedThemeStyle as ThemeStyle

  return readLegacyThemePreference()?.themeStyle ?? "solarized"
}

function readThemeStyleForAppearance(storageKey: string): ThemeStyle {
  if (typeof window === "undefined") return "solarized"

  const savedThemeStyle = window.localStorage.getItem(storageKey)
  if (themeStyles.includes(savedThemeStyle as ThemeStyle)) return savedThemeStyle as ThemeStyle

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

const AppPreferencesContext = React.createContext<Context>({
  themeMode: "solarizedDark",
  themeStyle: "solarized",
  setThemeStyle: noop,
  lightThemeStyle: "solarized",
  darkThemeStyle: "solarized",
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
    setLightThemeStyle(nextThemeStyle)
    setDarkThemeStyle(nextThemeStyle)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(themeStyleStorageKey, nextThemeStyle)
      window.localStorage.setItem(lightThemeStyleStorageKey, nextThemeStyle)
      window.localStorage.setItem(darkThemeStyleStorageKey, nextThemeStyle)
    }
  }, [])

  const setThemeStyleForAppearance = useCallback(
    (appearance: Exclude<ThemeAppearance, "system">, nextThemeStyle: ThemeStyle) => {
      if (appearance === "light") {
        setLightThemeStyle(nextThemeStyle)
      } else {
        setDarkThemeStyle(nextThemeStyle)
      }

      if (typeof window === "undefined") return
      const storageKey =
        appearance === "light" ? lightThemeStyleStorageKey : darkThemeStyleStorageKey
      window.localStorage.setItem(storageKey, nextThemeStyle)
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

  return <AppPreferencesContext.Provider value={value}>{children}</AppPreferencesContext.Provider>
}

export {
  maxCommandsStorageKey,
  darkThemeStyleStorageKey,
  lightThemeStyleStorageKey,
  startWithCompactSidebarStorageKey,
  themeAppearanceStorageKey,
  themeModeChangeEvent,
  themeModeStorageKey,
  themeStyleStorageKey,
}
export default AppPreferencesContext
export const AppPreferencesProvider = Provider
