// One-command live escrow e2e against the verdict-enforced settle-core on testnet.
//
//   npm run escrow:run -- clean   # clean.wasm  -> seller proves -> claim   (USDC -> seller)
//   npm run escrow:run -- dirty   # denylisted   -> seller declines -> reclaim (USDC -> buyer)
//
// The buyer pins expected_verdict=0 in BOTH runs. The clean artifact scans to 0
// (== pinned) so the seller proves and gets paid; the dirty artifact scans to 2
// (!= pinned) so the seller declines and, after the reclaim deadline, the buyer
// gets refunded. This drives the *buyer + claim* side; the seller's
// scan->prove->submit_proof runs inside the proofreceipt-server you start
// separately.
import { readFileSync } from "node:fs";
import { openJobArgs, reclaimArgs, claimArgs, sha256Hex, randomJobIdHex } from "./escrow.js";
import { loadConfig, resolveContract, runStellar, addrOf, getReceipt, postEscrowJob } from "./escrow-client.js";

const cfg = loadConfig();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const net = { rpcUrl: cfg.rpcUrl, networkPassphrase: cfg.networkPassphrase };
const jobStatus = async (jobIdHex: string) => (await getReceipt(cfg, jobIdHex)).status;

async function main() {
  const mode = (process.argv[2] ?? "").toLowerCase();
  if (mode !== "clean" && mode !== "dirty") {
    console.error("usage: npm run escrow:run -- <clean|dirty> [wasmPath]");
    process.exit(2);
  }
  const wasmPath = process.argv[3] ?? resolveContract(cfg, mode);
  const wasm = readFileSync(wasmPath);
  const inputHashHex = sha256Hex(wasm);
  const jobIdHex = randomJobIdHex();
  const buyerAddr = await addrOf(cfg.buyerKey);
  const sellerAddr = await addrOf(cfg.sellerKey);

  console.log(`[e2e] mode=${mode}  artifact=${wasmPath} (${wasm.length}B)`);
  console.log(`[e2e] job_id=${jobIdHex}`);
  console.log(`[e2e] input_hash=${inputHashHex}`);
  console.log(`[e2e] contract=${cfg.contractId}  token(USDC)=${cfg.tokenId}  amount=${cfg.amount}`);
  console.log(`[e2e] buyer=${buyerAddr}  seller=${sellerAddr}`);
  console.log(`[e2e] pinning expected_verdict=0, reclaim_secs=${cfg.reclaimSecs}, challenge_secs=${cfg.challengeSecs}`);

  // 1. Buyer opens the job (escrows USDC, pins the verdict).
  await runStellar(openJobArgs({
    contractId: cfg.contractId, source: cfg.buyerKey, ...net,
    jobIdHex, buyer: buyerAddr, seller: sellerAddr, token: cfg.tokenId, amount: cfg.amount,
    inputHashHex, imageIdHex: cfg.imageId, expectedVerdict: 0, reclaimSecs: cfg.reclaimSecs, challengeSecs: cfg.challengeSecs,
  }));
  console.log(`[e2e] ✅ open_job — USDC escrowed, status=${await jobStatus(jobIdHex)}`);

  // 2. Hand the artifact to the seller runner.
  await postEscrowJob(cfg, jobIdHex, wasm, 0);
  console.log(`[e2e] ✅ handed artifact to seller (${cfg.serverUrl}/escrow-job, 202)`);

  if (mode === "clean") {
    // 3a. Seller scans 0 == pinned 0 -> proves (Groth16, ~1-3 min) -> submit_proof. Poll for Proven.
    console.log(`[e2e] waiting for the seller to prove + submit (Groth16 prove can take a few minutes)…`);
    let proven = false;
    for (let i = 0; i < 240; i++) { // ~20 min cap at 5s
      const st = await jobStatus(jobIdHex);
      if (st === "Proven") { proven = true; break; }
      if (st === "Claimed") { proven = true; break; }
      await sleep(5000);
    }
    if (!proven) throw new Error("timed out waiting for status=Proven — check the seller server logs (Docker/m0-host?)");
    console.log(`[e2e] ✅ submit_proof landed — status=Proven. Waiting out the ${cfg.challengeSecs}s challenge window…`);
    await sleep((cfg.challengeSecs + 5) * 1000);
    // Seller claims the escrow.
    await runStellar(claimArgs({ contractId: cfg.contractId, source: cfg.sellerKey, ...net, jobIdHex }));
    const final = await jobStatus(jobIdHex);
    console.log(`[e2e] ✅ CLEAN PATH DONE — status=${final} — USDC moved buyer → escrow → seller.`);
  } else {
    // 3b. Seller scans 2 != pinned 0 -> declines (no proof). After reclaim_secs the buyer refunds itself.
    console.log(`[e2e] seller should DECLINE (denylisted scans to verdict 2 != pinned 0). Waiting ${cfg.reclaimSecs}s for the reclaim deadline…`);
    await sleep((cfg.reclaimSecs + 5) * 1000);
    const before = await jobStatus(jobIdHex);
    // Only a definitive non-Open status means the seller acted; "Unknown" is a flaky read — proceed.
    if (["Proven", "Claimed", "Reclaimed"].includes(before)) throw new Error(`expected status=Open before reclaim, got ${before} (did the seller wrongly prove?)`);
    await runStellar(reclaimArgs({ contractId: cfg.contractId, source: cfg.buyerKey, ...net, jobIdHex }));
    const final = await jobStatus(jobIdHex);
    console.log(`[e2e] ✅ DIRTY PATH DONE — status=${final} — USDC refunded escrow → buyer.`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
