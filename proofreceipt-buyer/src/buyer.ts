import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { verifyOnChain } from "./verify.js";
import { decodeVerdict } from "./verdict.js";

const SERVER = process.env.SERVER_URL ?? "http://127.0.0.1:8081";
const VERIFIER = process.env.VERIFIER_ID ?? "CCR6QRJJBEFKUDE4YXQ2L6VII6M6C57ENXXJ5A4HQWOO6PYKRP4KS4IU";
const AGREED_IMAGE_ID = process.env.AGREED_IMAGE_ID!; // hex, from a fresh proof.json
const SECRET = process.env.CLIENT_PRIVATE_KEY!;       // "S..." testnet secret (USDC funded)
const SELF_ADDR = process.env.CLIENT_PUBLIC_KEY!;     // "G..." (used as simulate source)

function hex(b: Uint8Array) { return Buffer.from(b).toString("hex"); }
function unhex(s: string) { return Uint8Array.from(Buffer.from(s, "hex")); }

async function main() {
  // Submit a real artifact: if argv[2] is a path to an existing file (e.g. a
  // compiled contract.wasm), audit its raw bytes; otherwise treat it as a UTF-8 string.
  const arg = process.argv[2] ?? "hello";
  const artifact = existsSync(arg) ? readFileSync(arg) : Buffer.from(arg, "utf8");
  const signer = createEd25519Signer(SECRET, "stellar:testnet");
  const client = new x402Client().register("stellar:*", new ExactStellarScheme(signer));
  const fetchWithPay = wrapFetchWithPayment(fetch, client);

  // 1. Pay + submit (method+body survive the 402 retry).
  const res = await fetchWithPay(`${SERVER}/audit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ artifact: artifact.toString("base64") }),
  });
  if (res.status !== 202) throw new Error(`expected 202, got ${res.status}: ${await res.text()}`);
  const { job_id } = (await res.json()) as { job_id: string };
  console.log(`[buyer] paid, job_id=${job_id}`);

  // 2. Poll (cap attempts so a stuck server doesn't hang forever; ~10 min at 2s).
  let receipt: any;
  for (let attempt = 0; ; attempt++) {
    if (attempt > 300) throw new Error("timed out waiting for the audit receipt");
    const r = await fetch(`${SERVER}/audit/${job_id}`);
    if (r.status === 200) {
      const j = await r.json();
      if (j.status === "done") { receipt = j; break; }
      if (j.status === "error") throw new Error(`audit error: ${j.error}`);
    }
    await new Promise((s) => setTimeout(s, 2000));
  }

  // 3. Three binding checks.
  // (a) program binding
  if (receipt.image_id !== AGREED_IMAGE_ID) throw new Error(`image_id mismatch: ${receipt.image_id}`);
  // (b) input binding — from the RAW journal, not a server-claimed verdict
  const journal = unhex(receipt.journal);
  const myInputHash = createHash("sha256").update(artifact).digest();
  if (hex(journal.slice(0, 32)) !== hex(myInputHash)) throw new Error("journal input_hash != sha256(my artifact)");
  const recomputedDigest = createHash("sha256").update(Buffer.from(journal)).digest();
  if (hex(recomputedDigest) !== receipt.journal_digest) throw new Error("journal_digest mismatch");
  // (c) proof validity on-chain
  const ok = await verifyOnChain(VERIFIER, SELF_ADDR, unhex(receipt.seal), unhex(receipt.image_id), recomputedDigest);
  if (!ok) throw new Error("on-chain verify rejected the proof");

  // Derive the verdict from the cryptographically-committed journal (last 4 bytes, LE),
  // not the server-reported field.
  const verdict = new DataView(journal.buffer, journal.byteOffset + 32, 4).getUint32(0, true);
  const findings = decodeVerdict(verdict);
  console.log(`[buyer] ✅ receipt verified: ran agreed program ${AGREED_IMAGE_ID.slice(0,8)}… on my exact ${artifact.length}-byte contract.`);
  if (findings.length === 0) {
    // NOTE: "no violations" is import-level only — see verdict.ts / the policy doc.
    // It does NOT assert the contract has no dangerous capability or that writes are auth-gated.
    console.log(`[buyer] audit verdict: 0 — no policy violations detected (import-level checks only)`);
  } else {
    console.log(`[buyer] audit verdict: ${verdict} — ${findings.length} finding(s):`);
    for (const f of findings) console.log(`  • ${f}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
