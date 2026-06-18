# Private Cross-Chain Bridge — EVM Sepolia → Stellar (Soroban)

Lock test-USDC on Ethereum Sepolia, then claim a bridged Stellar asset privately — proving in zero-knowledge that you own an unspent deposit, without revealing which one. Sender, recipient, amount, and the deposit↔withdrawal link stay hidden from everyone, including the relayers. Built for the **Stellar Hacks: ZK** hackathon, with the Groth16/BN254 proof verified **on Soroban** (on-theme).

> ⚠️ **Demo / hackathon project on unaudited reference code. Never frame this as securing real funds.** Testnet only. Privacy is trustless (zero-knowledge); backing/solvency relies on a single 1-of-1 relayer key — a documented limitation, not a finished trust model.

## Status at a glance

The cryptographic core is **done and deployed to live testnets**; the operator services and UI that would make it a one-click demo are **not built yet** — so there is **no working clickable end-to-end demo**.

| Layer | Status |
|---|---|
| Keystone (Poseidon2-BN254 parity across circom + Solidity + Rust) | Done |
| EVM contracts (deposit + Merkle tree + MockUSDC) | Done, deployed & verified on Sepolia |
| Withdraw circuit + Groth16 trusted setup | Done (`snarkjs groth16 verify` → OK) |
| Soroban verifier + pool + zUSDC SAC | Done, deployed to Stellar testnet |
| Relayer (Poseidon2, Merkle path, EVM reader, Soroban invoke, CLI) | Partial |
| Backing daemon · Withdrawal HTTP server · e2e harness | Not built |
| Frontend (deposit/withdraw UI + in-browser proving) | Not started |

> The full deposit→withdraw flow is **not yet runnable end-to-end**: the relayer's continuous backing daemon and `/path` + `/withdraw` HTTP endpoints, and the frontend, are still to come. In a fresh demo the anonymity set is 1 per denomination, so privacy is mechanism-only until a tree is populated. The recipient also needs a zUSDC trustline to receive the mint.

## Table of contents

- [Overview](#overview)
- [Architecture & data flow](#architecture--data-flow)
- [Zero-knowledge design](#zero-knowledge-design)
- [Contracts & live deployment](#contracts--live-deployment)
- [Trust model, security & limitations](#trust-model-security--limitations)
- [Build, test, reproduce & roadmap](#build-test-reproduce--roadmap)

## Overview

### The problem

Ordinary cross-chain transfers are fully transparent: the source-chain lock, the destination-chain release, the amount, and the two addresses are all public, so anyone can link "who sent how much to whom" across both chains. Even bridges with off-chain validators leak plaintext, because the validators attest to the message contents. That's a privacy hole for any value transfer.

### What this is

A simplified, privacy-preserving bridge that moves value EVM → Stellar through a **shielded pool**:

1. **Deposit** — lock test-USDC (MockUSDC, 6 decimals) on Sepolia in a fixed **denomination** (1 / 10 / 100). A Poseidon2 **commitment** is inserted into an on-chain incremental Merkle tree (one tree per denomination, depth 20, 30-root ring buffer).
2. **Backing** — a trusted **Backing Relayer** (1-of-1 for the MVP) watches Sepolia root events and anchors a recent EVM Merkle root into the Soroban pool's **Root Window**.
3. **Withdraw** — the user, via a **Withdrawal Relayer** (so the recipient stays unlinkable), submits a Groth16/BN254 proof of Merkle membership under an accepted root plus a **nullifier hash** that prevents double-withdrawal. The Soroban pool verifies the proof, records the nullifier, and mints bridged zUSDC (a Stellar Asset Contract) to the recipient.

Two orthogonal trust domains: **privacy is trustless** (zero-knowledge — even the relayers learn nothing); **backing/solvency is trusted** (one relayer key could in principle anchor an unbacked root; M-of-N federation is the upgrade path).

### Why it fits "Stellar Hacks: ZK"

The bridge direction is deliberately chosen so the **zero-knowledge verification happens on Stellar**. The withdrawal Groth16 proof is checked on Soroban via the BN254 host functions (CAP-0074 / CAP-0075, Protocol 25/26 "Yardstick"), using `soroban-sdk` 26. The keystone is a single Poseidon2-BN254 instantiation that is byte-identical across circom, Solidity, and Rust — Soroban itself computes no Poseidon; it only stores the root window and the nullifier set.

## Architecture & data flow

This is a one-direction private bridge: value is **locked on EVM (Ethereum Sepolia)** and **claimed privately on Stellar (Soroban)**. EVM is the public source-of-truth side; Stellar is the private/ZK side, where the Groth16 proof is verified on-chain. Privacy is trustless (zero-knowledge); backing/solvency is trusted to a single relayer key in this MVP.

### Components

**Sepolia side (public source of truth)**

- **Lock / Deposit Contract** — `PrivacyPoolDeposit.sol`. Holds **one independent incremental Merkle tree per denomination** (`tornado-core` `MerkleTreeWithHistory`, depth 20, ring-buffer root history `ROOT_HISTORY_SIZE = 30`). `deposit(denomIndex, commitment)` locks exactly the denomination's amount of test-USDC (`MockUSDC`, 6 decimals), inserts the user's **commitment** as a leaf, and emits `Deposit(denomIndex, commitment, leafIndex)` and `RootUpdated(denomIndex, root, rootIndex)`. The empty-leaf `ZERO_VALUE` is `0`, matching the circuit and relayer. Each denomination's tree is its own **anonymity set**.

**Off-chain (two relayers, two trust models)**

- **Backing Relayer** — watches the Sepolia Lock Contract, maintains the off-chain Merkle tree, and anchors a recent EVM **root** into the Soroban pool's **Root Window**. **Trusted for solvency/backing** (1-of-1): one key could in principle anchor an unbacked root. Documented limitation; M-of-N federation is the upgrade path.
- **Withdrawal Relayer** — submits the user's withdrawal proof transaction to Soroban so the recipient never needs a pre-funded, linkable account. **Trusted for liveness only**: it cannot steal (the proof binds the recipient as a public input) and cannot forge.

> There are deliberately **two relayers with different trust**. Keeping them separate means the privacy guarantee (ZK) never depends on the relayer that touches money, and the submitter that posts withdrawals can never compromise correctness or recipient binding.

**Stellar side (private / ZK)**

- **Shielded Pool** — `bridge-pool` Soroban contract. Stores the **Root Window** (per-denomination ring buffer of recent valid roots) and the **nullifier set**; it holds the bridged value and **never hashes the Merkle tree itself**. `update_root` (Backing-Relayer-gated via `require_auth`) pushes roots; `withdraw` verifies the proof, records the nullifier, and mints the bridged asset.
- **Soroban Groth16 Verifier** — `circom-groth16-verifier`, Groth16 over BN254 verified with Soroban BN254 host functions (CAP-0074/0075, Protocol 25/26). It embeds the bridge verification key (`nPublic = 4`). The pool calls it cross-contract via `verify(proof, public_inputs)`.
- **Bridged zUSDC SAC** — a Stellar Asset Contract whose admin is handed to the pool, so a verified withdrawal mints zUSDC (7 decimals) directly to the recipient. The recipient needs a zUSDC trustline to receive it.

### End-to-end flow (deposit → backing anchor → private withdraw)

```
        EVM — Sepolia (public)                    │   off-chain   │      Stellar — Soroban (private/ZK)
                                                  │               │
  ┌──────────────────────────────────────┐       │               │
  │ 1. DEPOSIT                            │       │               │
  │  user → PrivacyPoolDeposit.deposit(   │       │               │
  │      denomIndex, commitment)          │       │               │
  │   • locks test-USDC (denom amount)    │       │               │
  │   • inserts Commitment leaf           │       │               │
  │   • emits Deposit + RootUpdated       │       │               │
  └───────────────┬──────────────────────┘       │               │
                  │ RootUpdated(root)             │               │
                  └──────────────────────────────▶ Backing       │
                                                  │ Relayer       │
                                                  │ (watches      │
                                                  │  events,      │
                                                  │  trusted for  │
                                                  │  solvency)    │
                                                  │     │         │
  ┌───────────────────────────────────────────────────┘         │
  │ 2. BACKING ANCHOR                              │              │
  │  Backing Relayer → Pool.update_root(denom,root)│──────────────▶ Shielded Pool
  │  (relayer-gated; pushes into Root Window)      │              │   Root Window
  └────────────────────────────────────────────────              │   (ring buffer, 30)
                                                  │               │        │
  user builds Groth16 proof off-chain             │               │        │
  (Merkle membership under an accepted root        │               │        │
   + nullifierHash; recipient & denom bound)      │               │        │
                  │                               │               │        │
                  └───────────────────────────────▶ Withdrawal    │        │
                                                  │  Relayer       │        │
                                                  │ (trusted for   │        │
                                                  │  liveness only)│        │
                                                  │      │         │        ▼
  ┌──────────────────────────────────────────────────────┘  3. PRIVATE WITHDRAW
  │  Withdrawal Relayer → Pool.withdraw(           │            Pool.withdraw(...)
  │      proof, root, nullifierHash,               │             • is_known_root? (Root Window)
  │      recipient_fr, recipient, denom)           │             • nullifier unused? (Nullifier Set)
  └────────────────────────────────────────────────             • Verifier.verify(proof, inputs) ── BN254 ──▶ Groth16 Verifier
                                                  │             • mark nullifier used
                                                  │             • mint zUSDC SAC → recipient
                                                  │               (needs trustline)
```

The withdraw public-input vector order is exactly `[root, nullifierHash, recipient, denomination]` (4 inputs), matching the verifier's embedded key.

### Why the Root Window

The Sepolia tree's tip moves every time anyone deposits, so the EVM root changes constantly. Between the moment a user generates a proof (against some recent root) and the moment the Withdrawal Relayer submits it, more deposits may have advanced the tree. The Shielded Pool therefore accepts a proof against **any root in a rolling window of the last 30** anchored roots (per denomination), implemented as a ring buffer that drops the oldest root when full (`push_root` in `storage.rs`, `ROOT_HISTORY_SIZE = 30`). This mirrors the EVM tree's own `ROOT_HISTORY_SIZE = 30` history and tolerates tree-tip movement during the proving/submission gap.

### Why the nullifier set

A **note** carries a secret **nullifier**; at withdrawal the user publishes its deterministic image, the **nullifier hash**. The pool records each spent nullifier hash in the **nullifier set** (persistent storage) and rejects any withdrawal whose nullifier is already present, preventing the same note from being withdrawn twice. The nullifier hash cannot be linked back to its commitment, so double-spend prevention does not break the deposit↔withdrawal unlinkability.

## Zero-knowledge design

Withdrawals are authorized by a **Groth16 proof over the BN254 curve**, generated off-chain and verified **on Soroban** via Stellar's BN254 host functions (CAP-0074/0075, Protocol 25/26 "Yardstick"). The circuit is authored in circom; Rust owns the on-chain verifier and the relayer/tooling.

### The withdraw circuit

The circuit (`circuits/src/withdraw.circom`, instantiated at depth 20) proves, in zero knowledge, that the prover owns an unspent deposit, without revealing which one. Measured from the compiled R1CS, it has **9415 constraints** (9440 wires, 42 private inputs, 4 public inputs).

It does four things:

1. **Commitment** — `commitment = Poseidon2(2)([nullifier, secret])` (domain separation `0`).
2. **Nullifier hash** — `nullifierHash = Poseidon2(1)([nullifier])`, constrained to equal the public `nullifierHash`. This deterministic image is published at withdrawal and recorded in the pool's nullifier set to prevent double-withdrawal; it cannot be linked back to the commitment.
3. **Merkle membership** — the commitment is proven to be a leaf of a depth-20 incremental Merkle tree whose root equals the public `root`.
4. **Malleability binding** — `recipient` and `denomination` are bound into the witness by squaring them (`recipientSq`, `denomSq`), so a proof cannot be re-targeted to a different recipient or denomination.

There is **no amount arithmetic** in the circuit: value transfer is by fixed denomination (one tree per denomination), so withdrawals are Merkle-membership + nullifier only.

**Public input order is EXACTLY `[root, nullifierHash, recipient, denomination]`** (declared as `public [root, nullifierHash, recipient, denomination]` in the circuit `main`, and matched by the verifier's `nPublic = 4`). The verifier consumes public inputs positionally, so this order is load-bearing across the circuit, the proof's `public.json`, and the Soroban verifier.

### The keystone: one Poseidon2-BN254, byte-identical across surfaces

The single most fragile invariant in this project is the hash. A **single Poseidon2-BN254 family** (HorizenLabs `zkhash` `POSEIDON2_BN256_PARAMS_2` and `_3`, mixed arity) must be **byte-for-byte identical** across the **circom circuit, the Solidity tree, and the Rust relayer** — these three compute the hash, and the Soroban verifier checks a proof over the result.

It is **Poseidon2, not classic Poseidon1** — stock `poseidon-solidity`/circomlib are Poseidon1 and would silently fail to match. It also uses **mixed arity**:

| Use | Arity | Permutation | Form |
| --- | --- | --- | --- |
| Merkle node compression | `Poseidon2(2)` argument-pair → t=2 | Permutation width 2 | `node(l, r) = Perm([l, r])[0] + l` |
| `nullifierHash = Poseidon2(1)` | t=2 | Permutation width 2 | one-input hash |
| `commitment = Poseidon2(2)` | t=3 | Permutation width 3 | two-input hash |

The Merkle compression is the `P(l,r)[0] + l` form (confirmed in `circuits/src/merkle.circom`: `node(left,right) = Perm([left,right])[0] + left`). The empty-leaf `ZERO_VALUE` is `0`, kept consistent across EVM, circuit, and relayer.

### Why BN254

The curve choice is a *consequence* of keeping the authoritative commitment tree on-chain on EVM (Sepolia), which requires a SNARK-friendly hash in Solidity. **BN254 is the only field with a working off-the-shelf Solidity Poseidon** (`poseidon-solidity`, zk-kit); a BLS12-381 Poseidon in Solidity does not exist. Choosing BN254 lets one Poseidon instantiation span all four surfaces (circom + Solidity + Rust + Soroban), eliminating the cross-surface mismatch trap. BN254 Groth16 also verifies on Soroban today via the P25/P26 host functions. This **supersedes the earlier BLS12-381 decision** — see [ADR-0003](docs/adr/0003-zk-stack-circom-groth16-bls12-381.md) (superseded) → [ADR-0004](docs/adr/0004-flip-to-bn254-onchain-evm-tree.md).

### Trusted setup

Groth16 requires a per-circuit trusted setup: a universal **powers-of-tau** phase (Hermez ptau-14) followed by a circuit-specific **phase-2** contribution, producing `withdraw_final.zkey` and the `verification_key.json` embedded in the Soroban verifier (artifacts in `circuits/build/`).

### Key insight: Soroban computes no Poseidon

Hashing happens **only** in-circuit, in the EVM tree, and off-chain in the relayer. The Soroban pool is **verify-only**: it stores the root window and the nullifier set, and it checks the Groth16 proof. It never hashes the Merkle tree itself. This keeps the on-chain Soroban cost bounded to a Groth16 verification plus storage bookkeeping.

## Contracts & live deployment

Deployed 2026-06-19 to public testnets. All EVM contracts are verified on Etherscan; the Soroban contracts are linked below on stellar.expert.

### EVM — Ethereum Sepolia (chainId 11155111)

| Contract | Address | Explorer |
|----------|---------|----------|
| Poseidon2 (t=2 hasher) | `0x1d67b922dfed90ab36e267c65cd649977a9385c8` | [Etherscan](https://sepolia.etherscan.io/address/0x1d67b922dfed90ab36e267c65cd649977a9385c8) |
| MockUSDC (mUSDC, 6 decimals) | `0x1a39a02a3a776b354a5c97373dde715c419c6ab5` | [Etherscan](https://sepolia.etherscan.io/address/0x1a39a02a3a776b354a5c97373dde715c419c6ab5) |
| PrivacyPoolDeposit | `0x4c781728f3f53f220c6f226610cd24d8b1e8e7ef` | [Etherscan](https://sepolia.etherscan.io/address/0x4c781728f3f53f220c6f226610cd24d8b1e8e7ef) |

`PrivacyPoolDeposit` holds one incremental Merkle tree per denomination (deployed as nested contracts, not separately verified):

| Denomination | Tree address |
|----------|---------|
| denom[0] = 1 USDC | `0x65bb45c28ac0d432c1d0879a49d0dc4e18e7b121` |
| denom[1] = 10 USDC | `0x101de43219b5141aad4563c29f7d2a1c6fa6e9c5` |
| denom[2] = 100 USDC | `0xd48a25c88bb54773eccf88f04f8932068a7a734a` |

- **Deploy block: `11089276`** — this is the relayer's `from_block` start for the Sepolia event scan.
- **`MockUSDC.mint(address, uint256)` is an open faucet** — anyone can mint mUSDC to test deposits.
- Deployer: `0x65ee5CaB1e11e7bd456E15c39E83b997DCD953F9`.
- Events watched by the relayer: `Deposit(uint8 indexed denomIndex, uint256 indexed commitment, uint32 leafIndex)` and `RootUpdated(uint8 indexed denomIndex, uint256 root, uint32 rootIndex)`.

### Soroban — Stellar testnet

| Contract | ID | Explorer |
|----------|-----|----------|
| Groth16 Verifier | `CBXA7364AEVDQV2Z4CW7IUYSHO7JTETPUR6Y5FET2QAC5GWTNPN3ZGFH` | [stellar.expert](https://stellar.expert/explorer/testnet/contract/CBXA7364AEVDQV2Z4CW7IUYSHO7JTETPUR6Y5FET2QAC5GWTNPN3ZGFH) |
| Bridge Pool | `CDFQ5K2BPKB7BWNW2SJPGIIK5OOFQIR434MOX5YYBDKAN3M5CFVJKHR2` | [stellar.expert](https://stellar.expert/explorer/testnet/contract/CDFQ5K2BPKB7BWNW2SJPGIIK5OOFQIR434MOX5YYBDKAN3M5CFVJKHR2) |
| zUSDC Stellar Asset Contract (SAC) | `CAIUOHVZ77RSCDBNWR3BCZPTWHPUXQRTQXSW4VE3HGC2M5PRPJNSFBRU` | [stellar.expert](https://stellar.expert/explorer/testnet/contract/CAIUOHVZ77RSCDBNWR3BCZPTWHPUXQRTQXSW4VE3HGC2M5PRPJNSFBRU) |

Network: `testnet`, RPC `https://soroban-testnet.stellar.org`, passphrase `Test SDF Network ; September 2015`.

> **⚠️ Use the right verifier.** The deployed verifier `CBXA7364…ZGFH` embeds the **bridge withdraw verification key (`nPublic=4`)**, matching the circuit's public-input order `[root, nullifierHash, recipient, denomination]`. An earlier M0 spike verifier (`CA3DEXAK…`) embeds the **wrong upstream policy VK (`nPublic=11`)** and **must not be used** for the bridge.

**SAC admin handed to the pool.** The zUSDC SAC's administrator was transferred to the Bridge Pool contract, so the pool mints zUSDC directly to the recipient on a successful withdrawal. (The recipient must hold a zUSDC trustline to receive the mint.)

### Denomination map

The pool registers denominations by USDC **value** `{1, 10, 100}`, mapping to zUSDC amounts at 7 decimals:

| Pool denom id (value) | zUSDC amount (7 dp) |
|----------|---------|
| 1 | `10000000` (1e7) |
| 10 | `100000000` (1e8) |
| 100 | `1000000000` (1e9) |

Note the encoding mismatch to resolve when wiring the end-to-end prover: the EVM tree is keyed by **denomIndex `{0, 1, 2}`**, while the pool's denom id and the circuit's `denomination` public input are the **value `{1, 10, 100}`**. The relayer must map index → value before calling `update_root`/`withdraw`.

Key holders (testnet): bridge deployer `GA524GHEV3RINWIDHC6SIOI6XDXGKCCR7UYAKM7JFUQJUWEZ4GH56TEA`, zUSDC issuer `GAA3S6XLOKFX3SGDQ3VGLLXMCFMVB7E6WYNGHRGIRD62AEJ73ASPQ4KX`, backing relayer `GBLU6A6OKK35QZR5SIYYNF7PFMKIBEFPOJ6OZP3NM2HWN67DUTFOMIXW`.

## Trust model, security & limitations

> This is unaudited hackathon/demo code on testnet. It is never to be framed as securing real funds.

### Two orthogonal trust domains

Trust in this bridge splits cleanly into two independent domains. Treating them separately is the whole point of the design.

**1. Privacy — trustless (zero-knowledge).** The unlinkability of a deposit from its withdrawal is enforced by a Groth16/BN254 proof verified on-chain by the Soroban pool. No operator — not the backing relayer, not the withdrawal relayer, not the pool admin — can break the deposit↔withdrawal link. The proof reveals only the four public inputs `[root, nullifierHash, recipient, denomination]`; the depositor's secret, the specific commitment, and which deposit a withdrawal corresponds to all stay hidden.

**2. Backing / solvency — trusted (1-of-1 relayer).** That a Stellar-side mint is backed by a real Sepolia lock is *not* trustless. A single backing relayer key watches the Sepolia deposit contract and anchors a recent EVM Merkle root into the Soroban pool's root window via `update_root`, which is gated to the relayer address. The pool does not verify the EVM lock itself — it trusts the relayer to only anchor backed roots.

**Consequence (stated plainly):** a compromised or dishonest backing-relayer key could anchor an *unbacked* root and thereby allow minting of unbacked value on Stellar. This is an accepted, documented limitation for a testnet prototype.

**Upgrade path:** replace the 1-of-1 relayer with an **M-of-N federation** (threshold-signed root anchoring), or move to a trust-minimized **EVM light client / storage proof** so the Soroban side verifies the lock cryptographically rather than trusting an operator. Both are out of scope for the hackathon.

### What the ZK layer does and does not protect

| Property | Guaranteed by | Trustless? |
|---|---|---|
| Deposit↔withdrawal unlinkability | On-chain Groth16 proof | Yes |
| No double-withdrawal | On-chain nullifier set | Yes |
| Recipient cannot be swapped by a relayer | Recipient bound in-circuit | Yes |
| Mint is backed by a real EVM lock | 1-of-1 backing relayer | **No (trusted)** |

### Double-withdrawal prevention (nullifier set)

Each deposit's secret nullifier hashes (in-circuit) to a `nullifierHash` that is published as a public input. On withdraw, the pool checks `is_nullifier_used`; if the nullifier is already recorded it rejects with `NullifierAlreadyUsed`, and on success it calls `mark_nullifier_used` before minting. A given deposit can therefore be withdrawn at most once. The nullifier is derived from the deposit secret but is unlinkable to the original commitment, so spending it leaks nothing about which deposit was spent.

### Recipient malleability prevention (recipient bound in-circuit)

Because a withdrawal relayer submits the transaction (so the recipient stays unlinkable to the original deposit), a malicious relayer could otherwise try to redirect the mint to itself. The `recipient` is a **public input of the proof** and is constrained inside the withdraw circuit (`recipientSq <== recipient * recipient`), binding it into the witness. `denomination` is bound the same way. Changing the recipient (or denomination) invalidates the proof, so the relayer can submit the transaction but cannot alter where the funds go.

### Honest limitations

- **Unaudited demo code.** Reference/hackathon code, not audited; do not use to secure real value.
- **Anonymity set = deposits per denomination tree.** Each denomination is its own independent pool/Merkle tree, so privacy comes from the crowd of deposits *within one denomination*. In a fresh demo a tree may hold a single deposit — the unlinkability *mechanism* is demonstrated, but the privacy is not yet meaningful until a denomination's tree is populated with many deposits.
- **Testnet only.** EVM Sepolia + Soroban testnet. No mainnet deployment.
- **Recipient needs a zUSDC trustline.** The withdrawal mints a Stellar Asset Contract (SAC) token to the recipient; the recipient account must already hold a trustline for the zUSDC asset, or the mint will fail.
- **Open denomination-encoding decision.** The Soroban pool registers and looks up denominations **by value** (`{1, 10, 100}` → amounts `{1e7, 1e8, 1e9}`), while the EVM tree is keyed by **denom index** (`{0, 1, 2}`). The withdraw path encodes the pool's `denom` u32 directly into the field element fed to the proof (`u32_to_fr_bytes`, commented as an "index"), so the index↔value mapping must be reconciled by the relayer/prover when the public `denomination` input is constructed. This is not yet finalized end-to-end.
- **Full deposit→withdraw flow is not yet runnable end-to-end.** The backing daemon, the relayer HTTP endpoints (`/path`, `/withdraw`), and the frontend (in-browser proving + commitment hashing) are not built. The individual pieces (EVM contracts, circuit, Soroban verifier/pool, relayer keystone + Merkle path + invoke functions) are built and tested, but the live demo cannot currently run the complete deposit-to-withdraw path without manual steps.

## Build, test, reproduce & roadmap

### Component status

| Milestone | Component | Status | Notes |
|---|---|---|---|
| M0 | Spike / Poseidon2 keystone | **DONE** | Byte-identical Poseidon2-BN254 across circom + Solidity + Rust; real proof verified through the Soroban verifier (host-env). |
| M1 | EVM contracts (Sepolia) | **DONE + DEPLOYED** | `MockUSDC`, `Poseidon2`, `PrivacyPoolDeposit` (depth-20 incremental tree, 30-root ring), all verified on Etherscan. |
| M2 | Withdrawal circuit + trusted setup | **DONE** | `withdraw.circom`, 9415 constraints, 4 public inputs; Hermez ptau-14 + one phase-2 contribution; `snarkjs groth16 verify` => OK. |
| M3 | Soroban verifier + pool + SAC | **DONE + DEPLOYED** | Groth16/BN254 verifier (embeds the bridge VK, nPublic=4), bridge-pool (root window + nullifier set), zUSDC SAC with admin handed to the pool. |
| M4 | Relayer | **PARTIAL** | Built: Poseidon2 keystone, Merkle path service, EVM `Deposit` log reader, Soroban `update_root`/`withdraw` invoke fns, and a CLI (`topic`, `path`, `backing-once`). Not built: continuous backing daemon (Task 44), withdrawal HTTP server (Task 45 — crate is sync `ureq`, needs `tokio`/`axum`), end-to-end run (Task 46). |
| M5 | Frontend (Next.js + in-browser proving) | **NOT STARTED** | No deposit/withdraw UI; no in-browser snarkjs proving; no `commitment.wasm` for the in-browser commitment hash. |

The CLI surface reflects this state: `relayer backing-once` exists but is a single manual pass (not wired to a `NewRoot` scan), and there is no `/path` or `/withdraw` HTTP endpoint yet (`relayer/src/main.rs`).

### Verified tests

All counts below were green on the last re-run (2026-06-19).

| Suite | Result | Command |
|---|---|---|
| EVM (Foundry) | **19/19** | `forge test` (run inside `evm-tree/`) |
| Relayer (Rust) | **8/8** | `cargo test --manifest-path relayer/Cargo.toml` |
| Soroban bridge-pool | **9/9** | see vendored-workspace command below |
| Soroban circom-groth16-verifier | **5/5** | see vendored-workspace command below |
| Circuit (snarkjs) | **OK** | `snarkjs groth16 verify circuits/build/verification_key.json circuits/build/public.json circuits/build/proof.json` |

The 14 Soroban tests (9 pool + 5 verifier) must be run from inside the vendored workspace with the verifier VK exported:

```sh
# from vendor/stellar-private-payments/
VERIFIER_VK_JSON=<abs>/circuits/build/verification_key.json \
  cargo test -p bridge-pool -p circom-groth16-verifier
```

### Reproducibility gotchas

- **`VERIFIER_VK_JSON` is mandatory for any Soroban build/test.** `build.rs` would panic if the variable were truly unset, but `.cargo/config.toml` always supplies a default that points at a non-existent path (`testdata/policy_tx_2_2_vk.json`) — so in practice the build fails with a "failed to read VK file" panic unless you override it with an absolute path to `circuits/build/verification_key.json`.
- **Soroban contracts only build inside the vendored workspace** at `vendor/stellar-private-payments/`. The top-level `soroban/` directory is a non-buildable orphan copy.
- **Explicit RPC + passphrase for the Stellar CLI.** The `testnet` network alias had an empty RPC in this environment, so deploys/invokes used explicit flags: `--rpc-url https://soroban-testnet.stellar.org --network-passphrase "Test SDF Network ; September 2015"`.
- There is no top-level `Makefile`; run each suite with the commands above. The relayer's `relayer/config.toml` is already wired to the live testnet addresses — but the CLI defaults to `relayer.toml` (which does not exist), so pass `--config relayer/config.toml` for any subcommand other than `topic` (e.g. `relayer --config relayer/config.toml path --denom 1 --leaf-index 0`).

### Roadmap to a clickable demo

The full deposit → withdraw flow is not yet runnable end-to-end. Remaining work, in order:

1. **Backing daemon (Task 44):** turn the manual `backing-once` pass into a loop that scans Sepolia `NewRoot` events and anchors recent roots into the pool's root window.
2. **Withdrawal HTTP server (Task 45):** expose `/path` (Merkle proof) and `/withdraw` (relayed proof submission) endpoints. The relayer crate is currently synchronous (`ureq`); this requires moving to `tokio`/`axum`.
3. **Frontend (M5):** Next.js deposit/withdraw UI with in-browser snarkjs proving (and a `commitment.wasm` for the in-browser commitment hash).
4. **End-to-end (Task 46):** a full deposit-on-Sepolia → backing → private withdraw-on-Soroban demo run.

## Repository structure

| Path | Contents |
|---|---|
| `evm-tree/` | Foundry: Solidity contracts + 19 tests + `DEPLOYMENTS.md` |
| `circuits/` | circom sources + snarkjs artifacts (`circuits/build`, `artifacts/circuit`) |
| `vendor/stellar-private-payments/contracts/{circom-groth16-verifier,bridge-pool,types}` | Buildable Soroban contracts (vendored, gitignored, pinned by SHA) |
| `relayer/` | Rust relayer (Poseidon2 keystone, Merkle path, EVM reader, Soroban invoke, CLI) |
| `deployments/testnet.env` | Live testnet addresses |
| `docs/adr/` | ADR-0001..0004 |
| `docs/superpowers/plans/` | The full plan |
| `CONTEXT.md` | Domain language |
