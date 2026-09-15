# reactotron (fork)

A fork of [`infinitered/reactotron`](https://github.com/infinitered/reactotron), publishing the
libraries under the **`@hurajgor`** npm scope and shipping its own signed macOS build of the
desktop app.

The fork exists to serve Copart's `member_mobile` app, so changes here are usually driven by a
problem observed in that app rather than by the upstream roadmap.

## A note from the maintainers

This repo's bugs are timing and connection bugs, so "it looks better" is not a result. Measure
before and after — a socket count beats a screenshot, and a green unit test can be actively
misleading (see **Debugging connection problems**).

Say what you actually verified and what you did not. Treat the rest of this document as good
defaults; the developer's instructions in the moment override anything here.

## The three ways to hurt yourself

1. **Publishing.** npm versions are permanent — they can be deprecated but never replaced, and
   `2.11.1` and `5.3.1` are already burned this way. Never dispatch the publish workflow without
   being asked, and never include a package whose version has not changed (the run fails).
2. **Restarting the wrong side.** The desktop app depends on `reactotron-core-server`, **not**
   `reactotron-core-client`. A client-side fix never reaches it, so restarting Reactotron to
   test one proves nothing — restart Metro in the consuming RN app instead.
3. **Stale bundles.** Metro caches `node_modules` at startup. Sync a built package *after*
   Metro starts and the app runs the old code, which reads exactly like a failed fix. Check the
   file mtime against Metro's start time before concluding anything.

## Glossary

- **core-client** — `lib/reactotron-core-client`, the library running **inside** the mobile app.
- **core-server** — `lib/reactotron-core-server`, the WebSocket server running **inside** the desktop app.
- **the app** / **desktop app** — `apps/reactotron-app`, the Electron client. Ships as a binary on GitHub releases only; never published to npm.
- **the fork scope** — `@hurajgor/…`. Only scoped workspaces can be published from this fork; the unscoped names (`reactotron-core-server`, `eslint-plugin-reactotron`, `reactotron-app`) still belong to upstream Infinite Red on npm, so a publish under those names is not ours to make. Scoping a workspace is what makes it publishable here.
- **tag** — `<projectName>@<version>`, always **unscoped** (`reactotron-core-client@2.11.5`, never `@hurajgor/…`). Set by `nx.json:19` `tagPrefix: "{projectName}@"`.

## How the developer works

- **They verify personally, in the running app.** A passing test suite is not evidence to them.
  Expect "still same" and treat it as data, not disagreement — it usually means the app is
  running different code than you think.
- **They gate commits on their own check:** *"dont commit untill fixed and verified by me"*.
  Ask before committing a behaviour fix; a docs or tooling change is lower stakes.
- **Do not start or kill their processes.** Metro and the packaged Reactotron app are theirs.
  Ask before starting Metro; kill only what you started.
- **Keep moving once the goal is clear.** They dislike being blocked on: *"fix it dont wait on
  me"*. Make the call, state the assumption, continue. Use a question list only for taste
  decisions or irreversible actions (publishing, force-pushing, deleting a release).
- **Stay on the asked question.** Wandering into an adjacent codebase or an unrelated cleanup
  gets stopped.
- **Atomic commits, into `development`.** No Jira keys — this is not a Copart repo. Follow this
  repo's own commit history for style, not member_mobile's.
- **npm and GitHub releases stay in step**, and the latest release is the one that matters.

## Releasing

Everything targets **`development`**. `master` is far behind and is not a release branch.

The scripts `scripts/release.artifacts.mjs` and `apps/reactotron-app/scripts/release.artifacts.js`
are **CircleCI-only** — they gate npm publish on `isCi` and do a CircleCI OIDC token exchange.
CircleCI is not available to this team, so releases are cut by hand with `gh`. That is the
established process, not a workaround.

### 1. Version, changelog, commit and tag

`@jscutlery/semver` via nx does all four at once. Dry-run first with `--dryRun`:

```sh
npx nx run reactotron-app:version --releaseAs minor --baseBranch development
```

For a scoped project name, force the unscoped tag explicitly:

```sh
npx nx run @hurajgor/reactotron-core-ui:version --releaseAs minor \
  --tagPrefix 'reactotron-core-ui@' --baseBranch development
```

`nx version` also rewrites `workspace:*` ranges to real ones, which a hand-edited bump does not.
`reactotron-react-native` pins `reactotron-core-client` exactly, so that dependency moves with it.

Tags are **not** pushed by the version target:

```sh
git push origin development
git push origin 'reactotron-core-client@2.11.5'
```

If `git tag` silently produces nothing, use `git tag --no-sign -a '<tag>' -m '<tag>'` and push the
fully-qualified `refs/tags/<tag>` refspec.

### 2. Publish to npm

Manual `workflow_dispatch`. Order matters — core-client before react-native:

```sh
gh workflow run publish-npm.yml --ref development \
  -f packages="@hurajgor/reactotron-core-client,@hurajgor/reactotron-react-native"
npm view @hurajgor/reactotron-core-client version   # confirm the registry actually moved
```

Auth is **OIDC trusted publishing, configured per package on npmjs.com** — not repo-wide. A
package missing that config fails with `404 Not Found` on PUT, not a 401. A local `npm login`
does nothing for CI.

### 3. GitHub release

Push the tag first, then `--verify-tag`. Never `--target <sha>`: it creates an `untagged-…`
draft instead of using the tag.

```sh
gh release create 'reactotron-core-client@2.11.5' --repo hurajgor/reactotron \
  --verify-tag --title 'reactotron-core-client@2.11.5' --generate-notes --draft
```

Keep GitHub releases in step with npm — every published version gets one, libraries included.

### 4. Desktop installers

Only for `reactotron-app`, and only these carry binary assets.

```sh
corepack enable
MAC_SIGN_IDENTITY="$(security find-identity -v -p codesigning | grep -m1 'Apple Development' | sed -E 's/.*"(.*)"/\1/')" \
  BUILD_TARGET=macos corepack yarn workspace reactotron-app build:release
```

Look the identity up rather than hard-coding it — `security find-identity -v -p codesigning`
lists what the local keychain actually holds.

- `BUILD_TARGET` (`macos` | `linux` | `windows`) is required; the script throws without it.
- Omitting `MAC_SIGN_IDENTITY` **silently ships an unsigned build** — it falls back to
  `-c.mac.identity=null`. Signed DMGs are mandatory.
- Output is `apps/reactotron-app/release/`, **not** `dist/`.
- Builds take 10–25 minutes for both arches. Run detached and poll `pgrep -f electron-builder`.
- Not notarized — no notarize config or credentials exist. Gatekeeper still warns, so keep the
  Gatekeeper paragraph in the release notes.

Verify the signature, upload, then undraft:

```sh
codesign --verify --deep --strict --verbose=2 apps/reactotron-app/release/mac/Reactotron.app
gh release upload 'reactotron-app@3.13.2' apps/reactotron-app/release/Reactotron-3.13.2*.dmg \
  apps/reactotron-app/release/Reactotron-3.13.2*.zip --repo hurajgor/reactotron --clobber
gh release edit 'reactotron-app@3.13.2' --repo hurajgor/reactotron --draft=false
```

**A bad build is not a new version.** If installers were unsigned or wrong, rebuild and
re-upload to the *existing* release with `--clobber`. Do not cut a version to fix a packaging
mistake.

## Environment gotchas

- **`yarn` is not on `PATH`.** Run `corepack enable` first, or prefix
  `PATH="<repo>/node_modules/.bin:$PATH"`.
- **`electron-builder` resolves from the repo root** `node_modules/.bin`, not the app workspace.
- **Run `jest` from inside a package.** The repo root has no TypeScript transform, so suites fail
  to parse there.
- Workspace symlinks mean a `bob build` in a lib is picked up by the desktop app without
  reinstalling — but a consuming RN app needs the built files copied in and Metro restarted with
  `--reset-cache`.
- The `bufferutil` / `utf-8-validate` "Module not found" warnings from `ws` are benign optional
  native deps. They appear in every successful build.

## Testing

Run from inside the package:

```sh
npx jest <path>                       # one suite
npx tsc --noEmit --emitDeclarationOnly false
npx nx run-many --target ci:test --parallel=1
```

`ci:test` has **pre-existing failures** in `reactotron-core-client` and `reactotron-mst` from
broken `src/@hurajgor/...` test imports introduced by the rescoping commit `429de116`. Confirm a
failure predates your change before treating it as a regression.

Before publishing:

```sh
npx zx scripts/package.validate.mjs   # publishable fields on every workspace
npx nx run-many --target typecheck
```

## Debugging connection problems

A symptom shows up in one half of the system and is almost always caused by the other. The
desktop UI shows stacked "Connection established" lines; the defect is in the client library
inside the mobile app. Logs stop arriving; the socket is fine and a plugin never armed. Pick a
side by evidence, not by where the symptom rendered.

**Drive the server with a standalone Node client.** This is the single technique that settles
it, and it needs nothing from the developer:

```js
const { createClient } = require('<repo>/lib/reactotron-core-client')
const WebSocket = require('<repo>/node_modules/ws')
const client = createClient({
  createSocket: (p) => new WebSocket(p),
  host: 'localhost', port: 9090,
  getClientId: () => new Promise(r => setTimeout(() => r('probe'), 300)), // mimic AsyncStorage
})
client.connect()
setTimeout(() => console.log(client.connected, client.isReady, client.sendQueue.length), 8000)
```

If the probe stays connected while the real app churns, the server is exonerated and the
difference is something the app does that the probe does not — an async `getClientId`, a
second `connect()`, a plugin. Three separate wrong theories died to this in one session.

**Measure socket identity, not socket count.** This exact mistake has now been made in three
separate sessions: the connection count stayed flat, a fix was declared, and tracking source
ports revealed a brand-new connection every few seconds the whole time. A repeated log line does
not prove a repeated connection, and a stable count does not prove a stable connection.

```sh
lsof -nP -iTCP:9090 | grep ESTABLISHED   # a CHANGING SOURCE PORT = a new TCP connection
```

Sampling interval matters too. Polling every 5s made a 2s loop look like a 5s one and sent the
investigation at the wrong timer entirely.

**Read the error the app already printed.** Two separate bugs were cracked by one line the UI
was displaying all along — `Port 3200 is already in use…` exposed a TOCTOU race in
`getAvailablePort()`, and `Queued client.intro; socket is not ready.` exposed the send guard.
Before theorising, read what the software is already telling you.

**A/B by reverting.** When a fix "looks better", stash it, rebuild, re-measure, restore. The
only trustworthy result in that session came from this: 22 reconnects/60s reverted versus ~1
with the fix. Do it before claiming a fix works, not after being challenged.

**Green unit tests prove less than you think here.** The real bug was `ws` resolving to a
browser shim under React Native. Every Node test passed because `ws` behaves correctly there.
When a bug is environment-specific, mock the environment (`jest.mock("ws", …)`) or the suite
will keep agreeing with you.

**Before concluding a fix failed, prove the app is running it.** Compare the built file's mtime
against Metro's start time. More than once a "failed fix" was a cached bundle, and rebuilding
after the developer had already restarted Metro put them back to square one — rebuild first,
then have them restart.

## What has gone wrong before

Each of these has cost a session or more. Several have happened repeatedly.

- **Announcing a root cause, then retracting.** Six theories were tested and disproved on one
  bug; another session went *"I told you twice tonight that I'd found it, and I was wrong both
  times."* Say "the evidence so far points at X" until a measurement or a failing test settles
  it. Confident wrong answers cost more than an honest "I don't know yet".
- **Fixing the symptom instead of the cause.** Throttling reconnects removed the churn and
  silently broke network capture — the XHR interceptor was being re-armed by the very churn
  being suppressed. A fix that changes a number without explaining a mechanism is a guess.
- **Claiming done before the developer verified.** "Ready to publish" was said while the symptom
  was still reproducing. Nothing counts as fixed until it is reproduced working in the running
  app; a passing suite is not that.
- **Bypassing the repo's release tooling.** Hand-bumping with `npm pkg set` instead of
  `nx version` shipped manifests still containing `workspace:*`, breaking every consumer with
  `EUNSUPPORTEDPROTOCOL` and forcing respins (see `10bc95a4`).
- **Generalising from this machine.** A diagnosis leaned on a local orphan process until the
  developer said the symptom also occurs on a colleague's machine without it. Reproduce on a
  clean path before calling something the cause.
- **Assuming a change is yours.** Reconnect churn reproduced on published packages with none of
  the session's code present. Check whether the behaviour predates the change before owning it.
- **Debug instrumentation causing the bug.** A `console.warn` inside `onCommand` logged a
  command, which fired `onCommand`, which logged again. Never instrument a path that feeds
  itself — capture the original function reference at module load instead.
- **Heredocs mangling source.** Python heredocs wrote literal `\n` into JS strings and broke the
  bundle twice. Write patch scripts to a file, then run the file.
- **Touching processes the developer owns.** Metro and the packaged Reactotron app are theirs.
  Kill only what you started, and say so.
- **Leaving probes connected.** Test clients appear as extra connections in the developer's UI
  and corrupt their reading. Kill them when finished.
- **Editing files inside a consuming app's `node_modules`.** Sometimes necessary for testing;
  always announce it and restore afterwards.

## React Native specifics

`ws` resolves to its **browser shim** under React Native — a function that throws, exposing no
constants. `WebSocket.OPEN` reads `undefined` there, so any `readyState` comparison against it
silently never matches. Node builds are unaffected, which is why unit tests miss this class of
bug entirely; `core-client` uses a numeric `SOCKET_OPEN = 1` for that reason.

When debugging a connection problem, prefer measuring sockets over reading the UI:

```sh
lsof -nP -iTCP:9090 | grep ESTABLISHED    # a changing source port means reconnect churn
```

## Code style

ESLint and Prettier enforce the rest. Do not add AI attribution to code, commits, or release
notes.
