import {
  bindingFromKeyboardEvent,
  createKeyMap,
  formatBinding,
  getDefaultKeybindings,
  readKeybindings,
} from "./keybindings"

describe("keybindings", () => {
  beforeEach(() => {
    window.localStorage.clear()
    Object.defineProperty(window, "process", {
      configurable: true,
      value: { platform: "darwin" },
    })
  })

  it("falls back to defaults when saved values are malformed", () => {
    window.localStorage.setItem("reactotron.keybindings", "not-json")
    expect(readKeybindings()).toEqual(getDefaultKeybindings())
  })

  it("loads valid overrides without accepting unknown actions", () => {
    window.localStorage.setItem(
      "reactotron.keybindings",
      JSON.stringify({ DeviceScreenshot: "mod+shift+9", UnknownAction: "mod+u" })
    )
    const bindings = readKeybindings()
    expect(bindings.DeviceScreenshot).toBe("mod+shift+9")
    expect(bindings).not.toHaveProperty("UnknownAction")
  })

  it("resolves portable modifiers for react-hotkeys", () => {
    const keyMap = createKeyMap(getDefaultKeybindings())
    expect(keyMap.DeviceScreenshot.sequences).toEqual(["command+s"])
  })

  it("captures and presents a macOS shortcut", () => {
    const event = {
      key: "P",
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: true,
    } as React.KeyboardEvent
    expect(bindingFromKeyboardEvent(event)).toBe("mod+shift+p")
    expect(formatBinding("mod+shift+p")).toEqual(["⌘", "⇧", "P"])
  })
})
