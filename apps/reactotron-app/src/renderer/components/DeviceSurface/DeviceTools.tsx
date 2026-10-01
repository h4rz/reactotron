import React, { useCallback, useContext, useEffect, useMemo, useState } from "react"
import { ipcRenderer } from "electron"
import styled from "styled-components"

import StandaloneContext from "../../contexts/Standalone"

/**
 * Developer tools for the selected device: deep links, app lifecycle,
 * permissions, location and push notifications. What each
 * platform supports differs; unsupported tools explain why rather than fail.
 */
export type DeviceToolTarget =
  | { kind: "ios-simulator"; id: string }
  | { kind: "ios-physical"; id: string }
  | { kind: "android"; id: string; emulator: boolean }

type ToolResult = { ok: boolean; message?: string; apps?: Array<{ id: string; name?: string }> }

const IOS_PERMISSIONS = [
  "notifications",
  "location",
  "camera",
  "microphone",
  "photos",
  "photos-add",
  "contacts",
  "calendar",
  "reminders",
  "motion",
  "media-library",
  "siri",
  "speech",
  "faceid",
  "user-tracking",
  "homekit",
]
const ANDROID_PERMISSIONS = [
  "notifications",
  "location",
  "camera",
  "microphone",
  "photos",
  "contacts",
  "calendar",
]

const LOCATION_PRESETS: Array<{ label: string; latitude: number; longitude: number }> = [
  { label: "Dallas, TX", latitude: 32.7767, longitude: -96.797 },
  { label: "New York, NY", latitude: 40.7128, longitude: -74.006 },
  { label: "Los Angeles, CA", latitude: 34.0522, longitude: -118.2437 },
  { label: "Chicago, IL", latitude: 41.8781, longitude: -87.6298 },
  { label: "Miami, FL", latitude: 25.7617, longitude: -80.1918 },
  { label: "London, UK", latitude: 51.5072, longitude: -0.1276 },
]

const DEFAULT_PUSH = JSON.stringify(
  {
    aps: { alert: { title: "Test notification", body: "Sent from Reactotron" }, sound: "default" },
  },
  null,
  2
)

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 12px;
  border-bottom: 1px solid ${(props) => props.theme.borderSubtle};

  > strong {
    margin: 0 2px 2px;
    color: ${(props) => props.theme.foregroundDark};
    font-size: 11px;
    font-weight: 600;
  }
`

const Row = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
`

const Label = styled.span`
  min-width: 74px;
  color: ${(props) => props.theme.foregroundDark};
  font-size: 12px;
`

const inputStyles = `
  min-width: 0;
  height: 30px;
  box-sizing: border-box;
  padding: 0 9px;
  border-radius: 7px;
  outline: none;
  font: inherit;
  font-size: 12px;
`

const Input = styled.input`
  ${inputStyles}
  flex: 1;
  border: 1px solid ${(props) => props.theme.borderSubtle};
  background: ${(props) => props.theme.background};
  color: ${(props) => props.theme.foreground};

  &:focus-visible {
    border-color: ${(props) => props.theme.highlight};
  }
`

const Select = styled.select`
  ${inputStyles}
  flex: 1;
  border: 1px solid ${(props) => props.theme.borderSubtle};
  background: ${(props) => props.theme.background};
  color: ${(props) => props.theme.foreground};

  &:focus-visible {
    border-color: ${(props) => props.theme.highlight};
  }
`

const TextArea = styled.textarea`
  min-height: 92px;
  box-sizing: border-box;
  padding: 8px 9px;
  border: 1px solid ${(props) => props.theme.borderSubtle};
  border-radius: 7px;
  outline: none;
  background: ${(props) => props.theme.background};
  color: ${(props) => props.theme.foreground};
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  resize: vertical;

  &:focus-visible {
    border-color: ${(props) => props.theme.highlight};
  }
`

const Button = styled.button`
  height: 30px;
  flex: 0 0 auto;
  padding: 0 11px;
  border: 1px solid ${(props) => props.theme.borderSubtle};
  border-radius: 7px;
  background: ${(props) => props.theme.surfaceRaised};
  color: ${(props) => props.theme.foreground};
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 600;

  &:hover:not(:disabled) {
    border-color: ${(props) => props.theme.highlight};
  }

  &:focus-visible {
    outline: 2px solid ${(props) => props.theme.highlight};
    outline-offset: 1px;
  }

  &:disabled {
    cursor: default;
    opacity: 0.5;
  }
`

const Note = styled.p`
  margin: 0 2px;
  color: ${(props) => props.theme.foregroundDark};
  font-size: 11px;
  line-height: 16px;
`

function appStorageKey(target: DeviceToolTarget) {
  return `reactotron.deviceTools.app.${target.kind}.${target.id}`
}

/** Prefer the app the developer last used here, else one matching a connected Reactotron client. */
function pickDefaultApp(
  target: DeviceToolTarget,
  apps: Array<{ id: string; name?: string }>,
  clientNames: string[]
) {
  const remembered = window.localStorage.getItem(appStorageKey(target))
  if (remembered && apps.some((app) => app.id === remembered)) return remembered
  const words = clientNames
    .join(" ")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2)
  const scored = apps
    .filter((app) => !/xctrunner|uitests/i.test(app.id))
    .map((app) => {
      const haystack = `${app.id} ${app.name ?? ""}`.toLowerCase()
      return { app, score: words.filter((word) => haystack.includes(word)).length }
    })
    .sort((a, b) => b.score - a.score)
  return scored[0]?.app.id ?? apps[0]?.id ?? ""
}

function DeviceTools({
  target,
  onResult,
}: {
  target: DeviceToolTarget
  onResult: (message: string, isError: boolean) => void
}) {
  const { connections } = useContext(StandaloneContext)
  const clientNames = useMemo(
    () => connections.map((connection) => connection.name ?? "").filter(Boolean),
    [connections]
  )
  const [apps, setApps] = useState<Array<{ id: string; name?: string }>>([])
  const [appId, setAppId] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [url, setUrl] = useState("")
  const [permission, setPermission] = useState("camera")
  const [latitude, setLatitude] = useState("")
  const [longitude, setLongitude] = useState("")
  const [payload, setPayload] = useState(DEFAULT_PUSH)

  const isIOSSimulator = target.kind === "ios-simulator"
  const isAndroid = target.kind === "android"
  const isPhysicalIOS = target.kind === "ios-physical"
  const permissions = isAndroid ? ANDROID_PERMISSIONS : IOS_PERMISSIONS

  const runTool = useCallback(
    async (action: string, args: Record<string, unknown> = {}) => {
      setBusy(action)
      try {
        const result = (await ipcRenderer.invoke("device-tool", target, action, args)) as ToolResult
        if (result.message) onResult(result.message, !result.ok)
        return result
      } finally {
        setBusy(null)
      }
    },
    [onResult, target]
  )

  const loadApps = useCallback(async () => {
    setBusy("list-apps")
    try {
      // A simulator that is still restarting SpringBoard or loading its runtime can
      // fail or stall the first listing; retry before leaving the tools without an app.
      let result: ToolResult = { ok: false }
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 2500))
        result = (await ipcRenderer.invoke("device-tool", target, "list-apps")) as ToolResult
        if (result.ok) break
      }
      if (!result.ok) {
        onResult(result.message || "Could not list installed apps.", true)
        return
      }
      const next = [...(result.apps ?? [])].sort((a, b) =>
        (a.name || a.id).localeCompare(b.name || b.id)
      )
      setApps(next)
      setAppId((current) =>
        current && next.some((app) => app.id === current)
          ? current
          : pickDefaultApp(target, next, clientNames)
      )
    } finally {
      setBusy(null)
    }
    // clientNames only seeds the first choice; reloading on every connection change would reset it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onResult, target])

  useEffect(() => {
    loadApps().catch(() => undefined)
  }, [loadApps])

  const chooseApp = (next: string) => {
    setAppId(next)
    window.localStorage.setItem(appStorageKey(target), next)
  }

  const disabled = (action: string) => busy !== null || (action !== "open-url" && !appId)

  return (
    <>
      <Section>
        <strong>App</strong>
        <Row>
          <Label>App</Label>
          <Select
            aria-label="App to control"
            value={appId}
            disabled={busy === "list-apps" || apps.length === 0}
            onChange={(event) => chooseApp(event.target.value)}
          >
            {apps.length === 0 && (
              <option value="">{busy === "list-apps" ? "Loading…" : "No apps"}</option>
            )}
            {apps.map((app) => (
              <option key={app.id} value={app.id}>
                {app.name ? `${app.name} — ${app.id}` : app.id}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            disabled={busy !== null}
            onClick={() => loadApps().catch(() => undefined)}
          >
            Refresh
          </Button>
        </Row>
        <Row>
          <Button
            type="button"
            disabled={disabled("terminate")}
            onClick={() => runTool("terminate", { appId }).catch(() => undefined)}
          >
            Terminate
          </Button>
          <Button
            type="button"
            disabled={disabled("relaunch")}
            onClick={() => runTool("relaunch", { appId }).catch(() => undefined)}
          >
            Relaunch
          </Button>
        </Row>
        <Row
          as="form"
          onSubmit={(event: React.FormEvent) => {
            event.preventDefault()
            runTool("open-url", { url, appId }).catch(() => undefined)
          }}
        >
          <Input
            aria-label="URL or deep link"
            placeholder="https://… or myapp://path"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            spellCheck={false}
          />
          <Button type="submit" disabled={disabled("open-url") || !url.trim()}>
            Open
          </Button>
        </Row>
      </Section>

      <Section>
        <strong>Permissions</strong>
        {isPhysicalIOS ? (
          <Note>Physical iPhones do not allow changing app permissions from a computer.</Note>
        ) : (
          <Row>
            <Select
              aria-label="Permission"
              value={permission}
              onChange={(event) => setPermission(event.target.value)}
            >
              {permissions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
            <Button
              type="button"
              disabled={disabled("permission")}
              onClick={() =>
                runTool("permission", { appId, permission, mode: "grant" }).catch(() => undefined)
              }
            >
              Grant
            </Button>
            <Button
              type="button"
              disabled={disabled("permission")}
              onClick={() =>
                runTool("permission", { appId, permission, mode: "revoke" }).catch(() => undefined)
              }
            >
              Revoke
            </Button>
            <Button
              type="button"
              disabled={disabled("permission")}
              onClick={() =>
                runTool("permission", { appId, permission, mode: "reset" }).catch(() => undefined)
              }
            >
              Reset
            </Button>
          </Row>
        )}
      </Section>

      <Section>
        <strong>Location</strong>
        {isAndroid && !target.emulator ? (
          <Note>
            Physical Android devices only take a simulated location from a mock-location app.
          </Note>
        ) : (
          <>
            <Row>
              <Input
                aria-label="Latitude"
                placeholder="Latitude"
                inputMode="decimal"
                value={latitude}
                onChange={(event) => setLatitude(event.target.value)}
              />
              <Input
                aria-label="Longitude"
                placeholder="Longitude"
                inputMode="decimal"
                value={longitude}
                onChange={(event) => setLongitude(event.target.value)}
              />
            </Row>
            <Row>
              <Select
                aria-label="Location preset"
                value=""
                onChange={(event) => {
                  const preset = LOCATION_PRESETS.find((item) => item.label === event.target.value)
                  if (!preset) return
                  setLatitude(String(preset.latitude))
                  setLongitude(String(preset.longitude))
                }}
              >
                <option value="">Preset…</option>
                {LOCATION_PRESETS.map((preset) => (
                  <option key={preset.label} value={preset.label}>
                    {preset.label}
                  </option>
                ))}
              </Select>
              <Button
                type="button"
                disabled={busy !== null || !latitude.trim() || !longitude.trim()}
                onClick={() => runTool("location", { latitude, longitude }).catch(() => undefined)}
              >
                Set
              </Button>
              {!isAndroid && (
                <Button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => runTool("clear-location").catch(() => undefined)}
                >
                  Clear
                </Button>
              )}
            </Row>
          </>
        )}
      </Section>

      <Section>
        <strong>Push notification</strong>
        {isIOSSimulator ? (
          <>
            <TextArea
              aria-label="Push payload (APNs JSON)"
              value={payload}
              spellCheck={false}
              onChange={(event) => setPayload(event.target.value)}
            />
            <Row>
              <Button
                type="button"
                disabled={disabled("push")}
                onClick={() => runTool("push", { appId, payload }).catch(() => undefined)}
              >
                Send to app
              </Button>
              <Note>APNs payload; include custom keys your app routes on.</Note>
            </Row>
          </>
        ) : (
          <Note>
            {isAndroid
              ? "Android push needs Firebase Cloud Messaging; it cannot be sent from the computer."
              : "Push to a physical iPhone goes through Apple's push service, not the computer."}
          </Note>
        )}
      </Section>
    </>
  )
}

export default DeviceTools
