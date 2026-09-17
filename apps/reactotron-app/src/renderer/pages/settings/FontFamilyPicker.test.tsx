import React from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { ThemeProvider } from "styled-components"

import FontFamilyPicker from "./FontFamilyPicker"

const testTheme = {
  background: "#111111",
  backgroundHighlight: "#333333",
  backgroundLighter: "#222222",
  chromeLine: "#444444",
  foreground: "#ffffff",
  foregroundDark: "#999999",
  glow: "rgba(0, 0, 0, 0.4)",
  highlight: "#66aaff",
}

describe("FontFamilyPicker", () => {
  it("only mounts the visible portion of a large installed-font list", async () => {
    const fonts = Array.from({ length: 275 }, (_, index) => ({
      family: `Test Family ${String(index).padStart(3, "0")}`,
    }))
    Object.defineProperty(window, "queryLocalFonts", {
      configurable: true,
      value: jest.fn().mockResolvedValue(fonts),
    })

    render(
      <ThemeProvider theme={testTheme}>
        <FontFamilyPicker ariaLabel="Interface font family" value="system" onChange={jest.fn()} />
      </ThemeProvider>
    )

    fireEvent.click(screen.getByRole("button", { name: "Interface font family" }))

    await waitFor(() => expect(screen.queryByText("Loading installed fonts…")).toBeNull())

    expect(screen.getAllByRole("option").length).toBeLessThan(30)
    expect(screen.getByRole("option", { name: /System/ }).getAttribute("aria-setsize")).toBe("280")

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Test Family 274" } })

    expect(screen.getAllByRole("option")).toHaveLength(1)
    expect(screen.getByRole("option", { name: "Test Family 274" })).not.toBeNull()
  })
})
