import React, { useContext } from "react"
import { act, renderHook } from "@testing-library/react"

import AppPreferencesContext, {
  AppPreferencesProvider,
  darkThemeStyleStorageKey,
  lightThemeStyleStorageKey,
  themeAppearanceStorageKey,
  themeModeStorageKey,
  themeStyleStorageKey,
} from "."

jest.mock("@hurajgor/reactotron-core-ui", () => ({
  themeStyles: ["kanagawa", "everforest", "one"],
  themeVariants: {
    kanagawa: { dark: "kanagawaWave", light: "kanagawaLotus" },
    everforest: { dark: "everforestDark", light: "everforestLight" },
    one: { dark: "oneDarkPro", light: "oneLight" },
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
})
