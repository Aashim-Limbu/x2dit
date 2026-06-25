# ProofReceipt M2 — x402 Async Audit Service (Design Spec)

**Date:** 2026-06-25
**Status:** Approved (design), pending implementation plan
**Builds on:** M1 (proof-gated escrow contract) and M0 (RISC Zero prove→verify on testnet)
**Branch:** off `feat/proofreceipt-m1` (M1 PR not yet merged)

## Goal

Put ProofReceipt on the **x402 agent-payment rail**: an AI-agent buyer pays a seller's
audit API over real x402, the audit runs asynchronously, and the buyer receives a
**ZK proof receipt** it can verify on-chain ("the agreed audit program ran on my exact
input"). Demonstrates the agent-payment story end-to-end.

## Settlement model (the defining decision)

**Option B — real x402, proof-as-receipt.** Payment settles **to the seller up front**
via the OpenZeppelin Channels facilitator (canonical x402); the ZK proof comes back as a
**verifiable receipt**, NOT a payment gate. This deliberately trades away M1's "pay only
if proof valid" property in exchange for true x402-rail compatibility and the strongest
agent-payment narrative. The M1 escrow contract is **unused** in this path.

(Rejected alternatives: 402-gated escrow — keeps proof-gating but isn't literal x402;
hybrid fee+escrow — most surface area.)

## Architecture

```
Buyer (TS agent, @x402/fetch)     Seller audit server (Rust/axum)   OZ Facilitator   Stellar
  POST /audit (artifact) ─────────▶
  ◀── 402 + payment requirements ──
  (x402 fetch auto-signs auth entries)
  POST /audit + X-PAYMENT ────────▶
                                    /verify then /settle ─────────▶  USDC → seller ▶
  ◀── 202 {job_id, poll_url} ──────  (synchronous, ~5s)
                                    [spawn m0-host on artifact — async, minutes]
  GET /audit/{job_id} (poll) ─────▶
  ◀── 200 {seal,image_id,journal,…}  ← proof receipt
  verify(seal,image_id,journal_digest) on deployed verifier ──────────────────────▶ ✓
```

### Components
- **Buyer agent** — a small TS script using `@x402/fetch` + `@x402/stellar` (the real
  client; emits a valid `X-PAYMENT`). Submits the artifact, polls for the receipt, then
  verifies it **on-chain** against the deployed RISC Zero verifier.
- **Audit server** — a NEW isolated Rust/axum crate `proofreceipt-server/` (NOT wedged
  into the bridge relayer). Borrows the relayer's `soroban.rs` invoke + TOML-config
  patterns. Modules:
  - `x402` — build the 402 challenge JSON; call the facilitator `/verify` then `/settle`
    (Bearer-auth HTTP) by hand.
  - `audit` — `POST /audit` and `GET /audit/{job_id}` handlers, an in-memory job store,
    and spawning the prover.
- **Prover** — shells out to the existing `m0-host` with the buyer's artifact bytes;
  produces `(seal, image_id, journal, journal_digest)`.
- **Verifier** — the already-deployed RISC Zero leaf verifier on testnet
  (`CCR6QRJJBEFKUDE4YXQ2L6VII6M6C57ENXXJ5A4HQWOO6PYKRP4KS4IU`), used read-only by the
  buyer to check the receipt.

## Flow & binding

1. Buyer `POST /audit` with the artifact bytes (the thing to audit). No payment yet.
2. Server → `402` + payment-requirements JSON (`scheme: exact`, price, `network`,
   `payTo` = seller `G...`). The challenge also **advertises the expected `image_id`**
   (the agreed audit program).
3. Buyer's x402 fetch signs Soroban auth entries, retries `POST /audit` with the
   `X-PAYMENT` header (+ artifact).
4. Server calls facilitator `/verify` (Bearer key); if valid, `/settle` → USDC moves to
   the seller (~5s). This is **synchronous** (auth entries expire ~1 min).
5. Server stores the artifact, computes `input_hash`, returns `202 {job_id, poll_url}`,
   and spawns `m0-host` on the artifact in the background.
6. Background: `m0-host` runs the guest on the artifact bytes → `seal`, `image_id`,
   `journal` (`input_hash ‖ verdict`), `journal_digest`. Stored against `job_id`.
7. Buyer `GET /audit/{job_id}`: `202 {status: pending}` until done, then `200` with the
   receipt fields.
8. Buyer verifies: asserts `receipt.image_id == agreed image_id`; reconstructs
   `journal_digest = sha256(sha256(my_artifact) ‖ verdict_le)`; calls the deployed
   verifier `verify(seal, image_id, journal_digest)`. A pass proves the agreed program
   ran on the buyer's exact bytes.

**The trust check is three things:** program binding (`image_id` matches the agreed one),
input binding (journal digest reconstructed from the buyer's own artifact), and proof
validity (on-chain `verify` passes).

## State & data

- **Job store:** in-memory map `job_id -> { status: Queued|Proving|Done|Failed, input_hash,
  receipt? }`. No persistence (demo scope).
- **Journal layout:** unchanged from M1 — `input_hash (32) ‖ verdict (4 LE u32)` = 36
  bytes, committed raw by the guest via `commit_slice`; `journal_digest = sha256(journal)`.
- **Config (TOML + env):** `OZ_API_KEY`, `FACILITATOR_URL`
  (default `https://channels.openzeppelin.com/x402/testnet`), `STELLAR_RECIPIENT`
  (seller `G...`, needs USDC trustline), `STELLAR_NETWORK` (`stellar:testnet`), price,
  the agreed `image_id`, `http_bind`, path to the `m0-host` binary.

## Scope (YAGNI)

- **In:** the x402 payment plumbing (by hand, Rust), the async job + poll, the prover
  spawn, the TS buyer agent, on-chain receipt verification.
- **Out / deferred:** real bounded audit logic (guest stays the stub
  `verdict = nonempty ? 1 : 0`) → M3. No escrow / dispute / refund (Option B settles up
  front). No persistent job store. No webhook callback (poll only).

## Testing

- **Unit (Rust server):** 402-challenge JSON matches the x402 `exact` spec; facilitator
  `/verify`+`/settle` request construction against a **mock facilitator** HTTP server (no
  live dependency); job-store transitions (Queued→Proving→Done); poll endpoint returns
  202-pending then 200-with-receipt; prover output parses into a receipt.
- **Binding test:** a foreign `image_id` or a `journal_digest` reconstructed from
  different bytes fails on-chain `verify()` (reuses M0 negative-control behavior).
- **Live e2e (testnet, manual):** real TS buyer pays via the real facilitator → server
  settles → `m0-host` proves → buyer polls → buyer verifies the receipt on-chain. Needs
  `OZ_API_KEY` + payer USDC + trustlines.

## Key risks / open items for the plan

1. **Exact x402 wire formats** — the 402 body, the `X-PAYMENT` encoding, and the
   facilitator `/verify`+`/settle` request/response JSON. The #1 task: pin these by
   inspecting `@x402/core` source + the facilitator API BEFORE writing the Rust calls.
   Mitigation: use the real TS client as the buyer and capture a real `X-PAYMENT` off the
   wire to validate server parsing.
2. **External live deps** for the e2e: facilitator availability + API key, payer USDC,
   trustlines. The mock-facilitator unit tests keep dev/CI independent of these.
3. **`m0-host` tweak:** accept arbitrary artifact input + a per-job output path
   (currently takes a string arg and writes a fixed `proof.json`). Minor.

## Placement & isolation

- New crate `proofreceipt-server/` (Rust/axum), sibling to `proofreceipt-m0/` and
  `proofreceipt-contract/`. Buyer agent is a separate TS package at sibling
  `proofreceipt-buyer/`. Bridge (`relayer/`, `soroban/`, `frontend/`, `vendor/`)
  untouched. M2 branches off `feat/proofreceipt-m1`.
