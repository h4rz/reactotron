import React, { useContext } from "react"
import { act, renderHook } from "@testing-library/react"

import AppPreferencesContext, {
  AppPreferencesProvider,
  TypographyPreferencesContext,
  darkThemeStyleStorageKey,
  fontSmoothingStorageKey,
  interfaceFontSizeStorageKey,
  interfaceFontStorageKey,
  lightThemeStyleStorageKey,
  monospaceFontSizeStorageKey,
  monospaceFontStorageKey,
  themeAppearanceStorageKey,
  themeModeStorageKey,
  themeStyleStorageKey,
} from "."

jest.mock("@hurajgor/reactotron-core-ui", () => ({
  themeStyles: ["solarized", "kanagawa", "everforest", "one", "ocean", "t3Code", "nord"],
  themeVariants: {
    solarized: { dark: "solarizedDark", light: "solarizedLight" },
    kanagawa: { dark: "kanagawaWave", light: "kanagawaLotus" },
    everforest: { dark: "everforestDark", light: "everforestLight" },
    one: { dark: "oneDarkPro", light: "oneLight" },
    ocean: { dark: "oceanDark", light: "oceanLight" },
    t3Code: { dark: "t3CodeDark", light: "t3CodeLight" },
    nord: { dark: "nordDark", light: "nordLight" },
  },
}))

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: jest.fn().mockImplementation(() => ({
    matches: false,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  })),
})

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AppPreferencesProvider>{children}</AppPreferencesProvider>
)

describe("AppPreferences", () => {
  afterEach(() => {
    window.localStorage.removeItem(themeModeStorageKey)
    window.localStorage.removeItem(themeStyleStorageKey)
    window.localStorage.removeItem(lightThemeStyleStorageKey)
    window.localStorage.removeItem(darkThemeStyleStorageKey)
    window.localStorage.removeItem(themeAppearanceStorageKey)
    window.localStorage.removeItem(interfaceFontStorageKey)
    window.localStorage.removeItem(interfaceFontSizeStorageKey)
    window.localStorage.removeItem(monospaceFontStorageKey)
    window.localStorage.removeItem(monospaceFontSizeStorageKey)
    window.localStorage.removeItem(fontSmoothingStorageKey)
  })

  it.each([
    ["tokyoNight", "kanagawa"],
    ["githubDark", "one"],
    ["rosePine", "kanagawa"],
    ["ayuMirage", "everforest"],
  ])("migrates retired %s preferences to a retained dark style", (legacyTheme, themeStyle) => {
    window.localStorage.setItem(themeModeStorageKey, legacyTheme)

    const { result } = renderHook(() => useContext(AppPreferencesContext), { wrapper })

    expect(result.current.themeStyle).toBe(themeStyle)
    expect(result.current.lightThemeStyle).toBe(themeStyle)
    expect(result.current.darkThemeStyle).toBe(themeStyle)
    expect(result.current.themeAppearance).toBe("dark")
  })

  it("stores and resolves light and dark theme styles independently", () => {
    window.localStorage.setItem(lightThemeStyleStorageKey, "everforest")
    window.localStorage.setItem(darkThemeStyleStorageKey, "one")
    window.localStorage.setItem(themeAppearanceStorageKey, "dark")

    const { result } = renderHook(() => useContext(AppPreferencesContext), { wrapper })

    expect(result.current.themeStyle).toBe("one")
    expect(result.current.themeMode).toBe("oneDarkPro")

    act(() => result.current.setThemeAppearance("light"))

    expect(result.current.themeStyle).toBe("everforest")
    expect(result.current.themeMode).toBe("everforestLight")

    act(() => result.current.setThemeStyleForAppearance("light", "kanagawa"))

    expect(result.current.lightThemeStyle).toBe("kanagawa")
    expect(result.current.darkThemeStyle).toBe("one")
    expect(window.localStorage.getItem(lightThemeStyleStorageKey)).toBe("kanagawa")
  })

  it("falls back to Ocean when a saved theme is no longer offered", () => {
    window.localStorage.setItem(themeStyleStorageKey, "t3Code")
    window.localStorage.setItem(lightThemeStyleStorageKey, "t3Code")
    window.localStorage.setItem(darkThemeStyleStorageKey, "nord")

    const { result } = renderHook(() => useContext(AppPreferencesContext), { wrapper })

    expect(result.current.themeStyle).toBe("ocean")
    expect(result.current.lightThemeStyle).toBe("ocean")
    expect(result.current.darkThemeStyle).toBe("ocean")
    expect(result.current.themeMode).toBe("oceanLight")
  })

  it("stores typography preferences and clamps font sizes", () => {
    const { result } = renderHook(() => useContext(TypographyPreferencesContext), { wrapper })

    act(() => {
      result.current.setInterfaceFont("Academy Engraved LET")
      result.current.setInterfaceFontSize(40)
      result.current.setMonospaceFont("Andale Mono")
      result.current.setMonospaceFontSize(4)
      result.current.setFontSmoothing(false)
    })

    expect(result.current.interfaceFont).toBe("Academy Engraved LET")
    expect(result.current.interfaceFontSize).toBe(20)
    expect(result.current.monospaceFont).toBe("Andale Mono")
    expect(result.current.monospaceFontSize).toBe(10)
    expect(result.current.fontSmoothing).toBe(false)
    expect(window.localStorage.getItem(interfaceFontStorageKey)).toBe("Academy Engraved LET")
    expect(window.localStorage.getItem(interfaceFontSizeStorageKey)).toBe("20")
    expect(window.localStorage.getItem(monospaceFontStorageKey)).toBe("Andale Mono")
    expect(window.localStorage.getItem(monospaceFontSizeStorageKey)).toBe("10")
    expect(window.localStorage.getItem(fontSmoothingStorageKey)).toBe("false")
  })
})
