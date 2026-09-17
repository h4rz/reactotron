export type InterfaceFont = string
export type MonospaceFont = string

export const defaultInterfaceFont: InterfaceFont = "system"
export const defaultMonospaceFont: MonospaceFont = "systemMono"
export const defaultInterfaceFontSize = 15
export const defaultMonospaceFontSize = 12

export const fallbackInterfaceFonts: ReadonlyArray<{ label: string; value: InterfaceFont }> = [
  { label: "System", value: "system" },
  { label: "SF Pro", value: "sfPro" },
  { label: "Segoe UI", value: "segoeUi" },
  { label: "Ubuntu", value: "ubuntu" },
  { label: "Arial", value: "arial" },
]

export const fallbackMonospaceFonts: ReadonlyArray<{ label: string; value: MonospaceFont }> = [
  { label: "System Mono", value: "systemMono" },
  { label: "SF Mono", value: "sfMono" },
  { label: "Menlo", value: "menlo" },
  { label: "Consolas", value: "consolas" },
  { label: "Ubuntu Mono", value: "ubuntuMono" },
]

const interfaceFontFamilies: Record<string, string> = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  sfPro: '"SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif',
  segoeUi: '"Segoe UI", system-ui, sans-serif',
  ubuntu: "Ubuntu, system-ui, sans-serif",
  arial: 'Arial, "Helvetica Neue", sans-serif',
}

const monospaceFontFamilies: Record<string, string> = {
  systemMono: 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  sfMono: '"SF Mono", "SFMono-Regular", Menlo, Consolas, monospace',
  menlo: 'Menlo, "SF Mono", Consolas, monospace',
  consolas: 'Consolas, "Liberation Mono", monospace',
  ubuntuMono: '"Ubuntu Mono", "Liberation Mono", Consolas, monospace',
}

export function isInterfaceFont(value: string | null): value is InterfaceFont {
  return value !== null && value.trim().length > 0 && value.length <= 200
}

export function isMonospaceFont(value: string | null): value is MonospaceFont {
  return value !== null && value.trim().length > 0 && value.length <= 200
}

export function resolveInterfaceFont(font: InterfaceFont): string {
  return interfaceFontFamilies[font] || `${quoteFontFamily(font)}, ${interfaceFontFamilies.system}`
}

export function resolveMonospaceFont(font: MonospaceFont): string {
  return (
    monospaceFontFamilies[font] || `${quoteFontFamily(font)}, ${monospaceFontFamilies.systemMono}`
  )
}

function quoteFontFamily(font: string): string {
  return `"${font.trim().replace(/"/g, "")}"`
}

const monospaceProbeVariants = ["normal 400", "normal 700", "italic 400", "italic 700"]
const monospaceProbeGlyphs = ["i", "M", "W", "0", "@", "#", ".", " "]
const monospaceFamilyCache = new Map<string, boolean>()
let fontProbeContext: CanvasRenderingContext2D | null | undefined

export function isMonospaceFamily(font: string): boolean {
  const cached = monospaceFamilyCache.get(font)
  if (cached !== undefined) return cached
  if (typeof document === "undefined") return false
  if (fontProbeContext === undefined) {
    fontProbeContext = document.createElement("canvas").getContext("2d")
  }
  if (!fontProbeContext) return false

  const family = `${quoteFontFamily(font)}, monospace`
  const isMonospace = monospaceProbeVariants.every((variant) => {
    fontProbeContext!.font = `${variant} 32px ${family}`
    const widths = monospaceProbeGlyphs.map((glyph) => fontProbeContext!.measureText(glyph).width)
    return widths.every((width) => Math.abs(width - widths[0]) < 0.01)
  })
  monospaceFamilyCache.set(font, isMonospace)
  return isMonospace
}

export async function queryInstalledFontFamilies(): Promise<readonly string[]> {
  if (typeof window === "undefined") return []
  const query = (
    window as Window & {
      queryLocalFonts?: () => Promise<ReadonlyArray<{ readonly family: string }>>
    }
  ).queryLocalFonts
  if (typeof query !== "function") return []

  try {
    const fonts: ReadonlyArray<{ readonly family: string }> = await query.call(window)
    return Array.from(new Set(fonts.map((font) => font.family)))
      .filter((family) => family.length > 0 && !family.startsWith("."))
      .sort((left, right) => left.localeCompare(right))
  } catch {
    return []
  }
}

export function clampInterfaceFontSize(value: number): number {
  return Math.min(20, Math.max(12, Math.round(value)))
}

export function clampMonospaceFontSize(value: number): number {
  return Math.min(18, Math.max(10, Math.round(value)))
}

export interface TypographyPreferences {
  interfaceFont: InterfaceFont
  interfaceFontSize: number
  monospaceFont: MonospaceFont
  monospaceFontSize: number
  fontSmoothing: boolean
}

export function applyTypographyVariables(
  root: HTMLElement,
  preferences: TypographyPreferences
): void {
  root.style.setProperty(
    "--reactotron-interface-font",
    resolveInterfaceFont(preferences.interfaceFont)
  )
  root.style.setProperty(
    "--reactotron-interface-font-size",
    `${clampInterfaceFontSize(preferences.interfaceFontSize)}px`
  )
  root.style.setProperty(
    "--reactotron-monospace-font",
    resolveMonospaceFont(preferences.monospaceFont)
  )
  root.style.setProperty(
    "--reactotron-monospace-font-size",
    `${clampMonospaceFontSize(preferences.monospaceFontSize)}px`
  )
  root.style.setProperty(
    "--reactotron-font-smoothing",
    preferences.fontSmoothing ? "antialiased" : "auto"
  )
}
