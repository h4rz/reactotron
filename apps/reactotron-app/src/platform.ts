export function isIOSSimulatorSupported(platform: string): boolean {
  return platform === "darwin"
}

export function getDesktopShortcutModifier(platform: string): "Cmd" | "Ctrl" {
  return isIOSSimulatorSupported(platform) ? "Cmd" : "Ctrl"
}
