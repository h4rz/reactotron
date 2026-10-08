# @hurajgor/reactotron-mcp

The MCP server behind Reactotron's agent tools. It reads events from a running
`@hurajgor/reactotron-core-server` and exposes them, plus app, UI, device and flow
tools, over MCP's streamable HTTP transport.

The desktop app and `@hurajgor/reactotron-cli` (`reactotron serve` / `reactotron mcp`)
both run it. See [docs/mcp.md](https://github.com/h4rz/reactotron/blob/development/docs/mcp.md).

```ts
import { createServer } from "@hurajgor/reactotron-core-server"
import { createMcpServer, createNodeDeviceHost } from "@hurajgor/reactotron-mcp"

const server = createServer({ port: 9090 })
server.start()
await createMcpServer(server, undefined, undefined, createNodeDeviceHost()).start(4569)
```
