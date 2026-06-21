# Relayer: eth_getLogs chunking + snarkjs→Soroban proof converter — design

Date: 2026-06-19
Status: approved (brainstorming)
Scope: two relayer fixes surfaced by the live testnet e2e — (1) make the daemon/`/path` work against capped free-tier RPCs by paging `eth_getLogs`, and (2) add a converter so a snarkjs proof can be submitted to the deployed `withdraw`, validated by a real on-chain mint.

## Background (from the live e2e, 2026-06-19)

The backing daemon + HTTP `/path`/`/health` were validated live, but two gaps remain:

1. **`eth_getLogs` is not chunked.** Free-tier RPCs cap the block range (Alchemy free = 10 blocks, drpc free = 10k). The relayer issues one un-chunked `eth_getLogs` over the full `from_block..head` range and gets HTTP 400. The e2e worked around it with a narrow `from_block`.
2. **No CLI-ready proof.** The deployed `withdraw` wants the proof as `--proof '{ "a": <64 hex bytes>, "b": <128 hex bytes>, "c": <64 hex bytes> }'` (G2 in c1‖c0 order), but `artifacts/circuit/proof.json` is snarkjs format (`pi_a`/`pi_b`/`pi_c` decimal coords). The snarkjs→Soroban conversion existed only in Rust test code, so a live `withdraw`→mint was not runnable.

The exact `withdraw` arg format (from the deployed contract's generated CLI help):
- `--proof '{ "a": "<128 hex chars>", "b": "<256 hex chars>", "c": "<128 hex chars>" }'`
- `--root`, `--nullifier_hash`, `--recipient_fr`: bare 32-byte hex (64 hex chars, no `0x`)
- `--recipient`: Address (G…/C…/identity); `--denom`: u32

## Decisions

- **Converter is a relayer subcommand** `convert-proof` backed by a pure module `proofconv.rs` (in-repo, lean). Rejected: a tool in the vendored workspace (gitignored, can't commit) and reusing ark-circom (heavy, unnecessary — the conversion is pure integer encoding).
- **No field arithmetic / ark-circom needed.** The snarkjs coords are already affine integers; conversion is decimal-string → 32-byte big-endian, plus the G2 c1‖c0 reordering. Point A is NOT negated (the on-chain verifier negates A internally for the pairing check).
- **Chunk size is configurable**, `log_window_blocks` default **9** (works on Alchemy/drpc free tiers out of the box; raise on better RPCs for faster backfill).
- **`withdrawal.rs` is unchanged** — `/withdraw` already passes the `proof` string straight to `--proof`. The converter is a client-side step (our e2e script now; the M5 frontend later).
- **Correctness is proven by a live mint**, not just unit tests: the byte layout is right iff the deployed verifier accepts the converted proof and mints.

## Component 1 — eth_getLogs chunking

**Files:** `relayer/src/config.rs` (add field), `relayer/src/evm.rs` (chunking).

- `config.rs`: add `#[serde(default = "default_log_window")] pub log_window_blocks: u64` with `fn default_log_window() -> u64 { 9 }`. Existing config files keep parsing.
- `evm.rs`: add a private helper that pages a range and returns the raw log `Value`s:

  ```
  fn get_logs_chunked(rpc, contract, topic0: &str, from: u64, to: u64, window: u64) -> Result<Vec<serde_json::Value>>
  ```

  It loops `start = from; while start <= to { end = min(start+window-1, to); eth_getLogs(from=start,to=end); collect; start = end+1 }`. One `eth_getLogs` per window; propagates RPC errors.
- `fetch_root_updates(rpc, contract, from_block, to_block, window)` gains the `window` param and calls `get_logs_chunked` with `root_updated_topic0()`, then `decode_root_log` each, sorted by block.
- `fetch_deposits(rpc, contract, from_block, window)` gains `window`; it reads `current_block(rpc)` for a concrete head, calls `get_logs_chunked` over `from_block..head` with `deposit_topic0()`, then `decode_deposit_log` each, sorted by leaf_index.
- Callers updated: `backing::tick` passes `cfg.log_window_blocks` to `fetch_root_updates`; `withdrawal::path_handler` and `main::Path` pass `cfg.log_window_blocks` to `fetch_deposits`.

**Tests** (`relayer/tests/evm_decode.rs`, pure): a `get_logs_chunked`-style window-planner is the only non-network logic worth isolating — extract `fn plan_windows(from, to, window) -> Vec<(u64,u64)>` and unit-test it (e.g. `plan_windows(0, 25, 10) == [(0,9),(10,19),(20,25)]`, single-window, `from>to` empty). The decoders already have tests; the HTTP `eth_getLogs` itself is covered by the live e2e.

## Component 2 — proof converter

**Files:** `relayer/Cargo.toml` (add `num-bigint`, `num-traits`), `relayer/src/proofconv.rs` (new), `relayer/src/lib.rs` (register), `relayer/src/main.rs` (subcommand).

`proofconv.rs` (pure):

- `pub fn dec_to_be32(decimal: &str) -> anyhow::Result<String>` — parse a base-10 string to a non-negative integer; error if it does not fit in 32 bytes; return exactly 64 lowercase hex chars (left-zero-padded big-endian).
- `pub fn proof_abc(proof_json: &str) -> anyhow::Result<(String, String, String)>` — parse snarkjs `proof.json`:
  - `a = dec_to_be32(pi_a[0]) ++ dec_to_be32(pi_a[1])` (128 hex)
  - `b = dec_to_be32(pi_b[0][1]) ++ dec_to_be32(pi_b[0][0]) ++ dec_to_be32(pi_b[1][1]) ++ dec_to_be32(pi_b[1][0])` (256 hex) — i.e. x_c1‖x_c0‖y_c1‖y_c0
  - `c = dec_to_be32(pi_c[0]) ++ dec_to_be32(pi_c[1])` (128 hex)
- `pub fn public_fields(public_json: &str) -> anyhow::Result<(String, String, String, u32)>` — parse `public.json` array `[root, nullifierHash, recipient, denomination]` → `(root_hex, nullifier_hash_hex, recipient_fr_hex, denom)` where the three hex are `dec_to_be32(..)` and `denom = public[3].parse::<u32>()`.

`main.rs` subcommand:

```
ConvertProof { #[arg(long)] proof: String, #[arg(long)] public: Option<String> }
```

Behavior: read the proof file, build `{a,b,c}`. If `--public` given, also read it and emit root/nullifier_hash/recipient_fr/denom. Print a JSON object the caller can drop into `/withdraw` (minus `recipient`, which is the caller's destination address):

```json
{ "proof": { "a": "...", "b": "...", "c": "..." },
  "root": "<64hex>", "nullifier_hash": "<64hex>", "recipient_fr": "<64hex>", "denom": 10 }
```

The `proof` value is exactly the string `withdraw --proof` accepts; `root`/`nullifier_hash`/`recipient_fr` are bare hex (the `strip0x` fix already tolerates either).

**Tests** (`relayer/tests/proofconv.rs`, pure, against the committed `artifacts/circuit/{proof,public}.json`):
- `dec_to_be32`: `"0" -> 64 zeros`; `"255" -> ...ff`; a value > 2²⁵⁶ errors; output is always 64 chars.
- `proof_abc(artifacts proof)`: returns `(a,b,c)` with lengths 128/256/128 and all-hex.
- `public_fields(artifacts public)`: `root` ends with `…70bd86d4` (the known anchored root `0012f414…86d4`), `denom == 10`, `recipient_fr` = `dec_to_be32("103929005307927756724354605802047639613112342136")`.

## Component 3 — live mint validation + e2e update

**Files:** `relayer/scripts/e2e_smoke.sh` (use `convert-proof`).

- Update the smoke's withdraw step to build the proof via `relayer convert-proof --proof artifacts/circuit/proof.json --public artifacts/circuit/public.json`, merge in the `recipient` address, and POST to `/withdraw` (or invoke `withdraw` directly).
- Document the one-time trustline prerequisite: `stellar tx new change-trust --source-account <recipient> --line zUSDC:<issuer> ...`.

**Acceptance (run live, manual during execution):**
1. `stellar tx new change-trust` to give `my-stellar-wallet` a zUSDC trustline.
2. `relayer convert-proof` on the artifacts proof.
3. `withdraw` against the anchored root `0012f4149c6840973c2dee91e8ecd7dd2839be83b143607114e7b4cd70bd86d4` (denom 10), `recipient = my-stellar-wallet`.
4. Confirm the tx succeeds (verifier `Ok`, nullifier recorded) and `my-stellar-wallet`'s zUSDC balance is `100000000` (10 zUSDC @ 7 decimals).

This is one-shot: it consumes the artifacts proof's nullifier (expected).

## Out of scope

- In-browser (JS) proof conversion for the frontend (M5 will port `proofconv` logic to the web app).
- Retry/backoff tuning on `eth_getLogs` beyond the existing per-tick error logging.
- Distinguishing contract-level `withdraw` rejections (409 vs 502) — unchanged.

## Global constraints

- Keep existing tests green; keep all existing subcommands (`topic`, `path`, `backing`, `serve`, `backing-once`).
- Stage explicit files in commits (no `git add -A` / `-am`).
- Do not modify `poseidon.rs`, `merkle.rs`, `pathsvc.rs`.
- Byte encodings: 32-byte big-endian, lowercase hex, no `0x`; G2 ordering c1‖c0; A not negated.
