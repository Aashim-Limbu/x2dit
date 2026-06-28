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
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { openJobArgs, reclaimArgs, claimArgs, getJobArgs, sha256Hex, randomJobIdHex } from "./escrow.js";

const execFileP = promisify(execFile);

const CONTRACT_ID = process.env.SETTLE_CONTRACT_ID ?? "CCE46SRV3UVFTFJAMB4XSHCCCSZ4WRKDAM2SYSIB253AQ4WIGXLJD62U";
const TOKEN_ID = process.env.TOKEN_ID ?? "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"; // USDC SAC (7 decimals)
const IMAGE_ID = process.env.AGREED_IMAGE_ID ?? "ffc622e891883f70242e3dfea5ccb2b68b73136b30aed868f8f48242cc9eeddd";
const SERVER = process.env.SERVER_URL ?? "http://127.0.0.1:8081";
const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const PASSPHRASE = process.env.NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
const BUYER_KEY = process.env.BUYER_KEY ?? "e2e-buyer";   // stellar identity (or S-secret) that signs open_job/buyer_reclaim
const SELLER_KEY = process.env.SELLER_KEY ?? "e2e-seller"; // stellar identity that signs claim
const AMOUNT = process.env.AMOUNT ?? "100000";            // 0.01 USDC
const RECLAIM_SECS = Number(process.env.RECLAIM_SECS ?? 120);
const CHALLENGE_SECS = Number(process.env.CHALLENGE_SECS ?? 30);

const FIXTURES = "../proofreceipt-m0/methods/guest/wasm-policy/tests/fixtures";
const net = { rpcUrl: RPC_URL, networkPassphrase: PASSPHRASE };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run `stellar <args>`; echo its human output (tx hash + explorer link land on stderr) and return stdout. */
async function stellar(args: string[], label: string): Promise<string> {
  process.stderr.write(`\n[e2e] $ stellar ${args.join(" ")}\n`);
  try {
    const { stdout, stderr } = await execFileP("stellar", args, { maxBuffer: 16 * 1024 * 1024 });
    if (stderr.trim()) process.stderr.write(stderr);
    return stdout.trim();
  } catch (e: any) {
    throw new Error(`stellar ${label} failed: ${e.stderr || e.message}`);
  }
}

/** Resolve a `G...` address for a key: if it's already a G-address use it, else `stellar keys address <name>`. */
async function addrOf(key: string): Promise<string> {
  if (/^G[A-Z2-7]{55}$/.test(key)) return key;
  const { stdout } = await execFileP("stellar", ["keys", "address", key]);
  return stdout.trim();
}

// Read the job status. Testnet RPC (soroban-testnet.stellar.org) is load-balanced,
// so a lagging node can transiently return JobNotFound / a simulation error for an
// entry that demonstrably exists. Reads are idempotent, so retry a few times and
// fall back to "Unknown" (the poll loop keeps waiting) rather than aborting the run.
async function jobStatus(jobIdHex: string): Promise<string> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const out = await stellar(getJobArgs({ contractId: CONTRACT_ID, source: BUYER_KEY, ...net, jobIdHex }), "get_job");
      for (const s of ["Reclaimed", "Claimed", "Proven", "Open"]) if (out.includes(s)) return s;
      return out;
    } catch (e: any) {
      if (attempt === 4) {
        process.stderr.write(`[e2e] get_job read failed transiently (${String(e.message).split("\n")[0]}) — treating as Unknown, will retry\n`);
        return "Unknown";
      }
      await sleep(2000);
    }
  }
  return "Unknown";
}

async function main() {
  const mode = (process.argv[2] ?? "").toLowerCase();
  if (mode !== "clean" && mode !== "dirty") {
    console.error("usage: npm run escrow:run -- <clean|dirty> [wasmPath]");
    process.exit(2);
  }
  const wasmPath = process.argv[3] ?? `${FIXTURES}/${mode === "clean" ? "clean.wasm" : "denylisted.wasm"}`;
  const wasm = readFileSync(wasmPath);
  const inputHashHex = sha256Hex(wasm);
  const jobIdHex = randomJobIdHex();
  const buyerAddr = await addrOf(BUYER_KEY);
  const sellerAddr = await addrOf(SELLER_KEY);

  console.log(`[e2e] mode=${mode}  artifact=${wasmPath} (${wasm.length}B)`);
  console.log(`[e2e] job_id=${jobIdHex}`);
  console.log(`[e2e] input_hash=${inputHashHex}`);
  console.log(`[e2e] contract=${CONTRACT_ID}  token(USDC)=${TOKEN_ID}  amount=${AMOUNT}`);
  console.log(`[e2e] buyer=${buyerAddr}  seller=${sellerAddr}`);
  console.log(`[e2e] pinning expected_verdict=0, reclaim_secs=${RECLAIM_SECS}, challenge_secs=${CHALLENGE_SECS}`);

  // 1. Buyer opens the job (escrows USDC, pins the verdict).
  await stellar(openJobArgs({
    contractId: CONTRACT_ID, source: BUYER_KEY, ...net,
    jobIdHex, buyer: buyerAddr, seller: sellerAddr, token: TOKEN_ID, amount: AMOUNT,
    inputHashHex, imageIdHex: IMAGE_ID, expectedVerdict: 0, reclaimSecs: RECLAIM_SECS, challengeSecs: CHALLENGE_SECS,
  }), "open_job");
  console.log(`[e2e] ✅ open_job — USDC escrowed, status=${await jobStatus(jobIdHex)}`);

  // 2. Hand the artifact to the seller runner.
  const res = await fetch(`${SERVER}/escrow-job`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job_id_hex: jobIdHex, artifact_b64: wasm.toString("base64"), expected_verdict: 0 }),
  });
  if (res.status !== 202) throw new Error(`POST /escrow-job expected 202, got ${res.status}: ${await res.text()}`);
  console.log(`[e2e] ✅ handed artifact to seller (${SERVER}/escrow-job, 202)`);

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
    console.log(`[e2e] ✅ submit_proof landed — status=Proven. Waiting out the ${CHALLENGE_SECS}s challenge window…`);
    await sleep((CHALLENGE_SECS + 5) * 1000);
    // Seller claims the escrow.
    await stellar(claimArgs({ contractId: CONTRACT_ID, source: SELLER_KEY, ...net, jobIdHex }), "claim");
    const final = await jobStatus(jobIdHex);
    console.log(`[e2e] ✅ CLEAN PATH DONE — status=${final} — USDC moved buyer → escrow → seller.`);
  } else {
    // 3b. Seller scans 2 != pinned 0 -> declines (no proof). After reclaim_secs the buyer refunds itself.
    console.log(`[e2e] seller should DECLINE (denylisted scans to verdict 2 != pinned 0). Waiting ${RECLAIM_SECS}s for the reclaim deadline…`);
    await sleep((RECLAIM_SECS + 5) * 1000);
    const before = await jobStatus(jobIdHex);
    // Only a definitive non-Open status means the seller acted; "Unknown" is a flaky read — proceed.
    if (["Proven", "Claimed", "Reclaimed"].includes(before)) throw new Error(`expected status=Open before reclaim, got ${before} (did the seller wrongly prove?)`);
    await stellar(reclaimArgs({ contractId: CONTRACT_ID, source: BUYER_KEY, ...net, jobIdHex }), "buyer_reclaim");
    const final = await jobStatus(jobIdHex);
    console.log(`[e2e] ✅ DIRTY PATH DONE — status=${final} — USDC refunded escrow → buyer.`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
