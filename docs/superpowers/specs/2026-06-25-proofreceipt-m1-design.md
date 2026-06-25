# ProofReceipt M1 — Settle-core + Journal Binding (Design Spec)

**Date:** 2026-06-25
**Status:** Approved (design), pending implementation plan
**Builds on:** M0 (RISC Zero prove→verify round-trip verified on Stellar testnet)

## Goal

Make the M0 pipeline into the smallest thing that is actually *ProofReceipt*: an
on-chain `settle()` that releases escrowed USDC to a seller (auditor) when a RISC
Zero proof shows **the agreed program** ran on **the buyer's exact input** and
produced a verdict. M1 is the verify-and-settle core with a timelock escrow. No
x402/HTTP flow, no on-chain dispute, no real audit logic yet.

## Scope

**In scope (M1):**
- A new Soroban contract `proofreceipt` (verify-then-act skeleton, forked in spirit
  from `bridge-pool`; NOT a modification of the bridge).
- Cross-contract call to the M0-deployed RISC Zero leaf verifier
  (`CCR6QRJJBEFKUDE4YXQ2L6VII6M6C57ENXXJ5A4HQWOO6PYKRP4KS4IU` on testnet).
- USDC escrow using the existing testnet USDC SAC (SEP-41 transfer).
- Upgraded guest that commits real journal fields `(input_hash, verdict)`.
- Tests, including the cross-layer byte-exactness guard.

**Out of scope (deferred):**
- x402 / async HTTP settlement flow → M2.
- On-chain dispute + arbiter resolution → M2 (challenge window ships in M1, but a
  dispute only *waits out* the window optimistically; there is no on-chain
  dispute/resolve call).
- Real bounded audit computation in the guest → M3.

## Decisions (resolved forks)

1. **M1 boundary:** settle-core + journal binding. Stub computation, real binding,
   buyer pre-funds escrow, no x402.
2. **Payment condition:** pay for *work done*, optimistic. A valid proof + input
   match makes the escrow claimable by the seller after a challenge window. The
   verdict is committed and emitted but does NOT gate payment.
3. **Dispute:** optimistic in M1. Timelock escrow only; dispute/arbiter mechanism
   specified-but-deferred to M2. (Rationale: the ZK proof already guarantees the
   agreed program ran on the exact input, so the only legitimate disputes are about
   off-chain report delivery and audit-program quality — neither solvable on-chain
   in M1.)
4. **Trust anchors:** the buyer pins BOTH `expected_image_id` (the agreed audit
   program) and `expected_input_hash` (their exact artifact) at `open_job`. Both
   are mandatory — missing either collapses the guarantee.

## Architecture

```
buyer ──open_job(escrow USDC + pin deal)──▶ proofreceipt contract
seller ─submit_proof(seal, verdict)──────────────▶ proofreceipt ──verify()──▶ risc0 leaf verifier (M0)
seller ─claim() after challenge window────────▶ proofreceipt ──SEP-41 transfer──▶ seller
```

- **proofreceipt** (new contract): owns job state + escrow; calls the verifier;
  moves USDC.
- **risc0 leaf verifier** (already deployed, M0): `verify(seal, image_id, journal)`
  where `journal = sha256(journal_bytes)`; traps on invalid proof.
- **USDC SAC** (existing testnet token): the escrowed asset.

## Job lifecycle

```
open_job(buyer)  →  submit_proof(seller)  →  claim(seller, after window)
```

1. **`open_job(job_id, seller, token, amount, expected_input_hash, expected_image_id, challenge_secs)`**
   — caller = buyer. Requires `job_id` unused. Transfers `amount` of `token` from
   buyer → contract. Stores `Job` with status `Open`.
2. **`submit_proof(job_id, seal, verdict)`** — caller = seller (auth).
   Requires status `Open`. Steps:
   - reconstruct `journal_bytes = job.expected_input_hash (32B) || verdict (4B LE)`
     — note the contract uses the buyer's *pinned* `expected_input_hash`, NOT a
     seller-supplied value.
   - `journal_digest = env.crypto().sha256(journal_bytes)`
   - call verifier `verify(seal, job.expected_image_id, journal_digest)` (traps if invalid)
   - set `job.verdict = verdict`, `job.claimable_at = now + challenge_secs`,
     status = `Proven`; emit `proven` event `(job_id, verdict, claimable_at)`.

   **Why no explicit input-hash check:** because the journal is reconstructed from
   the buyer's pinned `expected_input_hash`, `verify()` succeeds ONLY if the guest
   actually committed that exact hash — i.e. ran on the buyer's exact input. The
   binding is enforced by the proof itself; a separate `input_hash` argument and
   `== expected` assert would be redundant. Likewise `verdict` must equal what the
   guest committed, or the digest won't match and `verify()` traps.
3. **`claim(job_id)`** — caller = seller (auth). Requires status `Proven` and
   `now >= claimable_at`. Transfer `amount` → seller. Status = `Claimed`. Emit
   `claimed` event.

## State & storage

`Job` record keyed by `job_id: BytesN<32>` (buyer-chosen; random or hash of deal):

```rust
struct Job {
    buyer: Address,
    seller: Address,
    token: Address,            // USDC SAC
    amount: i128,
    expected_input_hash: BytesN<32>,
    expected_image_id: BytesN<32>,
    verdict: u32,              // set at submit_proof (0 before)
    claimable_at: u64,         // ledger timestamp; set at submit_proof (0 before)
    status: Status,            // Open | Proven | Claimed
}
```

**Replay / double-spend protection = the status enum** (not nullifiers). Each
transition is one-way: `open_job` needs job_id unused; `submit_proof` needs `Open`;
`claim` needs `Proven` + time. A proof cannot be replayed; funds cannot be
double-claimed.

## Journal format (byte-exact — load-bearing)

```
journal_bytes = input_hash (32 bytes) || verdict (4 bytes, little-endian u32)   // 36 bytes
journal_digest = sha256(journal_bytes)
```

- **Guest** commits `env::commit(&input_hash); env::commit(&verdict);`. risc0
  serializes `[u8;32]` as 32 raw bytes and `u32` as 4 LE bytes ⇒ on-chain
  reconstruction is a plain concat.
- **Contract** `submit_proof` rebuilds the identical 36 bytes — from the job's
  pinned `expected_input_hash` and the submitted `verdict` — and hashes them. If
  the serialization disagrees by one byte, `sha256` differs and `verify()` rejects.
  Guarded by a dedicated cross-layer test.

## Guest changes (stub computation, real binding)

The guest:
1. reads `input_bytes` (stand-in for the buyer's submitted artifact),
2. computes `input_hash = sha256(input_bytes)` **inside the guest**,
3. runs a stub "audit": `verdict = if input_bytes nonempty { 1 } else { 0 }`,
4. commits `(input_hash, verdict)`.

This makes the binding genuine — the proof attests the program saw this exact input
and produced this verdict — while the audit logic stays trivial. Real bounded audit
logic is M3.

The host (`m0-host` → generalized) writes `proof.json` with `seal`, `image_id`,
`input_hash`, `verdict`, `journal_digest` for the contract calls/tests.

## Testing

- **Unit (contract):** happy path open→submit→claim; reject wrong `image_id`; a
  proof bound to a *different* input fails `verify()` (the binding is enforced
  cryptographically, not by an explicit check); reject claim-before-window; reject
  double-claim; reject `submit_proof` on non-`Open`.
- **Cross-layer (critical):** host generates a real proof for a known input; assert
  the contract's reconstructed `journal_digest` == the host's; `submit_proof`
  accepts it. This is the byte-exactness guard.
- **Negative:** tampered seal / tampered verdict ⇒ `verify()` traps (validated in
  M0 via the negative-control on testnet).

## Placement & isolation

- New contract crate at `soroban/contracts/proofreceipt/` (sibling to
  `bridge-pool`, added to the soroban workspace). Bridge contracts/relayer/frontend
  remain untouched.
- Guest/host live in / extend the `proofreceipt-m0/` workspace.

## Open items for the implementation plan

- Exact `risc0-interface` client wiring from a Soroban contract (use
  `RiscZeroVerifierClient` against the leaf verifier address; `verify` traps on
  failure — call directly, no `try_`).
- USDC SAC address + a funded buyer/seller test identity selection for the testnet
  walkthrough.
- Whether `submit_proof` takes raw `seal: Bytes` via CLI hex (yes, as in M0).
