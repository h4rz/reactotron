# Reactotron Agent CLI

The Reactotron Agent CLI gives developers and coding agents a scriptable interface to Reactotron. It talks to the same local MCP endpoint as other agent clients, so Reactotron's redaction settings remain enforced.

```bash
npx @hurajgor/reactotron-cli agent status --json
npx @hurajgor/reactotron-cli agent timeline --type api.response --limit 20 --json
npx @hurajgor/reactotron-cli agent ui press --test-id submit-button --json
```

## With or without the desktop app

- **Desktop running:** enable **MCP** in the footer. The CLI discovers release port `4567` and development port `4568`.
- **No desktop:** run `reactotron agent serve --detach`. It owns the app connection on `9090` and serves MCP on `4569`; every other command finds it automatically. Stop it with `reactotron agent stop`. It listens on `127.0.0.1` only, which simulators and `adb reverse` reach; pass `--host 0.0.0.0` for physical devices on Wi-Fi.

The desktop app is always preferred: when it is running, `serve` defers to it, so the two never compete for the app connection. Use `--port` or `--url` to override discovery.

## MCP over stdio

Agents that launch MCP servers as subprocesses can use:

```json
{ "mcpServers": { "reactotron": { "command": "npx", "args": ["-y", "@hurajgor/reactotron-cli", "mcp"] } } }
```

It forwards to the desktop app, then a running headless server, and otherwise starts a headless server in-process.

## Devices, video and flows

```bash
reactotron agent device list
reactotron agent device screenshot <udid|serial>
reactotron agent device record start <udid|serial>
reactotron agent device record stop <udid|serial> --out run.mp4

reactotron agent flow record start login
# ... ui press / fill / dispatch / device commands ...
reactotron agent flow record stop --out flows/login.json
reactotron agent flow run flows/login.json   # exit code 1 on failure, for CI
```

Flow files are JSON: tool steps `{ "tool": "agent_ui_press", "args": { "testID": "submit" } }` plus assertions `waitFor`, `expectNetwork`, `expectState` and `sleep`.

Run `reactotron agent --help` for the complete command list.
