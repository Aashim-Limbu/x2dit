# Relayer Services Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the M4 relayer with a continuous backing daemon, a withdrawal HTTP server, and an e2e smoke harness.

**Architecture:** Convert the existing synchronous `relayer` crate to a `tokio` async binary with an `axum` HTTP server. The backing daemon scans Sepolia `RootUpdated` events and anchors recent roots into the Soroban pool idempotently (block-based cursor). The HTTP server exposes `/path`, `/withdraw`, `/health` for the frontend. Existing blocking calls are bridged: EVM JSON-RPC stays on `ureq` (via `spawn_blocking` in the daemon), the `stellar` CLI moves to `tokio::process::Command`.

**Tech Stack:** Rust (edition 2021), tokio, axum 0.7, ureq, zkhash (vendored Poseidon2), ark-ff 0.6, serde, clap.

## Global Constraints

- Async runtime: `tokio`; HTTP: `axum` 0.7. Bridge blocking work via `tokio::task::spawn_blocking` and `tokio::process::Command`.
- `config.denoms: Vec<u32>` is the list of pool denomination **values** (`[1, 10, 100]`), indexed by EVM `denomIndex`. The public HTTP API speaks **values**; map value→index only to filter EVM logs.
- `POST /withdraw` maps 1:1 to the real contract signature: `withdraw(proof, root, nullifier_hash, recipient_fr, recipient, denom)` (6 args).
- Config stays a flat struct; all new fields use `#[serde(default = ...)]` so the existing `relayer/config.toml` keeps parsing.
- Idempotency cursor is the **EVM block number** (monotonic), never the `RootUpdated.rootIndex` (ring-buffer index 0–29, wraps).
- Keep the existing CLI subcommands (`topic`, `path`, `backing-once`) working and the existing 8 integration tests green.
- Do not modify `poseidon.rs` (the keystone), `merkle.rs`, or `pathsvc.rs`.
- Live testnet values for the e2e: pool `CDFQ5K2BPKB7BWNW2SJPGIIK5OOFQIR434MOX5YYBDKAN3M5CFVJKHR2`, SAC `CAIUOHVZ77RSCDBNWR3BCZPTWHPUXQRTQXSW4VE3HGC2M5PRPJNSFBRU`, deposit contract `0x4c781728f3f53f220c6f226610cd24d8b1e8e7ef`, deploy block `11089276`, denom 10 anchored root `0012f4149c6840973c2dee91e8ecd7dd2839be83b143607114e7b4cd70bd86d4`.

---

## File Structure

- `relayer/Cargo.toml` — add `tokio`, `axum`; keep existing deps.
- `relayer/src/config.rs` — add `poll_interval_secs`, `confirmations`, `http_bind` (defaulted).
- `relayer/src/evm.rs` — add pure log decoders + `RootUpdated` reader + `current_block`.
- `relayer/src/state.rs` — **new**: `BackingState` cursor persisted to JSON.
- `relayer/src/backing.rs` — **new**: pure `decide()` + async `run_daemon()`.
- `relayer/src/withdrawal.rs` — **new**: axum app, handlers, `validate_withdraw`, `denom_index_of`.
- `relayer/src/soroban.rs` — convert to async (`tokio::process`).
- `relayer/src/lib.rs` — register new modules.
- `relayer/src/main.rs` — `#[tokio::main]`; add `backing` + `serve` subcommands.
- `relayer/config.example.toml` — add the new fields.
- `relayer/README.md` — **new**: usage.
- `relayer/scripts/e2e_smoke.sh` — **new**: live testnet smoke.
- Tests: `relayer/tests/evm_decode.rs`, `relayer/tests/idempotency.rs`, `relayer/tests/withdrawal_request.rs` (new); existing tests unchanged.

---

## Task 1: Async runtime + config extension

**Files:**
- Modify: `relayer/Cargo.toml`
- Modify: `relayer/src/config.rs`
- Modify: `relayer/src/main.rs`
- Test: `relayer/tests/config_and_parse.rs` (extend)

**Interfaces:**
- Produces: `Config` gains `poll_interval_secs: u64`, `confirmations: u64`, `http_bind: String` (all defaulted). `main` becomes `#[tokio::main] async fn`.

- [ ] **Step 1: Add deps to `relayer/Cargo.toml`** (append under `[dependencies]`):

```toml
tokio = { version = "1", features = ["full"] }
axum = "0.7"
```

- [ ] **Step 2: Write the failing test** — append to `relayer/tests/config_and_parse.rs`:

```rust
#[test]
fn config_defaults_when_omitted() {
    let toml = r#"
evm_rpc = "https://rpc"
deposit_contract = "0xabc"
stellar_network = "testnet"
soroban_rpc = "https://srpc"
pool_id = "CPOOL"
stellar_identity = "rel"
denoms = [1, 10, 100]
"#;
    let cfg = relayer::config::Config::from_toml_str(toml).unwrap();
    assert_eq!(cfg.poll_interval_secs, 15);
    assert_eq!(cfg.confirmations, 2);
    assert_eq!(cfg.http_bind, "127.0.0.1:8080");
    assert_eq!(cfg.from_block, 0);
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cargo test --manifest-path relayer/Cargo.toml config_defaults_when_omitted`
Expected: FAIL (no field `poll_interval_secs`).

- [ ] **Step 4: Add the fields to `relayer/src/config.rs`** — add the default fns and fields inside the struct (after `from_block`):

```rust
fn default_poll_interval() -> u64 { 15 }
fn default_confirmations() -> u64 { 2 }
fn default_http_bind() -> String { "127.0.0.1:8080".to_string() }
```

Add to the `Config` struct:

```rust
    /// Backing daemon loop cadence (seconds).
    #[serde(default = "default_poll_interval")]
    pub poll_interval_secs: u64,
    /// Scan only up to head - confirmations (EVM reorg safety).
    #[serde(default = "default_confirmations")]
    pub confirmations: u64,
    /// Withdrawal HTTP server bind address.
    #[serde(default = "default_http_bind")]
    pub http_bind: String,
```

- [ ] **Step 5: Make `main` async in `relayer/src/main.rs`** — change the signature and parse call:

```rust
#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.cmd {
        // ... existing arms unchanged for now ...
    }
    Ok(())
}
```

(The existing `BackingOnce` arm still calls the sync `soroban::update_root`; leave it until Task 5.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `cargo test --manifest-path relayer/Cargo.toml`
Expected: PASS (9 tests — the 8 existing + the new default test).

- [ ] **Step 7: Commit**

```bash
git add relayer/Cargo.toml relayer/src/config.rs relayer/src/main.rs relayer/tests/config_and_parse.rs
git commit -m "feat(relayer): async runtime (tokio/axum) + config fields for daemon/server"
```

---

## Task 2: EVM `RootUpdated` reader + pure log decoders

**Files:**
- Modify: `relayer/src/evm.rs`
- Test: `relayer/tests/evm_decode.rs` (create)

**Interfaces:**
- Produces:
  - `pub struct RootLog { pub denom_index: u8, pub root_hex: String, pub root_index: u32, pub block: u64 }`
  - `pub fn root_updated_topic0() -> String`
  - `pub fn decode_deposit_log(log: &serde_json::Value) -> anyhow::Result<DepositLog>`
  - `pub fn decode_root_log(log: &serde_json::Value) -> anyhow::Result<RootLog>`
  - `pub fn fetch_root_updates(rpc: &str, contract: &str, from_block: u64, to_block: u64) -> anyhow::Result<Vec<RootLog>>`
  - `pub fn current_block(rpc: &str) -> anyhow::Result<u64>`

- [ ] **Step 1: Write the failing test** — create `relayer/tests/evm_decode.rs`:

```rust
use serde_json::json;

#[test]
fn decodes_deposit_log() {
    // Deposit(uint8 idx=1, uint256 commitment=0x..0a, uint32 leafIndex=3)
    let log = json!({
        "topics": [
            relayer::evm::deposit_topic0(),
            "0x0000000000000000000000000000000000000000000000000000000000000001",
            "0x000000000000000000000000000000000000000000000000000000000000000a"
        ],
        "data": "0x0000000000000000000000000000000000000000000000000000000000000003",
        "blockNumber": "0x10"
    });
    let d = relayer::evm::decode_deposit_log(&log).unwrap();
    assert_eq!(d.denom_index, 1);
    assert_eq!(d.leaf_index, 3);
    assert!(d.commitment_hex.ends_with("0a"));
}

#[test]
fn decodes_root_log() {
    // RootUpdated(uint8 idx=2, uint256 root=0x..ff, uint32 rootIndex=5)  block 0x2a
    let root_word = "00000000000000000000000000000000000000000000000000000000000000ff";
    let idx_word  = "0000000000000000000000000000000000000000000000000000000000000005";
    let log = json!({
        "topics": [
            relayer::evm::root_updated_topic0(),
            "0x0000000000000000000000000000000000000000000000000000000000000002"
        ],
        "data": format!("0x{root_word}{idx_word}"),
        "blockNumber": "0x2a"
    });
    let r = relayer::evm::decode_root_log(&log).unwrap();
    assert_eq!(r.denom_index, 2);
    assert_eq!(r.root_index, 5);
    assert_eq!(r.block, 42);
    assert_eq!(r.root_hex, format!("0x{root_word}"));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path relayer/Cargo.toml --test evm_decode`
Expected: FAIL (`decode_root_log` / `RootLog` not found).

- [ ] **Step 3: Implement in `relayer/src/evm.rs`** — refactor the existing decode into a pure fn and add the root reader. Replace the body of `fetch_deposits`'s loop with a call to `decode_deposit_log`, and add the new items:

```rust
#[derive(Debug, Clone)]
pub struct RootLog {
    pub denom_index: u8,
    pub root_hex: String,   // 0x + 64 hex
    pub root_index: u32,
    pub block: u64,
}

/// keccak256("RootUpdated(uint8,uint256,uint32)") — the event topic0.
pub fn root_updated_topic0() -> String {
    let mut k = Keccak::v256();
    k.update(b"RootUpdated(uint8,uint256,uint32)");
    let mut out = [0u8; 32];
    k.finalize(&mut out);
    format!("0x{}", hex::encode(out))
}

fn block_of(log: &serde_json::Value) -> Result<u64> {
    let b = log["blockNumber"].as_str().ok_or_else(|| anyhow!("no blockNumber"))?;
    Ok(u64::from_str_radix(b.trim_start_matches("0x"), 16)?)
}

pub fn decode_deposit_log(log: &serde_json::Value) -> Result<DepositLog> {
    let topics = log["topics"].as_array().ok_or_else(|| anyhow!("no topics"))?;
    // uint8 indexed denomIndex is right-aligned in the 32-byte topic: last 2 hex.
    // (NOTE: the previous inline decode used [58..64], which read the wrong bytes
    // and always yielded 0 for nonzero denom indices — this fixes that latent bug.)
    let t1 = topics[1].as_str().unwrap();
    let denom_index = u8::from_str_radix(&t1[t1.len() - 2..], 16)?;
    let commitment_hex = topics[2].as_str().unwrap().to_string();
    let data = log["data"].as_str().unwrap();
    let h = data.trim_start_matches("0x");
    let leaf_index = u32::from_str_radix(&h[h.len() - 8..], 16)?;
    Ok(DepositLog { denom_index, commitment_hex, leaf_index })
}

pub fn decode_root_log(log: &serde_json::Value) -> Result<RootLog> {
    let topics = log["topics"].as_array().ok_or_else(|| anyhow!("no topics"))?;
    let t1 = topics[1].as_str().unwrap();
    let denom_index = u8::from_str_radix(&t1[t1.len() - 2..], 16)?;
    let data = log["data"].as_str().unwrap().trim_start_matches("0x");
    // abi: word0 = root (uint256), word1 = rootIndex (uint32, right-aligned)
    let root_hex = format!("0x{}", &data[0..64]);
    let root_index = u32::from_str_radix(&data[120..128], 16)?;
    Ok(RootLog { denom_index, root_hex, root_index, block: block_of(log)? })
}

pub fn current_block(rpc: &str) -> Result<u64> {
    let body = json!({"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]});
    let resp: serde_json::Value = ureq::post(rpc).send_json(body)?.into_json()?;
    let s = resp["result"].as_str().ok_or_else(|| anyhow!("no result"))?;
    Ok(u64::from_str_radix(s.trim_start_matches("0x"), 16)?)
}

pub fn fetch_root_updates(rpc: &str, contract: &str, from_block: u64, to_block: u64) -> Result<Vec<RootLog>> {
    let body = json!({
        "jsonrpc": "2.0", "id": 1, "method": "eth_getLogs",
        "params": [{
            "address": contract,
            "topics": [root_updated_topic0()],
            "fromBlock": format!("0x{:x}", from_block),
            "toBlock": format!("0x{:x}", to_block)
        }]
    });
    let resp: serde_json::Value = ureq::post(rpc).send_json(body)?.into_json()?;
    if let Some(e) = resp.get("error") { return Err(anyhow!("eth_getLogs error: {e}")); }
    let logs = resp["result"].as_array().ok_or_else(|| anyhow!("no result array"))?;
    let mut out = Vec::new();
    for log in logs { out.push(decode_root_log(log)?); }
    out.sort_by_key(|r| r.block);
    Ok(out)
}
```

Then in the existing `fetch_deposits`, replace the inline decode loop body with:

```rust
    let mut out = Vec::new();
    for log in logs { out.push(decode_deposit_log(log)?); }
    out.sort_by_key(|d| d.leaf_index);
    Ok(out)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path relayer/Cargo.toml --test evm_decode`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add relayer/src/evm.rs relayer/tests/evm_decode.rs
git commit -m "feat(relayer): RootUpdated reader + pure log decoders + current_block"
```

---

## Task 3: Backing state cursor (`state.rs`)

**Files:**
- Create: `relayer/src/state.rs`
- Modify: `relayer/src/lib.rs`
- Test: `relayer/tests/idempotency.rs` (create, part 1)

**Interfaces:**
- Produces:
  - `pub struct DenomCursor { pub last_scanned_block: u64, pub last_anchored_root: Option<String> }`
  - `pub struct BackingState { /* denoms: BTreeMap<u32, DenomCursor> */ }`
  - `BackingState::load(path: &str) -> BackingState` (default if file missing)
  - `BackingState::save(&self, path: &str) -> anyhow::Result<()>`
  - `BackingState::cursor(&self, denom_value: u32) -> DenomCursor`
  - `BackingState::record_anchor(&mut self, denom_value: u32, root_hex: &str)`
  - `BackingState::set_scanned(&mut self, denom_value: u32, block: u64)`

- [ ] **Step 1: Register module in `relayer/src/lib.rs`** — add line:

```rust
pub mod state;
```

- [ ] **Step 2: Write the failing test** — create `relayer/tests/idempotency.rs`:

```rust
use relayer::state::BackingState;

#[test]
fn cursor_defaults_and_roundtrips() {
    let mut st = BackingState::default();
    assert_eq!(st.cursor(10).last_scanned_block, 0);
    assert!(st.cursor(10).last_anchored_root.is_none());

    st.set_scanned(10, 100);
    st.record_anchor(10, "0xaa");
    assert_eq!(st.cursor(10).last_scanned_block, 100);
    assert_eq!(st.cursor(10).last_anchored_root.as_deref(), Some("0xaa"));

    let path = std::env::temp_dir().join("zkh-backing-state-test.json");
    let p = path.to_str().unwrap();
    st.save(p).unwrap();
    let st2 = BackingState::load(p);
    assert_eq!(st2.cursor(10).last_scanned_block, 100);
    assert_eq!(st2.cursor(10).last_anchored_root.as_deref(), Some("0xaa"));
    std::fs::remove_file(p).ok();
}

#[test]
fn load_missing_file_is_default() {
    let st = BackingState::load("/nonexistent/zkh-no-such-state.json");
    assert_eq!(st.cursor(1).last_scanned_block, 0);
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cargo test --manifest-path relayer/Cargo.toml --test idempotency`
Expected: FAIL (module `state` not found).

- [ ] **Step 4: Implement `relayer/src/state.rs`:**

```rust
//! Idempotency cursor for the backing daemon, persisted as JSON.
//! Cursor is the EVM block number (monotonic) — NOT the RootUpdated.rootIndex
//! (a ring-buffer index that wraps).
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
pub struct DenomCursor {
    pub last_scanned_block: u64,
    pub last_anchored_root: Option<String>,
}

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
pub struct BackingState {
    denoms: BTreeMap<u32, DenomCursor>,
}

impl BackingState {
    pub fn load(path: &str) -> BackingState {
        match std::fs::read_to_string(path) {
            Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
            Err(_) => BackingState::default(),
        }
    }

    pub fn save(&self, path: &str) -> anyhow::Result<()> {
        std::fs::write(path, serde_json::to_string_pretty(self)?)?;
        Ok(())
    }

    pub fn cursor(&self, denom_value: u32) -> DenomCursor {
        self.denoms.get(&denom_value).cloned().unwrap_or_default()
    }

    pub fn record_anchor(&mut self, denom_value: u32, root_hex: &str) {
        self.denoms.entry(denom_value).or_default().last_anchored_root = Some(root_hex.to_string());
    }

    pub fn set_scanned(&mut self, denom_value: u32, block: u64) {
        self.denoms.entry(denom_value).or_default().last_scanned_block = block;
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --manifest-path relayer/Cargo.toml --test idempotency`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add relayer/src/state.rs relayer/src/lib.rs relayer/tests/idempotency.rs
git commit -m "feat(relayer): backing state cursor (block-based, JSON-persisted)"
```

---

## Task 4: Backing `decide()` pure logic

**Files:**
- Create: `relayer/src/backing.rs` (decide + types only in this task)
- Modify: `relayer/src/lib.rs`
- Test: `relayer/tests/idempotency.rs` (extend, part 2)

**Interfaces:**
- Consumes: `relayer::state::BackingState`, `relayer::evm::RootLog`.
- Produces:
  - `pub struct AnchorAction { pub denom_value: u32, pub root_hex: String }`
  - `pub fn denom_value_for(denoms: &[u32], denom_index: u8) -> Option<u32>`
  - `pub fn decide(state: &BackingState, denoms: &[u32], events: &[relayer::evm::RootLog]) -> Vec<AnchorAction>`

- [ ] **Step 1: Register module in `relayer/src/lib.rs`** — add line:

```rust
pub mod backing;
```

- [ ] **Step 2: Write the failing test** — append to `relayer/tests/idempotency.rs`:

```rust
use relayer::backing::{decide, denom_value_for, AnchorAction};
use relayer::evm::RootLog;

fn ev(idx: u8, root: &str, block: u64) -> RootLog {
    RootLog { denom_index: idx, root_hex: root.into(), root_index: 0, block }
}

#[test]
fn decide_maps_index_to_value_and_dedups() {
    let denoms = vec![1u32, 10, 100];
    let mut st = BackingState::default();
    st.record_anchor(10, "0xaa"); // denom value 10 already at root aa

    // idx 1 -> value 10. First event repeats aa (skip), second is new bb (anchor).
    let events = vec![ev(1, "0xaa", 5), ev(1, "0xbb", 6)];
    let actions = decide(&st, &denoms, &events);
    assert_eq!(actions, vec![AnchorAction { denom_value: 10, root_hex: "0xbb".into() }]);
}

#[test]
fn decide_collapses_consecutive_duplicates_in_batch() {
    let denoms = vec![1u32, 10, 100];
    let st = BackingState::default();
    let events = vec![ev(0, "0xcc", 1), ev(0, "0xcc", 2), ev(0, "0xdd", 3)];
    let actions = decide(&st, &denoms, &events);
    assert_eq!(actions, vec![
        AnchorAction { denom_value: 1, root_hex: "0xcc".into() },
        AnchorAction { denom_value: 1, root_hex: "0xdd".into() },
    ]);
}

#[test]
fn denom_value_for_maps_by_index() {
    let denoms = vec![1u32, 10, 100];
    assert_eq!(denom_value_for(&denoms, 0), Some(1));
    assert_eq!(denom_value_for(&denoms, 2), Some(100));
    assert_eq!(denom_value_for(&denoms, 9), None);
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cargo test --manifest-path relayer/Cargo.toml --test idempotency`
Expected: FAIL (module `backing` not found).

- [ ] **Step 4: Implement `relayer/src/backing.rs`** (decide + types; the daemon loop is Task 6):

```rust
//! Backing daemon: scan Sepolia RootUpdated events and anchor recent roots
//! into the Soroban pool. `decide` is the pure core (dedup + index->value);
//! `run_daemon` (Task 6) wires it to I/O.
use crate::evm::RootLog;
use crate::state::BackingState;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnchorAction {
    pub denom_value: u32,
    pub root_hex: String,
}

/// Map an EVM denomIndex to the pool denomination value via the config list.
pub fn denom_value_for(denoms: &[u32], denom_index: u8) -> Option<u32> {
    denoms.get(denom_index as usize).copied()
}

/// Pure: given prior state, the denom value table, and the events found in a
/// block range (assumed block-ordered), return the anchors to perform in order.
/// Skips any root equal to the last-known root for that denom value (carrying
/// the running last-root forward within the batch so duplicates collapse).
pub fn decide(state: &BackingState, denoms: &[u32], events: &[RootLog]) -> Vec<AnchorAction> {
    use std::collections::HashMap;
    let mut last: HashMap<u32, Option<String>> = HashMap::new();
    let mut actions = Vec::new();
    for e in events {
        let Some(value) = denom_value_for(denoms, e.denom_index) else { continue };
        let prev = last
            .entry(value)
            .or_insert_with(|| state.cursor(value).last_anchored_root);
        if prev.as_deref() == Some(e.root_hex.as_str()) {
            continue;
        }
        *prev = Some(e.root_hex.clone());
        actions.push(AnchorAction { denom_value: value, root_hex: e.root_hex.clone() });
    }
    actions
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --manifest-path relayer/Cargo.toml --test idempotency`
Expected: PASS (5 tests in this file).

- [ ] **Step 6: Commit**

```bash
git add relayer/src/backing.rs relayer/src/lib.rs relayer/tests/idempotency.rs
git commit -m "feat(relayer): backing decide() — index->value mapping + dedup"
```

---

## Task 5: Convert `soroban.rs` to async

**Files:**
- Modify: `relayer/src/soroban.rs`
- Modify: `relayer/src/main.rs` (await `BackingOnce`)
- Test: existing `relayer/tests/config_and_parse.rs::extracts_tx_hash_from_cli_output` stays green.

**Interfaces:**
- Produces (signatures change to async):
  - `pub async fn update_root(pool_id, network, rpc, identity, denom: u32, root_hex) -> Result<String>`
  - `pub async fn withdraw(pool_id, network, rpc, identity, proof_json, root_hex, nullifier_hash_hex, recipient_fr_hex, recipient, denom: u32) -> Result<String>`
  - `extract_tx_hash(&str) -> Option<String>` unchanged (pure).

- [ ] **Step 1: Convert `invoke` and the two entrypoints to async** in `relayer/src/soroban.rs` — replace the `use` + `invoke` + make both fns async:

```rust
use anyhow::{anyhow, Result};
use tokio::process::Command;

async fn invoke(args: &[String]) -> Result<String> {
    let out = Command::new("stellar").args(args).output().await?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    if !out.status.success() {
        return Err(anyhow!("stellar invoke failed: {stderr}"));
    }
    Ok(format!("{stdout}\n{stderr}"))
}
```

Change `pub fn update_root(...)` to `pub async fn update_root(...)` and its call to `let out = invoke(&args).await?;`. Do the same for `withdraw` (`pub async fn` + `invoke(&args).await?`). `extract_tx_hash` is unchanged.

- [ ] **Step 2: Update the `BackingOnce` arm in `relayer/src/main.rs`** to await:

```rust
        Cmd::BackingOnce { denom, root } => {
            let cfg = Config::from_path(&cli.config)?;
            let tx = soroban::update_root(
                &cfg.pool_id, &cfg.stellar_network, &cfg.soroban_rpc, &cfg.stellar_identity, denom, &root,
            ).await?;
            println!("anchored root for denom {denom}, tx {tx}");
        }
```

- [ ] **Step 3: Run tests + build to verify nothing broke**

Run: `cargo test --manifest-path relayer/Cargo.toml`
Expected: PASS (all existing tests; `extracts_tx_hash_from_cli_output` still green; crate builds async).

- [ ] **Step 4: Commit**

```bash
git add relayer/src/soroban.rs relayer/src/main.rs
git commit -m "feat(relayer): soroban invoke layer -> async (tokio::process)"
```

---

## Task 6: Backing daemon loop + `backing` subcommand

**Files:**
- Modify: `relayer/src/backing.rs` (add `run_daemon`)
- Modify: `relayer/src/main.rs` (add `Backing` subcommand)

**Interfaces:**
- Consumes: `Config`, `evm::{current_block, fetch_root_updates}`, `state::BackingState`, `soroban::update_root`, `decide`.
- Produces: `pub async fn run_daemon(cfg: &crate::config::Config, state_path: &str) -> anyhow::Result<()>`

- [ ] **Step 1: Add `run_daemon` to `relayer/src/backing.rs`:**

```rust
use crate::config::Config;
use crate::{evm, soroban};

/// Continuous backing loop: scan RootUpdated since the cursor, anchor new roots,
/// persist the cursor only after success, then sleep. Never crashes on transient
/// errors — logs and retries next tick.
pub async fn run_daemon(cfg: &Config, state_path: &str) -> anyhow::Result<()> {
    let mut state = BackingState::load(state_path);
    let denoms = cfg.denoms.clone();
    loop {
        if let Err(e) = tick(cfg, &denoms, &mut state, state_path).await {
            eprintln!("[backing] tick error (will retry): {e}");
        }
        tokio::time::sleep(std::time::Duration::from_secs(cfg.poll_interval_secs)).await;
    }
}

async fn tick(cfg: &Config, denoms: &[u32], state: &mut BackingState, state_path: &str) -> anyhow::Result<()> {
    let rpc = cfg.evm_rpc.clone();
    let contract = cfg.deposit_contract.clone();
    let head = {
        let rpc = rpc.clone();
        tokio::task::spawn_blocking(move || evm::current_block(&rpc)).await??
    };
    let to_block = head.saturating_sub(cfg.confirmations);
    // start from the min cursor across denoms (default cfg.from_block)
    let from_block = denoms
        .iter()
        .map(|d| {
            let c = state.cursor(*d).last_scanned_block;
            if c == 0 { cfg.from_block } else { c + 1 }
        })
        .min()
        .unwrap_or(cfg.from_block);
    if to_block < from_block {
        return Ok(());
    }
    let events = {
        let (rpc, contract) = (rpc.clone(), contract.clone());
        tokio::task::spawn_blocking(move || evm::fetch_root_updates(&rpc, &contract, from_block, to_block))
            .await??
    };
    let actions = decide(state, denoms, &events);
    for a in actions {
        let tx = soroban::update_root(
            &cfg.pool_id, &cfg.stellar_network, &cfg.soroban_rpc, &cfg.stellar_identity,
            a.denom_value, &a.root_hex,
        ).await?;
        println!("[backing] anchored denom {} root {} (tx {})", a.denom_value, a.root_hex, tx);
        state.record_anchor(a.denom_value, &a.root_hex);
    }
    for d in denoms {
        state.set_scanned(*d, to_block);
    }
    state.save(state_path)?;
    Ok(())
}
```

- [ ] **Step 2: Add the `Backing` subcommand to `relayer/src/main.rs`** — add to the `Cmd` enum:

```rust
    /// Run the continuous backing daemon (poll RootUpdated -> Pool.update_root).
    Backing {
        #[arg(long, default_value = "backing-state.json")]
        state: String,
    },
```

And add the match arm (inside `match cli.cmd`):

```rust
        Cmd::Backing { state } => {
            let cfg = Config::from_path(&cli.config)?;
            relayer::backing::run_daemon(&cfg, &state).await?;
        }
```

Add `relayer::backing` is available via the crate; the existing `use relayer::{...}` already imports modules, but add `backing` to it if needed (it's referenced fully-qualified above, so no import change required).

- [ ] **Step 3: Build to verify it compiles**

Run: `cargo build --manifest-path relayer/Cargo.toml`
Expected: builds clean (one daemon loop, no warnings that fail the build).

- [ ] **Step 4: Run the unit tests (still green)**

Run: `cargo test --manifest-path relayer/Cargo.toml`
Expected: PASS (all prior tests).

- [ ] **Step 5: Commit**

```bash
git add relayer/src/backing.rs relayer/src/main.rs
git commit -m "feat(relayer): backing daemon loop + `backing` subcommand"
```

---

## Task 7: Withdrawal HTTP server + `serve` subcommand

**Files:**
- Create: `relayer/src/withdrawal.rs`
- Modify: `relayer/src/lib.rs`
- Modify: `relayer/src/main.rs` (add `Serve` subcommand)
- Test: `relayer/tests/withdrawal_request.rs` (create)

**Interfaces:**
- Consumes: `Config`, `evm::fetch_deposits`, `pathsvc::path_for`, `poseidon::Fr`, `soroban::withdraw`.
- Produces:
  - `pub struct WithdrawRequest { proof: String, root: String, nullifier_hash: String, recipient_fr: String, recipient: String, denom: u32 }`
  - `pub fn denom_index_of(denoms: &[u32], value: u32) -> Option<usize>`
  - `pub fn validate_withdraw(req: &WithdrawRequest, denoms: &[u32]) -> Result<(), String>`
  - `pub fn app(cfg: std::sync::Arc<Config>) -> axum::Router`
  - `pub async fn serve(cfg: Config) -> anyhow::Result<()>`

- [ ] **Step 1: Register module in `relayer/src/lib.rs`** — add line:

```rust
pub mod withdrawal;
```

- [ ] **Step 2: Write the failing test** — create `relayer/tests/withdrawal_request.rs`:

```rust
use relayer::withdrawal::{denom_index_of, validate_withdraw, WithdrawRequest};

fn req(denom: u32) -> WithdrawRequest {
    WithdrawRequest {
        proof: "{}".into(),
        root: "0x01".into(),
        nullifier_hash: "0x02".into(),
        recipient_fr: "0x03".into(),
        recipient: "GABC".into(),
        denom,
    }
}

#[test]
fn maps_value_to_index() {
    let denoms = vec![1u32, 10, 100];
    assert_eq!(denom_index_of(&denoms, 1), Some(0));
    assert_eq!(denom_index_of(&denoms, 100), Some(2));
    assert_eq!(denom_index_of(&denoms, 7), None);
}

#[test]
fn validate_accepts_configured_denom() {
    let denoms = vec![1u32, 10, 100];
    assert!(validate_withdraw(&req(10), &denoms).is_ok());
}

#[test]
fn validate_rejects_unconfigured_denom() {
    let denoms = vec![1u32, 10, 100];
    assert!(validate_withdraw(&req(7), &denoms).is_err());
}

#[test]
fn validate_rejects_empty_field() {
    let denoms = vec![1u32, 10, 100];
    let mut r = req(10);
    r.recipient = "".into();
    assert!(validate_withdraw(&r, &denoms).is_err());
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cargo test --manifest-path relayer/Cargo.toml --test withdrawal_request`
Expected: FAIL (module `withdrawal` not found).

- [ ] **Step 4: Implement `relayer/src/withdrawal.rs`:**

```rust
//! Withdrawal HTTP server (axum): GET /health, GET /path, POST /withdraw.
use crate::config::Config;
use crate::poseidon::Fr;
use crate::{evm, pathsvc, soroban};
use ark_ff::PrimeField;
use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct WithdrawRequest {
    pub proof: String,
    pub root: String,
    pub nullifier_hash: String,
    pub recipient_fr: String,
    pub recipient: String,
    pub denom: u32,
}

pub fn denom_index_of(denoms: &[u32], value: u32) -> Option<usize> {
    denoms.iter().position(|d| *d == value)
}

pub fn validate_withdraw(req: &WithdrawRequest, denoms: &[u32]) -> Result<(), String> {
    if denom_index_of(denoms, req.denom).is_none() {
        return Err(format!("denom {} not configured", req.denom));
    }
    for (name, v) in [
        ("proof", &req.proof), ("root", &req.root), ("nullifier_hash", &req.nullifier_hash),
        ("recipient_fr", &req.recipient_fr), ("recipient", &req.recipient),
    ] {
        if v.trim().is_empty() {
            return Err(format!("{name} must not be empty"));
        }
    }
    Ok(())
}

#[derive(Deserialize)]
struct PathQuery { denom: u32, leaf_index: usize }

#[derive(Clone)]
struct AppState { cfg: Arc<Config> }

fn fr_from_be(be: &[u8]) -> Fr { Fr::from_be_bytes_mod_order(be) }

async fn health(State(st): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "deposit_contract": st.cfg.deposit_contract,
        "pool_id": st.cfg.pool_id,
        "denoms": st.cfg.denoms,
    }))
}

async fn path_handler(State(st): State<AppState>, Query(q): Query<PathQuery>) -> impl IntoResponse {
    let Some(idx) = denom_index_of(&st.cfg.denoms, q.denom) else {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": format!("denom {} not configured", q.denom)}))).into_response();
    };
    let (rpc, contract, from_block) = (st.cfg.evm_rpc.clone(), st.cfg.deposit_contract.clone(), st.cfg.from_block);
    let deposits = match tokio::task::spawn_blocking(move || evm::fetch_deposits(&rpc, &contract, from_block)).await {
        Ok(Ok(d)) => d,
        Ok(Err(e)) => return (StatusCode::BAD_GATEWAY, Json(serde_json::json!({"error": e.to_string()}))).into_response(),
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e.to_string()}))).into_response(),
    };
    let leaves: Vec<Fr> = deposits.iter()
        .filter(|d| d.denom_index as usize == idx)
        .map(|d| fr_from_be(&hex::decode(d.commitment_hex.trim_start_matches("0x")).unwrap()))
        .collect();
    if q.leaf_index >= leaves.len() {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "leaf_index out of range"}))).into_response();
    }
    let proof = pathsvc::path_for(&leaves, q.leaf_index);
    (StatusCode::OK, Json(serde_json::to_value(proof).unwrap())).into_response()
}

async fn withdraw_handler(State(st): State<AppState>, Json(req): Json<WithdrawRequest>) -> impl IntoResponse {
    if let Err(e) = validate_withdraw(&req, &st.cfg.denoms) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": e}))).into_response();
    }
    let c = &st.cfg;
    match soroban::withdraw(
        &c.pool_id, &c.stellar_network, &c.soroban_rpc, &c.stellar_identity,
        &req.proof, &req.root, &req.nullifier_hash, &req.recipient_fr, &req.recipient, req.denom,
    ).await {
        Ok(tx) => (StatusCode::OK, Json(serde_json::json!({"tx_hash": tx}))).into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, Json(serde_json::json!({"error": e.to_string()}))).into_response(),
    }
}

pub fn app(cfg: Arc<Config>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/path", get(path_handler))
        .route("/withdraw", post(withdraw_handler))
        .with_state(AppState { cfg })
}

pub async fn serve(cfg: Config) -> anyhow::Result<()> {
    let bind = cfg.http_bind.clone();
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    println!("[serve] withdrawal server listening on {bind}");
    axum::serve(listener, app(Arc::new(cfg))).await?;
    Ok(())
}
```

- [ ] **Step 5: Add the `Serve` subcommand to `relayer/src/main.rs`** — add to the `Cmd` enum:

```rust
    /// Run the withdrawal HTTP server (GET /path, POST /withdraw, GET /health).
    Serve,
```

And the match arm:

```rust
        Cmd::Serve => {
            let cfg = Config::from_path(&cli.config)?;
            relayer::withdrawal::serve(cfg).await?;
        }
```

- [ ] **Step 6: Run tests + build**

Run: `cargo test --manifest-path relayer/Cargo.toml`
Expected: PASS (the 4 new validation tests + all prior; crate builds with the axum server).

- [ ] **Step 7: Commit**

```bash
git add relayer/src/withdrawal.rs relayer/src/lib.rs relayer/src/main.rs relayer/tests/withdrawal_request.rs
git commit -m "feat(relayer): withdrawal HTTP server (axum) + `serve` subcommand"
```

---

## Task 8: e2e smoke script + config example + README

**Files:**
- Create: `relayer/scripts/e2e_smoke.sh`
- Modify: `relayer/config.example.toml`
- Create: `relayer/README.md`

**Interfaces:** none (scripting/docs).

- [ ] **Step 1: Update `relayer/config.example.toml`** to include the new fields:

```toml
# Relayer config template — copy to config.toml and fill in your own RPC.
# Live testnet addresses (2026-06-19) are pre-filled; see deployments/testnet.env.
evm_rpc            = "https://eth-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY"
deposit_contract   = "0x4c781728f3f53f220c6f226610cd24d8b1e8e7ef"
stellar_network    = "testnet"
soroban_rpc        = "https://soroban-testnet.stellar.org"
pool_id            = "CDFQ5K2BPKB7BWNW2SJPGIIK5OOFQIR434MOX5YYBDKAN3M5CFVJKHR2"
stellar_identity   = "bridge-relayer"
denoms             = [1, 10, 100]
from_block         = 11089276
poll_interval_secs = 15
confirmations      = 2
http_bind          = "127.0.0.1:8080"
```

- [ ] **Step 2: Create `relayer/scripts/e2e_smoke.sh`** (relayer-plumbing smoke against the live testnet using known-good artifacts):

```bash
#!/usr/bin/env bash
# e2e relayer-plumbing smoke. Proves the backing daemon + withdrawal server
# against the LIVE testnet using the existing known-good proof artifacts.
# Prereqs: relayer/config.toml present; `cast` (foundry) + `stellar` on PATH;
# a recipient account with a zUSDC trustline; env vars below.
#
#   RECIPIENT   : G... account that holds a zUSDC trustline (mint destination)
#   BASE        : relayer base URL (default http://127.0.0.1:8080)
set -euo pipefail
BASE="${BASE:-http://127.0.0.1:8080}"
RECIPIENT="${RECIPIENT:?set RECIPIENT to a G-address holding a zUSDC trustline}"
ART="artifacts/circuit"

echo "== 1. health =="
curl -fsS "$BASE/health" | tee /dev/stderr | grep -q '"status":"ok"'

echo "== 2. path for denom 10 leaf 0 =="
curl -fsS "$BASE/path?denom=10&leaf_index=0" | tee /tmp/path.json

echo "== 3. withdraw using known-good artifacts (root already anchored on-chain) =="
PROOF=$(cat "$ART/proof.json")
ROOT="0012f4149c6840973c2dee91e8ecd7dd2839be83b143607114e7b4cd70bd86d4"
# nullifier_hash + recipient_fr come from the artifacts' public signals (public.json:
#   [root, nullifierHash, recipient, denomination]).
NH=$(python3 -c "import json;print(f'{int(json.load(open(\"$ART/public.json\"))[1]):064x}')")
RFR=$(python3 -c "import json;print(f'{int(json.load(open(\"$ART/public.json\"))[2]):064x}')")
curl -fsS -X POST "$BASE/withdraw" -H 'content-type: application/json' -d @- <<JSON | tee /tmp/withdraw.json
{
  "proof": $PROOF,
  "root": "$ROOT",
  "nullifier_hash": "$NH",
  "recipient_fr": "$RFR",
  "recipient": "$RECIPIENT",
  "denom": 10
}
JSON

echo "== 4. assert a tx hash came back =="
grep -q '"tx_hash"' /tmp/withdraw.json && echo "SMOKE OK"
```

> [!NOTE]
> This smoke exercises the relayer's two services end-to-end. Generating a *fresh* proof for a brand-new deposit is the circuit/frontend's job (M5); here we reuse the known-good artifacts whose root (`0012f4…`) is already anchored under denom 10. The `recipient_fr` in the artifacts must match the public signal; the `recipient` G-address only needs a zUSDC trustline.

- [ ] **Step 3: Make the script executable + create `relayer/README.md`:**

```bash
chmod +x relayer/scripts/e2e_smoke.sh
```

Create `relayer/README.md`:

```markdown
# Relayer

Off-chain services for the zk-houdini bridge: a backing daemon (anchors EVM roots
into the Soroban pool) and a withdrawal HTTP server (serves Merkle paths and relays
withdrawal proofs).

## Build & test

    cargo test --manifest-path relayer/Cargo.toml

## Configure

    cp relayer/config.example.toml relayer/config.toml   # edit evm_rpc

All commands except `topic` need `--config relayer/config.toml`.

## Commands

    relayer --config relayer/config.toml backing            # run the backing daemon
    relayer --config relayer/config.toml serve              # run the withdrawal HTTP server
    relayer --config relayer/config.toml path --denom 10 --leaf-index 0
    relayer --config relayer/config.toml backing-once --denom 10 --root <hex>
    relayer topic

## HTTP API (serve)

- `GET  /health` -> `{ status, deposit_contract, pool_id, denoms }`
- `GET  /path?denom=<value>&leaf_index=<n>` -> `{ root, root_hex, path_elements, path_indices, leaf_index }`
- `POST /withdraw` `{ proof, root, nullifier_hash, recipient_fr, recipient, denom }` -> `{ tx_hash }`

`denom` is the pool **value** (1/10/100). See `docs/ARCHITECTURE.md`.

## e2e smoke

    RECIPIENT=G... ./relayer/scripts/e2e_smoke.sh
```

- [ ] **Step 4: Verify the build is clean and all tests pass**

Run: `cargo test --manifest-path relayer/Cargo.toml`
Expected: PASS (all tests green).

- [ ] **Step 5: Commit**

```bash
git add relayer/scripts/e2e_smoke.sh relayer/config.example.toml relayer/README.md
git commit -m "feat(relayer): e2e smoke script + config example + README"
```

---

## Self-Review notes

- **Spec coverage:** Task 44 → Tasks 2,3,4,6 (RootUpdated reader, state, decide, daemon). Task 45 → Task 7 (axum /path, /withdraw, /health). Task 46 → Task 8 (e2e). Config additions → Task 1. soroban async → Task 5. Denom value↔index mapping → `denom_value_for` (Task 4) + `denom_index_of` (Task 7). Idempotency (block cursor, dedup) → Tasks 3,4.
- **Existing tests preserved:** Tasks 1 & 5 keep `config_and_parse.rs` (incl. `extracts_tx_hash_from_cli_output`), `merkle_root.rs`, `poseidon_parity.rs` green.
- **Type consistency:** `RootLog`/`DepositLog` decoders (Task 2) consumed by `decide` (Task 4) and the daemon (Task 6); `WithdrawRequest` fields (Task 7) match `soroban::withdraw` args (Task 5) and the contract's 6-arg signature.
