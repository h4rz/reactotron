import { getDesktopShortcutModifier, isIOSSimulatorSupported } from "./platform"

describe("desktop platform capabilities", () => {
  it.each(["win32", "linux"])("does not expose iOS simulator support on %s", (platform) => {
    expect(isIOSSimulatorSupported(platform)).toBe(false)
    expect(getDesktopShortcutModifier(platform)).toBe("Ctrl")
  })

  it("exposes iOS simulator support on macOS", () => {
    expect(isIOSSimulatorSupported("darwin")).toBe(true)
    expect(getDesktopShortcutModifier("darwin")).toBe("Cmd")
  })
})
