import assert from "node:assert/strict";
import { buildTools } from "./mcp-tools.js";
import { loadConfig } from "./escrow-client.js";

const tools = buildTools(loadConfig());
assert.deepEqual(tools.map((t) => t.name).sort(), ["check_receipt", "get_wallet", "reclaim", "request_audit"]);

const audit = tools.find((t) => t.name === "request_audit")!;
// honesty guardrail must be in the description the agent reads
assert.ok(/agreed import\/capability policy/i.test(audit.description));
assert.ok(!/\bsafe\b/i.test(audit.description));
assert.ok("contract" in audit.inputSchema);

const check = tools.find((t) => t.name === "check_receipt")!;
assert.ok("job_id" in check.inputSchema);

console.log("mcp tools: all assertions passed");
