import fs from "fs"
import os from "os"
import path from "path"

/**
 * Resolve the adb executable used for every Android device command.
 *
 * When Reactotron is opened from Finder/Dock the process inherits a minimal
 * PATH that does not include the Android SDK platform-tools directory, so
 * spawning a bare "adb" fails with ENOENT and the device list comes back
 * empty. Look through the usual SDK locations before falling back to PATH,
 * which still works when the app is launched from a shell.
 *
 * REACTOTRON_ADB_PATH overrides everything for anyone using a custom install.
 */

const executableName = process.platform === "win32" ? "adb.exe" : "adb"

function isExecutableFile(filePath: string) {
  try {
    if (!fs.statSync(filePath).isFile()) return false
    fs.accessSync(filePath, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

function defaultSdkDirectories() {
  const home = os.homedir()

  if (process.platform === "darwin") {
    return [path.join(home, "Library", "Android", "sdk")]
  }

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA
    return localAppData ? [path.join(localAppData, "Android", "Sdk")] : []
  }

  return [path.join(home, "Android", "Sdk"), path.join(home, "android-sdk")]
}

/** SDK roots in lookup order: explicit environment first, then the default install location. */
export function androidSdkDirectories() {
  return [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    ...defaultSdkDirectories(),
  ].filter((directory): directory is string => Boolean(directory))
}

function candidatePaths() {
  const sdkRoots = androidSdkDirectories()

  return [
    process.env.REACTOTRON_ADB_PATH,
    ...sdkRoots.map((directory) => path.join(directory, "platform-tools", executableName)),
    "/opt/homebrew/bin/adb",
    "/usr/local/bin/adb",
  ].filter((filePath): filePath is string => Boolean(filePath))
}

let cachedAdbPath: string | undefined

/**
 * Path to adb, or the bare command name when nothing was found so the spawn
 * error still mentions adb rather than an invented path.
 */
export function getAdbPath(): string {
  if (cachedAdbPath) return cachedAdbPath

  const resolved = candidatePaths().find(isExecutableFile)
  cachedAdbPath = resolved || executableName
  return cachedAdbPath
}
