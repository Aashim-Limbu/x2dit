import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./escrow-client.js";
import { buildTools } from "./mcp-tools.js";

const cfg = loadConfig();
const server = new McpServer({ name: "proofreceipt", version: "0.1.0" });

for (const t of buildTools(cfg)) {
  server.registerTool(t.name, { description: t.description, inputSchema: t.inputSchema }, t.handler);
}

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("[mcp] proofreceipt MCP server ready (stdio)\n");
