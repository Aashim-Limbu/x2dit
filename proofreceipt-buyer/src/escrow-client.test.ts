import assert from "node:assert/strict";
import { loadConfig, resolveContract, extractTxHash, explorerUrl, parseStatus, parseJob } from "./escrow-client.js";

const cfg = loadConfig();
// defaults wired to the live deployment
assert.equal(cfg.contractId, "CCE46SRV3UVFTFJAMB4XSHCCCSZ4WRKDAM2SYSIB253AQ4WIGXLJD62U");
assert.equal(cfg.imageId, "ffc622e891883f70242e3dfea5ccb2b68b73136b30aed868f8f48242cc9eeddd");
assert.equal(cfg.buyerKey, "e2e-buyer");
assert.equal(cfg.sellerKey, "e2e-seller");

// friendly names resolve under fixturesDir; bare paths pass through (absolute)
assert.ok(resolveContract(cfg, "clean").endsWith("/fixtures/clean.wasm"));
assert.ok(resolveContract(cfg, "denylisted").endsWith("/fixtures/denylisted.wasm"));
assert.ok(resolveContract(cfg, "dirty").endsWith("/fixtures/denylisted.wasm"));
assert.ok(resolveContract(cfg, "/tmp/x.wasm").endsWith("/tmp/x.wasm"));

// tx hash extraction from CLI output (explorer link or "Signing transaction:")
const h = "a".repeat(64);
assert.equal(extractTxHash(`...explorer/testnet/tx/${h} ...`), h);
assert.equal(extractTxHash(`Signing transaction: ${h}`), h);
assert.equal(extractTxHash("no hash here"), undefined);
assert.equal(explorerUrl(h), `https://stellar.expert/explorer/testnet/tx/${h}`);

// status + job parsing
assert.equal(parseStatus('{"status":"Proven"}'), "Proven");
assert.equal(parseStatus("garbage"), "Unknown");
const r = parseJob('{"status":"Proven","verdict":0,"claimable_at":1782671027}');
assert.deepEqual(r, { status: "Proven", verdict: 0, claimableAt: 1782671027 });

console.log("escrow-client: all assertions passed");
