import { z } from "zod";
import { readFileSync } from "node:fs";
import { sha256Hex, randomJobIdHex } from "./escrow.js";
import {
  EscrowConfig, addrOf, getUsdcBalance, resolveContract, openJob, postEscrowJob, getReceipt, reclaimJob, explorerUrl,
} from "./escrow-client.js";

export type ToolSpec = {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
  handler: (args: any) => Promise<{ content: { type: "text"; text: string }[] }>;
};

const json = (obj: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] });

export function buildTools(cfg: EscrowConfig): ToolSpec[] {
  return [
    {
      name: "get_wallet",
      description: "Return the buyer agent's Stellar address and USDC balance on testnet.",
      inputSchema: {},
      handler: async () => {
        const address = await addrOf(cfg.buyerKey);
        const usdc_balance = await getUsdcBalance(cfg, address);
        return json({ address, usdc_balance, network: "testnet" });
      },
    },
    {
      name: "request_audit",
      description:
        "Audit a Soroban contract WASM before trusting it. Escrows USDC into the on-chain vault and submits the artifact to the auditor, which proves whether the contract is provably clean against the agreed import/capability policy (verdict 0). This is an import/capability check, NOT a general guarantee of correctness or absence of bugs. Returns a job_id; then poll check_receipt for the verdict and proof.",
      inputSchema: {
        contract: z.string().describe("'clean', 'denylisted', or a filesystem path to a .wasm"),
        expected_verdict: z.number().int().min(0).default(0).describe("verdict the buyer pins on-chain; 0 = clean"),
      },
      handler: async ({ contract, expected_verdict = 0 }) => {
        const path = resolveContract(cfg, contract);
        const wasm = readFileSync(path);
        const inputHashHex = sha256Hex(wasm);
        const jobIdHex = randomJobIdHex();
        const buyer = await addrOf(cfg.buyerKey);
        const seller = await addrOf(cfg.sellerKey);
        const { txHash } = await openJob(cfg, { jobIdHex, buyer, seller, inputHashHex, expectedVerdict: expected_verdict });
        await postEscrowJob(cfg, jobIdHex, wasm, expected_verdict);
        return json({
          job_id: jobIdHex,
          contract: path,
          input_hash: inputHashHex,
          amount_usdc: (Number(cfg.amount) / 1e7).toFixed(7),
          open_tx: txHash,
          open_tx_url: txHash ? explorerUrl(txHash) : undefined,
          note: "Escrow opened and artifact submitted. Poll check_receipt(job_id). Clean -> Proven, then the auditor auto-claims (Claimed). Dirty -> stays Open; after the reclaim deadline, call reclaim(job_id).",
        });
      },
    },
    {
      name: "check_receipt",
      description:
        "Check a job's on-chain status, verdict, and proof. Statuses: Open (auditing, or the auditor declined a non-clean contract), Proven (a clean proof landed and was verified on-chain), Claimed (auditor paid), Reclaimed (escrow refunded to the buyer).",
      inputSchema: { job_id: z.string().describe("the job_id from request_audit") },
      handler: async ({ job_id }) => {
        const r = await getReceipt(cfg, job_id);
        const hints: Record<string, string> = {
          Open: "Still auditing, or the auditor declined a contract that is not clean. Keep polling; if it stays Open past the reclaim deadline, call reclaim(job_id).",
          Proven: "A proof was verified on-chain: the contract is provably clean against the agreed import/capability policy (verdict 0). The auditor will auto-claim payment after the challenge window.",
          Claimed: "Done: clean proof + auditor paid. You may proceed to use this contract per the agreed import/capability policy (this is not a general safety guarantee).",
          Reclaimed: "Refunded: the contract was not proven clean; your escrow was returned. Do not use this contract.",
          Unknown: "Transient read from a load-balanced RPC node; poll again.",
        };
        return json({ job_id, status: r.status, verdict: r.verdict, hint: hints[r.status] });
      },
    },
    {
      name: "reclaim",
      description:
        "Reclaim (refund) the escrow for a job that was not proven clean, after its reclaim deadline has passed. Use when check_receipt has stayed Open (the auditor declined / no proof landed).",
      inputSchema: { job_id: z.string().describe("the job_id from request_audit") },
      handler: async ({ job_id }) => {
        const { txHash } = await reclaimJob(cfg, job_id);
        return json({
          job_id, status: "Reclaimed", reclaim_tx: txHash,
          reclaim_tx_url: txHash ? explorerUrl(txHash) : undefined,
          note: "Escrow refunded to the buyer.",
        });
      },
    },
  ];
}
