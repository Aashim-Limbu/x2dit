# Architecture & data flow

zk-houdini is a one-direction private bridge: value is **locked on EVM (Ethereum Sepolia)** and **claimed privately on Stellar (Soroban)**. EVM is the public source-of-truth side; Stellar is the private/ZK side, where the Groth16 proof is verified on-chain. Privacy is trustless (zero-knowledge); backing/solvency is trusted to a single relayer key in this MVP.

## Components

### Sepolia side (public source of truth)

- **Lock / Deposit Contract** — `PrivacyPoolDeposit.sol`. Holds **one independent incremental Merkle tree per denomination** (`tornado-core` `MerkleTreeWithHistory`, depth 20, ring-buffer root history `ROOT_HISTORY_SIZE = 30`). `deposit(denomIndex, commitment)` locks exactly the denomination's amount of test-USDC (`MockUSDC`, 6 decimals), inserts the user's **commitment** as a leaf, and emits `Deposit(denomIndex, commitment, leafIndex)` and `RootUpdated(denomIndex, root, rootIndex)`. The empty-leaf `ZERO_VALUE` is `0`, matching the circuit and relayer. Each denomination's tree is its own **anonymity set**.

### Off-chain (two relayers, two trust models)

- **Backing Relayer** — watches the Sepolia Lock Contract, maintains the off-chain Merkle tree, and anchors a recent EVM **root** into the Soroban pool's **Root Window**. **Trusted for solvency/backing** (1-of-1): one key could in principle anchor an unbacked root. Documented limitation; M-of-N federation is the upgrade path.
- **Withdrawal Relayer** — submits the user's withdrawal proof transaction to Soroban so the recipient never needs a pre-funded, linkable account. **Trusted for liveness only**: it cannot steal (the proof binds the recipient as a public input) and cannot forge.

> [!NOTE]
> There are deliberately **two relayers with different trust**. Keeping them separate means the privacy guarantee (ZK) never depends on the relayer that touches money, and the submitter that posts withdrawals can never compromise correctness or recipient binding.

### Stellar side (private / ZK)

- **Shielded Pool** — `bridge-pool` Soroban contract. Stores the **Root Window** (per-denomination ring buffer of recent valid roots) and the **nullifier set**; it holds the bridged value and **never hashes the Merkle tree itself**. `update_root` (Backing-Relayer-gated via `require_auth`) pushes roots; `withdraw` verifies the proof, records the nullifier, and mints the bridged asset.
- **Soroban Groth16 Verifier** — `circom-groth16-verifier`, Groth16 over BN254 verified with Soroban BN254 host functions (CAP-0074/0075, Protocol 25/26). It embeds the bridge verification key (`nPublic = 4`). The pool calls it cross-contract via `verify(proof, public_inputs)`.
- **Bridged zUSDC SAC** — a Stellar Asset Contract whose admin is handed to the pool, so a verified withdrawal mints zUSDC (7 decimals) directly to the recipient. The recipient needs a zUSDC trustline to receive it.

## End-to-end flow (deposit → backing anchor → private withdraw)

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

## Why the Root Window

The Sepolia tree's tip moves every time anyone deposits, so the EVM root changes constantly. Between the moment a user generates a proof (against some recent root) and the moment the Withdrawal Relayer submits it, more deposits may have advanced the tree. The Shielded Pool therefore accepts a proof against **any root in a rolling window of the last 30** anchored roots (per denomination), implemented as a ring buffer that drops the oldest root when full (`push_root` in `storage.rs`, `ROOT_HISTORY_SIZE = 30`). This mirrors the EVM tree's own `ROOT_HISTORY_SIZE = 30` history and tolerates tree-tip movement during the proving/submission gap.

## Why the nullifier set

A **note** carries a secret **nullifier**; at withdrawal the user publishes its deterministic image, the **nullifier hash**. The pool records each spent nullifier hash in the **nullifier set** (persistent storage) and rejects any withdrawal whose nullifier is already present, preventing the same note from being withdrawn twice. The nullifier hash cannot be linked back to its commitment, so double-spend prevention does not break the deposit↔withdrawal unlinkability.

## Trust model

Trust splits cleanly into two independent domains. Treating them separately is the whole point of the design.

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
- **Open denomination-encoding decision.** The Soroban pool registers and looks up denominations **by value** (`{1, 10, 100}` → amounts `{1e7, 1e8, 1e9}`), while the EVM tree is keyed by **denom index** (`{0, 1, 2}`). The withdraw path encodes the pool's `denom` u32 directly into the field element fed to the proof (`u32_to_fr_bytes`), so the index↔value mapping must be reconciled by the relayer/prover when the public `denomination` input is constructed. This is not yet finalized end-to-end.
- **Full deposit→withdraw flow is not yet runnable end-to-end.** The backing daemon, the relayer HTTP endpoints (`/path`, `/withdraw`), and the frontend (in-browser proving + commitment hashing) are not built. The individual pieces (EVM contracts, circuit, Soroban verifier/pool, relayer keystone + Merkle path + invoke functions) are built and tested, but the live demo cannot currently run the complete deposit-to-withdraw path without manual steps.

See [ZK-DESIGN.md](ZK-DESIGN.md) for the circuit and hash internals, and the [ADRs](adr/) for the decisions behind the trust model and the multi-denomination shielded-pool design.
