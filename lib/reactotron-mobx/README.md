# reactotron-mobx

Exposes plain MobX stores (no mobx-state-tree) to Reactotron's state tools: the desktop State page, MCP `request_state` / `request_state_keys` / `subscribe_state` / `swap_state` / `dispatch_action`, and `reactotron agent state`.

```ts
import { mobxPlugin } from "@hurajgor/reactotron-mobx"

const reactotron = Reactotron.configure().useReactNative().use(mobxPlugin()).connect()
reactotron.trackMobxStore(rootStore)
```

Keep secrets out of Reactotron with a path filter:

```ts
mobxPlugin({ filter: (path) => !path.endsWith(".token") })
```

MobX has no serialisable actions, so `dispatch_action` calls a store method by path: `{ type: "authStore.logout" }` or `{ type: "cart.add", payload: [item] }` (an array payload is spread as arguments). `swap_state` assigns values onto the existing observables, so store classes and their actions survive.
