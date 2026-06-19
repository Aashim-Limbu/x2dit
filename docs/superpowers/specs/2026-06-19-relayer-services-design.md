# Relayer services — design (Task 44/45/46)

Date: 2026-06-19
Status: approved (brainstorming)
Scope: complete the M4 relayer — backing daemon, withdrawal HTTP server, and an e2e smoke harness.

## Goal

The relayer crate (`relayer/`) currently has the building blocks (Poseidon2 keystone, Merkle path service, `Deposit` log reader, `update_root`/`withdraw` CLI invokers, flat config, `topic`/`path`/`backing-once` CLI) but none of the long-running services. This design adds:

- **Task 44 — Backing daemon:** a continuous loop that scans Sepolia `RootUpdated` events and anchors recent EVM Merkle roots into the Soroban pool's Root Window, idempotently and resumably.
- **Task 45 — Withdrawal HTTP server:** an HTTP API the frontend calls — `GET /path`, `POST /withdraw`, `GET /health`.
- **Task 46 — e2e smoke:** a script exercising the relayer's two services end-to-end against live testnets.

It deliberately completes the existing crate rather than rewriting it; the existing modules and their 8 tests stay green.

## Decisions

- **Async runtime: `tokio` + `axum`.** The crate becomes async (`#[tokio::main]`). The existing blocking calls are bridged: EVM JSON-RPC stays on `ureq` wrapped in `tokio::task::spawn_blocking` (low call rate), and the `stellar` CLI moves to `tokio::process::Command`.
- **Daemon root source: read the emitted `RootUpdated` root directly** and anchor it (option A). A cheap integrity cross-check recomputes the root from `Deposit` logs via the existing `pathsvc`/`merkle` and logs a warning if they ever diverge (the Poseidon2 keystone guarantees they shouldn't). Rejected: rebuilding the tree to derive the root (option B) — more work, no benefit for a trusted backing role.
- **Denomination encoding (resolves the prior open decision):** `config.denoms = [1, 10, 100]` is the list of pool denom **values**, indexed by EVM `denomIndex`. `denoms[denomIndex]` is the one mapping. The public API and the pool/circuit all speak the **value** (`1/10/100`); the relayer maps value→index only to filter EVM logs. This matches the deployed pool (registered by value `{1,10,100}`) and the circuit's `denomination` public input.
- **Withdraw payload matches the real 6-arg contract signature**, not the plan's older 5-arg shape.
- **Config stays flat**, extended with serde-defaulted fields so the existing `config.toml` keeps parsing.

## Module layout (`relayer/src/`)

| Module | Change | Responsibility |
|---|---|---|
| `evm.rs` | extend | add `RootUpdated(uint8,uint256,uint32)` reader beside the existing `Deposit` reader |
| `state.rs` | new | idempotency cursor persisted to `backing-state.json` |
| `backing.rs` | new | the daemon loop (scan → anchor → persist → sleep) |
| `withdrawal.rs` | new | axum router + handlers (`/path`, `/withdraw`, `/health`) |
| `soroban.rs` | adjust | CLI calls via `tokio::process::Command` |
| `config.rs` | extend | new fields (below) |
| `main.rs` | extend | `#[tokio::main]`; keep `topic`/`path`/`backing-once`; add `backing` and `serve` |
| `poseidon.rs`, `merkle.rs`, `pathsvc.rs`, `lib.rs` | unchanged | reused as-is |

## Config additions (flat, serde defaults)

```toml
# existing: evm_rpc, deposit_contract, stellar_network, soroban_rpc,
#           pool_id, stellar_identity, denoms, from_block
poll_interval_secs = 15          # daemon loop cadence (default 15)
confirmations      = 2           # scan only up to head - confirmations (default 2)
http_bind          = "127.0.0.1:8080"  # withdrawal server address (default)
```

`denoms` is now explicitly the value list indexed by EVM `denomIndex` (e.g. `[1, 10, 100]`).

## Data flow

```
Backing daemon:
  EVM RootUpdated(idx, root, rootIndex)
    -> value = denoms[idx]
    -> Pool.update_root(value, root)        (relayer-gated)
    -> Root Window (per-denom ring buffer, 30)

Withdraw (frontend):
  GET /path?denom=<value>&leaf_index=<n>
    -> idx = denoms.index(value); filter Deposit logs by idx; rebuild tree
    -> { root, pathElements[20], pathIndices[20], leaf }
  (frontend builds Groth16 proof off-chain; recipient_fr = field-encode(recipient))
  POST /withdraw { proof, root, nullifier_hash, recipient_fr, recipient, denom }
    -> soroban::withdraw(...) -> Pool verifies proof + nullifier -> mints zUSDC
```

## HTTP API

- `GET /health` → `200 { status, deposit_contract, pool_id, denoms }`.
- `GET /path?denom=<value>&leaf_index=<n>` → `200 { root, pathElements: [..20], pathIndices: [..20], leaf }`; `400` if `denom` not configured or `leaf_index` out of range.
- `POST /withdraw` body `{ proof, root, nullifier_hash, recipient_fr, recipient, denom }` →
  - `200 { tx_hash }` on success;
  - `400` on bad/missing fields or unconfigured `denom`;
  - `409`/`502` on a surfaced downstream rejection (e.g. `NullifierAlreadyUsed`, unknown root, CLI failure).

The server validates request shape + that `denom` is configured, then passes through to `soroban::withdraw` (6 args). `recipient_fr` is supplied by the client (the exact field element its proof commits to); `recipient` is the destination G-address.

## Idempotency & resumability

`state.rs` persists per-denom `{ last_scanned_block, last_anchored_root }` to `backing-state.json`. The cursor is the **EVM block number** (monotonic) — NOT the `RootUpdated.rootIndex`, which is the on-chain ring-buffer index (0–29) and wraps, so it is not a safe cursor.

- The loop scans `last_scanned_block + 1 … head - confirmations`.
- For each `RootUpdated` in that range whose `root` differs from `last_anchored_root` for that denom, anchor via `update_root`, then update `last_anchored_root`.
- After the batch's anchors succeed, advance `last_scanned_block` to the scanned head. The cursor advances **only after success**, so a crash or RPC failure mid-batch is retried from the last good block.
- Because scanning only ever moves forward by block and consecutive identical roots are skipped, a root is not re-anchored (no wasted tx).

## Error handling

- **Daemon:** transient errors (EVM RPC, CLI) are logged and retried on the next tick — the loop never crashes. A failure on one denom does not advance that denom's cursor and does not block the others.
- **HTTP:** validation → `400`; downstream rejection → `409`/`502` with the surfaced message; success → `200`.

## Testing

Pure logic is factored out so tests need no network:

- `state.rs` cursor load/save + `mark_anchored` idempotency → `tests/idempotency.rs`.
- backing loop body as a pure `decide(state, fetched_roots) -> actions` → unit-tested for dedup/cursor advancement.
- `evm.rs` `RootUpdated` decoder → `tests/evm_decode.rs` (also closes the existing untested `Deposit` decoder gap).
- `/withdraw` request validation + value→index mapping → `tests/withdrawal_request.rs` (no socket).
- Existing 8 tests stay green.

## e2e smoke (`scripts/e2e_smoke.sh`)

Exercises the live relayer plumbing against testnet: `cast` mint mUSDC → approve + `deposit` on Sepolia → run the backing daemon one tick (anchors the new `RootUpdated`) → `GET /path` for the leaf → `POST /withdraw` → assert zUSDC minted.

Note: generating a *fresh* valid proof for a brand-new deposit is the circuit/frontend's job (snarkjs), not yet built. The first smoke therefore proves the **relayer's two services end-to-end** using the existing known-good proof artifacts against the matching root already anchored on-chain (denom 10, root `0012f4…`), minting to a recipient that holds a zUSDC trustline. The full cryptographic deposit→withdraw e2e lands with M5.

## Out of scope

- In-browser/circuit proof generation (M5).
- M-of-N backing federation / light-client backing (future trust upgrade).
- Auth / rate-limiting on the HTTP server (hackathon: trusted local/dev use).
