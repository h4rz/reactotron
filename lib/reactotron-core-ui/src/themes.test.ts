import { themes, themeStyles, themeVariants } from "./themes"

describe.each(["ocean", "iris"] as const)("%s theme", (themeStyle) => {
  it("provides complete light and dark variants", () => {
    expect(themeStyles).toContain(themeStyle)

    const variants = themeVariants[themeStyle]
    expect(Object.values(themes[variants.light]).every(Boolean)).toBe(true)
    expect(Object.values(themes[variants.dark]).every(Boolean)).toBe(true)
  })
})
