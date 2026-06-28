import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { openJobArgs, reclaimArgs, getJobArgs } from "./escrow.js";

const execFileP = promisify(execFile);

export type JobStatus = "Open" | "Proven" | "Claimed" | "Reclaimed" | "Unknown";
export type Receipt = { status: JobStatus; verdict?: number; claimableAt?: number };

export type EscrowConfig = {
  contractId: string; tokenId: string; imageId: string; serverUrl: string;
  rpcUrl: string; networkPassphrase: string; buyerKey: string; sellerKey: string;
  amount: string; reclaimSecs: number; challengeSecs: number; fixturesDir: string;
};

export function loadConfig(): EscrowConfig {
  return {
    contractId: process.env.SETTLE_CONTRACT_ID ?? "CCE46SRV3UVFTFJAMB4XSHCCCSZ4WRKDAM2SYSIB253AQ4WIGXLJD62U",
    tokenId: process.env.TOKEN_ID ?? "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    imageId: process.env.AGREED_IMAGE_ID ?? "ffc622e891883f70242e3dfea5ccb2b68b73136b30aed868f8f48242cc9eeddd",
    serverUrl: process.env.SERVER_URL ?? "http://127.0.0.1:8081",
    rpcUrl: process.env.RPC_URL ?? "https://soroban-testnet.stellar.org",
    networkPassphrase: process.env.NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015",
    buyerKey: process.env.BUYER_KEY ?? "e2e-buyer",
    sellerKey: process.env.SELLER_KEY ?? "e2e-seller",
    amount: process.env.AMOUNT ?? "100000",
    reclaimSecs: Number(process.env.RECLAIM_SECS ?? 120),
    challengeSecs: Number(process.env.CHALLENGE_SECS ?? 30),
    fixturesDir: process.env.FIXTURES_DIR ?? resolve(import.meta.dirname, "../../proofreceipt-m0/methods/guest/wasm-policy/tests/fixtures"),
  };
}

const NAMED: Record<string, string> = { clean: "clean.wasm", denylisted: "denylisted.wasm", dirty: "denylisted.wasm" };
export function resolveContract(cfg: EscrowConfig, nameOrPath: string): string {
  const named = NAMED[nameOrPath];
  return named ? resolve(cfg.fixturesDir, named) : resolve(nameOrPath);
}

export function extractTxHash(s: string): string | undefined {
  const m = s.match(/explorer\/testnet\/tx\/([0-9a-f]{64})/i) ?? s.match(/Signing transaction:\s*([0-9a-f]{64})/i);
  return m?.[1];
}
export function explorerUrl(txHash: string): string {
  return `https://stellar.expert/explorer/testnet/tx/${txHash}`;
}

export function parseStatus(getJobStdout: string): JobStatus {
  for (const s of ["Reclaimed", "Claimed", "Proven", "Open"] as const) if (getJobStdout.includes(s)) return s;
  return "Unknown";
}
export function parseJob(getJobStdout: string): Receipt {
  const verdict = getJobStdout.match(/"verdict":(\d+)/);
  const claimable = getJobStdout.match(/"claimable_at":(\d+)/);
  return {
    status: parseStatus(getJobStdout),
    verdict: verdict ? Number(verdict[1]) : undefined,
    claimableAt: claimable ? Number(claimable[1]) : undefined,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runStellar(args: string[], opts: { quiet?: boolean } = {}): Promise<{ stdout: string; stderr: string; txHash?: string }> {
  try {
    const { stdout, stderr } = await execFileP("stellar", args, { maxBuffer: 16 * 1024 * 1024 });
    if (!opts.quiet && stderr.trim()) process.stderr.write(stderr);
    return { stdout: stdout.trim(), stderr, txHash: extractTxHash(stderr + stdout) };
  } catch (e: any) {
    throw new Error(`stellar ${args[0] ?? ""} ${args[1] ?? ""} failed: ${e.stderr || e.message}`);
  }
}

export async function addrOf(key: string): Promise<string> {
  if (/^G[A-Z2-7]{55}$/.test(key)) return key;
  const { stdout } = await execFileP("stellar", ["keys", "address", key]);
  return stdout.trim();
}

function netArgs(cfg: EscrowConfig) {
  return { rpcUrl: cfg.rpcUrl, networkPassphrase: cfg.networkPassphrase };
}

export async function getUsdcBalance(cfg: EscrowConfig, addr: string): Promise<string> {
  try {
    const { stdout } = await runStellar(
      ["contract", "invoke", "--id", cfg.tokenId, "--source", cfg.buyerKey,
        "--rpc-url", cfg.rpcUrl, "--network-passphrase", cfg.networkPassphrase, "--", "balance", "--id", addr],
      { quiet: true },
    );
    const base = Number(stdout.replace(/"/g, "").trim());
    return Number.isFinite(base) ? (base / 1e7).toFixed(7) : "unknown";
  } catch {
    return "unknown";
  }
}

export async function getReceipt(cfg: EscrowConfig, jobIdHex: string): Promise<Receipt> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const { stdout } = await runStellar(getJobArgs({ contractId: cfg.contractId, source: cfg.buyerKey, ...netArgs(cfg), jobIdHex }), { quiet: true });
      return parseJob(stdout);
    } catch {
      if (attempt === 4) return { status: "Unknown" };
      await sleep(2000);
    }
  }
  return { status: "Unknown" };
}

export async function openJob(
  cfg: EscrowConfig,
  p: { jobIdHex: string; buyer: string; seller: string; inputHashHex: string; expectedVerdict: number },
): Promise<{ txHash?: string }> {
  const r = await runStellar(openJobArgs({
    contractId: cfg.contractId, source: cfg.buyerKey, ...netArgs(cfg),
    jobIdHex: p.jobIdHex, buyer: p.buyer, seller: p.seller, token: cfg.tokenId, amount: cfg.amount,
    inputHashHex: p.inputHashHex, imageIdHex: cfg.imageId, expectedVerdict: p.expectedVerdict,
    reclaimSecs: cfg.reclaimSecs, challengeSecs: cfg.challengeSecs,
  }));
  return { txHash: r.txHash };
}

export async function reclaimJob(cfg: EscrowConfig, jobIdHex: string): Promise<{ txHash?: string }> {
  const r = await runStellar(reclaimArgs({ contractId: cfg.contractId, source: cfg.buyerKey, ...netArgs(cfg), jobIdHex }));
  return { txHash: r.txHash };
}

export async function postEscrowJob(cfg: EscrowConfig, jobIdHex: string, wasm: Uint8Array, expectedVerdict: number): Promise<void> {
  const res = await fetch(`${cfg.serverUrl}/escrow-job`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job_id_hex: jobIdHex, artifact_b64: Buffer.from(wasm).toString("base64"), expected_verdict: expectedVerdict }),
  });
  if (res.status !== 202) throw new Error(`POST /escrow-job expected 202, got ${res.status}: ${await res.text()}`);
}
