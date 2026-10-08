import { isObservableArray, isObservableMap, reaction, runInAction, toJS, type IReactionDisposer } from "mobx"
import type { Command } from "@hurajgor/reactotron-core-contract"
import {
  type ReactotronCore,
  type Plugin,
  assertHasStateResponsePlugin,
  type InferFeatures,
  type StateResponsePlugin,
} from "@hurajgor/reactotron-core-client"

/**
 * Exposes plain MobX stores (no mobx-state-tree) to Reactotron's state commands,
 * so the desktop state tools, MCP request_state/subscribe_state/swap_state and
 * `reactotron agent state` all work against a MobX root store.
 *
 *   Reactotron.use(mobxPlugin()).connect()
 *   Reactotron.trackMobxStore(rootStore)
 */

export interface MobxPluginOptions {
  /** State paths (dot-separated) never sent to Reactotron, e.g. "authStore.token". */
  filter?: (path: string) => boolean
}

type Store = Record<string, any>

function isNilOrEmpty(path: unknown): path is null | undefined | "" {
  return path === null || path === undefined || path === ""
}

function readPath(path: string, state: unknown): unknown {
  return path.split(".").reduce<any>((value, key) => {
    if (value === null || value === undefined) return undefined
    return isObservableMap(value) || value instanceof Map ? value.get(key) : value[key]
  }, state)
}

function keysOf(value: unknown): string[] {
  if (value === null || typeof value !== "object") return []
  if (isObservableMap(value) || value instanceof Map) return Array.from(value.keys(), String)
  if (isObservableArray(value) || Array.isArray(value)) return value.map((_, index) => String(index))
  return Object.keys(value).filter((key) => typeof (value as any)[key] !== "function")
}

/** Snapshot data only: drops functions and applies the user's path filter. */
function snapshot(value: unknown, path: string, filter?: (path: string) => boolean): unknown {
  const plain = toJS(value)
  const strip = (node: any, at: string): any => {
    if (node === null || typeof node !== "object") return node
    if (Array.isArray(node)) return node.map((item, index) => strip(item, at ? `${at}.${index}` : String(index)))
    if (node instanceof Map) return strip(Object.fromEntries(node), at)
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(node)) {
      if (typeof child === "function") continue
      const childPath = at ? `${at}.${key}` : key
      if (filter && !filter(childPath)) continue
      out[key] = strip(child, childPath)
    }
    return out
  }
  return strip(plain, path)
}

/** Copy plain values onto observable targets, keeping the store's class instances and actions. */
function assign(target: any, source: any) {
  for (const [key, value] of Object.entries(source ?? {})) {
    const current = target[key]
    if (typeof current === "function") continue
    if (
      current !== null &&
      typeof current === "object" &&
      !Array.isArray(current) &&
      !isObservableArray(current) &&
      !isObservableMap(current) &&
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      assign(current, value)
    } else if (isObservableMap(current) && value && typeof value === "object") {
      current.replace(value)
    } else {
      target[key] = value
    }
  }
}

export function mobxPlugin(options: MobxPluginOptions = {}) {
  function plugin<Client extends ReactotronCore = ReactotronCore>(reactotron: Client) {
    assertHasStateResponsePlugin(reactotron)
    const client = reactotron as Client & InferFeatures<Client, StateResponsePlugin>

    let store: Store | undefined
    let subscriptions: string[] = []
    let disposeSubscriptions: IReactionDisposer | undefined

    const read = (path?: string | null) =>
      isNilOrEmpty(path) ? snapshot(store, "", options.filter) : snapshot(readPath(path, store), path, options.filter)

    function expandSubscriptions(): string[] {
      // "cart.*" subscribes to every direct child of cart, matching the MST/Redux plugins.
      return Array.from(
        new Set(
          subscriptions.flatMap((path) => {
            if (!path.endsWith(".*")) return [path]
            const base = path.slice(0, -2)
            return keysOf(base ? readPath(base, store) : store).map((key) => (base ? `${base}.${key}` : key))
          })
        )
      ).sort()
    }

    function sendSubscriptions() {
      if (!store) return
      client.stateValuesChange(expandSubscriptions().map((path) => ({ path, value: read(path) })))
    }

    function watchSubscriptions() {
      disposeSubscriptions?.()
      disposeSubscriptions = undefined
      if (!store || subscriptions.length === 0) return
      // toJS inside the expression makes the reaction track nested changes too.
      disposeSubscriptions = reaction(
        () => expandSubscriptions().map((path) => toJS(readPath(path, store))),
        sendSubscriptions
      )
    }

    function trackMobxStore(rootStore: Store) {
      store = rootStore
      watchSubscriptions()
      sendSubscriptions()
      return rootStore
    }

    function requestKeys(command: Command<"state.keys.request">) {
      if (!store) return
      const path = command?.payload?.path
      const target = isNilOrEmpty(path) ? store : readPath(path, store)
      const keys = keysOf(target).filter(
        (key) => !options.filter || options.filter(isNilOrEmpty(path) ? key : `${path}.${key}`)
      )
      client.stateKeysResponse(isNilOrEmpty(path) ? null : path, keys, target !== undefined)
    }

    function requestValues(command: Command<"state.values.request">) {
      if (!store) return
      const path = command?.payload?.path
      client.stateValuesResponse(isNilOrEmpty(path) ? null : path, read(path))
    }

    function subscribe(command: Command<"state.values.subscribe">) {
      const paths = command?.payload?.paths ?? []
      subscriptions = Array.from(new Set(paths.flat().map((path) => path ?? "")))
      watchSubscriptions()
      sendSubscriptions()
    }

    function backup() {
      if (store) client.stateBackupResponse(read() as any)
    }

    function restore(command: Command<"state.restore.request">) {
      const state = command?.payload?.state
      if (store && state) runInAction(() => assign(store, state))
    }

    /**
     * MobX has no actions-as-data, so a dispatch calls a store method by path:
     * { type: "authStore.logout" } or { type: "cart.add", payload: [item] }.
     */
    function dispatchAction(command: Command<"state.action.dispatch">) {
      const action = command?.payload?.action as { type?: string; payload?: unknown } | undefined
      if (!store || typeof action?.type !== "string") return
      const segments = action.type.split(".")
      const method = segments.pop()!
      const owner = segments.length ? readPath(segments.join("."), store) : store
      const fn = (owner as any)?.[method]
      if (typeof fn !== "function") {
        reactotron.send("log", {
          level: "warn",
          message: `[reactotron-mobx] ${action.type} is not a store method.`,
        } as any)
        return
      }
      const args = Array.isArray(action.payload)
        ? action.payload
        : action.payload === undefined
          ? []
          : [action.payload]
      const started = Date.now()
      fn.apply(owner, args)
      reactotron.send("state.action.complete", {
        name: action.type,
        action: { type: action.type, payload: action.payload },
        ms: Date.now() - started,
      } as any)
    }

    const COMMAND_MAP: Record<string, (command: Command) => void> = {
      "state.backup.request": backup,
      "state.restore.request": restore,
      "state.action.dispatch": dispatchAction,
      "state.values.subscribe": subscribe,
      "state.keys.request": requestKeys,
      "state.values.request": requestValues,
    }

    return {
      onCommand(command: Command) {
        COMMAND_MAP[command?.type]?.(command)
      },
      onDisconnect() {
        disposeSubscriptions?.()
        disposeSubscriptions = undefined
      },
      features: { trackMobxStore },
    } satisfies Plugin<Client>
  }

  return plugin
}
