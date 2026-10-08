import { makeAutoObservable, observable } from "mobx"
import { mobxPlugin } from "../src"

class AuthStore {
  user = { name: "Ada", age: 36 }
  token = "secret"
  constructor() {
    makeAutoObservable(this)
  }
  setName(name: string) {
    this.user.name = name
  }
  logout() {
    this.token = ""
  }
}

class RootStore {
  auth = new AuthStore()
  lots = observable.map<string, { id: string }>({ a: { id: "a" } })
  constructor() {
    makeAutoObservable(this)
  }
}

function setup(options?: Parameters<typeof mobxPlugin>[0]) {
  const reactotron = {
    send: jest.fn(),
    stateValuesResponse: jest.fn(),
    stateKeysResponse: jest.fn(),
    stateValuesChange: jest.fn(),
    stateBackupResponse: jest.fn(),
    stateActionComplete: jest.fn(),
  }
  const plugin = mobxPlugin(options)(reactotron as any)
  const store = new RootStore()
  plugin.features.trackMobxStore(store)
  const command = (type: string, payload: unknown) =>
    plugin.onCommand({ type, payload, connectionId: 1, date: new Date(), deltaTime: 0, important: false, messageId: 1 } as any)
  return { reactotron, store, command }
}

describe("mobxPlugin", () => {
  it("answers state.values.request at the root and at a path, without functions", () => {
    const { reactotron, command } = setup()
    command("state.values.request", { path: "auth.user" })
    expect(reactotron.stateValuesResponse).toHaveBeenLastCalledWith("auth.user", { name: "Ada", age: 36 })

    command("state.values.request", { path: "" })
    expect(reactotron.stateValuesResponse).toHaveBeenLastCalledWith(null, {
      auth: { user: { name: "Ada", age: 36 }, token: "secret" },
      lots: { a: { id: "a" } },
    })
  })

  it("lists keys, including observable map keys", () => {
    const { reactotron, command } = setup()
    command("state.keys.request", { path: "" })
    expect(reactotron.stateKeysResponse).toHaveBeenLastCalledWith(null, ["auth", "lots"], true)
    command("state.keys.request", { path: "lots" })
    expect(reactotron.stateKeysResponse).toHaveBeenLastCalledWith("lots", ["a"], true)
    command("state.keys.request", { path: "auth" })
    expect(reactotron.stateKeysResponse).toHaveBeenLastCalledWith("auth", ["user", "token"], true)
  })

  it("applies the filter to values and keys", () => {
    const { reactotron, command } = setup({ filter: (path) => path !== "auth.token" })
    command("state.values.request", { path: "auth" })
    expect(reactotron.stateValuesResponse).toHaveBeenLastCalledWith("auth", { user: { name: "Ada", age: 36 } })
    command("state.keys.request", { path: "auth" })
    expect(reactotron.stateKeysResponse).toHaveBeenLastCalledWith("auth", ["user"], true)
  })

  it("sends subscribed values when they change, including nested changes", () => {
    const { reactotron, store, command } = setup()
    command("state.values.subscribe", { paths: ["auth.user"] })
    expect(reactotron.stateValuesChange).toHaveBeenLastCalledWith([
      { path: "auth.user", value: { name: "Ada", age: 36 } },
    ])

    store.auth.setName("Grace")
    expect(reactotron.stateValuesChange).toHaveBeenLastCalledWith([
      { path: "auth.user", value: { name: "Grace", age: 36 } },
    ])
  })

  it("dispatches a store method by path and reports completion", () => {
    const { reactotron, store, command } = setup()
    command("state.action.dispatch", { action: { type: "auth.setName", payload: "Linus" } })
    expect(store.auth.user.name).toBe("Linus")
    expect(reactotron.send).toHaveBeenCalledWith("state.action.complete", expect.objectContaining({ name: "auth.setName" }))
  })

  it("restores state onto the existing observables, keeping store actions", () => {
    const { store, command } = setup()
    command("state.restore.request", { state: { auth: { user: { name: "Restored" } } } })
    expect(store.auth.user).toEqual({ name: "Restored", age: 36 })
    store.auth.logout()
    expect(store.auth.token).toBe("")
  })

  it("backs up the current state", () => {
    const { reactotron, command } = setup()
    command("state.backup.request", {})
    expect(reactotron.stateBackupResponse).toHaveBeenCalledWith(
      expect.objectContaining({ auth: expect.any(Object), lots: expect.any(Object) })
    )
  })
})
