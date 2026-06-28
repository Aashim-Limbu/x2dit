<div align="center">

# 🧾 ProofReceipt

**Verifiable receipts for the agent economy — an AI agent pays an API for expensive compute, and gets back a zero-knowledge proof that the paid work actually ran on its exact input.**

![network](https://img.shields.io/badge/network-testnet-3b82f6)
![proof](https://img.shields.io/badge/proof-RISC%20Zero%20Groth16-8b5cf6)
![chain](https://img.shields.io/badge/Stellar-Soroban%20P26-000000)
![rail](https://img.shields.io/badge/payments-x402%20v2-f97316)
![status](https://img.shields.io/badge/status-hackathon%20prototype-eab308)

[Overview](#overview) · [How it works](#how-it-works) · [Live deployment](#live-deployment) · [Getting started](#getting-started) · [Status](#status--roadmap)

</div>

When a machine pays a machine for work it can't see, the receipt has to be a **proof, not a promise**. ProofReceipt is a Stellar-native settlement primitive for the agent economy: a seller runs an agreed, bounded computation inside a [RISC Zero](https://risczero.com/) zkVM and returns a Groth16 proof that is verified **on Soroban**. The proof commits to the hash of the buyer's exact input, so "valid proof" means *the seller ran the agreed program on the bytes you sent* — checkable on-chain by anyone, trusting no operator.

> [!WARNING]
> Demo / hackathon project on **unaudited** reference code (including an unaudited RISC Zero Soroban verifier). **Testnet only — never framed as moving real funds.** The proof guarantees **integrity** ("this exact program ran on these exact bytes") but not confidentiality — the artifact and verdict are public.

## Overview

In an agentic API economy, a buyer agent pays a seller for compute it fundamentally can't observe — a security audit, a risk score, a model run. Today that trust is social: you pay, and you hope the seller actually did the work on your input rather than returning a cached or fabricated answer.

ProofReceipt closes that gap with a single idea: **the journal of the proof binds the buyer's input.** The seller's zkVM program commits `sha256(input) ‖ verdict`; the on-chain verifier only accepts a proof whose journal matches the agreed image id and the buyer's pinned input hash. A passing verification is therefore unforgeable evidence that *this exact program ran on this exact input*. Verification becomes the receipt.

The audit guest runs a real **WASM capability-policy audit**: it parses the import section of a Soroban contract WASM and evaluates a bitmask verdict — `0` = clean, bit 0 = allowlist violation, bit 1 = denylist hit, bit 2 = an auth host function is imported. Malformed WASM fails closed (no proof is produced). Live results: `clean.wasm` → verdict 0; `denylisted.wasm` → verdict 2. This is an import-level check — it attests which host functions a contract imports, not which code paths are actually reached at runtime.

The cryptographic core — RISC Zero proving locally, the Groth16 seal verified on Soroban via the BN254 host functions (CAP-0074/0075, Protocol 25/26) — is **live on Stellar testnet**.

## How it works

ProofReceipt ships **two settlement models** over the same proof core. Pick the one your rail needs.

### 1. Settle-core — *verification is settlement* (escrow)

A Soroban contract escrows the buyer's USDC and releases it **only** when a valid proof lands.

```
open_job ──▶ submit_proof ──▶ claim
(buyer escrows USDC,   (seller posts seal; contract     (seller withdraws after
 pins input_hash +      reconstructs journal from the    the challenge window —
 image_id +             pinned input_hash + verdict,     one-way Open▸Proven▸Claimed
 challenge window)      then verify() on-chain or trap)  guards replay)
```

The seller can submit but can never fake the work: `submit_proof` rebuilds the journal digest from the buyer's pinned `expected_input_hash` and calls the RISC Zero verifier, which **traps** unless the seal proves exactly that journal under the agreed image id.

### 2. x402 receipt — *pay on the rail, prove the work* (Option B)

Settles over real [x402](https://x402.org/) so it drops into existing agent-payment tooling: the buyer pays the seller **up front** via the OpenZeppelin Channels facilitator, and the proof is a verifiable **receipt** rather than a payment gate.

```
POST /audit ─(no payment)─▶ 402 + PAYMENT-REQUIRED
POST /audit ─(PAYMENT-SIGNATURE)─▶ facilitator verify + settle ─▶ 202 {job_id} + PAYMENT-RESPONSE
                                          │
                                          └─▶ spawn RISC Zero prover (async)
GET  /audit/{job_id} ─▶ poll ─▶ receipt { seal, image_id, journal_digest, verdict }
buyer ─▶ simulateTransaction verify(seal, image_id, journal_digest) on the deployed verifier (read-only)
```

The buyer independently re-verifies the receipt against the on-chain verifier with a read-only `simulateTransaction` — no signing, no second payment — and checks that the image id and input hash are the ones it agreed to.

## Features

- **Real WASM capability-policy audit.** The M3 guest parses the import section of any Soroban contract WASM and evaluates a bitmask verdict (0 = clean; bit 0 = allowlist violation; bit 1 = denylist hit; bit 2 = an auth host fn is imported). Malformed WASM fails closed. Live: `clean.wasm` → 0, `denylisted.wasm` → 2.
- **The receipt is a proof.** A passing on-chain verification is unforgeable evidence the seller ran the agreed program on the buyer's exact input — not an operator's attestation.
- **Input-bound journals.** The zkVM commits `sha256(wasm_bytes)(32 bytes) ‖ verdict(4-byte LE u32)` = 36 bytes total; the contract reconstructs the journal from the buyer's pinned hash, so a valid seal can't be replayed against different input.
- **Verification on Stellar.** The Groth16 seal is checked on Soroban via the native BN254 host functions (Protocol 25/26) using the [NethermindEth RISC Zero verifier](https://github.com/NethermindEth/stellar-risc0-verifier).
- **Two rails, one core.** Escrow ("verification is settlement") and real-x402 ("proof-as-receipt") share the same prover, guest, and on-chain verifier.
- **x402 v2, by hand.** The audit server speaks the x402 v2 wire protocol directly (`PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE`), settling USDC through the OZ Channels facilitator with fee sponsorship.
- **Settle before prove.** Payment is verified and settled synchronously *before* the slow proving job is spawned, so there's no free-work path and the receipt always corresponds to a paid request.

## Live deployment

Deployed to Stellar testnet. The verdict-enforced escrow below (M4 — `open_job` pins the buyer's expected verdict, adds `buyer_reclaim`) has completed **both** live round trips on-chain with real Groth16 seals: a clean contract → proof verified → `claim` (USDC → seller, job `efb330a5…`, proof tx `4cebe3ac…`), and a denylisted contract → auditor declines → `buyer_reclaim` (USDC → buyer, job `ec6dceb9…`, reclaim tx `7506ae82…`).

| Contract | ID |
|---|---|
| RISC Zero verifier (Groth16 leaf, NethermindEth) | [`CCR6QRJJ…S4IU`](https://stellar.expert/explorer/testnet/contract/CCR6QRJJBEFKUDE4YXQ2L6VII6M6C57ENXXJ5A4HQWOO6PYKRP4KS4IU) |
| ProofReceipt settle-core (verdict-enforced escrow, M4) | [`CCE46SRV…D62U`](https://stellar.expert/explorer/testnet/contract/CCE46SRV3UVFTFJAMB4XSHCCCSZ4WRKDAM2SYSIB253AQ4WIGXLJD62U) |
| USDC (SEP-41 SAC, 7 decimals) | [`CBIELTK6…DAMA`](https://stellar.expert/explorer/testnet/contract/CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA) |

x402 facilitator: [`channels.openzeppelin.com/x402/testnet`](https://channels.openzeppelin.com/x402/testnet) (free Bearer key from `/testnet/gen`).

> [!IMPORTANT]
> Local RISC Zero proving needs **x86_64 + ~16 GB RAM** and `r0vm` 3.0.5 (via [`rzup`](https://dev.risczero.com/api/zkvm/install)). The proof's seal selector must match the deployed verifier's embedded version (parameters.json `3.0.0`), so the prover must use `risc0-zkvm = "^3.0"`.

## Getting started

You'll need Rust + the [Stellar CLI](https://developers.stellar.org/docs/tools/cli) (`soroban-sdk` 25, `wasm32v1-none` target), the RISC Zero toolchain ([`rzup`](https://dev.risczero.com/api/zkvm/install)), and Node.js 20+ for the buyer.

```sh
# Settle-core Soroban contract — 14 tests (mock verifier): verdict-pinned escrow + buyer_reclaim
cargo test --manifest-path proofreceipt-contract/contract/Cargo.toml

# x402 audit server + seller escrow runner — 15 unit + 2 wire-fixture round-trip tests
cargo test --manifest-path proofreceipt-server/Cargo.toml

# RISC Zero M0 — prove → verify round-trip (produces proof.json with seal/image_id/journal)
cargo run --release --manifest-path proofreceipt-m0/Cargo.toml -p m0-host -- --input <bytes> --out proof.json
```

End-to-end x402 demo (real USDC on testnet):

```sh
# 1. Build the prover, fund a buyer USDC trustline (faucet.circle.com), grab a facilitator key.
cargo build --release --manifest-path proofreceipt-m0/Cargo.toml

# 2. Configure and run the seller's audit service.
cp proofreceipt-server/proofreceipt-server.example.toml proofreceipt-server/proofreceipt-server.toml
#   fill pay_to, oz_api_key, image_id, m0_host_path
cargo run --release --manifest-path proofreceipt-server/Cargo.toml -- proofreceipt-server/proofreceipt-server.toml

# 3. Run the buyer: pay over x402, poll for the receipt, re-verify it on-chain.
#    Pass the path to a real .wasm file as the artifact to audit.
cd proofreceipt-buyer && npm install && npm run buyer -- ../proofreceipt-m0/methods/guest/wasm-policy/tests/fixtures/clean.wasm
```

Verdict-enforced escrow e2e (real USDC on testnet) — the buyer pins `expected_verdict=0`, so a **provably-clean** artifact pays the seller and a **dirty** one is refunded to the buyer:

```sh
# 1. Build the prover + start the seller (which now also runs the escrow worker).
cargo build --release --manifest-path proofreceipt-m0/Cargo.toml
cargo run   --release --manifest-path proofreceipt-server/Cargo.toml -- proofreceipt-server/proofreceipt-server.toml   # needs settle_contract_id + seller_key in the toml

# 2. Fund the buyer with testnet USDC (faucet.circle.com → Stellar testnet) + a USDC trustline.
# 3. Drive both paths (resolves buyer/seller from the e2e-buyer / e2e-seller identities):
cd proofreceipt-buyer && ./run-escrow-e2e.sh both
#   clean → open_job → seller proves → claim   (USDC → seller)
#   dirty → open_job → seller declines → buyer_reclaim after the deadline (USDC → buyer)
#   tx hashes + explorer links print in the output. Override e.g. RECLAIM_SECS=60 BUYER_KEY=… for a faster/custom run.
```

> [!NOTE]
> The contract crate builds for `wasm32v1-none` and uses the `risc0-interface` mock verifier in tests; the audit server is a standalone Cargo workspace. The OZ Channels payment authorization expires in ~60 s, so the server settles **before** spawning the prover.

## Status & roadmap

| Milestone | Status |
|---|---|
| **M0** — RISC Zero guest/host, prove → verify round-trip on testnet | **Done · live** |
| **M1** — settle-core escrow contract (`open_job` / `submit_proof` / `claim`) | **Done · live e2e, 10/10 tests** |
| **M2** — x402 v2 audit server + buyer, proof-as-receipt | **Done · merge-ready, 14 tests** *(human-gated live USDC run pending)* |
| **M3** — real bounded WASM capability-policy audit guest (import-section scan → bitmask verdict) | **Done · live on testnet** |

The complete ProofReceipt stack is demonstrated end-to-end on testnet: on-chain Groth16 verification, escrow settlement, x402 real-USDC payment, and real WASM capability-policy audit. A buyer-side refund/dispute path for the x402 model remains out of scope for this prototype.

## Repository structure

| Path | Contents |
|---|---|
| `proofreceipt-m0/` | RISC Zero guest + `m0-host` prover; prove→verify round-trip, deploy/verify scripts |
| `proofreceipt-contract/` | Soroban settle-core escrow contract (`open_job` / `submit_proof` / `claim`) + tests |
| `proofreceipt-server/` | Rust/axum x402 v2 audit service (402 challenge, facilitator verify/settle, async proving) |
| `proofreceipt-buyer/` | TypeScript x402 client — pays, polls for the receipt, re-verifies it on-chain |

> [!NOTE]
> This repo also contains an earlier Stellar Hacks: ZK project — a **private cross-chain bridge** (`evm-tree/`, `circuits/`, `relayer/`, `soroban/`) that deposits on Ethereum Sepolia and withdraws privately on Stellar via a Groth16/BN254 proof. ProofReceipt reuses that on-chain BN254 verification experience; the bridge is prior work, not part of the ProofReceipt build.
</content>
</invoke>
