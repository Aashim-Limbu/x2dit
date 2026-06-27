# ProofReceipt M3 — Real Bounded Audit (Soroban Capability Policy)

**Date:** 2026-06-27
**Status:** Approved (design), pending implementation plan
**Builds on:** M2 (x402 audit service) + M1/M0 (journal binding + on-chain verify)
**Branch:** off `feat/proofreceipt-m2`

## Goal

Replace the stub guest (`verdict = nonempty ? 1 : 0`) with a **real, bounded, deterministic
security check** so the proof receipt attests that an actual audit ran on the buyer's exact
Soroban contract — not a placeholder. The check is a **capability-policy analysis of the
WASM import section**, chosen because it is genuinely useful AND small enough to prove in a
RISC Zero guest on a 15 GB box.

## What the buyer submits

The compiled **Soroban WASM bytecode** (`contract.wasm`) — the canonical, on-chain-deployed
artifact. (Rust source was rejected: auditing source needs a Rust parser inside the zkVM,
which blows the proving budget; and source ≠ what's deployed.)

## The check — WASM import-section capability policy

A Soroban WASM module declares an **import section**: a list of `(module, field)` pairs
naming the Stellar host functions it uses — i.e. its capabilities (storage, ledger, auth,
crypto, cross-contract calls, …). The guest:

1. `input_hash = sha256(wasm_bytes)` — the binding (unchanged from M1/M2).
2. **Parses only the import section** (a small, rigidly-structured list; the rest of the
   multi-KB module is hashed, not analyzed — so proving cost stays close to the stub).
3. Runs three checks against the imports, using a policy **baked into the guest**:
   - **Allowlist** — every imported host fn ∈ the approved set, else flag.
   - **Denylist** — no forbidden/deprecated host fn, else flag.
   - **Auth-presence** — if it imports any storage-**write** host fn, it must also import an
     **auth** host fn (writes-state-without-access-control is a classic bug class), else flag.
4. Commits `(input_hash, verdict)` — the **same 36-byte journal** as M1/M2.

### Verdict = findings bitmask (journal layout UNCHANGED)
`verdict: u32` is redefined from the stub into a findings bitmask:
- `verdict == 0` → clean (all checks passed)
- bit 0 → allowlist violation; bit 1 → denylist hit; bit 2 → auth-presence failure
- bits 3–31 reserved, always 0 in M3 (keeps the field a single `u32`; richer encodings are a
  future milestone, not this one)

Because `journal = input_hash(32) ‖ verdict(4 LE u32)` is byte-identical to M1/M2, **the
server, the on-chain verifier, the settle/receipt path, and the buyer's binding checks all
work untouched.** M3 is essentially a **guest-only change** plus a small buyer-side decoder.

### Policy is baked into the guest → `image_id` = the agreed policy
The allowlist/denylist/auth/storage sets are compile-time constants in the guest, so the
guest's `image_id` (program commitment) *is* the agreed policy. A buyer trusting a specific
`image_id` is trusting that exact policy; changing the policy yields a new `image_id` (a new
"agreed program"). No separate policy-commitment plumbing is needed.

## Policy contents (4 host-fn sets) + the one thing to pin

The checks need four sets of Soroban host-function imports:
- **Allowlist** — approved host fns (context, ledger, storage, map/vec/bytes, int, crypto,
  address, auth, call, …).
- **Denylist** — forbidden/deprecated host fns to flag.
- **Storage-write set** — host fns that mutate storage (`*_put`/`*_set`-style).
- **Auth set** — `require_auth`, `require_auth_for_args`.

**#1 PLAN TASK — pin the exact import names.** Soroban imports host functions under *terse*
module/field symbols (the env uses short names, not the literal `require_auth`), so the exact
`(module, field)` byte-strings MUST be pinned from the real Soroban host interface — by
compiling a tiny Soroban contract and dumping its WASM import section, cross-checked against
`soroban-env-common`'s host-function definitions. This is M3's analogue of the M2 x402-wire
pinning: nail the real names before writing the policy.

## Scope (YAGNI)

- **In:** import-section parser; the 3 policy checks; baked-in policy; verdict bitmask; a
  small buyer-side verdict decoder; test WASM fixtures.
- **Out / deferred:** function-body / control-flow analysis (a later milestone); runtime-
  configurable policy (the policy is baked in); any payment-gating on the verdict (M2 Option
  B keeps payment up front — the verdict is delivered, not a gate).

## No redeploy needed

The deployed RISC Zero verifier (`CCR6QRJJ…`) is **generic over `image_id`** — it verifies
any guest's Groth16 proof given `(seal, image_id, journal)`. So the new guest needs **no
contract/verifier redeploy**; only the new `image_id` flows into the server config and the
buyer's `AGREED_IMAGE_ID`. risc0 stays pinned to 3.0 (seal-selector compatibility).

## Testing

- **Import parser** — unit-tested against a real compiled Soroban contract's WASM (correct
  `(module, field)` extraction; rejects malformed modules gracefully).
- **Policy suite** — 4 fixture WASMs with asserted exact `verdict` bitmasks: (a) clean → 0;
  (b) a non-allowlisted import → bit 0; (c) a denylisted import → bit 1; (d) storage-write
  with no auth import → bit 2. Fixtures are minimal hand-built or compiled WASM modules.
- **End-to-end binding** — reuse the M0/M1/M2 path: prove on a fixture WASM → verdict bitmask
  in the journal → on-chain verify passes (existing verifier, new `image_id`) → buyer decodes
  the findings. (Live prove uses the M2 RUNBOOK; the guest stays tiny so proving cost is ~M2.)

## Files (anticipated)

- `proofreceipt-m0/methods/guest/src/main.rs` — MODIFY: WASM import parse + policy suite +
  verdict bitmask (replaces the stub). May add a small `no_std` WASM-import-parser module.
- `proofreceipt-m0/methods/guest/Cargo.toml` — MODIFY: a minimal `no_std` wasm-parser dep
  (e.g. `wasmparser` if it builds for the guest) OR a hand-rolled bounded parser (decided in
  the plan — a hand-rolled import-section reader avoids a heavy dep and keeps proving small).
- `proofreceipt-buyer/src/buyer.ts` — MODIFY: decode the `verdict` bitmask into named findings.
- Test fixtures: small `.wasm` files + a host/guest test harness.

## Open items for the plan

1. **Pin the exact Soroban host-fn import `(module, field)` names** (compile + dump a real
   contract; cross-check `soroban-env-common`). Defines all four policy sets.
2. **WASM import-section parser:** hand-rolled bounded `no_std` reader vs a crate — pick the
   one that builds for the RISC Zero guest and keeps proving cheap (lean hand-rolled).
3. **Fixture WASMs:** compile/handcraft the 4 test modules.
4. **Confirm proving cost** stays within budget on the box (guest still tiny; import parse is
   cheap) — measure a real prove on a representative WASM.
