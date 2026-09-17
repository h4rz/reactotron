# ![Reactotron Logo](./docs/plugins/images/readme/Reactotron-128.png) Reactotron

Reactotron is a desktop debugger for React and React Native. This fork builds on the existing Reactotron debugging tools with an advanced network workspace, semantic agent controls, and embedded iOS and Android device surfaces.

![Reactotron desktop with Timeline and an embedded iPhone simulator](./docs/plugins/images/readme/desktop-simulator.png)

## What this fork adds

- Inspect network requests, responses, headers, payloads, and timing alongside application logs.
- Search and filter traffic by method, status, duration, content type, host, endpoint, time window, and duplicates.
- Explore and operate React Native runtime UI through the Agent CLI or MCP, using `testID`, labels, text, roles, and placeholders.
- Connect coding agents through MCP or terminal workflows to inspect debug data and control desktop iOS Simulator workflows.
- Create, open, stream, and control iOS Simulators from Reactotron on macOS, without switching to Simulator.app.
- Stream and control Android emulators and physical ADB devices directly in Reactotron.
- Choose a theme and light, dark, or system appearance; use a compact sidebar; and tailor the Timeline layout to your workflow.
- Recover dropped app connections, refresh stale device state, and run development and release builds side by side on separate default ports.
- Debug the rest of your app with Reactotron’s established state, Redux, MobX-State-Tree, Async Storage, overlay, Storybook, benchmark, and custom-command tools.

## A modern desktop workspace

The Timeline is a single place to investigate API activity and logs. Keep the event list visible while inspecting details, resize the inspector to suit the task, and move between readable summary, request, response, headers, and raw data views.

![Timeline with simulator setup controls](./docs/plugins/images/readme/simulator-setup.png)

### Network and logs

Use the Timeline to:

- Search endpoints, logs, status codes, and hosts.
- Filter network events by method, status, duration, content type, host, endpoint, time window, and duplicates.
- Select log levels independently from network traffic.
- Inspect formatted, tree, or raw payloads and copy the data you need.
- Keep a resizable inspector open while you compare requests and responses.
- Capture `console.log`, `console.info`, `console.warn`, and `console.debug` calls without losing their additional arguments.

### Agentic development and MCP

The Agent CLI and MCP server give coding agents a semantic view of a connected React Native app. Agents can request a UI snapshot, find elements by `testID`, runtime ID, text, accessibility label, role, hint, or placeholder, and perform supported press, fill, and scroll actions without relying on screenshot coordinates. They also provide timelines, network activity, logs, state tools, custom commands, and desktop iOS Simulator workflows to local coding assistants such as Claude Code and Codex.

See the [MCP and Agent CLI guide](./docs/mcp.md) for client setup, redaction, available tools, and iOS Simulator requirements.

### Themes and layout

Choose Solarized, Kanagawa, Everforest, Gruvbox, Catppuccin, T3 Code, One, or Nord in Settings, then use the system, dark, or light appearance. The newer Timeline event-table interface and compact sidebar are enabled by default, and both preferences can be changed there.

![Reactotron Settings with theme, Timeline, and sidebar preferences](./docs/plugins/images/readme/desktop-settings.png)

## Embedded iOS Simulator (macOS)

Open the simulator panel to discover a booted iOS Simulator or create a new iPhone simulator from an installed runtime. Reactotron manages the local stream and gives you a first-class device surface with tabs, connection state, and device controls.

Requirements:

- macOS with Xcode Command Line Tools.
- At least one installed iOS Simulator runtime.

The embedded device supports Home, reload, reconnect, shutdown, rotation, light/dark appearance, pointer gestures, US-ASCII keyboard input, and paste. Screenshot capture offers **Save to File** or **Copy to Clipboard**. Recording begins immediately, displays a red **REC** state, and asks where to save only after you stop it.

| Shortcut      | Action                                                            |
| ------------- | ----------------------------------------------------------------- |
| `Cmd+S`       | Capture a screenshot and choose Save to File or Copy to Clipboard |
| `Cmd+R`       | Start recording; press again to stop and choose where to save     |
| `Cmd+Shift+A` | Toggle the simulator between light and dark appearance            |

## Android emulators and physical devices

The device panel discovers Android emulators, USB devices, and Wi-Fi ADB devices through ADB. Open a device to start a low-latency H.264 stream powered by scrcpy and interact with it directly inside Reactotron.

The Android surface supports taps, swipes, dragging, keyboard input, and paste, along with Back, Home, Recents, Reload, and rotation controls. You can capture screenshots, record the screen, and use the link button to configure `adb reverse` for Reactotron's active server port.

## Install

macOS is the primary development platform. Windows and Linux installers are built on native GitHub runners and receive automated packaging checks, but their full device workflows still need more community runtime testing. If you use either platform, test reports and fixes are welcome.

Download Reactotron for macOS, Windows, or Linux from the [Releases](https://github.com/h4rz/reactotron/releases) page.

Internal macOS builds are code-signed for both Intel and Apple Silicon. They are not notarized, so macOS may require you to move Reactotron to Applications and select **Open Anyway** in **System Settings → Privacy & Security** on first launch.

This fork publishes its client packages under the `@hurajgor` scope. Add the client that matches your application as a development dependency so it does not affect production builds:

```sh
# React Native
npm install --save-dev @hurajgor/reactotron-react-native

# React
npm install --save-dev @hurajgor/reactotron-react-js
```

Use the scoped `@hurajgor/*` integrations as well, for example `@hurajgor/reactotron-redux`, `@hurajgor/reactotron-mst`, and `@hurajgor/reactotron-apisauce`. Do not mix these with the unscoped upstream Reactotron packages.

Latest desktop release:

- [Reactotron 3.14.3](https://github.com/h4rz/reactotron/releases/tag/reactotron-app%403.14.3)

## Get started

- [React Native quick start](./docs/quick-start/react-native.md)
- [React quick start](./docs/quick-start/react-js.md)
- [MCP setup and tools](./docs/mcp.md)
- [Tips and tricks](./docs/tips.md)
- [Troubleshooting](./docs/troubleshooting.md)

## Plugins and integrations

Reactotron includes integrations for [global errors](./docs/plugins/track-global-errors.md), [global logs](./docs/plugins/track-global-logs.md), [networking](./docs/plugins/networking.md), [Async Storage](./docs/plugins/async-storage.md), [React Native MMKV](./docs/plugins/react-native-mmkv.md), [benchmarks](./docs/plugins/benchmark.md), [apisauce](./docs/plugins/apisauce.md), [overlays](./docs/plugins/overlay.md), [MST](./docs/plugins/mst.md), [Redux](./docs/plugins/redux.md), [Open in Editor](./docs/plugins/open-in-editor.md), [Storybook](./docs/plugins/storybook.md), and [custom commands](./docs/custom-commands.md).

## Roadmap

The following capabilities are planned and are not part of the current releases:

- **Test-case execution:** discover, run, monitor, and review test cases from Reactotron.
- **Chrome DevTools integration:** combine network inspection, logs, JavaScript debugging, and breakpoints in one desktop application.
- **Physical iOS device mirroring:** extend the embedded simulator experience to connected physical iOS devices.
- **End-to-end agentic testing:** build on the existing semantic MCP runtime so agents can execute test flows, interact through stable `testID` and accessibility selectors, perform assertions, and report results without depending primarily on screenshot coordinates.

## Contributing

- [Contributing guide](./docs/contributing/index.md)
- [Architecture](./docs/contributing/architecture.md)
- [Monorepo guide](./docs/contributing/monorepo.md)
- [Release process](./docs/contributing/releasing.md)

The desktop development app identifies itself as **Reactotron Dev** and uses ports `9091` (server) and `4568` (MCP) by default, so it can run alongside a release installation. Override either with `REACTOTRON_SERVER_PORT` or `REACTOTRON_MCP_PORT` when needed.

## Credits

Reactotron is developed by [Infinite Red](https://infinite.red), [@rmevans9](https://github.com/rmevans9), and 70+ contributors. Special thanks to [@skellock](https://github.com/skellock) for originally creating Reactotron while at Infinite Red.
