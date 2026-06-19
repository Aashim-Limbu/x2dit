<div align="center">

# 🎩 zk-houdini

**A private cross-chain bridge — lock on EVM Sepolia, reappear privately on Stellar via a zero-knowledge proof.**

![network](https://img.shields.io/badge/network-testnet-3b82f6)
![proof](https://img.shields.io/badge/proof-Groth16%2FBN254-8b5cf6)
![chain](https://img.shields.io/badge/Stellar-Soroban%20P26-000000)
![circuit](https://img.shields.io/badge/circuit-circom%202.2-f97316)
![status](https://img.shields.io/badge/status-hackathon%20prototype-eab308)

[Overview](#overview) · [Architecture](docs/ARCHITECTURE.md) · [ZK design](docs/ZK-DESIGN.md) · [Live deployment](#live-deployment) · [Getting started](#getting-started)

</div>

Deposit test-USDC into a shielded pool on Ethereum Sepolia, then withdraw a bridged asset on Stellar by proving in zero-knowledge that you own an unspent deposit — **without revealing which one**. Sender, recipient, amount, and the deposit↔withdrawal link stay hidden, even from the relayers. Built for the **Stellar Hacks: ZK** hackathon, with the Groth16/BN254 proof verified **on Soroban** (on-theme).

> [!WARNING]
> Demo / hackathon project on **unaudited** reference code. **Testnet only — never framed as securing real funds.** Privacy is trustless (zero-knowledge); backing/solvency relies on a single 1-of-1 relayer key — a documented limitation, not a finished trust model.

## Status at a glance

The cryptographic core is **done and deployed to live testnets**; the operator services and UI that would make it one-click are **not built yet**.

| Layer | Status |
|---|---|
| Keystone — Poseidon2-BN254 parity across circom + Solidity + Rust | Done |
| EVM contracts (deposit + Merkle tree + MockUSDC) | Done · deployed & verified on Sepolia |
| Withdraw circuit + Groth16 trusted setup | Done (`snarkjs groth16 verify` → OK) |
| Soroban verifier + pool + zUSDC SAC | Done · deployed to Stellar testnet |
| Relayer (Poseidon2, Merkle path, EVM reader, Soroban invoke, CLI) | Partial |
| Backing daemon · withdrawal HTTP server · e2e harness | Not built |
| Frontend (deposit/withdraw UI + in-browser proving) | Not started |

> [!NOTE]
> The full deposit→withdraw flow is **not yet runnable end-to-end** — the relayer's backing daemon and `/path` + `/withdraw` HTTP endpoints, and the frontend, are still to come. In a fresh demo the anonymity set is 1 per denomination, so privacy is mechanism-only until a tree is populated. The recipient also needs a zUSDC trustline to receive the mint.

## Overview

Ordinary cross-chain transfers are fully transparent: the source-chain lock, the destination-chain release, the amount, and both addresses are public, so anyone can link "who sent how much to whom" across both chains. Even bridges with off-chain validators leak plaintext, because the validators attest to the message contents.

zk-houdini moves value EVM → Stellar through a **shielded pool**, in three steps:

1. **Deposit** — lock test-USDC (MockUSDC, 6 decimals) on Sepolia in a fixed **denomination** (1 / 10 / 100). A Poseidon2 **commitment** is inserted into an on-chain incremental Merkle tree (one tree per denomination, depth 20, 30-root ring buffer).
2. **Backing** — a trusted **Backing Relayer** (1-of-1 for the MVP) watches Sepolia root events and anchors a recent EVM Merkle root into the Soroban pool's **Root Window**.
3. **Withdraw** — the user, via a **Withdrawal Relayer** (so the recipient stays unlinkable), submits a Groth16/BN254 proof of Merkle membership under an accepted root plus a **nullifier hash** that prevents double-withdrawal. The Soroban pool verifies the proof, records the nullifier, and mints bridged zUSDC (a Stellar Asset Contract) to the recipient.

## Features

- **Trustless privacy** — sender, recipient, amount, and the deposit↔withdrawal link are hidden from everyone, including the relayers; enforced by an on-chain ZK proof, not an operator's promise.
- **Verification on Stellar** — the withdrawal Groth16/BN254 proof is checked on Soroban via the BN254 host functions (CAP-0074/0075, Protocol 25/26), using `soroban-sdk` 26.
- **One hash everywhere** — a single Poseidon2-BN254 instantiation is byte-identical across circom, Solidity, and Rust; Soroban itself computes no Poseidon.
- **EVM as source of truth** — the authoritative commitment tree lives on-chain on Sepolia; the Soroban side only mirrors a rolling window of recent roots.
- **Unlinkable withdrawals** — a nullifier set blocks double-spends and the recipient is bound in-circuit, so a relayer can submit but can never redirect funds.
- **Multi-denomination** — fixed 1 / 10 / 100 denominations, each its own independent anonymity set.

## Architecture

```
EVM — Sepolia (public)            off-chain                 Stellar — Soroban (private/ZK)
  deposit(denom, commitment)  ──▶  Backing Relayer  ──▶  Pool.update_root  ──▶  Root Window (30)
  (lock + Merkle insert)           (trusted: solvency)     (relayer-gated)
                                   Withdrawal Relayer ─▶  Pool.withdraw(proof, …)
  user builds Groth16 proof  ──▶   (trusted: liveness)     • known root? • nullifier unused?
  off-chain (membership +                                  • Verifier.verify ─BN254─▶ Groth16 Verifier
   nullifier; recipient bound)                             • mint zUSDC SAC → recipient
```

Two relayers with **different trust**: privacy is trustless (ZK); only backing/solvency trusts a single key. See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the full component breakdown, the detailed flow diagram, the Root Window / nullifier mechanics, and the complete trust model — and **[docs/ZK-DESIGN.md](docs/ZK-DESIGN.md)** for the circuit, the Poseidon2 keystone, and the BN254 rationale.

## Live deployment

Deployed 2026-06-19 to public testnets. EVM contracts are verified on Etherscan.

**EVM — Ethereum Sepolia** (chainId 11155111)

| Contract | Address |
|---|---|
| Poseidon2 (t=2 hasher) | [`0x1d67b9…85c8`](https://sepolia.etherscan.io/address/0x1d67b922dfed90ab36e267c65cd649977a9385c8) |
| MockUSDC (mUSDC, open faucet) | [`0x1a39a0…6ab5`](https://sepolia.etherscan.io/address/0x1a39a02a3a776b354a5c97373dde715c419c6ab5) |
| PrivacyPoolDeposit (block 11089276) | [`0x4c7817…e7ef`](https://sepolia.etherscan.io/address/0x4c781728f3f53f220c6f226610cd24d8b1e8e7ef) |

**Soroban — Stellar testnet**

| Contract | ID |
|---|---|
| Groth16 Verifier (bridge VK, nPublic=4) | [`CBXA7364…ZGFH`](https://stellar.expert/explorer/testnet/contract/CBXA7364AEVDQV2Z4CW7IUYSHO7JTETPUR6Y5FET2QAC5GWTNPN3ZGFH) |
| Bridge Pool | [`CDFQ5K2B…HR2`](https://stellar.expert/explorer/testnet/contract/CDFQ5K2BPKB7BWNW2SJPGIIK5OOFQIR434MOX5YYBDKAN3M5CFVJKHR2) |
| zUSDC SAC (admin → pool) | [`CAIUOHVZ…FBRU`](https://stellar.expert/explorer/testnet/contract/CAIUOHVZ77RSCDBNWR3BCZPTWHPUXQRTQXSW4VE3HGC2M5PRPJNSFBRU) |

Full address list (incl. per-denomination trees, key holders, RPC/passphrase) is in [`deployments/testnet.env`](deployments/testnet.env) and [`evm-tree/DEPLOYMENTS.md`](evm-tree/DEPLOYMENTS.md).

> [!IMPORTANT]
> Use verifier `CBXA7364…ZGFH` — it embeds the **bridge withdraw VK (`nPublic=4`)**. An earlier M0 spike verifier (`CA3DEXAK…`) embeds the wrong upstream policy VK (`nPublic=11`) and must **not** be used for the bridge.

## Getting started

There is no end-to-end app to run yet, but every built component compiles and tests green. You'll need [Foundry](https://book.getfoundry.sh/), Rust + the [Stellar CLI](https://developers.stellar.org/docs/tools/cli) (`soroban-sdk` 26, `wasm32v1-none` target), [circom](https://docs.circom.io/) 2.2, and [snarkjs](https://github.com/iden3/snarkjs).

```sh
# EVM contracts — 19 tests
cd evm-tree && forge test

# Relayer (Rust) — 8 tests
cargo test --manifest-path relayer/Cargo.toml

# Soroban verifier + pool — 14 tests (9 pool + 5 verifier)
# run from the vendored workspace with the bridge VK exported
cd vendor/stellar-private-payments
VERIFIER_VK_JSON="$(git rev-parse --show-toplevel)/circuits/build/verification_key.json" \
  cargo test -p bridge-pool -p circom-groth16-verifier

# Circuit — verify the real proof
snarkjs groth16 verify \
  circuits/build/verification_key.json \
  circuits/build/public.json \
  circuits/build/proof.json    # → snarkJS: OK!
```

> [!NOTE]
> Soroban builds **require** an absolute `VERIFIER_VK_JSON`. The verifier crate's `build.rs` reads it, and the `.cargo/config.toml` default points at a non-existent path — so an unset/default build fails with a "failed to read VK file" panic. The contracts only build inside `vendor/stellar-private-payments/` (the top-level `soroban/` dir is a non-buildable copy). For the Stellar CLI, pass `--rpc-url https://soroban-testnet.stellar.org --network-passphrase "Test SDF Network ; September 2015"` explicitly.

## Project status & roadmap

| Milestone | Status |
|---|---|
| M0 spike / Poseidon2 keystone | **Done** |
| M1 EVM contracts | **Done · deployed** |
| M2 withdraw circuit + trusted setup | **Done** |
| M3 Soroban verifier + pool + SAC | **Done · deployed** |
| M4 relayer | **Partial** — keystone, Merkle path, EVM reader, Soroban invoke, CLI built; backing daemon + HTTP server + e2e not |
| M5 frontend | **Not started** |

Path to a clickable demo: (1) backing daemon that scans Sepolia `NewRoot` events and anchors roots; (2) withdrawal HTTP server exposing `/path` + `/withdraw` (needs `tokio`/`axum` — the relayer is currently synchronous); (3) Next.js frontend with in-browser snarkjs proving; (4) the full deposit → withdraw e2e run.

## Repository structure

| Path | Contents |
|---|---|
| `evm-tree/` | Foundry: Solidity contracts + 19 tests + `DEPLOYMENTS.md` |
| `circuits/` | circom sources + snarkjs artifacts (`circuits/build`, `artifacts/circuit`) |
| `vendor/stellar-private-payments/contracts/` | Buildable Soroban contracts (`circom-groth16-verifier`, `bridge-pool`, `types`) — vendored, pinned by SHA |
| `relayer/` | Rust relayer (Poseidon2 keystone, Merkle path, EVM reader, Soroban invoke, CLI) |
| `deployments/testnet.env` | Live testnet addresses |
| `docs/` | [ARCHITECTURE.md](docs/ARCHITECTURE.md), [ZK-DESIGN.md](docs/ZK-DESIGN.md), [ADRs](docs/adr/) |
| `CONTEXT.md` | Domain language / glossary |

## Documentation

- **[Architecture & data flow](docs/ARCHITECTURE.md)** — components, full flow diagram, Root Window, nullifier set, and the complete trust model & limitations.
- **[Zero-knowledge design](docs/ZK-DESIGN.md)** — the withdraw circuit, the Poseidon2 keystone, why BN254, and the trusted setup.
- **[Architecture Decision Records](docs/adr/)** — the trust model, the unlinkable multi-denomination pool, and the BLS12-381 → BN254 flip.
- **[CONTEXT.md](CONTEXT.md)** — the domain glossary (Commitment, Note, Nullifier, Root Window, the two relayers, …).
