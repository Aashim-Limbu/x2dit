# M3 policy test fixtures

Real Soroban contracts compiled to WASM, used to test the import parser + policy.
Both built with `soroban-sdk = "25"` (resolved 25.3.1), target `wasm32v1-none`,
`cargo build --release --target wasm32v1-none`.

| fixture | audits to | why |
|---|---|---|
| `clean.wasm` | `0` (clean) | 15 known imports incl. storage-write `l/_` + auth `a/0` |
| `denylisted.wasm` | `2` (bit1, denylist hit) | imports `update_current_contract_wasm` (`l/6`) — code self-modification, on the denylist |

`denylisted.wasm` is also useful for a live demo of a **non-zero** verdict end-to-end
(`npm run buyer -- …/denylisted.wasm` → `audit verdict: 2 — denylist-hit`).

- **denylisted.wasm sha256:** `fd909474f9620422de126231e449b63e9a2da19707a6805c44790f67463aaa1a`
  - rebuild source (`src/lib.rs`):
    ```rust
    #![no_std]
    use soroban_sdk::{contract, contractimpl, BytesN, Env};
    #[contract]
    pub struct BadUpgrade;
    #[contractimpl]
    impl BadUpgrade {
        pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
            env.deployer().update_current_contract_wasm(new_wasm_hash); // l/6 (denylisted)
        }
    }
    ```

---

## `clean.wasm`

A real Soroban contract compiled to WASM, used to test the import parser + policy
(`parse_imports` extracts exactly 15 imports; `audit_verdict` returns 0 = clean).

- **soroban-sdk:** `25` (resolved 25.3.1), **target:** `wasm32v1-none`
- **sha256:** `746334f720ffa2fb08bb68de6143a5276288b68838a6c06651aba93a23e33fb8`
- **Imports (module,field):** (a,0)(l,_)(l,1)(x,3)(x,4)(i,0)(m,_)(m,0)(v,_)(v,6)(b,4)(b,3)(b,e)(c,_)(l,0)

## Rebuild

`Cargo.toml`:
```toml
[package]
name = "m3sample"
version = "0.1.0"
edition = "2021"
[lib]
crate-type = ["cdylib"]
[dependencies]
soroban-sdk = "25"
[profile.release]
opt-level = "z"
overflow-checks = true
panic = "abort"
codegen-units = 1
lto = true
strip = "symbols"
```

`src/lib.rs`:
```rust
#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, Address, Bytes, Env, Map, Symbol, Vec};

#[contract]
pub struct M3Sample;
const KEY: Symbol = symbol_short!("K");

#[contractimpl]
impl M3Sample {
    pub fn exercise(env: Env, who: Address, n: u32) -> soroban_sdk::BytesN<32> {
        who.require_auth();                                   // a/0
        env.storage().persistent().set(&KEY, &n);            // l/_
        let _ = env.storage().persistent().has(&KEY);        // l/0
        let v: u32 = env.storage().persistent().get(&KEY).unwrap_or(0); // l/1
        let seq = env.ledger().sequence();                   // x/3
        let ts = env.ledger().timestamp();                   // x/4, i/0
        let mut m: Map<Symbol, u32> = Map::new(&env);        // m/_
        m.set(KEY, v.wrapping_add(seq));                     // m/0
        let mut vc: Vec<u32> = Vec::new(&env);               // v/_
        vc.push_back(v); vc.push_back(ts as u32);            // v/6
        let mut b = Bytes::new(&env);                        // b/4
        b.append(&Bytes::from_slice(&env, &n.to_be_bytes())); // b/3, b/e
        env.crypto().sha256(&b).to_bytes()                   // c/_
    }
}
```

Build: `cargo build --release --target wasm32v1-none`, then copy
`target/wasm32v1-none/release/m3sample.wasm` to `clean.wasm`.
