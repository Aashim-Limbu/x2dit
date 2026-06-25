# ProofReceipt M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Soroban `proofreceipt` contract that escrows USDC and releases it to a seller after a challenge window when a RISC Zero proof shows the agreed program ran on the buyer's exact input.

**Architecture:** A new, self-contained Soroban workspace (`proofreceipt-contract/`) holds the settle contract; it calls the M0-deployed RISC Zero leaf verifier cross-contract via `RiscZeroVerifierClient`. The existing `proofreceipt-m0/` prover is upgraded so its guest commits `(input_hash, verdict)` as raw journal bytes. Job state moves one-way `Open → Proven → Claimed` for replay protection.

**Tech Stack:** Rust, Soroban SDK 25.x, `risc0-interface` (from NethermindEth/stellar-risc0-verifier), risc0-zkvm 3.0.x, stellar CLI 26.x.

## Global Constraints

- `soroban-sdk` pinned to major **25** (must match `risc0-interface`'s SDK major, or `Bytes`/`BytesN<32>` passed to `RiscZeroVerifierClient` are type-incompatible).
- `risc0-zkvm`/toolchain on the **3.0** line (already installed: 3.0.5) — must match the deployed verifier's `parameters.json` VERSION 3.0.0.
- Deployed RISC Zero leaf verifier (testnet): `CCR6QRJJBEFKUDE4YXQ2L6VII6M6C57ENXXJ5A4HQWOO6PYKRP4KS4IU`.
- Journal layout (raw bytes, no serde): `input_hash (32 bytes) || verdict (4 bytes little-endian u32)` = 36 bytes. Guest writes it with `env::commit_slice`.
- Groth16 proving requires Docker running + x86_64; prove with `ProverOpts::groth16()`.
- stellar CLI: the `testnet` alias errors with "Invalid URL" on this machine — always pass explicit `--rpc-url https://soroban-testnet.stellar.org --network-passphrase 'Test SDF Network ; September 2015'`.
- The bridge (`soroban/`, `relayer/`, `frontend/`, `vendor/`) is NOT touched.

## File Structure

- `proofreceipt-m0/methods/guest/src/main.rs` — MODIFY: commit `(input_hash, verdict)` raw bytes.
- `proofreceipt-m0/methods/guest/Cargo.toml` — MODIFY: add `sha2`.
- `proofreceipt-m0/host/src/main.rs` — MODIFY: read input bytes, emit `input_hash`/`verdict`/`journal`/`journal_digest` to `proof.json`.
- `proofreceipt-contract/Cargo.toml` — CREATE: workspace + soroban release profile.
- `proofreceipt-contract/contract/Cargo.toml` — CREATE: the contract crate.
- `proofreceipt-contract/contract/src/error.rs` — CREATE: `Error` enum.
- `proofreceipt-contract/contract/src/storage.rs` — CREATE: `Job`, `Status`, `DataKey`, accessors.
- `proofreceipt-contract/contract/src/lib.rs` — CREATE: `initialize`/`open_job`/`submit_proof`/`claim`.
- `proofreceipt-contract/contract/src/test.rs` — CREATE: unit + cross-layer tests, mock verifiers.
- `proofreceipt-contract/scripts/e2e_testnet.sh` — CREATE: deploy + open→submit→claim walkthrough.

---

### Task 1: Journal-binding guest + host

**Files:**
- Modify: `proofreceipt-m0/methods/guest/src/main.rs`
- Modify: `proofreceipt-m0/methods/guest/Cargo.toml`
- Modify: `proofreceipt-m0/host/src/main.rs`

**Interfaces:**
- Produces: `proof.json` with string fields `seal`, `image_id`, `input_hash`, `verdict` (decimal), `journal`, `journal_digest`. Journal bytes = `input_hash || verdict_le`.

- [ ] **Step 1: Update the guest to commit (input_hash, verdict) as raw bytes**

Replace `proofreceipt-m0/methods/guest/src/main.rs` with:

```rust
// M1 guest: read the buyer's input bytes, hash them, run a STUB audit, and
// commit (input_hash, verdict) as RAW journal bytes (no serde expansion).
use risc0_zkvm::guest::env;
use sha2::{Digest, Sha256};

fn main() {
    // The buyer's submitted artifact (stand-in). Stub: real audit logic is M3.
    let input: alloc::vec::Vec<u8> = env::read();

    let input_hash: [u8; 32] = Sha256::digest(&input).into();
    let verdict: u32 = if input.is_empty() { 0 } else { 1 };

    // Journal = input_hash(32) || verdict(4 LE) = 36 bytes, written raw.
    let mut buf = [0u8; 36];
    buf[..32].copy_from_slice(&input_hash);
    buf[32..].copy_from_slice(&verdict.to_le_bytes());
    env::commit_slice(&buf);
}

extern crate alloc;
```

- [ ] **Step 2: Add sha2 to the guest deps**

In `proofreceipt-m0/methods/guest/Cargo.toml`, under `[dependencies]` add:

```toml
sha2 = { version = "0.10", default-features = false }
```

- [ ] **Step 3: Update the host to feed input bytes and emit the new fields**

Replace the body of `proofreceipt-m0/host/src/main.rs` `main()` input handling + output with this (keep the existing imports; add `use sha2::{Digest as _, Sha256};` if not present):

```rust
fn main() -> anyhow::Result<()> {
    use anyhow::Context;
    // Input artifact: argv[1] as UTF-8 bytes, default "hello".
    let input_str = std::env::args().nth(1).unwrap_or_else(|| "hello".to_string());
    let input = input_str.into_bytes();

    eprintln!("[m1] input = {:?} ({} bytes)", input_str, input.len());
    eprintln!("[m1] proving with Groth16 (needs Docker; first run is slow)...");

    let env = risc0_zkvm::ExecutorEnv::builder().write(&input)?.build()?;
    let receipt = risc0_zkvm::default_prover()
        .prove_with_opts(env, m0_methods::M0_GUEST_ELF, &risc0_zkvm::ProverOpts::groth16())?
        .receipt;
    receipt.verify(m0_methods::M0_GUEST_ID).context("local verify failed")?;

    let seal = risc0_ethereum_contracts::encode_seal(&receipt)?;
    let image_id = risc0_zkvm::sha::Digest::from(m0_methods::M0_GUEST_ID);
    let journal = receipt.journal.bytes.clone();
    let journal_digest = Sha256::digest(&journal);
    let input_hash = Sha256::digest(&input);
    let verdict: u32 = if input.is_empty() { 0 } else { 1 };

    let out = format!(
        "{{\n  \"input\": \"{input_str}\",\n  \"seal\": \"{}\",\n  \"image_id\": \"{}\",\n  \"input_hash\": \"{}\",\n  \"verdict\": {verdict},\n  \"journal\": \"{}\",\n  \"journal_digest\": \"{}\"\n}}\n",
        hex::encode(&seal), hex::encode(image_id.as_bytes()),
        hex::encode(input_hash), hex::encode(&journal), hex::encode(journal_digest),
    );
    std::fs::write("proof.json", &out).context("writing proof.json")?;
    println!("{out}");
    Ok(())
}
```

- [ ] **Step 4: Build**

Run: `cd proofreceipt-m0 && PATH="$HOME/.risc0/bin:$HOME/.cargo/bin:$PATH" cargo build --release`
Expected: `Finished release`.

- [ ] **Step 5: Prove for "hello" and assert the journal layout**

Run:
```bash
cd proofreceipt-m0 && PATH="$HOME/.risc0/bin:$HOME/.cargo/bin:$PATH" RISC0_DEV_MODE=0 ./target/release/m0-host hello
grep -q '"journal": "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b982401000000"' proof.json && \
grep -q '"journal_digest": "49314a2ed2b80db1d717bddff8d1927c509e3eadfb3cdefa17af80de83254eba"' proof.json && echo "JOURNAL OK"
```
Expected: `JOURNAL OK` (proves the guest's raw journal == `sha256("hello") || 01000000` and its digest matches the deterministic fixture).

- [ ] **Step 6: Commit**

```bash
git add proofreceipt-m0/methods/guest/src/main.rs proofreceipt-m0/methods/guest/Cargo.toml proofreceipt-m0/host/src/main.rs
git commit -m "feat(m1): guest commits (input_hash, verdict) raw journal; host emits binding fields"
```

---

### Task 2: Contract workspace scaffold + storage

**Files:**
- Create: `proofreceipt-contract/Cargo.toml`
- Create: `proofreceipt-contract/contract/Cargo.toml`
- Create: `proofreceipt-contract/contract/src/error.rs`
- Create: `proofreceipt-contract/contract/src/storage.rs`
- Create: `proofreceipt-contract/contract/src/lib.rs` (minimal: module wiring + `initialize`/getters)

**Interfaces:**
- Produces: `Status { Open, Proven, Claimed }`; `Job { buyer, seller, token, amount: i128, expected_input_hash: BytesN<32>, expected_image_id: BytesN<32>, challenge_secs: u64, verdict: u32, claimable_at: u64, status: Status }`; `DataKey { Verifier, Job(BytesN<32>) }`; `Error`.

- [ ] **Step 1: Workspace Cargo.toml**

Create `proofreceipt-contract/Cargo.toml`:

```toml
[workspace]
resolver = "2"
members = ["contract"]

[profile.release]
opt-level = "z"
overflow-checks = true
debug = 0
strip = "symbols"
debug-assertions = false
panic = "abort"
codegen-units = 1
lto = true
```

- [ ] **Step 2: Contract Cargo.toml**

Create `proofreceipt-contract/contract/Cargo.toml`:

```toml
[package]
name = "proofreceipt"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
soroban-sdk = "25"
risc0-interface = { git = "https://github.com/NethermindEth/stellar-risc0-verifier", package = "risc0-interface" }

[dev-dependencies]
soroban-sdk = { version = "25", features = ["testutils"] }
```

- [ ] **Step 3: error.rs**

Create `proofreceipt-contract/contract/src/error.rs`:

```rust
use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    JobExists = 3,
    JobNotFound = 4,
    JobNotOpen = 5,
    JobNotProven = 6,
    ChallengeWindowOpen = 7,
    InvalidAmount = 8,
}
```

- [ ] **Step 4: storage.rs**

Create `proofreceipt-contract/contract/src/storage.rs`:

```rust
use soroban_sdk::{contracttype, Address, BytesN, Env};
use crate::error::Error;

#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Status {
    Open,
    Proven,
    Claimed,
}

#[contracttype]
#[derive(Clone)]
pub struct Job {
    pub buyer: Address,
    pub seller: Address,
    pub token: Address,
    pub amount: i128,
    pub expected_input_hash: BytesN<32>,
    pub expected_image_id: BytesN<32>,
    pub challenge_secs: u64,
    pub verdict: u32,
    pub claimable_at: u64,
    pub status: Status,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Verifier,
    Job(BytesN<32>),
}

pub fn get_verifier(env: &Env) -> Result<Address, Error> {
    env.storage().instance().get(&DataKey::Verifier).ok_or(Error::NotInitialized)
}
pub fn has_job(env: &Env, id: &BytesN<32>) -> bool {
    env.storage().persistent().has(&DataKey::Job(id.clone()))
}
pub fn get_job(env: &Env, id: &BytesN<32>) -> Result<Job, Error> {
    env.storage().persistent().get(&DataKey::Job(id.clone())).ok_or(Error::JobNotFound)
}
pub fn set_job(env: &Env, id: &BytesN<32>, job: &Job) {
    env.storage().persistent().set(&DataKey::Job(id.clone()), job);
}
```

- [ ] **Step 5: lib.rs (scaffold: initialize + getters)**

Create `proofreceipt-contract/contract/src/lib.rs`:

```rust
#![no_std]
mod error;
mod storage;
#[cfg(test)]
mod test;

use error::Error;
use storage::DataKey;
use storage::Job;
use soroban_sdk::{contract, contractimpl, Address, BytesN, Env};

#[contract]
pub struct ProofReceipt;

#[contractimpl]
impl ProofReceipt {
    pub fn initialize(env: Env, verifier: Address) {
        if env.storage().instance().has(&DataKey::Verifier) {
            soroban_sdk::panic_with_error!(&env, Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Verifier, &verifier);
    }

    pub fn get_verifier(env: Env) -> Result<Address, Error> {
        storage::get_verifier(&env)
    }

    pub fn get_job(env: Env, job_id: BytesN<32>) -> Result<Job, Error> {
        storage::get_job(&env, &job_id)
    }
}
```

- [ ] **Step 6: Create an empty test module so it compiles**

Create `proofreceipt-contract/contract/src/test.rs`:

```rust
#![cfg(test)]
use soroban_sdk::{testutils::Address as _, Address, Env};
use crate::{ProofReceipt, ProofReceiptClient};

#[test]
fn initialize_sets_verifier() {
    let env = Env::default();
    let verifier = Address::generate(&env);
    let id = env.register(ProofReceipt, ());
    let client = ProofReceiptClient::new(&env, &id);
    client.initialize(&verifier);
    assert_eq!(client.get_verifier(), verifier);
}
```

- [ ] **Step 7: Build + test**

Run: `cd proofreceipt-contract && cargo test -p proofreceipt`
Expected: `initialize_sets_verifier ... ok`.

- [ ] **Step 8: Commit**

```bash
git add proofreceipt-contract/Cargo.toml proofreceipt-contract/contract/Cargo.toml proofreceipt-contract/contract/src/error.rs proofreceipt-contract/contract/src/storage.rs proofreceipt-contract/contract/src/lib.rs proofreceipt-contract/contract/src/test.rs
git commit -m "feat(m1): proofreceipt contract scaffold (storage, initialize)"
```

---

### Task 3: open_job (escrow)

**Files:**
- Modify: `proofreceipt-contract/contract/src/lib.rs`
- Modify: `proofreceipt-contract/contract/src/test.rs`

**Interfaces:**
- Produces: `open_job(env, job_id: BytesN<32>, buyer: Address, seller: Address, token_addr: Address, amount: i128, expected_input_hash: BytesN<32>, expected_image_id: BytesN<32>, challenge_secs: u64) -> Result<(), Error>`. Transfers `amount` from buyer to the contract; stores a `Status::Open` job.

- [ ] **Step 1: Write the failing tests**

Add to `proofreceipt-contract/contract/src/test.rs`:

```rust
use soroban_sdk::{token, BytesN};

fn make_token<'a>(env: &Env, admin: &Address) -> (Address, token::StellarAssetClient<'a>, token::TokenClient<'a>) {
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let addr = sac.address();
    (addr.clone(), token::StellarAssetClient::new(env, &addr), token::TokenClient::new(env, &addr))
}

#[test]
fn open_job_escrows_funds() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let (token_addr, mint, tok) = make_token(&env, &admin);
    mint.mint(&buyer, &1000);

    let id = env.register(ProofReceipt, ());
    let client = ProofReceiptClient::new(&env, &id);
    client.initialize(&Address::generate(&env));

    let job_id = BytesN::from_array(&env, &[7u8; 32]);
    let ih = BytesN::from_array(&env, &[1u8; 32]);
    let img = BytesN::from_array(&env, &[2u8; 32]);
    client.open_job(&job_id, &buyer, &seller, &token_addr, &100, &ih, &img, &60);

    assert_eq!(tok.balance(&buyer), 900);
    assert_eq!(tok.balance(&id), 100);
    let job = client.get_job(&job_id);
    assert_eq!(job.status, crate::storage::Status::Open);
    assert_eq!(job.amount, 100);
}

#[test]
#[should_panic]
fn open_job_rejects_duplicate_id() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let (token_addr, mint, _tok) = make_token(&env, &admin);
    mint.mint(&buyer, &1000);
    let id = env.register(ProofReceipt, ());
    let client = ProofReceiptClient::new(&env, &id);
    client.initialize(&Address::generate(&env));
    let job_id = BytesN::from_array(&env, &[7u8; 32]);
    let ih = BytesN::from_array(&env, &[1u8; 32]);
    let img = BytesN::from_array(&env, &[2u8; 32]);
    client.open_job(&job_id, &buyer, &seller, &token_addr, &100, &ih, &img, &60);
    client.open_job(&job_id, &buyer, &seller, &token_addr, &100, &ih, &img, &60);
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd proofreceipt-contract && cargo test -p proofreceipt open_job`
Expected: FAIL (`open_job` not found).

- [ ] **Step 3: Implement open_job**

In `proofreceipt-contract/contract/src/lib.rs`, change the imports line to:

```rust
use soroban_sdk::{contract, contractimpl, symbol_short, token, Address, BytesN, Env};
use storage::{DataKey, Job, Status};
```

Add inside `impl ProofReceipt`:

```rust
    #[allow(clippy::too_many_arguments)]
    pub fn open_job(
        env: Env,
        job_id: BytesN<32>,
        buyer: Address,
        seller: Address,
        token_addr: Address,
        amount: i128,
        expected_input_hash: BytesN<32>,
        expected_image_id: BytesN<32>,
        challenge_secs: u64,
    ) -> Result<(), Error> {
        buyer.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if storage::has_job(&env, &job_id) {
            return Err(Error::JobExists);
        }

        token::TokenClient::new(&env, &token_addr)
            .transfer(&buyer, &env.current_contract_address(), &amount);

        let job = Job {
            buyer,
            seller,
            token: token_addr,
            amount,
            expected_input_hash,
            expected_image_id,
            challenge_secs,
            verdict: 0,
            claimable_at: 0,
            status: Status::Open,
        };
        storage::set_job(&env, &job_id, &job);
        env.events().publish((symbol_short!("opened"), job_id), amount);
        Ok(())
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd proofreceipt-contract && cargo test -p proofreceipt open_job`
Expected: both `open_job_escrows_funds` and `open_job_rejects_duplicate_id` PASS.

- [ ] **Step 5: Commit**

```bash
git add proofreceipt-contract/contract/src/lib.rs proofreceipt-contract/contract/src/test.rs
git commit -m "feat(m1): open_job escrows USDC and records the deal"
```

---

### Task 4: submit_proof (verify + bind)

**Files:**
- Modify: `proofreceipt-contract/contract/src/lib.rs`
- Modify: `proofreceipt-contract/contract/src/test.rs`

**Interfaces:**
- Produces: `submit_proof(env, job_id: BytesN<32>, seal: Bytes, verdict: u32) -> Result<(), Error>`. Reconstructs `journal = job.expected_input_hash || verdict_le`, sha256s it, calls `RiscZeroVerifierClient::verify(seal, job.expected_image_id, journal_digest)` (traps if invalid), sets `Proven` + `claimable_at`.
- Consumes (tests): mock verifier contracts `GoodVerifier` (no-op) and `BadVerifier` (panics) with signature `verify(Env, Bytes, BytesN<32>, BytesN<32>)`.

- [ ] **Step 1: Write the failing tests + mock verifiers**

Add to `proofreceipt-contract/contract/src/test.rs`:

```rust
use soroban_sdk::{contract, contractimpl, Bytes};

#[contract]
pub struct GoodVerifier;
#[contractimpl]
impl GoodVerifier {
    pub fn verify(_e: Env, _seal: Bytes, _image_id: BytesN<32>, _journal: BytesN<32>) {}
}

#[contract]
pub struct BadVerifier;
#[contractimpl]
impl BadVerifier {
    pub fn verify(_e: Env, _seal: Bytes, _image_id: BytesN<32>, _journal: BytesN<32>) {
        panic!("invalid proof");
    }
}

fn open_default_job(env: &Env, client: &ProofReceiptClient, token_addr: &Address, buyer: &Address, seller: &Address) -> BytesN<32> {
    let job_id = BytesN::from_array(env, &[9u8; 32]);
    let ih = BytesN::from_array(env, &[1u8; 32]);
    let img = BytesN::from_array(env, &[2u8; 32]);
    client.open_job(&job_id, buyer, seller, token_addr, &100, &ih, &img, &60);
    job_id
}

#[test]
fn submit_proof_marks_proven_on_valid() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let (token_addr, mint, _tok) = make_token(&env, &admin);
    mint.mint(&buyer, &1000);

    let verifier = env.register(GoodVerifier, ());
    let id = env.register(ProofReceipt, ());
    let client = ProofReceiptClient::new(&env, &id);
    client.initialize(&verifier);
    let job_id = open_default_job(&env, &client, &token_addr, &buyer, &seller);

    client.submit_proof(&job_id, &Bytes::from_array(&env, &[0u8; 4]), &1);
    let job = client.get_job(&job_id);
    assert_eq!(job.status, crate::storage::Status::Proven);
    assert_eq!(job.verdict, 1);
    assert_eq!(job.claimable_at, env.ledger().timestamp() + 60);
}

#[test]
#[should_panic]
fn submit_proof_traps_on_invalid() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let (token_addr, mint, _tok) = make_token(&env, &admin);
    mint.mint(&buyer, &1000);

    let verifier = env.register(BadVerifier, ());
    let id = env.register(ProofReceipt, ());
    let client = ProofReceiptClient::new(&env, &id);
    client.initialize(&verifier);
    let job_id = open_default_job(&env, &client, &token_addr, &buyer, &seller);
    client.submit_proof(&job_id, &Bytes::from_array(&env, &[0u8; 4]), &1);
}

#[test]
#[should_panic]
fn submit_proof_rejects_non_open() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let (token_addr, mint, _tok) = make_token(&env, &admin);
    mint.mint(&buyer, &1000);
    let verifier = env.register(GoodVerifier, ());
    let id = env.register(ProofReceipt, ());
    let client = ProofReceiptClient::new(&env, &id);
    client.initialize(&verifier);
    let job_id = open_default_job(&env, &client, &token_addr, &buyer, &seller);
    client.submit_proof(&job_id, &Bytes::from_array(&env, &[0u8; 4]), &1);
    // Second submit on a Proven job must fail.
    client.submit_proof(&job_id, &Bytes::from_array(&env, &[0u8; 4]), &1);
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd proofreceipt-contract && cargo test -p proofreceipt submit_proof`
Expected: FAIL (`submit_proof` not found).

- [ ] **Step 3: Implement submit_proof**

In `proofreceipt-contract/contract/src/lib.rs`, add to the imports:

```rust
use soroban_sdk::Bytes;
use risc0_interface::RiscZeroVerifierClient;
```

Add inside `impl ProofReceipt`:

```rust
    pub fn submit_proof(
        env: Env,
        job_id: BytesN<32>,
        seal: Bytes,
        verdict: u32,
    ) -> Result<(), Error> {
        let mut job = storage::get_job(&env, &job_id)?;
        if job.status != Status::Open {
            return Err(Error::JobNotOpen);
        }
        job.seller.require_auth();

        // Reconstruct the journal from the buyer's PINNED input hash + verdict.
        // verify() only succeeds if the guest committed exactly these bytes, so
        // a valid proof IS the proof the seller ran on the buyer's exact input.
        let mut buf = Bytes::from_array(&env, &job.expected_input_hash.to_array());
        buf.extend_from_array(&verdict.to_le_bytes());
        let journal_digest: BytesN<32> = env.crypto().sha256(&buf).to_bytes();

        let verifier = storage::get_verifier(&env)?;
        RiscZeroVerifierClient::new(&env, &verifier)
            .verify(&seal, &job.expected_image_id, &journal_digest);

        job.verdict = verdict;
        job.claimable_at = env.ledger().timestamp().saturating_add(job.challenge_secs);
        job.status = Status::Proven;
        storage::set_job(&env, &job_id, &job);
        env.events().publish((symbol_short!("proven"), job_id), (verdict, job.claimable_at));
        Ok(())
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd proofreceipt-contract && cargo test -p proofreceipt submit_proof`
Expected: `submit_proof_marks_proven_on_valid`, `submit_proof_traps_on_invalid`, `submit_proof_rejects_non_open` PASS.

- [ ] **Step 5: Commit**

```bash
git add proofreceipt-contract/contract/src/lib.rs proofreceipt-contract/contract/src/test.rs
git commit -m "feat(m1): submit_proof verifies proof against pinned input + image"
```

---

### Task 5: claim (release after window)

**Files:**
- Modify: `proofreceipt-contract/contract/src/lib.rs`
- Modify: `proofreceipt-contract/contract/src/test.rs`

**Interfaces:**
- Produces: `claim(env, job_id: BytesN<32>) -> Result<(), Error>`. Requires `Proven` + `now >= claimable_at`; transfers escrow to seller; sets `Claimed`.

- [ ] **Step 1: Write the failing tests**

Add to `proofreceipt-contract/contract/src/test.rs`:

```rust
use soroban_sdk::testutils::Ledger as _;

#[test]
fn claim_pays_seller_after_window() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let (token_addr, mint, tok) = make_token(&env, &admin);
    mint.mint(&buyer, &1000);
    let verifier = env.register(GoodVerifier, ());
    let id = env.register(ProofReceipt, ());
    let client = ProofReceiptClient::new(&env, &id);
    client.initialize(&verifier);
    let job_id = open_default_job(&env, &client, &token_addr, &buyer, &seller);
    client.submit_proof(&job_id, &Bytes::from_array(&env, &[0u8; 4]), &1);

    env.ledger().set_timestamp(env.ledger().timestamp() + 61);
    client.claim(&job_id);

    assert_eq!(tok.balance(&seller), 100);
    assert_eq!(tok.balance(&id), 0);
    assert_eq!(client.get_job(&job_id).status, crate::storage::Status::Claimed);
}

#[test]
#[should_panic]
fn claim_rejected_before_window() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let (token_addr, mint, _tok) = make_token(&env, &admin);
    mint.mint(&buyer, &1000);
    let verifier = env.register(GoodVerifier, ());
    let id = env.register(ProofReceipt, ());
    let client = ProofReceiptClient::new(&env, &id);
    client.initialize(&verifier);
    let job_id = open_default_job(&env, &client, &token_addr, &buyer, &seller);
    client.submit_proof(&job_id, &Bytes::from_array(&env, &[0u8; 4]), &1);
    client.claim(&job_id); // window not elapsed -> ChallengeWindowOpen
}

#[test]
#[should_panic]
fn claim_rejects_double_claim() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let (token_addr, mint, _tok) = make_token(&env, &admin);
    mint.mint(&buyer, &1000);
    let verifier = env.register(GoodVerifier, ());
    let id = env.register(ProofReceipt, ());
    let client = ProofReceiptClient::new(&env, &id);
    client.initialize(&verifier);
    let job_id = open_default_job(&env, &client, &token_addr, &buyer, &seller);
    client.submit_proof(&job_id, &Bytes::from_array(&env, &[0u8; 4]), &1);
    env.ledger().set_timestamp(env.ledger().timestamp() + 61);
    client.claim(&job_id);
    client.claim(&job_id); // second claim -> JobNotProven (status now Claimed)
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd proofreceipt-contract && cargo test -p proofreceipt claim`
Expected: FAIL (`claim` not found).

- [ ] **Step 3: Implement claim**

Add inside `impl ProofReceipt` in `proofreceipt-contract/contract/src/lib.rs`:

```rust
    pub fn claim(env: Env, job_id: BytesN<32>) -> Result<(), Error> {
        let mut job = storage::get_job(&env, &job_id)?;
        if job.status != Status::Proven {
            return Err(Error::JobNotProven);
        }
        if env.ledger().timestamp() < job.claimable_at {
            return Err(Error::ChallengeWindowOpen);
        }
        job.seller.require_auth();

        token::TokenClient::new(&env, &job.token)
            .transfer(&env.current_contract_address(), &job.seller, &job.amount);

        job.status = Status::Claimed;
        storage::set_job(&env, &job_id, &job);
        env.events().publish((symbol_short!("claimed"), job_id), job.amount);
        Ok(())
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd proofreceipt-contract && cargo test -p proofreceipt`
Expected: ALL tests PASS (including the three claim tests).

- [ ] **Step 5: Commit**

```bash
git add proofreceipt-contract/contract/src/lib.rs proofreceipt-contract/contract/src/test.rs
git commit -m "feat(m1): claim releases escrow to seller after challenge window"
```

---

### Task 6: Byte-exactness cross-layer guard

**Files:**
- Modify: `proofreceipt-contract/contract/src/test.rs`

**Interfaces:**
- Consumes: deterministic fixture for input `"hello"` from Task 1 — `input_hash = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824`, `verdict = 1`, `journal_digest = 49314a2ed2b80db1d717bddff8d1927c509e3eadfb3cdefa17af80de83254eba`.

- [ ] **Step 1: Write the test**

Add to `proofreceipt-contract/contract/src/test.rs`:

```rust
// Guard: the contract's journal reconstruction (expected_input_hash || verdict_le,
// then sha256) MUST equal the host/guest journal_digest for the SAME input.
// Fixture is the host output for input "hello" (Task 1). If the guest's
// commit_slice layout or the contract's concat ever drifts, this fails.
#[test]
fn contract_journal_digest_matches_host_fixture() {
    let env = Env::default();
    let input_hash = BytesN::from_array(&env, &[
        0x2c,0xf2,0x4d,0xba,0x5f,0xb0,0xa3,0x0e,0x26,0xe8,0x3b,0x2a,0xc5,0xb9,0xe2,0x9e,
        0x1b,0x16,0x1e,0x5c,0x1f,0xa7,0x42,0x5e,0x73,0x04,0x33,0x62,0x93,0x8b,0x98,0x24,
    ]);
    let verdict: u32 = 1;

    let mut buf = Bytes::from_array(&env, &input_hash.to_array());
    buf.extend_from_array(&verdict.to_le_bytes());
    let digest: BytesN<32> = env.crypto().sha256(&buf).to_bytes();

    let expected = BytesN::from_array(&env, &[
        0x49,0x31,0x4a,0x2e,0xd2,0xb8,0x0d,0xb1,0xd7,0x17,0xbd,0xdf,0xf8,0xd1,0x92,0x7c,
        0x50,0x9e,0x3e,0xad,0xfb,0x3c,0xde,0xfa,0x17,0xaf,0x80,0xde,0x83,0x25,0x4e,0xba,
    ]);
    assert_eq!(digest, expected);
}
```

- [ ] **Step 2: Run to verify pass**

Run: `cd proofreceipt-contract && cargo test -p proofreceipt contract_journal_digest_matches_host_fixture`
Expected: PASS. (If it fails, the guest journal layout and the contract reconstruction have diverged — the #1 silent bug.)

- [ ] **Step 3: Commit**

```bash
git add proofreceipt-contract/contract/src/test.rs
git commit -m "test(m1): cross-layer byte-exactness guard for journal digest"
```

---

### Task 7: Testnet end-to-end walkthrough

**Files:**
- Create: `proofreceipt-contract/scripts/e2e_testnet.sh`

**Interfaces:**
- Consumes: `proofreceipt-m0/proof.json` (real proof for some input), the deployed verifier id, a funded testnet identity, and a USDC SAC address.

- [ ] **Step 1: Write the e2e script**

Create `proofreceipt-contract/scripts/e2e_testnet.sh`:

```bash
#!/usr/bin/env bash
# M1 end-to-end on testnet: deploy proofreceipt, open a job, submit the real
# proof, fast-forward is NOT possible on testnet so use a short challenge window.
#
# Requires: SOURCE (funded identity), TOKEN (USDC SAC address), and a real
# proofreceipt-m0/proof.json. SELLER defaults to SOURCE's address.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RPC="https://soroban-testnet.stellar.org"
PASS='Test SDF Network ; September 2015'
VERIFIER="CCR6QRJJBEFKUDE4YXQ2L6VII6M6C57ENXXJ5A4HQWOO6PYKRP4KS4IU"
SOURCE="${SOURCE:?set SOURCE=<funded identity>}"
TOKEN="${TOKEN:?set TOKEN=<USDC SAC address>}"
PROOF="$HERE/../proofreceipt-m0/proof.json"
val(){ grep -o "\"$1\": *\"[0-9a-fx]*\"" "$PROOF" | head -1 | sed -E 's/.*"([0-9a-fx]*)"$/\1/'; }
SEAL="$(val seal)"; IMAGE_ID="$(val image_id)"; INPUT_HASH="$(val input_hash)"
VERDICT="$(grep -o '"verdict": *[0-9]*' "$PROOF" | grep -o '[0-9]*')"
ADDR="$(stellar keys address "$SOURCE")"

echo "[e2e] building contract wasm..."
( cd "$HERE/contract" && stellar contract build )
WASM="$(find "$HERE/target" -name 'proofreceipt.wasm' -path '*release*' ! -path '*deps*' | head -1)"

echo "[e2e] deploying proofreceipt..."
PR_ID="$(stellar contract deploy --wasm "$WASM" --source "$SOURCE" --rpc-url "$RPC" --network-passphrase "$PASS")"
echo "[e2e] proofreceipt: $PR_ID"

inv(){ stellar contract invoke --id "$PR_ID" --source "$SOURCE" --rpc-url "$RPC" --network-passphrase "$PASS" --send yes -- "$@"; }
inv initialize --verifier "$VERIFIER"

JOB_ID="$(openssl rand -hex 32)"
echo "[e2e] opening job $JOB_ID (buyer=seller=$ADDR for the demo)..."
inv open_job --job_id "$JOB_ID" --buyer "$ADDR" --seller "$ADDR" --token_addr "$TOKEN" \
  --amount 100 --expected_input_hash "$INPUT_HASH" --expected_image_id "$IMAGE_ID" --challenge_secs 5

echo "[e2e] submitting real proof..."
inv submit_proof --job_id "$JOB_ID" --seal "$SEAL" --verdict "$VERDICT"

echo "[e2e] waiting out the 5s challenge window..."; sleep 7
inv claim --job_id "$JOB_ID"
echo "[e2e] ✅ open -> submit_proof(real RISC Zero proof) -> claim all succeeded on testnet."
```

- [ ] **Step 2: Make executable**

Run: `chmod +x proofreceipt-contract/scripts/e2e_testnet.sh`

- [ ] **Step 3: Generate a fresh proof + run the walkthrough**

Run:
```bash
cd proofreceipt-m0 && PATH="$HOME/.risc0/bin:$HOME/.cargo/bin:$PATH" RISC0_DEV_MODE=0 ./target/release/m0-host hello
cd ../proofreceipt-contract && SOURCE=bridge-deployer TOKEN=<USDC_SAC_ADDRESS> ./scripts/e2e_testnet.sh
```
Expected: final line `✅ open -> submit_proof(real RISC Zero proof) -> claim all succeeded on testnet.`
Note: pick `TOKEN` = the existing testnet USDC SAC, and ensure `bridge-deployer` holds enough of it (or mint via the `zusdc-issuer` identity first).

- [ ] **Step 4: Commit**

```bash
git add proofreceipt-contract/scripts/e2e_testnet.sh
git commit -m "feat(m1): testnet e2e walkthrough (open -> submit_proof -> claim)"
```

---

## Notes for the implementer

- Run contract unit tests from `proofreceipt-contract/` (its own workspace). Run the prover from `proofreceipt-m0/` with the risc0 PATH prefix.
- `env.register(Contract, ())` and `register_stellar_asset_contract_v2` are soroban-sdk 22+ APIs; on SDK 25 they're current. If the SDK minor differs, check `token::StellarAssetClient`/`token::TokenClient` import paths.
- `RiscZeroVerifierClient::verify` returns `()` and TRAPS on a bad proof — there is no bool to check. That trap is what makes `submit_proof` reject invalid proofs; the `BadVerifier` mock reproduces it.
- The deployed verifier expects `journal` = sha256(journal_bytes). The contract computes exactly that; do not pass raw journal bytes.
```
