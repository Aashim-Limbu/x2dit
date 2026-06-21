# Relayer RPC chunking + proof converter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the relayer's `eth_getLogs` work against capped free-tier RPCs (chunked scanning) and add a `convert-proof` subcommand that turns a snarkjs proof into the Soroban `withdraw --proof` JSON, enabling a live withdraw→mint.

**Architecture:** `evm.rs` gains a pure `plan_windows` range splitter and a `get_logs_chunked` helper; `fetch_root_updates`/`fetch_deposits` page their ranges and gain a `window` param. A new pure `proofconv.rs` module encodes snarkjs decimal coords to the contract's byte layout (A=x‖y, B=x_c1‖x_c0‖y_c1‖y_c0, C=x‖y; 32-byte BE hex), exposed via a `convert-proof` CLI subcommand. The HTTP `/withdraw` is unchanged.

**Tech Stack:** Rust (edition 2021), tokio, axum, ureq, serde_json, num-bigint, hex.

## Global Constraints

- Byte encodings: 32-byte big-endian, lowercase hex, no `0x`. G2 point B uses c1‖c0 (imaginary‖real) ordering. Point A is NOT negated (the on-chain verifier negates A internally).
- `log_window_blocks` config field defaults to **9** (serde default), so existing config files keep parsing and free-tier RPCs work out of the box.
- Keep existing tests green; keep all subcommands (`topic`, `path`, `backing`, `serve`, `backing-once`).
- Stage explicit files in every commit — never `git add -A` or `git commit -am`.
- Do not modify `poseidon.rs`, `merkle.rs`, `pathsvc.rs`.
- Run tests with `cargo test --manifest-path relayer/Cargo.toml`.

---

## File Structure

- `relayer/src/config.rs` — add `log_window_blocks` (defaulted).
- `relayer/src/evm.rs` — add `plan_windows` (pure) + `get_logs_chunked`; add `window` param to `fetch_root_updates`/`fetch_deposits`; `fetch_deposits` reads `current_block` for a head.
- `relayer/src/backing.rs`, `relayer/src/withdrawal.rs`, `relayer/src/main.rs` — pass `cfg.log_window_blocks` to the fetch calls.
- `relayer/src/proofconv.rs` — **new**: `dec_to_be32`, `proof_abc`, `public_fields`.
- `relayer/src/lib.rs` — register `proofconv`.
- `relayer/Cargo.toml` — add `num-bigint`, `num-traits`.
- `relayer/config.example.toml`, `relayer/README.md`, `relayer/scripts/e2e_smoke.sh` — docs + e2e using `convert-proof`.
- Tests: `relayer/tests/config_and_parse.rs` (extend), `relayer/tests/evm_decode.rs` (extend), `relayer/tests/proofconv.rs` (new).

---

## Task 1: Config `log_window_blocks`

**Files:**
- Modify: `relayer/src/config.rs`
- Modify: `relayer/config.example.toml`
- Test: `relayer/tests/config_and_parse.rs`

**Interfaces:**
- Produces: `Config.log_window_blocks: u64` (serde default 9).

- [ ] **Step 1: Extend the failing test** — in `relayer/tests/config_and_parse.rs`, add an assertion to the existing `config_defaults_when_omitted` test (it omits the field):

```rust
    assert_eq!(cfg.log_window_blocks, 9);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path relayer/Cargo.toml config_defaults_when_omitted`
Expected: FAIL (no field `log_window_blocks`).

- [ ] **Step 3: Add the field + default fn in `relayer/src/config.rs`** — add the default fn next to the others:

```rust
fn default_log_window() -> u64 { 9 }
```

and add to the `Config` struct (after `http_bind`):

```rust
    /// Max block span per eth_getLogs call (free RPCs cap this; Alchemy free = 10).
    #[serde(default = "default_log_window")]
    pub log_window_blocks: u64,
```

- [ ] **Step 4: Document it in `relayer/config.example.toml`** — add a line under the existing fields:

```toml
log_window_blocks  = 9             # max blocks per eth_getLogs (raise on a paid RPC)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --manifest-path relayer/Cargo.toml`
Expected: PASS (all suites green).

- [ ] **Step 6: Commit**

```bash
git add relayer/src/config.rs relayer/config.example.toml relayer/tests/config_and_parse.rs
git commit -m "feat(relayer): add log_window_blocks config (default 9) for chunked eth_getLogs"
```

---

## Task 2: Chunked `eth_getLogs` in `evm.rs`

**Files:**
- Modify: `relayer/src/evm.rs`
- Modify: `relayer/src/backing.rs:78`, `relayer/src/withdrawal.rs:66-67`, `relayer/src/main.rs:42`
- Test: `relayer/tests/evm_decode.rs`

**Interfaces:**
- Consumes: `Config.log_window_blocks` (Task 1), `decode_root_log`/`decode_deposit_log`/`current_block`/`root_updated_topic0`/`deposit_topic0` (existing).
- Produces:
  - `pub fn plan_windows(from: u64, to: u64, window: u64) -> Vec<(u64, u64)>`
  - `pub fn fetch_root_updates(rpc: &str, contract: &str, from_block: u64, to_block: u64, window: u64) -> Result<Vec<RootLog>>`
  - `pub fn fetch_deposits(rpc: &str, contract: &str, from_block: u64, window: u64) -> Result<Vec<DepositLog>>`

- [ ] **Step 1: Write the failing test** — add to `relayer/tests/evm_decode.rs`:

```rust
#[test]
fn plan_windows_splits_inclusive_ranges() {
    assert_eq!(relayer::evm::plan_windows(0, 25, 10), vec![(0, 9), (10, 19), (20, 25)]);
    assert_eq!(relayer::evm::plan_windows(5, 5, 10), vec![(5, 5)]);
    assert_eq!(relayer::evm::plan_windows(10, 5, 10), Vec::<(u64, u64)>::new()); // from > to
    assert_eq!(relayer::evm::plan_windows(0, 100, 0), Vec::<(u64, u64)>::new()); // window 0 guard
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path relayer/Cargo.toml --test evm_decode plan_windows`
Expected: FAIL (`plan_windows` not found).

- [ ] **Step 3: Implement chunking in `relayer/src/evm.rs`** — add `plan_windows` + `get_logs_chunked`, and replace the bodies of `fetch_root_updates` and `fetch_deposits`:

```rust
/// Split an inclusive [from, to] range into <= `window`-block chunks.
pub fn plan_windows(from: u64, to: u64, window: u64) -> Vec<(u64, u64)> {
    let mut out = Vec::new();
    if window == 0 || to < from {
        return out;
    }
    let mut start = from;
    loop {
        let end = core::cmp::min(start + window - 1, to);
        out.push((start, end));
        if end >= to {
            break;
        }
        start = end + 1;
    }
    out
}

/// Page an eth_getLogs query for `topic0` over [from, to] in <= `window`-block
/// chunks and return the raw log values (free-tier RPCs cap the per-call span).
fn get_logs_chunked(
    rpc: &str, contract: &str, topic0: &str, from: u64, to: u64, window: u64,
) -> Result<Vec<serde_json::Value>> {
    let mut all = Vec::new();
    for (start, end) in plan_windows(from, to, window) {
        let body = json!({
            "jsonrpc": "2.0", "id": 1, "method": "eth_getLogs",
            "params": [{
                "address": contract,
                "topics": [topic0],
                "fromBlock": format!("0x{:x}", start),
                "toBlock": format!("0x{:x}", end)
            }]
        });
        let resp: serde_json::Value = ureq::post(rpc).send_json(body)?.into_json()?;
        if let Some(e) = resp.get("error") {
            return Err(anyhow!("eth_getLogs error: {e}"));
        }
        let logs = resp["result"].as_array().ok_or_else(|| anyhow!("no result array"))?;
        all.extend(logs.iter().cloned());
    }
    Ok(all)
}
```

Replace the existing `fetch_root_updates` with:

```rust
pub fn fetch_root_updates(
    rpc: &str, contract: &str, from_block: u64, to_block: u64, window: u64,
) -> Result<Vec<RootLog>> {
    let logs = get_logs_chunked(rpc, contract, &root_updated_topic0(), from_block, to_block, window)?;
    let mut out = Vec::new();
    for log in &logs {
        out.push(decode_root_log(log)?);
    }
    out.sort_by_key(|r| r.block);
    Ok(out)
}
```

Replace the existing `fetch_deposits` with (note: now reads the head itself):

```rust
pub fn fetch_deposits(
    rpc: &str, contract: &str, from_block: u64, window: u64,
) -> Result<Vec<DepositLog>> {
    let head = current_block(rpc)?;
    let logs = get_logs_chunked(rpc, contract, &deposit_topic0(), from_block, head, window)?;
    let mut out = Vec::new();
    for log in &logs {
        out.push(decode_deposit_log(log)?);
    }
    out.sort_by_key(|d| d.leaf_index);
    Ok(out)
}
```

- [ ] **Step 4: Update the caller in `relayer/src/backing.rs`** — the `tick` fn fetches root updates via `spawn_blocking`. Add a `window` binding and pass it:

Change the events fetch block (currently around line 76-84) to:

```rust
    let events = {
        let (rpc, contract) = (rpc.clone(), contract.clone());
        let window = cfg.log_window_blocks;
        tokio::task::spawn_blocking(move || evm::fetch_root_updates(&rpc, &contract, from_block, to_block, window))
            .await??
    };
```

- [ ] **Step 5: Update the caller in `relayer/src/withdrawal.rs`** — in `path_handler`, change the deposits fetch (around line 66-67):

```rust
    let (rpc, contract, from_block) = (st.cfg.evm_rpc.clone(), st.cfg.deposit_contract.clone(), st.cfg.from_block);
    let window = st.cfg.log_window_blocks;
    let deposits = match tokio::task::spawn_blocking(move || evm::fetch_deposits(&rpc, &contract, from_block, window)).await {
```

- [ ] **Step 6: Update the caller in `relayer/src/main.rs`** — in the `Cmd::Path` arm (line 42):

```rust
            let deposits = evm::fetch_deposits(&cfg.evm_rpc, &cfg.deposit_contract, cfg.from_block, cfg.log_window_blocks)?;
```

- [ ] **Step 7: Run tests + build**

Run: `cargo test --manifest-path relayer/Cargo.toml`
Expected: PASS (new `plan_windows` test + all prior; crate builds clean).

- [ ] **Step 8: Commit**

```bash
git add relayer/src/evm.rs relayer/src/backing.rs relayer/src/withdrawal.rs relayer/src/main.rs relayer/tests/evm_decode.rs
git commit -m "feat(relayer): chunk eth_getLogs into log_window_blocks windows (free-tier RPC support)"
```

---

## Task 3: `proofconv` module

**Files:**
- Modify: `relayer/Cargo.toml`
- Create: `relayer/src/proofconv.rs`
- Modify: `relayer/src/lib.rs`
- Test: `relayer/tests/proofconv.rs`

**Interfaces:**
- Produces:
  - `pub fn dec_to_be32(decimal: &str) -> anyhow::Result<String>` (64-char lowercase hex)
  - `pub fn proof_abc(proof_json: &str) -> anyhow::Result<(String, String, String)>` (a 128hex, b 256hex, c 128hex)
  - `pub fn public_fields(public_json: &str) -> anyhow::Result<(String, String, String, u32)>` (root, nullifier_hash, recipient_fr, denom)

- [ ] **Step 1: Add deps to `relayer/Cargo.toml`** (under `[dependencies]`):

```toml
num-bigint = "0.4"
num-traits = "0.2"
```

- [ ] **Step 2: Register the module in `relayer/src/lib.rs`** — add:

```rust
pub mod proofconv;
```

- [ ] **Step 3: Write the failing test** — create `relayer/tests/proofconv.rs`:

```rust
use relayer::proofconv::{dec_to_be32, proof_abc, public_fields};

#[test]
fn dec_to_be32_pads_and_rejects_overflow() {
    assert_eq!(dec_to_be32("0").unwrap(), "0".repeat(64));
    assert_eq!(dec_to_be32("255").unwrap(), format!("{}ff", "0".repeat(62)));
    assert_eq!(dec_to_be32("255").unwrap().len(), 64);
    // 2^256 does not fit in 32 bytes
    let two_256 = "115792089237316195423570985008687907853269984665640564039457584007913129639936";
    assert!(dec_to_be32(two_256).is_err());
}

#[test]
fn proof_abc_has_right_lengths_and_is_hex() {
    let p = std::fs::read_to_string("../artifacts/circuit/proof.json").unwrap();
    let (a, b, c) = proof_abc(&p).unwrap();
    assert_eq!(a.len(), 128);
    assert_eq!(b.len(), 256);
    assert_eq!(c.len(), 128);
    assert!(a.chars().chain(b.chars()).chain(c.chars()).all(|ch| ch.is_ascii_hexdigit()));
}

#[test]
fn public_fields_match_known_artifacts() {
    let pj = std::fs::read_to_string("../artifacts/circuit/public.json").unwrap();
    let (root, _nh, rfr, denom) = public_fields(&pj).unwrap();
    // anchored root 0012f414...70bd86d4 ; denom 10 ; recipient_fr from public[2]
    assert!(root.ends_with("70bd86d4"));
    assert_eq!(denom, 10);
    assert_eq!(rfr, dec_to_be32("103929005307927756724354605802047639613112342136").unwrap());
}
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cargo test --manifest-path relayer/Cargo.toml --test proofconv`
Expected: FAIL (module `proofconv` not found).

- [ ] **Step 5: Implement `relayer/src/proofconv.rs`:**

```rust
//! Convert a snarkjs Groth16 proof (proof.json + public.json) into the byte
//! layout the Soroban verifier/`withdraw` expects.
//!   A = x || y                       (64 bytes)
//!   B = x_c1 || x_c0 || y_c1 || y_c0 (128 bytes, Soroban c1||c0 ordering)
//!   C = x || y                       (64 bytes)
//! All coords are 32-byte big-endian, lowercase hex, no 0x. A is NOT negated
//! (the on-chain verifier negates A internally for the pairing check).
use anyhow::{anyhow, Result};
use num_bigint::BigUint;
use num_traits::Num;
use serde_json::Value;

/// Decimal string -> 64-char lowercase hex (32-byte big-endian). Errors if > 32 bytes.
pub fn dec_to_be32(decimal: &str) -> Result<String> {
    let n = BigUint::from_str_radix(decimal.trim(), 10).map_err(|e| anyhow!("bad decimal: {e}"))?;
    let be = n.to_bytes_be();
    if be.len() > 32 {
        return Err(anyhow!("value exceeds 32 bytes"));
    }
    let mut buf = [0u8; 32];
    buf[32 - be.len()..].copy_from_slice(&be);
    Ok(hex::encode(buf))
}

fn coord(v: &Value) -> Result<String> {
    let s = v.as_str().ok_or_else(|| anyhow!("expected string coordinate"))?;
    dec_to_be32(s)
}

/// snarkjs proof.json -> (a, b, c) hex strings (lengths 128/256/128).
pub fn proof_abc(proof_json: &str) -> Result<(String, String, String)> {
    let v: Value = serde_json::from_str(proof_json)?;
    let (pa, pb, pc) = (&v["pi_a"], &v["pi_b"], &v["pi_c"]);
    let a = format!("{}{}", coord(&pa[0])?, coord(&pa[1])?);
    // pi_b = [[x_c0, x_c1], [y_c0, y_c1], [_, _]] ; Soroban wants x_c1||x_c0||y_c1||y_c0
    let b = format!(
        "{}{}{}{}",
        coord(&pb[0][1])?, coord(&pb[0][0])?, coord(&pb[1][1])?, coord(&pb[1][0])?
    );
    let c = format!("{}{}", coord(&pc[0])?, coord(&pc[1])?);
    Ok((a, b, c))
}

/// snarkjs public.json [root, nullifierHash, recipient, denomination]
/// -> (root_hex, nullifier_hash_hex, recipient_fr_hex, denom).
pub fn public_fields(public_json: &str) -> Result<(String, String, String, u32)> {
    let v: Value = serde_json::from_str(public_json)?;
    let arr = v.as_array().ok_or_else(|| anyhow!("public.json is not an array"))?;
    if arr.len() < 4 {
        return Err(anyhow!("expected 4 public signals, got {}", arr.len()));
    }
    let root = coord(&arr[0])?;
    let nh = coord(&arr[1])?;
    let recipient_fr = coord(&arr[2])?;
    let denom: u32 = arr[3]
        .as_str()
        .ok_or_else(|| anyhow!("denom not a string"))?
        .parse()
        .map_err(|e| anyhow!("bad denom: {e}"))?;
    Ok((root, nh, recipient_fr, denom))
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cargo test --manifest-path relayer/Cargo.toml --test proofconv`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add relayer/Cargo.toml relayer/src/proofconv.rs relayer/src/lib.rs relayer/tests/proofconv.rs
git commit -m "feat(relayer): proofconv — snarkjs proof/public -> Soroban byte layout"
```

---

## Task 4: `convert-proof` subcommand

**Files:**
- Modify: `relayer/src/main.rs`

**Interfaces:**
- Consumes: `relayer::proofconv::{proof_abc, public_fields}` (Task 3).
- Produces: CLI `relayer convert-proof --proof <path> [--public <path>]`.

- [ ] **Step 1: Add the variant to the `Cmd` enum in `relayer/src/main.rs`:**

```rust
    /// Convert a snarkjs proof.json (+ optional public.json) into the JSON that
    /// `withdraw --proof` accepts (and the root/nullifier_hash/recipient_fr/denom).
    ConvertProof {
        #[arg(long)]
        proof: String,
        #[arg(long)]
        public: Option<String>,
    },
```

- [ ] **Step 2: Add the match arm** (inside `match cli.cmd`):

```rust
        Cmd::ConvertProof { proof, public } => {
            let proof_json = std::fs::read_to_string(&proof)?;
            let (a, b, c) = relayer::proofconv::proof_abc(&proof_json)?;
            let mut out = serde_json::json!({ "proof": { "a": a, "b": b, "c": c } });
            if let Some(pub_path) = public {
                let public_json = std::fs::read_to_string(&pub_path)?;
                let (root, nh, rfr, denom) = relayer::proofconv::public_fields(&public_json)?;
                out["root"] = serde_json::Value::String(root);
                out["nullifier_hash"] = serde_json::Value::String(nh);
                out["recipient_fr"] = serde_json::Value::String(rfr);
                out["denom"] = serde_json::Value::Number(denom.into());
            }
            println!("{}", serde_json::to_string_pretty(&out)?);
        }
```

- [ ] **Step 3: Build + smoke the subcommand**

Run: `cargo build --manifest-path relayer/Cargo.toml && ./relayer/target/debug/relayer convert-proof --proof artifacts/circuit/proof.json --public artifacts/circuit/public.json`
Expected: prints a JSON object with `proof.a` (128 hex), `proof.b` (256 hex), `proof.c` (128 hex), plus `root`, `nullifier_hash`, `recipient_fr`, `denom: 10`.

- [ ] **Step 4: Run the full suite**

Run: `cargo test --manifest-path relayer/Cargo.toml`
Expected: PASS (all prior tests; crate builds with the new subcommand).

- [ ] **Step 5: Commit**

```bash
git add relayer/src/main.rs
git commit -m "feat(relayer): convert-proof subcommand (snarkjs -> withdraw --proof JSON)"
```

---

## Task 5: e2e smoke + docs

**Files:**
- Modify: `relayer/scripts/e2e_smoke.sh`
- Modify: `relayer/README.md`

**Interfaces:** none (scripting/docs).

- [ ] **Step 1: Update the withdraw step in `relayer/scripts/e2e_smoke.sh`** — replace the existing "withdraw" section (the one that did `PROOF=$(cat ...)` and hand-built the JSON) with a `convert-proof`-based version:

```bash
echo "== 3. convert proof + withdraw =="
# Build the withdraw body from the known-good artifacts proof. The artifacts'
# root (0012f4...) must already be anchored on-chain under denom 10, and
# $RECIPIENT must hold a zUSDC trustline (stellar tx new change-trust).
REL=./relayer/target/debug/relayer
BODY=$("$REL" --config relayer/config.toml convert-proof \
  --proof artifacts/circuit/proof.json --public artifacts/circuit/public.json \
  | python3 -c "import sys,json; d=json.load(sys.stdin); d['recipient']='$RECIPIENT'; print(json.dumps(d))")
curl -fsS -X POST "$BASE/withdraw" -H 'content-type: application/json' -d "$BODY" | tee /tmp/withdraw.json

echo "== 4. assert a tx hash came back =="
grep -q '"tx_hash"' /tmp/withdraw.json && echo "SMOKE OK"
```

Also update the header comment block to note the trustline prerequisite:

```bash
#   RECIPIENT must hold a zUSDC trustline first:
#     stellar tx new change-trust --source-account <RECIPIENT-identity> \
#       --line zUSDC:<issuer-G-address> --network testnet
```

- [ ] **Step 2: Update `relayer/README.md`** — add the `convert-proof` command under the Commands section and a note about `log_window_blocks`:

In the Commands list, add:

```markdown
    relayer convert-proof --proof artifacts/circuit/proof.json --public artifacts/circuit/public.json
```

And add a short note after the config section:

```markdown
`log_window_blocks` (default 9) caps the block span per `eth_getLogs` call so the
daemon and `/path` work on free-tier RPCs (Alchemy free = 10-block range). Raise it
on a paid RPC for faster historical backfill.

`convert-proof` turns a snarkjs `proof.json` (+ `public.json`) into the `{a,b,c}`
JSON that `withdraw --proof` expects (G2 in c1||c0 order); add a `recipient`
address and POST it to `/withdraw`.
```

- [ ] **Step 3: Verify the script is valid + crate still builds**

Run: `bash -n relayer/scripts/e2e_smoke.sh && cargo build --manifest-path relayer/Cargo.toml`
Expected: no syntax errors; clean build.

- [ ] **Step 4: Commit**

```bash
git add relayer/scripts/e2e_smoke.sh relayer/README.md
git commit -m "docs(relayer): e2e smoke uses convert-proof; document log_window_blocks + convert-proof"
```

---

## Live acceptance (run during execution, after Task 4)

Not a code task — the final correctness proof for the byte layout:

1. Give a recipient a zUSDC trustline: `stellar tx new change-trust --source-account my-stellar-wallet --line zUSDC:<zusdc-issuer-G-address> --rpc-url https://soroban-testnet.stellar.org --network-passphrase "Test SDF Network ; September 2015"`.
2. `relayer convert-proof --proof artifacts/circuit/proof.json --public artifacts/circuit/public.json` → withdraw body.
3. Call `withdraw` against the anchored root `0012f4149c6840973c2dee91e8ecd7dd2839be83b143607114e7b4cd70bd86d4` (denom 10), `recipient = my-stellar-wallet`.
4. Confirm the tx succeeds and `my-stellar-wallet`'s zUSDC balance is `100000000` (10 zUSDC @ 7 decimals). One-shot: consumes the artifacts proof's nullifier.

---

## Self-Review notes

- **Spec coverage:** Component 1 (chunking) → Tasks 1,2. Component 2 (converter) → Tasks 3,4. Component 3 (e2e/docs/live mint) → Task 5 + the live acceptance section.
- **Type consistency:** `fetch_root_updates`/`fetch_deposits` gain `window: u64`; all three call sites (backing/withdrawal/main) updated to pass `cfg.log_window_blocks`. `proof_abc`/`public_fields`/`dec_to_be32` signatures match between Task 3 (def), Task 3 (tests), and Task 4 (subcommand use).
- **Existing tests preserved:** Task 1 extends `config_defaults_when_omitted`; Task 2 keeps `evm_decode` decoders; no changes to poseidon/merkle/pathsvc.
- **G2 ordering / A-not-negated** encoded in `proof_abc` and stated in the module doc + global constraints; ultimate check is the live mint.
