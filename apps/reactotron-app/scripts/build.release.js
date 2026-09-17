// @ts-check
// #region Validate inputs
const isCi = process.env.CI === "true"
let skipSigning = false
const BUILD_TARGET = process.env.BUILD_TARGET
if (BUILD_TARGET !== "macos" && BUILD_TARGET !== "linux" && BUILD_TARGET !== "windows") {
  throw new Error('BUILD_TARGET must be either "macos", "linux" or "windows"')
}
console.log(`Releasing app for target: '${BUILD_TARGET}'`)

if (isCi) {
  const path = require("path")
  const fs = require("fs")
  const CSC_LINK = path.join(
    __dirname, // ~/apps/reactotron-app/scripts
    "..", // ~/apps/reactotron-app/
    "Certificates.p12" // ~/apps/reactotron-app/Certificates.p12
  )
  if (BUILD_TARGET === "macos" && !fs.existsSync(CSC_LINK)) {
    throw new Error(`CSC_LINK not found at ${CSC_LINK} for ${BUILD_TARGET} target}`)
  }
  if (BUILD_TARGET === "macos") {
    console.log(`MacOS Code Signing Certificate found at: '${CSC_LINK}'`)
  }
} else {
  // Local builds can sign with a keychain identity when one is provided via
  // MAC_SIGN_IDENTITY (or electron-builder's native CSC_NAME). This lets
  // electron-builder sign the whole bundle in the correct order during the
  // build, so no manual post-build re-signing is required. Without an
  // identity we fall back to an unsigned build.
  const localIdentity = process.env.MAC_SIGN_IDENTITY || process.env.CSC_NAME
  if (BUILD_TARGET !== "macos") {
    console.log(`No code-signing configuration is required for the ${BUILD_TARGET} target`)
  } else if (localIdentity) {
    console.log(`Signing local build with identity: '${localIdentity}'`)
  } else {
    console.log("Not running in CI and no signing identity provided, skipping code signing")
    console.log(
      "To sign locally, set MAC_SIGN_IDENTITY to a keychain identity (e.g. 'Apple Development: You (TEAMID)'). See: https://www.electron.build/code-signing.html"
    )
    skipSigning = true
  }
}
// #endregion

/** @type {Record<typeof BUILD_TARGET, string>} @see https://electron.build/cli.html */
const targetFlags = { macos: "--macos --arm64 --x64", windows: "--windows", linux: "--linux" }
let flags = `${targetFlags[BUILD_TARGET]} --publish never`

if (skipSigning) {
  flags += " -c.mac.identity=null"
} else if (!isCi && (process.env.MAC_SIGN_IDENTITY || process.env.CSC_NAME)) {
  flags += ` -c.mac.identity=${JSON.stringify(process.env.MAC_SIGN_IDENTITY || process.env.CSC_NAME)}`
}

/**
 * @type {Record<typeof BUILD_TARGET, Record<string, string>>}
 * @see https://www.electron.build/code-signing.html
 * @see https://www.electron.build/configuration/publish#githuboptions
 */
const processVars = { macos: {}, windows: {}, linux: {} }
const env = {
  ...process.env,
  BUILD_TARGET,
  ...processVars[BUILD_TARGET],
}

/** @param cmd {string} */
const $ = (cmd) => {
  require("child_process").execSync(cmd, { env, stdio: "inherit" })
}

console.log(`Building app with flags: '${flags}'...`)
$(`yarn build && electron-builder ${flags}`)
