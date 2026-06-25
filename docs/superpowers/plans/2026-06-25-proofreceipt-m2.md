# ProofReceipt M2 Implementation Plan — x402 Async Audit Service

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sell the RISC Zero audit over real x402 (v2): a TS agent pays a Rust/axum seller server up front via the OZ Channels facilitator, the audit runs async, and the buyer gets a ZK proof receipt it verifies on-chain.

**Architecture:** New isolated `proofreceipt-server/` Rust crate speaks x402 v2 by hand (returns a 402 `PAYMENT-REQUIRED` challenge, forwards the buyer's `PAYMENT-SIGNATURE` to the facilitator `/verify`+`/settle`), settles synchronously, then spawns the existing `m0-host` prover async and serves the receipt on a poll endpoint. A new `proofreceipt-buyer/` TS package pays + polls + verifies the receipt via read-only `simulateTransaction`.

**Tech Stack:** Rust (axum 0.7, tokio, reqwest 0.12, serde, base64, uuid), `m0-host` (RISC Zero 3.0), TypeScript (`@x402/*@2.16.0`, `@stellar/stellar-sdk@^14.6.1`).

## Global Constraints

- **x402 version:** packages `@x402/core` + `@x402/stellar` + `@x402/fetch` all **`2.16.0`**; wire `x402Version: 2` (integer); scheme literal **`"exact"`**; `@stellar/stellar-sdk@^14.6.1`. NEVER use the unscoped `x402@1.x` (v1, no Stellar).
- **Headers (base64 of JSON, match case-INsensitively):** 402 response → `PAYMENT-REQUIRED`; request payment → `PAYMENT-SIGNATURE` (NOT `X-PAYMENT`, which is v1-only and the v2 server reader has no fallback for it); settle success → `PAYMENT-RESPONSE`. base64 is STANDARD (`[A-Za-z0-9+/]`, `=` pad), `base64(JSON.stringify(x))`.
- **402 body (`PaymentRequired`):** `{x402Version:2, error?, resource:{url,description?,mimeType?}, accepts:[{scheme:"exact", network:"stellar:testnet", asset:<USDC SAC>, amount:<atomic string>, payTo:<G...>, maxTimeoutSeconds:60, extra:{areFeesSponsored:true}}], extensions?}`. `resource.url` is REQUIRED; `extra.areFeesSponsored:true` is REQUIRED or the buyer client throws. Amount is **atomic base units**, USDC has **7 decimals** ($0.01 → `"100000"`). Field is `amount` (NOT v1 `maxAmountRequired`). The agreed `image_id` is advertised in `extra.image_id`.
- **Payment payload (decoded `PAYMENT-SIGNATURE`):** `{x402Version:2, accepted:{<the chosen PaymentRequirements>}, payload:{transaction:"<base64 Stellar tx XDR>"}}`. Forward `payload` (and the whole `paymentPayload`) to the facilitator as OPAQUE `serde_json::Value`; never parse the inner XDR.
- **Facilitator:** testnet base `https://channels.openzeppelin.com/x402/testnet`; `POST {base}/verify`, `POST {base}/settle`, `GET {base}/supported`. Request body for verify+settle: `{x402Version:2, paymentPayload:<obj>, paymentRequirements:<obj>}`. `/verify` → `{isValid:bool, invalidReason?:string, payer?:string}` (HTTP 200 EVEN WHEN invalid). `/settle` → `{success:bool, transaction:string, network:string, payer?:string, errorReason?:string}`. **Auth REQUIRED on every call:** `Authorization: Bearer <key>`. Free testnet key: `GET https://channels.openzeppelin.com/testnet/gen` → `{"apiKey":"<uuid>"}`. Treat `invalidReason`/`errorReason` as OPEN strings (do not enum).
- **USDC testnet SAC:** `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` (classic issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`). This is NOT the repo's bridged `SOROBAN_SAC_ID` (zUSDC) — do not reuse it. Facilitator fee-sponsor signer (exclude as payer): `GCNJB6V5YIODDSSCWXZ2VOKMRPRVZ2V723RRQS6STXE6NWTGVOJY35CN`.
- **Settle ordering:** facilitator `/verify` then `/settle` run SYNCHRONOUSLY inside the paid `POST /audit` request, BEFORE returning 202 and BEFORE proving. The signed auth entries expire in ~`maxTimeoutSeconds` (~60s); the audit takes minutes — proving after settle is mandatory.
- **Verifier (on-chain receipt check):** deployed router `CCR6QRJJBEFKUDE4YXQ2L6VII6M6C57ENXXJ5A4HQWOO6PYKRP4KS4IU` on testnet; method `verify(seal: Bytes, image_id: BytesN<32>, journal: BytesN<32>)` where `journal` is the **sha256 journal_digest** (NOT the raw 36-byte journal). Returns void on success, traps on invalid. Buyer checks via read-only `simulateTransaction` (no submit, no fee). Soroban RPC `https://soroban-testnet.stellar.org`, passphrase `Test SDF Network ; September 2015`.
- **Journal layout (from M1, unchanged):** `input_hash(32) ‖ verdict(4-byte LE u32)` = 36 raw bytes; `journal_digest = sha256(journal)`. `verdict = nonempty ? 1 : 0` (stub audit; real logic is M3).
- **image_id is a build artifact** (`m0_methods::M0_GUEST_ID`; current value `3601e6ac4552eff672f171c704bb20085fd9c0691cfefcdb177beea0ed2edf54`). Single source of truth = the `image_id` field of a freshly generated `proof.json`; the server reads it from config and the buyer reads it from config — never hardcode a stale copy in two places.
- **risc0 pinned to 3.0** (must match the deployed verifier's `parameters.json` 3.0.0). The server invokes the SAME `m0-host` binary; do not bump risc0 independently or the seal selector won't resolve.
- **Isolation:** new crates `proofreceipt-server/` and `proofreceipt-buyer/` only; the bridge (`relayer/`, `soroban/`, `frontend/`, `vendor/`) and `proofreceipt-contract/` are untouched. M2 is on branch `feat/proofreceipt-m2` (off M1).
- **Egress:** Tasks 8–9 (capture + live e2e) need outbound network to npm, `channels.openzeppelin.com`, `soroban-testnet.stellar.org`, friendbot, and the Circle USDC faucet. Tasks 1–6 build+test fully offline (mock facilitator + fake prover).

## File Structure

- `proofreceipt-m0/host/src/main.rs` — MODIFY: `--input <path>` (raw bytes) + `--out <path>`, binary-safe `serde_json` emit.
- `proofreceipt-m0/host/Cargo.toml` — MODIFY: add `serde_json`.
- `proofreceipt-server/Cargo.toml` — CREATE.
- `proofreceipt-server/src/config.rs` — CREATE: TOML config.
- `proofreceipt-server/src/x402.rs` — CREATE: v2 wire types + base64 codecs + 402 builder + `PAYMENT-SIGNATURE` reader.
- `proofreceipt-server/src/facilitator.rs` — CREATE: async reqwest client (`verify`, `settle`).
- `proofreceipt-server/src/job.rs` — CREATE: job store + status + prover runner.
- `proofreceipt-server/src/audit.rs` — CREATE: `POST /audit` + `GET /audit/{id}` handlers.
- `proofreceipt-server/src/lib.rs` — CREATE: module wiring + `AppState` + `app()`/`serve()`.
- `proofreceipt-server/src/main.rs` — CREATE: CLI entry (load config, serve).
- `proofreceipt-server/tests/fixtures/` — CREATE (Task 8): captured real wire JSON.
- `proofreceipt-buyer/package.json`, `tsconfig.json`, `src/buyer.ts`, `src/verify.ts` — CREATE.
- `proofreceipt-buyer/scripts/setup-testnet.sh` — CREATE (Task 9).

---

### Task 1: m0-host accepts artifact bytes + per-job output

**Files:**
- Modify: `proofreceipt-m0/host/src/main.rs`
- Modify: `proofreceipt-m0/host/Cargo.toml`

**Interfaces:**
- Produces: `m0-host --input <path> --out <path>` reads RAW bytes from `<path>`, writes the proof JSON to `<path>`. No-flag behavior (positional arg or default `"hello"`, output `proof.json`) preserved. JSON is `serde_json`-emitted (binary-safe). Helper `fn proof_json(input, seal, image_id, input_hash, journal, journal_digest, verdict) -> serde_json::Value` is unit-testable without proving.

- [ ] **Step 1: Add serde_json to host deps**

In `proofreceipt-m0/host/Cargo.toml` under `[dependencies]` add:

```toml
serde_json = "1"
```

- [ ] **Step 2: Write the failing tests (arg parse + JSON emit, no proving)**

Append to `proofreceipt-m0/host/src/main.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::{parse_args, proof_json, InputSource};

    #[test]
    fn parse_args_flags() {
        let a = vec!["--input".into(), "/x/a.bin".into(), "--out".into(), "/x/p.json".into()];
        let (src, out) = parse_args(a.into_iter());
        assert!(matches!(src, InputSource::Path(p) if p == "/x/a.bin"));
        assert_eq!(out, "/x/p.json");
    }

    #[test]
    fn parse_args_defaults() {
        let (src, out) = parse_args(Vec::<String>::new().into_iter());
        assert!(matches!(src, InputSource::Default));
        assert_eq!(out, "proof.json");
    }

    #[test]
    fn proof_json_is_binary_safe() {
        // bytes that would break a hand-built JSON string: a quote and a backslash
        let input = vec![0x22u8, 0x5c, 0x00, 0xff];
        let v = proof_json(&input, &[1, 2], &[3; 32], &[4; 32], &[5; 36], &[6; 32], 1);
        // round-trips through a real JSON parser (no manual escaping bugs)
        let s = v.to_string();
        let back: serde_json::Value = serde_json::from_str(&s).unwrap();
        assert_eq!(back["verdict"], 1);
        assert_eq!(back["seal"], "0102");
        assert_eq!(back["journal_digest"], hex::encode([6u8; 32]));
    }
}
```

- [ ] **Step 3: Run to verify failure**

Run: `cd proofreceipt-m0 && PATH="$HOME/.risc0/bin:$HOME/.cargo/bin:$PATH" cargo test -p m0-host`
Expected: FAIL (`parse_args`/`proof_json`/`InputSource` not found).

- [ ] **Step 4: Refactor `host/src/main.rs` — replace everything ABOVE the Step-2 test module**

Replace the old `use` lines + `fn main()` with the code below. **Keep the Step-2
`#[cfg(test)] mod tests { ... }` block at the bottom of the file** (do not overwrite the
whole file, or Step 5 runs 0 tests).

```rust
// M2 host — runs the guest, produces a Groth16 receipt, emits a binding proof JSON.
// Usage:
//   m0-host [input_string]
//   m0-host --input <path> --out <path>
// --input reads RAW bytes (binary-safe); positional is UTF-8; default "hello".
// Requires the RISC Zero Groth16 prover (Docker + x86_64).

use m0_methods::{M0_GUEST_ELF, M0_GUEST_ID};
use sha2::{Digest as _, Sha256};

pub enum InputSource {
    Path(String),
    Positional(String),
    Default,
}

/// Minimal flag parser: --input <path>, --out <path>, one optional positional.
pub fn parse_args(args: impl Iterator<Item = String>) -> (InputSource, String) {
    let mut input_path: Option<String> = None;
    let mut out_path = "proof.json".to_string();
    let mut positional: Option<String> = None;
    let mut it = args;
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--input" => input_path = it.next(),
            "--out" => {
                if let Some(p) = it.next() {
                    out_path = p;
                }
            }
            other => {
                if positional.is_none() {
                    positional = Some(other.to_string());
                }
            }
        }
    }
    let src = match (input_path, positional) {
        (Some(p), _) => InputSource::Path(p),
        (None, Some(s)) => InputSource::Positional(s),
        (None, None) => InputSource::Default,
    };
    (src, out_path)
}

/// Build the proof JSON with a real serializer (so arbitrary bytes never produce malformed
/// JSON). NOTE: the `input` field is a LOSSY UTF-8 preview only — every binding check uses
/// `input_hash`/`journal` (sha256 over the raw bytes), never this field.
#[allow(clippy::too_many_arguments)]
pub fn proof_json(
    input: &[u8],
    seal: &[u8],
    image_id: &[u8],
    input_hash: &[u8],
    journal: &[u8],
    journal_digest: &[u8],
    verdict: u32,
) -> serde_json::Value {
    serde_json::json!({
        "input": String::from_utf8_lossy(input),
        "seal": hex::encode(seal),
        "image_id": hex::encode(image_id),
        "input_hash": hex::encode(input_hash),
        "verdict": verdict,
        "journal": hex::encode(journal),
        "journal_digest": hex::encode(journal_digest),
    })
}

fn main() -> anyhow::Result<()> {
    use anyhow::Context;
    let (src, out_path) = parse_args(std::env::args().skip(1));
    let input: Vec<u8> = match src {
        InputSource::Path(p) => std::fs::read(&p).with_context(|| format!("reading {p}"))?,
        InputSource::Positional(s) => s.into_bytes(),
        InputSource::Default => b"hello".to_vec(),
    };

    eprintln!("[m2] input = {} bytes", input.len());
    eprintln!("[m2] proving with Groth16 (needs Docker; first run is slow)...");

    let env = risc0_zkvm::ExecutorEnv::builder().write(&input)?.build()?;
    let receipt = risc0_zkvm::default_prover()
        .prove_with_opts(env, M0_GUEST_ELF, &risc0_zkvm::ProverOpts::groth16())?
        .receipt;
    receipt.verify(M0_GUEST_ID).context("local verify failed")?;

    let seal = risc0_ethereum_contracts::encode_seal(&receipt)?;
    let image_id = risc0_zkvm::sha::Digest::from(M0_GUEST_ID);
    let journal = receipt.journal.bytes.clone();
    let journal_digest = Sha256::digest(&journal);
    let input_hash = Sha256::digest(&input);
    let verdict: u32 = if input.is_empty() { 0 } else { 1 };

    let v = proof_json(
        &input,
        &seal,
        image_id.as_bytes(),
        &input_hash,
        &journal,
        &journal_digest,
        verdict,
    );
    let out = serde_json::to_string_pretty(&v)? + "\n";
    std::fs::write(&out_path, &out).with_context(|| format!("writing {out_path}"))?;
    println!("{out}");
    Ok(())
}
```

- [ ] **Step 5: Run to verify pass**

Run: `cd proofreceipt-m0 && PATH="$HOME/.risc0/bin:$HOME/.cargo/bin:$PATH" cargo test -p m0-host`
Expected: 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add proofreceipt-m0/host/src/main.rs proofreceipt-m0/host/Cargo.toml
git commit -m "feat(m2): m0-host accepts --input/--out, binary-safe serde_json emit"
```

---

### Task 2: proofreceipt-server scaffold + config + health

**Files:**
- Create: `proofreceipt-server/Cargo.toml`, `proofreceipt-server/src/{config.rs,lib.rs,main.rs}`

**Interfaces:**
- Produces: `Config` (TOML, fields below); `AppState { cfg: Arc<Config> }`; `app(state) -> Router` with `GET /health`; `serve(cfg)`.

- [ ] **Step 1: Cargo.toml**

Create `proofreceipt-server/Cargo.toml`:

```toml
[package]
name = "proofreceipt-server"
version = "0.1.0"
edition = "2021"

[dependencies]
axum = "0.7"
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
toml = "0.8"
anyhow = "1"
hex = "0.4"
base64 = "0.22"
reqwest = { version = "0.12", features = ["json"] }
uuid = { version = "1", features = ["v4"] }
tracing-subscriber = "0.3"   # fmt::init() for logs

[dev-dependencies]
tower = { version = "0.5", features = ["util"] }   # ServiceExt::oneshot for handler tests
wiremock = "0.6"                                     # mock facilitator
# tokio test runtime comes from the main `tokio` dep (features = ["full"] includes macros + rt).
```

Make it a standalone workspace by adding at the top:

```toml
[workspace]
```

- [ ] **Step 2: config.rs**

Create `proofreceipt-server/src/config.rs`:

```rust
use serde::Deserialize;

fn default_http_bind() -> String { "127.0.0.1:8081".to_string() }
fn default_facilitator() -> String { "https://channels.openzeppelin.com/x402/testnet".to_string() }
fn default_network() -> String { "stellar:testnet".to_string() }
fn default_asset() -> String { "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA".to_string() }

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    /// Seller classic G-address receiving USDC (needs a USDC trustline).
    pub pay_to: String,
    /// USDC base units as a decimal string, 7 decimals (e.g. "100000" = $0.01).
    pub amount: String,
    /// OZ Channels facilitator API key (Bearer). From https://channels.openzeppelin.com/testnet/gen
    pub oz_api_key: String,
    /// Agreed RISC Zero image id (hex), advertised in the 402 and asserted by the buyer.
    pub image_id: String,
    /// Deployed verifier router contract id (for reference / buyer config).
    pub verifier_id: String,
    /// Absolute path to the built m0-host binary.
    pub m0_host_path: String,
    #[serde(default = "default_facilitator")]
    pub facilitator_url: String,
    #[serde(default = "default_network")]
    pub network: String,
    #[serde(default = "default_asset")]
    pub asset: String,
    #[serde(default = "default_http_bind")]
    pub http_bind: String,
}

impl Config {
    pub fn from_toml_str(s: &str) -> anyhow::Result<Self> { Ok(toml::from_str(s)?) }
    pub fn from_path(path: &str) -> anyhow::Result<Self> {
        Self::from_toml_str(&std::fs::read_to_string(path)?)
    }
}
```

- [ ] **Step 3: Write the failing tests**

Create `proofreceipt-server/src/lib.rs` with the test module first:

```rust
pub mod config;

use axum::{routing::get, Json, Router};
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub cfg: Arc<config::Config>,
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok" }))
}

pub fn app(state: AppState) -> Router {
    Router::new().route("/health", get(health)).with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    fn test_cfg() -> config::Config {
        config::Config::from_toml_str(
            r#"
            pay_to = "GSELLER"
            amount = "100000"
            oz_api_key = "k"
            image_id = "00"
            verifier_id = "CV"
            m0_host_path = "/bin/true"
            "#,
        )
        .unwrap()
    }

    #[tokio::test]
    async fn health_ok() {
        let app = app(AppState { cfg: Arc::new(test_cfg()) });
        let res = app
            .oneshot(Request::builder().uri("/health").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), 1 << 20).await.unwrap();
        let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(v["status"], "ok");
    }

    #[test]
    fn config_defaults_apply() {
        let c = test_cfg();
        assert_eq!(c.facilitator_url, "https://channels.openzeppelin.com/x402/testnet");
        assert_eq!(c.asset, "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA");
        assert_eq!(c.http_bind, "127.0.0.1:8081");
    }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd proofreceipt-server && cargo test`
Expected: `health_ok` and `config_defaults_apply` PASS.

- [ ] **Step 5: main.rs**

Create `proofreceipt-server/src/main.rs`:

```rust
use proofreceipt_server::{app, config::Config, AppState};
use std::sync::Arc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();
    let path = std::env::args().nth(1).unwrap_or_else(|| "proofreceipt-server.toml".to_string());
    let cfg = Config::from_path(&path)?;
    let bind = cfg.http_bind.clone();
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    println!("[serve] proofreceipt-server listening on {bind}");
    axum::serve(listener, app(AppState { cfg: Arc::new(cfg) })).await?;
    Ok(())
}
```

- [ ] **Step 6: Commit**

```bash
git add proofreceipt-server/Cargo.toml proofreceipt-server/src/config.rs proofreceipt-server/src/lib.rs proofreceipt-server/src/main.rs
git commit -m "feat(m2): proofreceipt-server scaffold (config, axum, health)"
```

---

### Task 3: x402 v2 wire types + codecs + 402 builder + payment reader

**Files:**
- Create: `proofreceipt-server/src/x402.rs`
- Modify: `proofreceipt-server/src/lib.rs` (add `pub mod x402;`)

**Interfaces:**
- Produces: serde types `PaymentRequired`, `ResourceInfo`, `PaymentRequirements`, `PaymentPayload`, `VerifyResponse`, `SettleResponse`; `fn build_payment_required(cfg, resource_url) -> (PaymentRequired, String)` returning the object + its base64 `PAYMENT-REQUIRED` value; `fn read_payment_signature(headers: &HeaderMap) -> Option<serde_json::Value>` (raw decoded payload, case-insensitive header lookup, no field loss); `fn b64_json<T: Serialize>(&T) -> String` / `fn from_b64_json<T: DeserializeOwned>(&str) -> Result<T>`.

- [ ] **Step 1: Write the failing tests**

Append to `proofreceipt-server/src/x402.rs` (create the file with this test module at the bottom; types go above in Step 3):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderMap;

    fn cfg() -> crate::config::Config {
        crate::config::Config::from_toml_str(
            r#"
            pay_to = "GSELLERADDR"
            amount = "100000"
            oz_api_key = "k"
            image_id = "3601e6ac"
            verifier_id = "CV"
            m0_host_path = "/bin/true"
            "#,
        ).unwrap()
    }

    #[test]
    fn build_402_has_required_v2_fields() {
        let (pr, header) = build_payment_required(&cfg(), "https://s/audit");
        assert_eq!(pr.x402_version, 2);
        let acc = &pr.accepts[0];
        assert_eq!(acc.scheme, "exact");
        assert_eq!(acc.network, "stellar:testnet");
        assert_eq!(acc.amount, "100000");
        assert_eq!(acc.pay_to, "GSELLERADDR");
        // areFeesSponsored MUST be present and true or the buyer client throws
        assert_eq!(acc.extra["areFeesSponsored"], serde_json::json!(true));
        assert_eq!(acc.extra["image_id"], serde_json::json!("3601e6ac"));
        // header decodes back to the same object
        let back: PaymentRequired = from_b64_json(&header).unwrap();
        assert_eq!(back.accepts[0].pay_to, "GSELLERADDR");
    }

    #[test]
    fn read_payment_signature_case_insensitive() {
        let payload = PaymentPayload {
            x402_version: 2,
            accepted: serde_json::json!({"scheme":"exact"}),
            payload: serde_json::json!({"transaction":"AAAA"}),
        };
        let b64 = b64_json(&payload);
        let mut h = HeaderMap::new();
        h.insert("payment-signature", b64.parse().unwrap()); // lowercase on the wire
        let got = read_payment_signature(&h).unwrap(); // raw serde_json::Value
        assert_eq!(got["x402Version"], 2);
        assert_eq!(got["payload"]["transaction"], "AAAA");
    }

    #[test]
    fn read_payment_signature_absent_is_none() {
        assert!(read_payment_signature(&HeaderMap::new()).is_none());
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd proofreceipt-server && cargo test x402`
Expected: FAIL (types/functions not defined).

- [ ] **Step 3: Implement x402.rs (above the test module)**

```rust
use axum::http::HeaderMap;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{de::DeserializeOwned, Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceInfo {
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(rename = "mimeType", skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentRequirements {
    pub scheme: String,
    pub network: String,
    pub asset: String,
    pub amount: String,
    #[serde(rename = "payTo")]
    pub pay_to: String,
    #[serde(rename = "maxTimeoutSeconds")]
    pub max_timeout_seconds: u32,
    pub extra: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentRequired {
    #[serde(rename = "x402Version")]
    pub x402_version: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub resource: ResourceInfo,
    pub accepts: Vec<PaymentRequirements>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentPayload {
    #[serde(rename = "x402Version")]
    pub x402_version: u32,
    pub accepted: serde_json::Value,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifyResponse {
    #[serde(rename = "isValid")]
    pub is_valid: bool,
    #[serde(rename = "invalidReason")]
    pub invalid_reason: Option<String>,
    pub payer: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettleResponse {
    pub success: bool,
    #[serde(default)]
    pub transaction: String,
    #[serde(default)]
    pub network: String,
    pub payer: Option<String>,
    #[serde(rename = "errorReason")]
    pub error_reason: Option<String>,
}

pub fn b64_json<T: Serialize>(v: &T) -> String {
    STANDARD.encode(serde_json::to_vec(v).expect("serialize"))
}

pub fn from_b64_json<T: DeserializeOwned>(s: &str) -> anyhow::Result<T> {
    let bytes = STANDARD.decode(s.trim())?;
    Ok(serde_json::from_slice(&bytes)?)
}

/// Build the v2 PaymentRequired object + its base64 `PAYMENT-REQUIRED` header value.
pub fn build_payment_required(cfg: &crate::config::Config, resource_url: &str) -> (PaymentRequired, String) {
    let req = PaymentRequirements {
        scheme: "exact".into(),
        network: cfg.network.clone(),
        asset: cfg.asset.clone(),
        amount: cfg.amount.clone(),
        pay_to: cfg.pay_to.clone(),
        max_timeout_seconds: 60,
        // areFeesSponsored:true is REQUIRED; image_id advertises the agreed program.
        extra: serde_json::json!({ "areFeesSponsored": true, "image_id": cfg.image_id }),
    };
    let pr = PaymentRequired {
        x402_version: 2,
        error: None,
        resource: ResourceInfo {
            url: resource_url.to_string(),
            description: Some("Async ZK proof audit (RISC Zero Groth16 receipt)".into()),
            mime_type: Some("application/json".into()),
        },
        accepts: vec![req],
    };
    let header = b64_json(&pr);
    (pr, header)
}

/// Read + base64-decode the v2 `PAYMENT-SIGNATURE` header into the RAW payment-payload JSON
/// (returning a `serde_json::Value` so NO fields are dropped before forwarding to the
/// facilitator — re-serializing a typed struct would silently lose `resource`/`extensions`).
/// `HeaderMap::get` is already case-insensitive. Returns None only if the header is absent or
/// undecodable; a decode failure is logged for diagnostics (so a paid-but-malformed request
/// doesn't silently look "unpaid" and loop on 402).
pub fn read_payment_signature(headers: &HeaderMap) -> Option<serde_json::Value> {
    let raw = headers.get("payment-signature")?;
    let s = raw.to_str().ok()?;
    match from_b64_json::<serde_json::Value>(s) {
        Ok(v) => Some(v),
        Err(e) => {
            eprintln!("[x402] PAYMENT-SIGNATURE decode failed: {e}");
            None
        }
    }
}
```

Add `pub mod x402;` to `lib.rs`.

- [ ] **Step 4: Run to verify pass**

Run: `cd proofreceipt-server && cargo test x402`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add proofreceipt-server/src/x402.rs proofreceipt-server/src/lib.rs
git commit -m "feat(m2): x402 v2 wire types, base64 codecs, 402 builder, PAYMENT-SIGNATURE reader"
```

---

### Task 4: Facilitator client (verify / settle)

**Files:**
- Create: `proofreceipt-server/src/facilitator.rs`
- Modify: `proofreceipt-server/src/lib.rs` (add `pub mod facilitator;`)

**Interfaces:**
- Consumes: `x402::{VerifyResponse, SettleResponse}` (payload + requirements are passed as opaque `serde_json::Value`).
- Produces: `struct Facilitator { base: String, api_key: String, http: reqwest::Client }`; `async fn verify(&self, payload: &serde_json::Value, requirements: &serde_json::Value) -> Result<VerifyResponse>`; `async fn settle(&self, payload: &serde_json::Value, requirements: &serde_json::Value) -> Result<SettleResponse>`. Both POST `{x402Version:2, paymentPayload, paymentRequirements}` with `Authorization: Bearer <key>`.

- [ ] **Step 1: Write the failing test (against a wiremock facilitator)**

Create `proofreceipt-server/src/facilitator.rs` with this test module at the bottom:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{body_partial_json, header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn verify_posts_bearer_and_parses() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/verify"))
            .and(header("authorization", "Bearer testkey"))
            .and(body_partial_json(serde_json::json!({ "x402Version": 2 })))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "isValid": true, "payer": "GBUYER"
            })))
            .mount(&server)
            .await;

        let fac = Facilitator::new(server.uri(), "testkey".into());
        let payload = serde_json::json!({"x402Version":2,"payload":{"transaction":"AAAA"}});
        let reqs = serde_json::json!({"scheme":"exact"});
        let v = fac.verify(&payload, &reqs).await.unwrap();
        assert!(v.is_valid);
        assert_eq!(v.payer.as_deref(), Some("GBUYER"));
    }

    #[tokio::test]
    async fn settle_parses_success() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/settle"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "success": true, "transaction": "abc123", "network": "stellar:testnet", "payer": "GBUYER"
            })))
            .mount(&server)
            .await;
        let fac = Facilitator::new(server.uri(), "k".into());
        let s = fac.settle(&serde_json::json!({}), &serde_json::json!({})).await.unwrap();
        assert!(s.success);
        assert_eq!(s.transaction, "abc123");
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd proofreceipt-server && cargo test facilitator`
Expected: FAIL (`Facilitator` not defined).

- [ ] **Step 3: Implement (above the test module)**

```rust
use crate::x402::{SettleResponse, VerifyResponse};
use anyhow::{anyhow, Result};

pub struct Facilitator {
    base: String,
    api_key: String,
    http: reqwest::Client,
}

impl Facilitator {
    pub fn new(base: String, api_key: String) -> Self {
        Self { base: base.trim_end_matches('/').to_string(), api_key, http: reqwest::Client::new() }
    }

    fn body(payload: &serde_json::Value, requirements: &serde_json::Value) -> serde_json::Value {
        serde_json::json!({
            "x402Version": 2,
            "paymentPayload": payload,
            "paymentRequirements": requirements,
        })
    }

    pub async fn verify(&self, payload: &serde_json::Value, requirements: &serde_json::Value) -> Result<VerifyResponse> {
        let res = self.http
            .post(format!("{}/verify", self.base))
            .bearer_auth(&self.api_key)
            .json(&Self::body(payload, requirements))
            .send().await?;
        if !res.status().is_success() {
            return Err(anyhow!("facilitator /verify HTTP {}: {}", res.status(), res.text().await.unwrap_or_default()));
        }
        Ok(res.json::<VerifyResponse>().await?)
    }

    pub async fn settle(&self, payload: &serde_json::Value, requirements: &serde_json::Value) -> Result<SettleResponse> {
        let res = self.http
            .post(format!("{}/settle", self.base))
            .bearer_auth(&self.api_key)
            .json(&Self::body(payload, requirements))
            .send().await?;
        if !res.status().is_success() {
            return Err(anyhow!("facilitator /settle HTTP {}: {}", res.status(), res.text().await.unwrap_or_default()));
        }
        Ok(res.json::<SettleResponse>().await?)
    }
}
```

Add `pub mod facilitator;` to `lib.rs`.

- [ ] **Step 4: Run to verify pass**

Run: `cd proofreceipt-server && cargo test facilitator`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add proofreceipt-server/src/facilitator.rs proofreceipt-server/src/lib.rs
git commit -m "feat(m2): facilitator client (verify/settle, Bearer auth) tested vs wiremock"
```

---

### Task 5: Job store + prover runner

**Files:**
- Create: `proofreceipt-server/src/job.rs`
- Modify: `proofreceipt-server/src/lib.rs` (add `pub mod job;`)

**Interfaces:**
- Produces: `enum JobStatus { Pending, Done, Error }`; `struct Receipt { seal, image_id, journal, journal_digest, verdict }` (serde, hex strings + u32); `struct Job { status, receipt: Option<Receipt>, error: Option<String> }`; `type JobStore = Arc<Mutex<HashMap<String, Job>>>`; `fn new_store()`; `fn insert_pending(&store) -> String` (uuid); `fn set_done/set_error`; `async fn run_prover(m0_host_path, artifact: Vec<u8>) -> Result<Receipt>` (spawn_blocking: write artifact to a temp file, run `m0-host --input <tmp> --out <tmp.json>`, parse).

- [ ] **Step 1: Write the failing tests (fake m0-host via a shell script)**

Create `proofreceipt-server/src/job.rs` with this test module at the bottom:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn store_transitions() {
        let store = new_store();
        let id = insert_pending(&store);
        assert!(matches!(store.lock().unwrap().get(&id).unwrap().status, JobStatus::Pending));
        let r = Receipt { seal: "01".into(), image_id: "02".into(), journal: "03".into(), journal_digest: "04".into(), verdict: 1 };
        set_done(&store, &id, r);
        let g = store.lock().unwrap();
        let j = g.get(&id).unwrap();
        assert!(matches!(j.status, JobStatus::Done));
        assert_eq!(j.receipt.as_ref().unwrap().verdict, 1);
    }

    #[tokio::test]
    async fn run_prover_parses_fake_host_output() {
        // Fake m0-host: a shell script that ignores --input and writes a canned proof.json to --out.
        let dir = std::env::temp_dir().join(format!("m2test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let host = dir.join("fake-host.sh");
        std::fs::write(&host, "#!/usr/bin/env bash\nset -e\nout=\"\"\nwhile [ $# -gt 0 ]; do if [ \"$1\" = \"--out\" ]; then out=\"$2\"; shift; fi; shift; done\ncat > \"$out\" <<'JSON'\n{\"seal\":\"aa\",\"image_id\":\"bb\",\"journal\":\"cc\",\"journal_digest\":\"dd\",\"verdict\":1}\nJSON\n").unwrap();
        std::fs::set_permissions(&host, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();

        let r = run_prover(host.to_str().unwrap(), b"hello".to_vec()).await.unwrap();
        assert_eq!(r.seal, "aa");
        assert_eq!(r.journal_digest, "dd");
        assert_eq!(r.verdict, 1);
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd proofreceipt-server && cargo test job`
Expected: FAIL (types/functions not defined).

- [ ] **Step 3: Implement (above the test module)**

```rust
use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize)]
pub enum JobStatus { Pending, Done, Error }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Receipt {
    pub seal: String,           // hex
    pub image_id: String,       // hex
    pub journal: String,        // hex (raw 36-byte journal)
    pub journal_digest: String, // hex (sha256 of journal)
    pub verdict: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct Job {
    pub status: JobStatus,
    pub receipt: Option<Receipt>,
    pub error: Option<String>,
}

pub type JobStore = Arc<Mutex<HashMap<String, Job>>>;

pub fn new_store() -> JobStore { Arc::new(Mutex::new(HashMap::new())) }

pub fn insert_pending(store: &JobStore) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    store.lock().unwrap().insert(id.clone(), Job { status: JobStatus::Pending, receipt: None, error: None });
    id
}

pub fn set_done(store: &JobStore, id: &str, receipt: Receipt) {
    if let Some(j) = store.lock().unwrap().get_mut(id) {
        j.status = JobStatus::Done;
        j.receipt = Some(receipt);
    }
}

pub fn set_error(store: &JobStore, id: &str, err: String) {
    if let Some(j) = store.lock().unwrap().get_mut(id) {
        j.status = JobStatus::Error;
        j.error = Some(err);
    }
}

/// Run m0-host on the artifact bytes and parse its proof.json into a Receipt.
/// Blocking work (a multi-minute Groth16 prove) is moved off the async runtime.
pub async fn run_prover(m0_host_path: &str, artifact: Vec<u8>) -> Result<Receipt> {
    let host = m0_host_path.to_string();
    tokio::task::spawn_blocking(move || {
        let dir = std::env::temp_dir().join(format!("m2job-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir)?;
        let in_path = dir.join("artifact.bin");
        let out_path = dir.join("proof.json");
        std::fs::write(&in_path, &artifact).context("write artifact")?;
        let out = std::process::Command::new(&host)
            .arg("--input").arg(&in_path)
            .arg("--out").arg(&out_path)
            .output()
            .with_context(|| format!("spawn m0-host at {host}"))?;
        if !out.status.success() {
            return Err(anyhow!("m0-host failed: {}", String::from_utf8_lossy(&out.stderr)));
        }
        let json = std::fs::read_to_string(&out_path).context("read proof.json")?;
        let r: Receipt = serde_json::from_str(&json).context("parse proof.json")?;
        let _ = std::fs::remove_dir_all(&dir);
        Ok(r)
    })
    .await
    .context("prover task join")?
}
```

Add `pub mod job;` to `lib.rs`.

- [ ] **Step 4: Run to verify pass**

Run: `cd proofreceipt-server && cargo test job`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add proofreceipt-server/src/job.rs proofreceipt-server/src/lib.rs
git commit -m "feat(m2): job store + prover runner (spawn_blocking m0-host) parsed to Receipt"
```

---

### Task 6: /audit payment flow + poll endpoint

**Files:**
- Create: `proofreceipt-server/src/audit.rs`
- Modify: `proofreceipt-server/src/lib.rs` (`AppState` gains `store` + `facilitator`; routes added)

**Interfaces:**
- Consumes: `x402::*`, `facilitator::Facilitator`, `job::*`.
- Produces: `POST /audit` — without `PAYMENT-SIGNATURE` → `402` + `PAYMENT-REQUIRED` header; with → facilitator verify (if `!isValid` → 402 again) → settle (if `!success` → 502) → enqueue + spawn prover → `202 {job_id}` + `PAYMENT-RESPONSE` header. `GET /audit/{id}` → `202 {status:"pending"}` / `200 {status:"done", ...receipt}` / `200 {status:"error", error}` / `404`. Body limit 4 MB on `/audit`.

- [ ] **Step 1: Update AppState and wire modules in lib.rs**

Replace EVERYTHING in `lib.rs` from the first `pub mod` line through the end of `fn app(...)`
— i.e. all the module declarations accumulated in Tasks 2–5, plus `AppState`/`health`/`app`
— with the block below. Each `pub mod` and each `use` must appear EXACTLY ONCE (do not leave
the old `pub mod config;`/`x402;`/`facilitator;`/`job;` lines above it). **Keep the
`#[cfg(test)] mod tests { ... }` block below intact** (only its `AppState { ... }`
construction is patched, next).

```rust
pub mod audit;
pub mod config;
pub mod facilitator;
pub mod job;
pub mod x402;

use axum::{extract::DefaultBodyLimit, routing::{get, post}, Json, Router};
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub cfg: Arc<config::Config>,
    pub store: job::JobStore,
    pub facilitator: Arc<facilitator::Facilitator>,
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok" }))
}

pub fn app(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/audit", post(audit::post_audit).layer(DefaultBodyLimit::max(4 * 1024 * 1024)))
        .route("/audit/:id", get(audit::get_audit))
        .with_state(state)
}
```

Also update the `health_ok` test inside `lib.rs` (from Task 2) — `AppState` now has three fields, so the old `AppState { cfg: Arc::new(test_cfg()) }` no longer compiles. Replace its state construction with:

```rust
        let st = AppState {
            facilitator: Arc::new(crate::facilitator::Facilitator::new("http://unused".into(), "k".into())),
            store: crate::job::new_store(),
            cfg: Arc::new(test_cfg()),
        };
        let app = app(st);
```

(`config_defaults_apply` is unaffected.)

Update `main.rs` to build the new `AppState`:

```rust
use proofreceipt_server::{app, config::Config, facilitator::Facilitator, job::new_store, AppState};
use std::sync::Arc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();
    let path = std::env::args().nth(1).unwrap_or_else(|| "proofreceipt-server.toml".to_string());
    let cfg = Config::from_path(&path)?;
    let bind = cfg.http_bind.clone();
    let facilitator = Arc::new(Facilitator::new(cfg.facilitator_url.clone(), cfg.oz_api_key.clone()));
    let state = AppState { cfg: Arc::new(cfg), store: new_store(), facilitator };
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    println!("[serve] proofreceipt-server listening on {bind}");
    axum::serve(listener, app(state)).await?;
    Ok(())
}
```

- [ ] **Step 2: Write the failing test (full flow vs mock facilitator + fake prover)**

Create `proofreceipt-server/src/audit.rs` with this test module at the bottom:

```rust
#[cfg(test)]
mod tests {
    use crate::{app, config::Config, facilitator::Facilitator, job::new_store, x402, AppState};
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use std::sync::Arc;
    use tower::ServiceExt;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn cfg(host: &str) -> Config {
        Config::from_toml_str(&format!(
            r#"
            pay_to = "GSELLER"
            amount = "100000"
            oz_api_key = "k"
            image_id = "3601e6ac"
            verifier_id = "CV"
            m0_host_path = "{host}"
            "#
        )).unwrap()
    }

    async fn fac_server() -> MockServer {
        let s = MockServer::start().await;
        Mock::given(method("POST")).and(path("/verify"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"isValid":true,"payer":"GBUYER"})))
            .mount(&s).await;
        Mock::given(method("POST")).and(path("/settle"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"success":true,"transaction":"tx1","network":"stellar:testnet","payer":"GBUYER"})))
            .mount(&s).await;
        s
    }

    fn fake_host() -> String {
        let dir = std::env::temp_dir().join(format!("m2audit-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let host = dir.join("fake-host.sh");
        std::fs::write(&host, "#!/usr/bin/env bash\nset -e\nout=\"\"\nwhile [ $# -gt 0 ]; do if [ \"$1\" = \"--out\" ]; then out=\"$2\"; shift; fi; shift; done\ncat > \"$out\" <<'JSON'\n{\"seal\":\"aa\",\"image_id\":\"3601e6ac\",\"journal\":\"cc\",\"journal_digest\":\"dd\",\"verdict\":1}\nJSON\n").unwrap();
        std::fs::set_permissions(&host, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
        host.to_str().unwrap().to_string()
    }

    fn state(fac_uri: String, host: String) -> AppState {
        let c = cfg(&host);
        AppState {
            facilitator: Arc::new(Facilitator::new(fac_uri, c.oz_api_key.clone())),
            cfg: Arc::new(c),
            store: new_store(),
        }
    }

    #[tokio::test]
    async fn unpaid_audit_returns_402_with_header() {
        let st = state("http://unused".into(), fake_host());
        let res = app(st).oneshot(
            Request::builder().method("POST").uri("/audit")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"artifact":"aGVsbG8="}"#)).unwrap()
        ).await.unwrap();
        assert_eq!(res.status(), StatusCode::PAYMENT_REQUIRED);
        let hdr = res.headers().get("payment-required").unwrap().to_str().unwrap().to_string();
        let pr: x402::PaymentRequired = x402::from_b64_json(&hdr).unwrap();
        assert_eq!(pr.accepts[0].extra["areFeesSponsored"], serde_json::json!(true));
    }

    #[tokio::test]
    async fn paid_audit_enqueues_then_poll_completes() {
        let fac = fac_server().await;
        let st = state(fac.uri(), fake_host());
        let signed = x402::b64_json(&x402::PaymentPayload {
            x402_version: 2,
            accepted: serde_json::json!({"scheme":"exact"}),
            payload: serde_json::json!({"transaction":"AAAA"}),
        });
        let app1 = app(st);
        let res = app1.clone().oneshot(
            Request::builder().method("POST").uri("/audit")
                .header("content-type","application/json")
                .header("payment-signature", signed)
                .body(Body::from(r#"{"artifact":"aGVsbG8="}"#)).unwrap()
        ).await.unwrap();
        assert_eq!(res.status(), StatusCode::ACCEPTED);
        assert!(res.headers().get("payment-response").is_some());
        let bytes = axum::body::to_bytes(res.into_body(), 1<<20).await.unwrap();
        let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let id = v["job_id"].as_str().unwrap().to_string();

        // Poll until done (fake prover is fast).
        let mut done = false;
        for _ in 0..50 {
            let r = app1.clone().oneshot(
                Request::builder().method("GET").uri(format!("/audit/{id}")).body(Body::empty()).unwrap()
            ).await.unwrap();
            if r.status() == StatusCode::OK {
                let b = axum::body::to_bytes(r.into_body(), 1<<20).await.unwrap();
                let jv: serde_json::Value = serde_json::from_slice(&b).unwrap();
                if jv["status"] == "done" { assert_eq!(jv["seal"], "aa"); done = true; break; }
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        assert!(done, "job never completed");
    }
}
```

- [ ] **Step 3: Run to verify failure**

Run: `cd proofreceipt-server && cargo test audit`
Expected: FAIL (`post_audit`/`get_audit` not defined).

- [ ] **Step 4: Implement audit.rs (above the test module)**

```rust
use crate::job::{self, JobStatus, Receipt};
use crate::x402;
use crate::AppState;
use axum::{
    extract::{Path, State},
    http::{HeaderMap, HeaderName, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct AuditReq {
    /// base64 of the raw artifact bytes.
    pub artifact: String,
}

fn header(name: &'static str, value: &str) -> (HeaderName, HeaderValue) {
    (HeaderName::from_static(name), HeaderValue::from_str(value).unwrap())
}

pub async fn post_audit(
    State(st): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AuditReq>,
) -> Response {
    let resource_url = format!("http://{}/audit", st.cfg.http_bind);
    let (pr, pr_header) = x402::build_payment_required(&st.cfg, &resource_url);

    // No payment yet → 402 challenge. `payload_val` is the RAW decoded payment payload.
    let Some(payload_val) = x402::read_payment_signature(&headers) else {
        return (
            StatusCode::PAYMENT_REQUIRED,
            [header("payment-required", &pr_header)],
            Json(serde_json::json!({ "error": "payment required" })),
        ).into_response();
    };

    // Decode the artifact up front (bad base64 → 400, no charge).
    let artifact = match base64_decode(&req.artifact) {
        Ok(b) => b,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error":"artifact not base64"}))).into_response(),
    };

    // Forward the WHOLE payment payload (opaque, all fields intact) + the single chosen requirement.
    let requirements_val = serde_json::to_value(&pr.accepts[0]).unwrap();

    // verify (synchronous, before settle/202/prove).
    match st.facilitator.verify(&payload_val, &requirements_val).await {
        Ok(v) if v.is_valid => {}
        Ok(v) => {
            return (
                StatusCode::PAYMENT_REQUIRED,
                [header("payment-required", &pr_header)],
                Json(serde_json::json!({ "error": "payment invalid", "reason": v.invalid_reason })),
            ).into_response();
        }
        Err(e) => return (StatusCode::BAD_GATEWAY, Json(serde_json::json!({"error": e.to_string()}))).into_response(),
    }

    // settle (synchronous; auth entries expire in ~60s, so this must precede proving).
    let settle = match st.facilitator.settle(&payload_val, &requirements_val).await {
        Ok(s) if s.success => s,
        Ok(s) => return (StatusCode::BAD_GATEWAY, Json(serde_json::json!({"error":"settle failed","reason":s.error_reason}))).into_response(),
        Err(e) => return (StatusCode::BAD_GATEWAY, Json(serde_json::json!({"error": e.to_string()}))).into_response(),
    };

    // Enqueue + spawn the (slow) prover; respond 202 immediately.
    let id = job::insert_pending(&st.store);
    {
        let store = st.store.clone();
        let host = st.cfg.m0_host_path.clone();
        let id2 = id.clone();
        tokio::spawn(async move {
            match job::run_prover(&host, artifact).await {
                Ok(r) => job::set_done(&store, &id2, r),
                Err(e) => job::set_error(&store, &id2, e.to_string()),
            }
        });
    }

    let pay_resp = x402::b64_json(&settle);
    (
        StatusCode::ACCEPTED,
        [header("payment-response", &pay_resp)],
        Json(serde_json::json!({ "job_id": id })),
    ).into_response()
}

pub async fn get_audit(State(st): State<AppState>, Path(id): Path<String>) -> Response {
    let guard = st.store.lock().unwrap();
    let Some(job) = guard.get(&id) else {
        return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error":"no such job"}))).into_response();
    };
    match &job.status {
        JobStatus::Pending => (StatusCode::ACCEPTED, Json(serde_json::json!({"status":"pending"}))).into_response(),
        JobStatus::Error => (StatusCode::OK, Json(serde_json::json!({"status":"error","error": job.error}))).into_response(),
        JobStatus::Done => {
            let r: &Receipt = job.receipt.as_ref().unwrap();
            (StatusCode::OK, Json(serde_json::json!({
                "status": "done",
                "seal": r.seal, "image_id": r.image_id,
                "journal": r.journal, "journal_digest": r.journal_digest, "verdict": r.verdict
            }))).into_response()
        }
    }
}

fn base64_decode(s: &str) -> anyhow::Result<Vec<u8>> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    Ok(STANDARD.decode(s.trim())?)
}
```

- [ ] **Step 5: Run to verify pass**

Run: `cd proofreceipt-server && cargo test`
Expected: ALL server tests PASS (health, config, x402, facilitator, job, audit).

- [ ] **Step 6: Commit**

```bash
git add proofreceipt-server/src/audit.rs proofreceipt-server/src/lib.rs proofreceipt-server/src/main.rs
git commit -m "feat(m2): /audit verify->settle->enqueue->202 + poll endpoint (vs mock facilitator)"
```

---

### Task 7: TS buyer agent (pay + poll + on-chain verify)

**Files:**
- Create: `proofreceipt-buyer/package.json`, `proofreceipt-buyer/tsconfig.json`, `proofreceipt-buyer/src/verify.ts`, `proofreceipt-buyer/src/buyer.ts`

**Interfaces:**
- Produces: `verifyOnChain(seal, imageId, journal): Promise<boolean>` (read-only simulate); `buyer.ts` CLI: pays `POST /audit`, polls, then runs the three binding checks. Deliverable is a type-checking, runnable script (live exercise is Task 9).

- [ ] **Step 1: package.json**

Create `proofreceipt-buyer/package.json`:

```json
{
  "name": "proofreceipt-buyer",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "typecheck": "tsc --noEmit",
    "buyer": "tsx src/buyer.ts"
  },
  "dependencies": {
    "@x402/core": "2.16.0",
    "@x402/fetch": "2.16.0",
    "@x402/stellar": "2.16.0",
    "@stellar/stellar-sdk": "^14.6.1"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "tsx": "^4.19.0",
    "@types/node": "^22.0.0"
  }
}
```

- [ ] **Step 2: tsconfig.json**

Create `proofreceipt-buyer/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: verify.ts (read-only on-chain verify)**

Create `proofreceipt-buyer/src/verify.ts`:

```ts
import {
  Contract, TransactionBuilder, BASE_FEE, Networks, nativeToScVal, rpc,
} from "@stellar/stellar-sdk";

const RPC_URL = "https://soroban-testnet.stellar.org";

/**
 * Read-only verify of a receipt against the deployed RISC Zero verifier router.
 * Returns true if the proof verifies (void return), false if the contract traps.
 * @param verifierId  the CCR6... router contract id
 * @param sourceAddr  any funded testnet G-account (for a valid sequence; never signed/submitted)
 */
export async function verifyOnChain(
  verifierId: string,
  sourceAddr: string,
  seal: Uint8Array,
  imageId: Uint8Array,     // 32 bytes
  journalDigest: Uint8Array, // 32 bytes (sha256 of journal)
): Promise<boolean> {
  const server = new rpc.Server(RPC_URL);
  const contract = new Contract(verifierId);
  const op = contract.call(
    "verify",
    nativeToScVal(Buffer.from(seal), { type: "bytes" }),
    nativeToScVal(Buffer.from(imageId), { type: "bytes" }),
    nativeToScVal(Buffer.from(journalDigest), { type: "bytes" }),
  );
  const account = await server.getAccount(sourceAddr);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(op).setTimeout(30).build();
  const sim = await server.simulateTransaction(tx);
  // The verifier traps (contract error / WASM panic / unreachable) on an invalid proof, all
  // of which surface as a simulation error → the proof did NOT verify. Genuine transport/RPC
  // failures throw from `simulateTransaction` itself (caught by the caller), not here.
  if (rpc.Api.isSimulationError(sim)) return false;
  return rpc.Api.isSimulationSuccess(sim);
}
```

- [ ] **Step 4: buyer.ts (pay, poll, three binding checks)**

Create `proofreceipt-buyer/src/buyer.ts`:

```ts
import { createHash } from "node:crypto";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { verifyOnChain } from "./verify.js";

const SERVER = process.env.SERVER_URL ?? "http://127.0.0.1:8081";
const VERIFIER = process.env.VERIFIER_ID ?? "CCR6QRJJBEFKUDE4YXQ2L6VII6M6C57ENXXJ5A4HQWOO6PYKRP4KS4IU";
const AGREED_IMAGE_ID = process.env.AGREED_IMAGE_ID!; // hex, from a fresh proof.json
const SECRET = process.env.CLIENT_PRIVATE_KEY!;       // "S..." testnet secret (USDC funded)
const SELF_ADDR = process.env.CLIENT_PUBLIC_KEY!;     // "G..." (used as simulate source)

function hex(b: Uint8Array) { return Buffer.from(b).toString("hex"); }
function unhex(s: string) { return Uint8Array.from(Buffer.from(s, "hex")); }

async function main() {
  const artifact = Buffer.from(process.argv[2] ?? "hello", "utf8"); // the bytes to audit
  const signer = createEd25519Signer(SECRET, "stellar:testnet");
  const client = new x402Client().register("stellar:*", new ExactStellarScheme(signer));
  const fetchWithPay = wrapFetchWithPayment(fetch, client);

  // 1. Pay + submit (method+body survive the 402 retry).
  const res = await fetchWithPay(`${SERVER}/audit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ artifact: artifact.toString("base64") }),
  });
  if (res.status !== 202) throw new Error(`expected 202, got ${res.status}: ${await res.text()}`);
  const { job_id } = (await res.json()) as { job_id: string };
  console.log(`[buyer] paid, job_id=${job_id}`);

  // 2. Poll (cap attempts so a stuck server doesn't hang forever; ~10 min at 2s).
  let receipt: any;
  for (let attempt = 0; ; attempt++) {
    if (attempt > 300) throw new Error("timed out waiting for the audit receipt");
    const r = await fetch(`${SERVER}/audit/${job_id}`);
    if (r.status === 200) {
      const j = await r.json();
      if (j.status === "done") { receipt = j; break; }
      if (j.status === "error") throw new Error(`audit error: ${j.error}`);
    }
    await new Promise((s) => setTimeout(s, 2000));
  }

  // 3. Three binding checks.
  // (a) program binding
  if (receipt.image_id !== AGREED_IMAGE_ID) throw new Error(`image_id mismatch: ${receipt.image_id}`);
  // (b) input binding — from the RAW journal, not a server-claimed verdict
  const journal = unhex(receipt.journal);
  const myInputHash = createHash("sha256").update(artifact).digest();
  if (hex(journal.slice(0, 32)) !== hex(myInputHash)) throw new Error("journal input_hash != sha256(my artifact)");
  const recomputedDigest = createHash("sha256").update(Buffer.from(journal)).digest();
  if (hex(recomputedDigest) !== receipt.journal_digest) throw new Error("journal_digest mismatch");
  // (c) proof validity on-chain
  const ok = await verifyOnChain(VERIFIER, SELF_ADDR, unhex(receipt.seal), unhex(receipt.image_id), recomputedDigest);
  if (!ok) throw new Error("on-chain verify rejected the proof");

  // Derive the verdict from the cryptographically-committed journal (last 4 bytes, LE),
  // not the server-reported field.
  const verdict = new DataView(journal.buffer, journal.byteOffset + 32, 4).getUint32(0, true);
  console.log(`[buyer] ✅ receipt verified: ran agreed program ${AGREED_IMAGE_ID.slice(0,8)}… on my exact ${artifact.length}-byte input; verdict=${verdict}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 5: Install + typecheck**

Run: `cd proofreceipt-buyer && npm install && npm run typecheck`
Expected: install succeeds; `tsc --noEmit` exits 0 (confirms the subpath import `@x402/stellar/exact/client`, the `rpc` namespace, and `nativeToScVal`/`Contract.call` signatures all resolve against the installed packages).

- [ ] **Step 6: Commit**

```bash
git add proofreceipt-buyer/package.json proofreceipt-buyer/tsconfig.json proofreceipt-buyer/src/verify.ts proofreceipt-buyer/src/buyer.ts
git commit -m "feat(m2): TS buyer agent (x402 pay + poll + on-chain verify with 3 binding checks)"
```

---

### Task 8: Capture real wire fixtures + validate Rust structs

**Files:**
- Create: `proofreceipt-buyer/scripts/capture.mjs`, `proofreceipt-server/tests/fixtures/{payment_payload.json,supported.json,verify_invalid.json}`, `proofreceipt-server/tests/wire_fixtures.rs`

**Interfaces:** locks the source-verified shapes against real bytes (the residual risk from the spec). Needs network egress (npm + Soroban testnet RPC + the OZ facilitator) + a testnet keypair. No USDC FUNDS needed — the buyer builds/signs the `PAYMENT-SIGNATURE` and we capture it against a local echo server that never settles (the payload build does query Soroban RPC for the expiration ledger, hence the egress requirement).

- [ ] **Step 1: Reference echo-seller + buyer capture script**

Create `proofreceipt-buyer/scripts/capture.mjs`:

```js
// Captures (1) the real PAYMENT-SIGNATURE header bytes from @x402/fetch, decoded,
// (2) GET /supported, (3) POST /verify with an empty payload (200-on-invalid).
// No USDC FUNDS needed (the echo server never settles), but Soroban testnet RPC egress IS
// required: building the payment payload queries the ledger to set signatureExpirationLedger.
import http from "node:http";
import { writeFileSync, mkdirSync } from "node:fs";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";

const FAC = "https://channels.openzeppelin.com/x402/testnet";
const KEY = process.env.OZ_API_KEY;             // from https://channels.openzeppelin.com/testnet/gen
const SECRET = process.env.CLIENT_PRIVATE_KEY;  // "S..." testnet (no funds needed)
const OUT = "../proofreceipt-server/tests/fixtures";
mkdirSync(OUT, { recursive: true });

// Minimal echo seller: returns the same v2 402 our Rust server emits, logs the payment header.
const PR = {
  x402Version: 2, error: "",
  resource: { url: "http://127.0.0.1:8099/audit", description: "capture", mimeType: "application/json" },
  accepts: [{ scheme: "exact", network: "stellar:testnet",
    asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    amount: "100000", payTo: process.env.PAY_TO,
    maxTimeoutSeconds: 60, extra: { areFeesSponsored: true, image_id: "00" } }],
};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
let captured = null;
const srv = http.createServer((req, res) => {
  const sig = req.headers["payment-signature"];
  if (!sig) { res.writeHead(402, { "PAYMENT-REQUIRED": b64(PR) }); return res.end("{}"); }
  captured = JSON.parse(Buffer.from(sig, "base64").toString("utf8"));
  res.writeHead(202); res.end(JSON.stringify({ job_id: "capture" }));
});
await new Promise((r) => srv.listen(8099, r));

const signer = createEd25519Signer(SECRET, "stellar:testnet");
const client = new x402Client().register("stellar:*", new ExactStellarScheme(signer));
const fetchWithPay = wrapFetchWithPayment(fetch, client);
await fetchWithPay("http://127.0.0.1:8099/audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
writeFileSync(`${OUT}/payment_payload.json`, JSON.stringify(captured, null, 2));
srv.close();

// Live facilitator: /supported and an invalid /verify.
const auth = { Authorization: `Bearer ${KEY}` };
const sup = await (await fetch(`${FAC}/supported`, { headers: auth })).json();
writeFileSync(`${OUT}/supported.json`, JSON.stringify(sup, null, 2));
const inv = await (await fetch(`${FAC}/verify`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({ x402Version: 2, paymentPayload: {}, paymentRequirements: {} }) })).json();
writeFileSync(`${OUT}/verify_invalid.json`, JSON.stringify(inv, null, 2));
console.log("captured payment_payload.json, supported.json, verify_invalid.json");
```

- [ ] **Step 2: Run the capture (egress required)**

Run:
```bash
cd proofreceipt-buyer
export OZ_API_KEY="$(curl -s https://channels.openzeppelin.com/testnet/gen | python3 -c 'import sys,json;print(json.load(sys.stdin)["apiKey"])')"
export CLIENT_PRIVATE_KEY="$(stellar keys show e2e-buyer)"
export PAY_TO="$(stellar keys address e2e-seller)"
node scripts/capture.mjs
```
Expected: three fixture files written under `proofreceipt-server/tests/fixtures/`. `payment_payload.json` has `{x402Version:2, accepted:{...}, payload:{transaction:"<base64>"}}`; `verify_invalid.json` has `{isValid:false, invalidReason:"..."}`.

- [ ] **Step 3: Write the Rust round-trip test**

Create `proofreceipt-server/tests/wire_fixtures.rs`:

```rust
use proofreceipt_server::x402::{PaymentPayload, VerifyResponse};

#[test]
fn payment_payload_fixture_deserializes() {
    let s = std::fs::read_to_string("tests/fixtures/payment_payload.json").unwrap();
    let p: PaymentPayload = serde_json::from_str(&s).unwrap();
    assert_eq!(p.x402_version, 2);
    assert!(p.payload.get("transaction").and_then(|t| t.as_str()).is_some());
}

#[test]
fn verify_invalid_fixture_deserializes() {
    let s = std::fs::read_to_string("tests/fixtures/verify_invalid.json").unwrap();
    let v: VerifyResponse = serde_json::from_str(&s).unwrap();
    assert!(!v.is_valid);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd proofreceipt-server && cargo test --test wire_fixtures`
Expected: both PASS — the real captured bytes deserialize into our serde structs (locks the `PAYMENT-SIGNATURE` shape).

- [ ] **Step 5: Commit**

```bash
git add proofreceipt-buyer/scripts/capture.mjs proofreceipt-server/tests/fixtures proofreceipt-server/tests/wire_fixtures.rs
git commit -m "test(m2): capture real x402 wire bytes; assert Rust structs round-trip them"
```

---

### Task 9: Live testnet end-to-end

**Files:**
- Create: `proofreceipt-buyer/scripts/setup-testnet.sh`, `proofreceipt-server/proofreceipt-server.example.toml`

**Interfaces:** the full real run (egress + USDC required). Proves: buyer pays via the real OZ facilitator → server settles → `m0-host` proves → buyer polls → on-chain verify passes.

- [ ] **Step 1: Generate a fresh image_id source of truth**

Run: `cd proofreceipt-m0 && PATH="$HOME/.risc0/bin:$HOME/.cargo/bin:$PATH" RISC0_DEV_MODE=0 ./target/release/m0-host hello`
Then read `image_id` from `proof.json`. This single value feeds BOTH the server config (`image_id`) and the buyer env (`AGREED_IMAGE_ID`).

- [ ] **Step 2: Setup script (fund + trustlines + USDC + key)**

Create `proofreceipt-buyer/scripts/setup-testnet.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
RPC="https://soroban-testnet.stellar.org"; PASS='Test SDF Network ; September 2015'
USDC_ISSUER="GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
BUYER=$(stellar keys address e2e-buyer); SELLER=$(stellar keys address e2e-seller)
echo "buyer=$BUYER seller=$SELLER"
# 1. Fund both with XLM (idempotent; ignore already-funded errors).
curl -s "https://friendbot.stellar.org/?addr=$BUYER" >/dev/null || true
curl -s "https://friendbot.stellar.org/?addr=$SELLER" >/dev/null || true
# 2. USDC trustline on BOTH (seller payTo must hold it or settle's SAC transfer fails).
for who in e2e-buyer e2e-seller; do
  stellar tx new change-trust --source-account "$who" --line "USDC:$USDC_ISSUER" \
    --rpc-url "$RPC" --network-passphrase "$PASS" || true
done
# 3. OZ facilitator key.
echo "OZ_API_KEY=$(curl -s https://channels.openzeppelin.com/testnet/gen | python3 -c 'import sys,json;print(json.load(sys.stdin)["apiKey"])')"
echo "NOW fund the BUYER ($BUYER) with testnet USDC at https://faucet.circle.com (select Stellar testnet, asset USDC)."
```

- [ ] **Step 3: Run setup, fund USDC**

Run: `cd proofreceipt-buyer && ./scripts/setup-testnet.sh`
Then use the printed Circle faucet step to send testnet USDC to the buyer. (Web Captcha; not scriptable.)
Expected: both accounts funded with XLM + USDC trustline; buyer holds USDC; an `OZ_API_KEY` printed.

- [ ] **Step 4: Write server config**

Create `proofreceipt-server/proofreceipt-server.example.toml` and a real `proofreceipt-server.toml` (gitignored) from it:

```toml
pay_to = "<e2e-seller G-address>"
amount = "100000"                 # $0.01 USDC (7 decimals)
oz_api_key = "<from setup>"
image_id = "<image_id from Step 1 proof.json>"
verifier_id = "CCR6QRJJBEFKUDE4YXQ2L6VII6M6C57ENXXJ5A4HQWOO6PYKRP4KS4IU"
m0_host_path = "/home/aashim/hackathon/stellar-hacks/proofreceipt-m0/target/release/m0-host"
http_bind = "127.0.0.1:8081"
```

- [ ] **Step 5: Run the full e2e**

Run (two terminals):
```bash
# terminal A — server
cd proofreceipt-server && cargo run --release -- proofreceipt-server.toml
# terminal B — buyer
cd proofreceipt-buyer
export SERVER_URL=http://127.0.0.1:8081
export VERIFIER_ID=CCR6QRJJBEFKUDE4YXQ2L6VII6M6C57ENXXJ5A4HQWOO6PYKRP4KS4IU
export AGREED_IMAGE_ID="<image_id from Step 1>"
export CLIENT_PRIVATE_KEY="$(stellar keys show e2e-buyer)"
export CLIENT_PUBLIC_KEY="$(stellar keys address e2e-buyer)"
npm run buyer -- "audit me please"
```
Expected: buyer prints `✅ receipt verified: ran agreed program …`. Server logs a successful `/settle` (USDC moved to the seller) and a completed prove. Capture the settle tx hash from the server's `PAYMENT-RESPONSE`.

- [ ] **Step 6: Add .gitignore + example, commit**

Create `proofreceipt-server/.gitignore`:
```
/target
/proofreceipt-server.toml
```

```bash
git add proofreceipt-buyer/scripts/setup-testnet.sh proofreceipt-server/proofreceipt-server.example.toml proofreceipt-server/.gitignore
git commit -m "feat(m2): testnet e2e setup + example config (real x402 pay -> prove -> verify)"
```

---

## Notes for the implementer

- Tasks 1–6 build and pass fully offline (mock facilitator + fake `m0-host` shell script). Do NOT need egress, USDC, or the real prover.
- The single load-bearing trap: the buyer sends **`PAYMENT-SIGNATURE`** (v2), never `X-PAYMENT`. The server reads case-insensitively. Task 8 locks this against real bytes.
- Settle MUST happen before the 202 and before proving (auth entries expire ~60s; proving takes minutes).
- `image_id` is one value from one fresh `proof.json`, fed to both server config and buyer env — never two hardcoded copies.
- Keep the server pointed at the existing `proofreceipt-m0/target/release/m0-host` (risc0 3.0) so the seal selector still resolves against the deployed verifier.
- The buyer verifies via read-only `simulateTransaction` (free, no signing/submit); it still needs a funded source account for a valid sequence (its own address works).
- **No refund path — deliberate, by Option B.** A prior memory note ("M2 must add a buyer refund path") refers to the M1 ESCROW model. Option B settles the USDC straight to the seller up front via the facilitator, so there is no escrow to refund. The one residual buyer risk — payment settles, then the prover later fails (`GET /audit/{id}` → `200 {status:"error"}`, buyer already charged) — is an accepted tradeoff of pay-up-front x402. A refundable design is the *402-gated-escrow* variant (a separate future milestone), NOT this one. Do not bolt a refund onto Option B.
```
