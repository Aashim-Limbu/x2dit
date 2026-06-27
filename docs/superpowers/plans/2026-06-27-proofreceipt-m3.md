# ProofReceipt M3 — Real Bounded Audit (Soroban Capability Policy) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stub guest verdict (`nonempty ? 1 : 0`) with a real, bounded, deterministic capability-policy audit of a Soroban contract's WASM import section, committing a findings bitmask in the same 36-byte journal — so the proof attests an actual security check ran on the buyer's exact contract.

**Architecture:** A new pure, dependency-free `wasm-policy` crate (`no_std` + `alloc`, host-testable) hand-rolls a bounded WASM import-section parser and applies a baked-in policy (allowlist / denylist / auth-presence), returning a `u32` findings bitmask. The RISC Zero guest calls it; everything else (journal layout, on-chain verifier, server settle path, buyer binding checks) is unchanged. The host stops recomputing the stub verdict and reads it from the committed journal; the buyer gains a bitmask→findings decoder and the ability to submit a `.wasm` file. Changing the policy changes the guest's `image_id` (= the agreed policy) — no verifier redeploy.

**Tech Stack:** Rust (RISC Zero 3.0 zkVM guest + host), pure `no_std` Rust for the parser/policy, TypeScript (buyer). Soroban host-fn interface pinned from `soroban-env-common 25.0.1` (`env.json`) against a real `soroban-sdk 25.3.1` compiled artifact.

## Global Constraints

- **Journal layout is UNCHANGED and load-bearing:** `journal = input_hash(32 bytes) ‖ verdict(4 bytes, little-endian u32)` = exactly 36 bytes, written via `env::commit_slice`. Do not change the size, order, or endianness.
- **`input_hash = sha256(wasm_bytes)`** over the raw submitted bytes (unchanged from M1/M2).
- **Verdict is a findings bitmask (`u32`):** `0` = clean; bit 0 (`0x1`) = allowlist violation; bit 1 (`0x2`) = denylist hit; bit 2 (`0x4`) = auth-presence failure. Bits 3–31 are reserved and MUST always be 0 in M3.
- **Malformed WASM must never yield a "clean" verdict.** If the import section cannot be parsed, the policy returns `Err` and the guest panics (proving fails → the buyer gets an error job), rather than committing `verdict = 0`.
- **The policy is BAKED INTO the guest** as compile-time constants — no runtime-configurable policy. The guest's `image_id` therefore *is* the agreed policy.
- **The 4 policy sets (exact terse `(module_byte, field_byte)` pairs), pinned from a real compiled artifact + `env.json`:**
  - **Known-interface modules → function count** (an import is a *known* host fn iff its module is one of these and its field index `< count`): `x`→10, `i`→44, `m`→12, `v`→19, `l`→16, `d`→2, `b`→26, `c`→28, `a`→8, `t`→2, `p`→4. Any other module, or a field index ≥ count, or a non-func import kind, is an allowlist violation. (Counts re-derived by counting `functions[]` per module in `soroban-env-common 25.0.1`'s `env.json`; `x`=context has 10 fns, top field `'8'` = `get_max_live_until_ledger` at index 9.)
  - **Field-name encoding** (single ASCII byte = the fn's positional index in its module via Soroban's Symbol alphabet): `_`→0, `'0'..'9'`→1..10, `'a'..'z'`→11..36, `'A'..'Z'`→37..62.
  - **DENYLIST** = `{(b't',b'_'), (b't',b'0'), (b'l',b'5'), (b'l',b'6')}` — test-only `dummy0`/`protocol_gated_dummy` + code self-modification `upload_wasm`/`update_current_contract_wasm`. (User-chosen policy; changing it yields a new `image_id`.)
  - **STORAGE-WRITE set** = `{(b'l',b'_'), (b'l',b'2')}` — `put_contract_data`, `del_contract_data`. (Durability persistent/temporary/instance is NOT distinguishable from imports — single host fn per op.)
  - **AUTH set** = `{(b'a',b'0'), (b'a',b'_')}` — `require_auth`, `require_auth_for_args`.
  - **Auth-presence rule (bit 2):** set iff the module imports any STORAGE-WRITE fn AND imports no AUTH fn.
- **Documented limitations of CLEAN (verdict 0) — import-level analysis only.** These are inherent to inspecting only the import section (no function-body/control-flow analysis, which is explicitly deferred). The buyer messaging must NOT overclaim, and these caveats must appear in the `policy.rs` doc-comment:
  - **bit 2 is import-PRESENCE, not enforcement.** It attests an auth host fn is *imported* alongside storage writes — NOT that every write is actually auth-gated. A contract that imports `require_auth` but never calls it (e.g. on a dead branch) clears bit 2. (Same class as the durability caveat above.)
  - **Allowlist ≠ safelist.** `is_known` returns true for ANY real host fn, so absence of bit 0 only means "imports nothing outside the host interface." Safety rests on the DENYLIST. With the chosen denylist, **CLEAN means: no test-only host fns and no WASM self-upload/update — it does NOT mean "no dangerous capability."** Genuinely powerful-but-not-denylisted fns (e.g. `create_contract` `l/3`, cross-contract `call` `d/_`, `authorize_as_curr_contract` `a/3`) audit CLEAN by design. Expanding the denylist to cover them is a one-line change that yields a new `image_id` (the intended mechanism).
  - **The receipt binds WASM bytes, not a deployed address.** `input_hash = sha256(wasm)` attests the audit ran on *these exact bytes*; any "this deployed contract is safe" claim additionally requires binding the on-chain contract's code hash to `input_hash`.
- **Parser:** hand-rolled, bounded, zero external deps; every read bounds-checked (returns `Err`, never panics/indexes-OOB). Do NOT add `wasmparser` or any WASM crate to the guest.
- **RISC Zero stays pinned to the 3.0 line** (seal-selector compatibility with the deployed verifier `parameters.json`). Do not bump risc0.
- **No verifier redeploy.** The deployed verifier `CCR6QRJJBEFKUDE4YXQ2L6VII6M6C57ENXXJ5A4HQWOO6PYKRP4KS4IU` is generic over `image_id`. The new `image_id` flows only into the server config and the buyer's `AGREED_IMAGE_ID` env.
- **risc0 build PATH (toolchain already installed):** `export PATH="$HOME/.risc0/bin:$HOME/.cargo/bin:$PATH"`. Building the guest needs the RISC-V toolchain (no Docker); only real Groth16 *proving* needs Docker. **Note:** any `cargo build`/`cargo test` in the `m0` workspace (e.g. `cargo test -p m0-host`) runs `methods`' `risc0-build` `build.rs`, which compiles the guest ELF — so those commands require this PATH and are not pure host-only runs.
- **Provenance of the test fixture:** `wasm-policy/tests/fixtures/clean.wasm` is a real `soroban-sdk 25.3.1` contract compiled with `cargo build --release --target wasm32v1-none`; its 15 imports are all known, include `put_contract_data` (`l/_`) and `require_auth` (`a/0`), and trip no denylist entry → verdict 0. It is COMMITTED to the repo (force-added past the root `*.wasm` gitignore — see Task 1) so fresh checkouts/CI can compile the `include_bytes!` tests; a `fixtures/README.md` records the exact source + rebuild command for reproducibility.

---

### Task 1: `wasm-policy` crate scaffold + bounded WASM import-section parser

Creates the pure, host-testable crate and the hand-rolled parser that extracts every import's `(kind, module, field)` from raw WASM bytes, with graceful error handling. No policy logic yet (Task 2).

**Files:**
- Create: `proofreceipt-m0/methods/guest/wasm-policy/Cargo.toml`
- Create: `proofreceipt-m0/methods/guest/wasm-policy/src/lib.rs`
- Create: `proofreceipt-m0/methods/guest/wasm-policy/src/parser.rs`
- Create (binary fixture, copy from scratch): `proofreceipt-m0/methods/guest/wasm-policy/tests/fixtures/clean.wasm`
- Test: parser unit tests live in `src/parser.rs` under `#[cfg(test)] mod tests`.

**Interfaces:**
- Produces (consumed by Task 2 and Task 3):
  - `pub enum ParseError { BadMagic, Truncated, BadLeb, SectionOverrun }` (derives `Debug, PartialEq, Eq`)
  - `pub struct Import<'a> { pub kind: u8, pub module: &'a [u8], pub field: &'a [u8] }` (also derives `Debug, PartialEq, Eq` — the parser tests `assert_eq!(parse_imports(...), Err(...))` compare a `Result<Vec<Import>, ParseError>`, which requires `Import: Debug + PartialEq`)
  - `pub fn parse_imports(wasm: &[u8]) -> Result<alloc::vec::Vec<Import<'_>>, ParseError>` — returns every import in order; only id==2 (import section) is read, other sections are skipped by size. `kind`: 0=func,1=table,2=mem,3=global,4=tag.

- [ ] **Step 1: Create the crate manifest**

`proofreceipt-m0/methods/guest/wasm-policy/Cargo.toml`:

```toml
[package]
name = "wasm-policy"
version = "0.1.0"
edition = "2021"

# Standalone workspace so it's fully decoupled from the guest's RISC-V workspace
# and from the host workspace: `cargo test` here builds for the HOST target with
# zero risc0 involvement, while the guest depends on it via a path dependency.
[workspace]

[dependencies]
# Intentionally EMPTY — pure no_std + alloc, zero deps (keeps proving tiny and the
# security boundary auditable).
```

- [ ] **Step 2: Create the crate root**

`proofreceipt-m0/methods/guest/wasm-policy/src/lib.rs`:

```rust
//! Pure, dependency-free Soroban-WASM capability-policy audit for the ProofReceipt
//! M3 guest. `no_std` + `alloc` in production; `std` under `cargo test` so the test
//! harness links. Zero external deps: the parser is hand-rolled and fully
//! bounds-checked so the proof means exactly what we say it means.
#![cfg_attr(not(test), no_std)]

extern crate alloc;

pub mod parser;

pub use parser::{parse_imports, Import, ParseError};
```

- [ ] **Step 3: Write the failing parser tests**

`proofreceipt-m0/methods/guest/wasm-policy/src/parser.rs` — start with the test module only (implementation lands in Step 5). Append this at the bottom of the file:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    // Minimal-but-valid WASM: header + a type section (one `()->()`), so a func
    // import can reference type index 0. Import-section bytes are appended per case.
    const HEADER_AND_TYPE: &[u8] = &[
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // \0asm + version 1
        0x01, 0x04, 0x01, 0x60, 0x00, 0x00, // type section: 1 type, ()->()
    ];

    // One func import (module, field) referencing type 0: import section id=2,
    // size=7, count=1, modlen=1, mod, namelen=1, name, kind=0(func), typeidx=0.
    fn with_one_import(module: u8, field: u8) -> alloc::vec::Vec<u8> {
        let mut v = HEADER_AND_TYPE.to_vec();
        v.extend_from_slice(&[0x02, 0x07, 0x01, 0x01, module, 0x01, field, 0x00, 0x00]);
        v
    }

    #[test]
    fn rejects_bad_magic() {
        assert_eq!(parse_imports(&[0, 0, 0, 0, 0, 0, 0, 0]), Err(ParseError::BadMagic));
        assert_eq!(parse_imports(&[0x00, 0x61, 0x73]), Err(ParseError::BadMagic));
    }

    #[test]
    fn no_import_section_yields_empty() {
        // Header + type section only, no import section.
        let imports = parse_imports(HEADER_AND_TYPE).unwrap();
        assert!(imports.is_empty());
    }

    #[test]
    fn parses_one_func_import() {
        let wasm = with_one_import(b'l', b'_');
        let imports = parse_imports(&wasm).unwrap();
        assert_eq!(imports.len(), 1);
        assert_eq!(imports[0].kind, 0);
        assert_eq!(imports[0].module, b"l");
        assert_eq!(imports[0].field, b"_");
    }

    #[test]
    fn truncated_import_section_errors() {
        // import section claims size 7 but the payload is cut short.
        let mut wasm = HEADER_AND_TYPE.to_vec();
        wasm.extend_from_slice(&[0x02, 0x07, 0x01, 0x01, b'l']); // stops mid-import
        assert!(parse_imports(&wasm).is_err());
    }

    #[test]
    fn section_size_overrun_errors() {
        // import section declares a size larger than the remaining buffer.
        let mut wasm = HEADER_AND_TYPE.to_vec();
        wasm.extend_from_slice(&[0x02, 0x7f, 0x01]); // size=127 but ~nothing follows
        assert_eq!(parse_imports(&wasm), Err(ParseError::SectionOverrun));
    }

    #[test]
    fn parses_real_soroban_contract_15_imports() {
        // clean.wasm: a real soroban-sdk 25.3.1 contract (see fixtures provenance).
        let wasm = include_bytes!("../tests/fixtures/clean.wasm");
        let imports = parse_imports(wasm).unwrap();
        // collect (module, field) byte pairs
        let mut got: alloc::vec::Vec<(u8, u8)> = imports
            .iter()
            .map(|i| (i.module[0], i.field[0]))
            .collect();
        got.sort_unstable();
        let mut expected: alloc::vec::Vec<(u8, u8)> = alloc::vec![
            (b'a', b'0'), (b'l', b'_'), (b'l', b'1'), (b'x', b'3'), (b'x', b'4'),
            (b'i', b'0'), (b'm', b'_'), (b'm', b'0'), (b'v', b'_'), (b'v', b'6'),
            (b'b', b'4'), (b'b', b'3'), (b'b', b'e'), (b'c', b'_'), (b'l', b'0'),
        ];
        expected.sort_unstable();
        assert_eq!(got, expected);
        // every import in the real contract is a single-byte module + single-byte field
        assert!(imports.iter().all(|i| i.module.len() == 1 && i.field.len() == 1));
        assert!(imports.iter().all(|i| i.kind == 0));
    }
}
```

- [ ] **Step 4: Copy the real fixture (force past gitignore), pin its provenance, and run tests to confirm they FAIL**

The repo root `.gitignore` ignores `*.wasm`, so the fixture must be force-added and kept tracked via a local negation. Copy it, add the negation `.gitignore`, and write a provenance README:

```bash
mkdir -p proofreceipt-m0/methods/guest/wasm-policy/tests/fixtures
cp "/tmp/claude-1000/-home-aashim-hackathon-stellar-hacks/2e08d16a-676d-4658-9c53-b9a781de3ca5/scratchpad/m3-sample/target/wasm32v1-none/release/m3sample.wasm" \
   proofreceipt-m0/methods/guest/wasm-policy/tests/fixtures/clean.wasm
printf '!clean.wasm\n' > proofreceipt-m0/methods/guest/wasm-policy/tests/fixtures/.gitignore
sha256sum proofreceipt-m0/methods/guest/wasm-policy/tests/fixtures/clean.wasm
```
Expected sha256: `746334f720ffa2fb08bb68de6143a5276288b68838a6c06651aba93a23e33fb8` (a rebuild may differ slightly across toolchain patch versions; what MUST hold is the 15-import set the test asserts).

Create `proofreceipt-m0/methods/guest/wasm-policy/tests/fixtures/README.md` (provenance so the fixture is reproducible without the /tmp scratch path):

````markdown
# `clean.wasm` — M3 policy test fixture

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
````

Run the (still-failing) tests:

```bash
cd proofreceipt-m0/methods/guest/wasm-policy && cargo test
```
Expected: compile error / FAIL — `parse_imports`, `Import`, `ParseError` are not defined yet.

- [ ] **Step 5: Implement the parser**

Prepend this to `proofreceipt-m0/methods/guest/wasm-policy/src/parser.rs` (above the test module):

```rust
//! Hand-rolled, bounded WASM import-section reader. Reads ONLY what the policy
//! needs — each import's (kind, module, field) — skipping every other section by
//! its declared size. Every read is bounds-checked: malformed input returns an
//! `Err`, never a panic or out-of-bounds index.

use alloc::vec::Vec;

#[derive(Debug, PartialEq, Eq)]
pub enum ParseError {
    BadMagic,
    Truncated,
    BadLeb,
    SectionOverrun,
}

/// One WASM import. `kind`: 0=func, 1=table, 2=mem, 3=global, 4=tag.
/// `module`/`field` are raw bytes (compared as bytes; multi-byte/UTF-8 names are
/// simply "unknown" to the policy, never a panic).
#[derive(Debug, PartialEq, Eq)]
pub struct Import<'a> {
    pub kind: u8,
    pub module: &'a [u8],
    pub field: &'a [u8],
}

/// Unsigned LEB128 → u32, with overflow rejected.
fn read_u32_leb(buf: &[u8], pos: &mut usize) -> Result<u32, ParseError> {
    let mut result: u32 = 0;
    let mut shift: u32 = 0;
    loop {
        let byte = *buf.get(*pos).ok_or(ParseError::Truncated)?;
        *pos += 1;
        let part = (byte & 0x7f) as u32;
        // reject shifts that would drop bits (malformed / oversized LEB)
        if shift >= 32 || (part << shift) >> shift != part {
            return Err(ParseError::BadLeb);
        }
        result |= part << shift;
        if byte & 0x80 == 0 {
            return Ok(result);
        }
        shift += 7;
    }
}

/// Read a length-prefixed byte string (WASM `name`): (len:LEB128)(bytes).
fn read_name<'a>(buf: &'a [u8], pos: &mut usize) -> Result<&'a [u8], ParseError> {
    let len = read_u32_leb(buf, pos)? as usize;
    let start = *pos;
    let end = start.checked_add(len).ok_or(ParseError::Truncated)?;
    let s = buf.get(start..end).ok_or(ParseError::Truncated)?;
    *pos = end;
    Ok(s)
}

/// Skip a limits descriptor: flag(1) min(LEB) [max(LEB) if flag&1].
fn skip_limits(buf: &[u8], mut p: usize) -> Result<usize, ParseError> {
    let flags = *buf.get(p).ok_or(ParseError::Truncated)?;
    p += 1;
    let _min = read_u32_leb(buf, &mut p)?;
    if flags & 0x01 != 0 {
        let _max = read_u32_leb(buf, &mut p)?;
    }
    Ok(p)
}

/// Skip a table-type descriptor: reftype(1) then limits.
fn skip_table_type(buf: &[u8], mut p: usize) -> Result<usize, ParseError> {
    let _reftype = *buf.get(p).ok_or(ParseError::Truncated)?;
    p += 1;
    skip_limits(buf, p)
}

pub fn parse_imports(wasm: &[u8]) -> Result<Vec<Import<'_>>, ParseError> {
    // Magic "\0asm" + version 1.
    if wasm.len() < 8 || &wasm[0..4] != b"\0asm" || &wasm[4..8] != [1, 0, 0, 0] {
        return Err(ParseError::BadMagic);
    }
    let mut pos = 8usize;
    let mut imports = Vec::new();

    while pos < wasm.len() {
        let id = wasm[pos];
        pos += 1;
        let size = read_u32_leb(wasm, &mut pos)? as usize;
        let sec_start = pos;
        let sec_end = sec_start.checked_add(size).ok_or(ParseError::SectionOverrun)?;
        if sec_end > wasm.len() {
            return Err(ParseError::SectionOverrun);
        }

        if id == 2 {
            // Import section.
            let mut p = sec_start;
            let count = read_u32_leb(wasm, &mut p)?;
            for _ in 0..count {
                let module = read_name(wasm, &mut p)?;
                let field = read_name(wasm, &mut p)?;
                let kind = *wasm.get(p).ok_or(ParseError::Truncated)?;
                p += 1;
                // Skip the kind-specific descriptor so we can keep reading imports.
                match kind {
                    0 => {
                        let _typeidx = read_u32_leb(wasm, &mut p)?;
                    }
                    1 => p = skip_table_type(wasm, p)?,
                    2 => p = skip_limits(wasm, p)?,
                    3 => p = p.checked_add(2).ok_or(ParseError::Truncated)?, // valtype + mut
                    4 => {
                        // tag: attribute(1) + typeidx(LEB)
                        p = p.checked_add(1).ok_or(ParseError::Truncated)?;
                        let _typeidx = read_u32_leb(wasm, &mut p)?;
                    }
                    _ => return Err(ParseError::BadLeb),
                }
                if p > sec_end {
                    return Err(ParseError::SectionOverrun);
                }
                imports.push(Import { kind, module, field });
            }
        }
        pos = sec_end;
    }
    Ok(imports)
}
```

- [ ] **Step 6: Run tests to confirm they PASS**

```bash
cd proofreceipt-m0/methods/guest/wasm-policy && cargo test
```
Expected: all parser tests PASS (incl. `parses_real_soroban_contract_15_imports`).

- [ ] **Step 7: Commit**

```bash
git add proofreceipt-m0/methods/guest/wasm-policy/Cargo.toml \
        proofreceipt-m0/methods/guest/wasm-policy/src/lib.rs \
        proofreceipt-m0/methods/guest/wasm-policy/src/parser.rs \
        proofreceipt-m0/methods/guest/wasm-policy/tests/fixtures/.gitignore \
        proofreceipt-m0/methods/guest/wasm-policy/tests/fixtures/README.md
# clean.wasm is force-added past the root *.wasm gitignore (the fixtures/.gitignore
# negation keeps it tracked thereafter):
git add -f proofreceipt-m0/methods/guest/wasm-policy/tests/fixtures/clean.wasm
git status --porcelain proofreceipt-m0/methods/guest/wasm-policy/tests/fixtures/clean.wasm  # must show 'A '
git commit -m "feat(m3): wasm-policy crate + bounded WASM import-section parser"
```

---

### Task 2: Capability policy + verdict bitmask (`audit_verdict`)

Adds the baked-in policy (allowlist via module fn-counts + field-index decode, denylist, storage-write/auth sets) and the one-pass evaluator that returns the findings bitmask. Malformed WASM propagates as `Err`.

**Files:**
- Create: `proofreceipt-m0/methods/guest/wasm-policy/src/policy.rs`
- Modify: `proofreceipt-m0/methods/guest/wasm-policy/src/lib.rs` (add `pub mod policy;` + re-export)
- Test: policy unit tests live in `src/policy.rs` under `#[cfg(test)] mod tests`.

**Interfaces:**
- Consumes: `parse_imports`, `Import`, `ParseError` (Task 1).
- Produces (consumed by Task 3): `pub fn audit_verdict(wasm: &[u8]) -> Result<u32, ParseError>` — the 36-byte-journal verdict (bitmask defined in Global Constraints).

- [ ] **Step 1: Add the policy module to the crate root**

Edit `proofreceipt-m0/methods/guest/wasm-policy/src/lib.rs` — add after `pub mod parser;`:

```rust
pub mod policy;
```

and extend the re-export line to:

```rust
pub use parser::{parse_imports, Import, ParseError};
pub use policy::audit_verdict;
```

- [ ] **Step 2: Write the failing policy tests**

Create `proofreceipt-m0/methods/guest/wasm-policy/src/policy.rs` with ONLY the test module first:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    const HEADER_AND_TYPE: &[u8] = &[
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
        0x01, 0x04, 0x01, 0x60, 0x00, 0x00,
    ];

    fn with_one_import(module: u8, field: u8) -> alloc::vec::Vec<u8> {
        let mut v = HEADER_AND_TYPE.to_vec();
        v.extend_from_slice(&[0x02, 0x07, 0x01, 0x01, module, 0x01, field, 0x00, 0x00]);
        v
    }

    #[test]
    fn clean_real_contract_is_zero() {
        let wasm = include_bytes!("../tests/fixtures/clean.wasm");
        assert_eq!(audit_verdict(wasm).unwrap(), 0);
    }

    #[test]
    fn empty_imports_is_zero() {
        assert_eq!(audit_verdict(HEADER_AND_TYPE).unwrap(), 0);
    }

    #[test]
    fn unknown_import_sets_bit0() {
        // module 'z' is not a real host module → allowlist violation.
        assert_eq!(audit_verdict(&with_one_import(b'z', b'0')).unwrap(), 0b001);
    }

    #[test]
    fn out_of_range_field_sets_bit0() {
        // module 'd' (call) has only 2 fns (indices 0,1 = '_','0'); field '5' (idx 6)
        // is out of range → allowlist violation.
        assert_eq!(audit_verdict(&with_one_import(b'd', b'5')).unwrap(), 0b001);
    }

    #[test]
    fn denylisted_import_sets_bit1_only() {
        // (l,'6') = update_current_contract_wasm: known (no bit0), denylisted (bit1),
        // not a storage-write (no bit2).
        assert_eq!(audit_verdict(&with_one_import(b'l', b'6')).unwrap(), 0b010);
    }

    #[test]
    fn storage_write_without_auth_sets_bit2() {
        // (l,'_') = put_contract_data, no auth import → auth-presence failure.
        assert_eq!(audit_verdict(&with_one_import(b'l', b'_')).unwrap(), 0b100);
    }

    #[test]
    fn storage_write_with_auth_is_clean() {
        // put_contract_data + require_auth → no bit2.
        let mut wasm = HEADER_AND_TYPE.to_vec();
        // two imports: (l,'_') then (a,'0'); rebuild an import section with count=2.
        // import entry = modlen,mod,namelen,name,kind,typeidx = 6 bytes each.
        // section payload = count(1) + 6 + 6 = 13 bytes.
        wasm.extend_from_slice(&[
            0x02, 0x0d, 0x02,
            0x01, b'l', 0x01, b'_', 0x00, 0x00,
            0x01, b'a', 0x01, b'0', 0x00, 0x00,
        ]);
        assert_eq!(audit_verdict(&wasm).unwrap(), 0);
    }

    #[test]
    fn malformed_wasm_is_err_not_clean() {
        // bad magic must NOT decode to verdict 0.
        assert!(audit_verdict(&[0u8; 8]).is_err());
    }
}
```

- [ ] **Step 3: Run tests to confirm they FAIL**

```bash
cd proofreceipt-m0/methods/guest/wasm-policy && cargo test
```
Expected: FAIL — `audit_verdict` not defined.

- [ ] **Step 4: Implement the policy**

Prepend to `proofreceipt-m0/methods/guest/wasm-policy/src/policy.rs` (above the test module):

```rust
//! Baked-in Soroban capability policy. The constants below ARE the agreed policy:
//! changing any of them changes the guest's image_id. Pinned from a real
//! soroban-sdk 25.3.1 artifact cross-checked against soroban-env-common 25.0.1
//! (env.json). See the plan's Global Constraints for the full provenance.
//!
//! Limitations of CLEAN (verdict 0) — this is IMPORT-LEVEL analysis only:
//!  - bit 2 attests an auth host fn is IMPORTED alongside storage writes, NOT that
//!    writes are auth-gated (an unused `require_auth` import clears it).
//!  - allowlist != safelist: `is_known` accepts any real host fn, so CLEAN means
//!    "no test-only fns and no wasm self-upload/update" (the denylist) — NOT "no
//!    dangerous capability". Powerful-but-not-denylisted fns (e.g. create_contract,
//!    cross-contract call, authorize_as_curr_contract) audit CLEAN by design.
//!  - durability (persistent/temporary/instance) is invisible in imports.

use crate::parser::{parse_imports, ParseError};

/// Forbidden host fns (bit 1). Test-only + code self-modification.
const DENYLIST: &[(u8, u8)] = &[(b't', b'_'), (b't', b'0'), (b'l', b'5'), (b'l', b'6')];
/// Storage mutators (auth-presence gate input). put_contract_data, del_contract_data.
const STORAGE_WRITE: &[(u8, u8)] = &[(b'l', b'_'), (b'l', b'2')];
/// Access-control host fns. require_auth, require_auth_for_args.
const AUTH: &[(u8, u8)] = &[(b'a', b'0'), (b'a', b'_')];

/// Number of host fns in each known module (an import is a *known* host fn iff its
/// module is here and its field index < count). Any other module / out-of-range
/// field / non-func kind is an allowlist violation.
fn module_fn_count(m: u8) -> Option<usize> {
    Some(match m {
        b'x' => 10,
        b'i' => 44,
        b'm' => 12,
        b'v' => 19,
        b'l' => 16,
        b'd' => 2,
        b'b' => 26,
        b'c' => 28,
        b'a' => 8,
        b't' => 2,
        b'p' => 4,
        _ => return None,
    })
}

/// Soroban Symbol-alphabet position of a single field byte.
fn field_index(b: u8) -> Option<usize> {
    Some(match b {
        b'_' => 0,
        b'0'..=b'9' => 1 + (b - b'0') as usize,
        b'a'..=b'z' => 11 + (b - b'a') as usize,
        b'A'..=b'Z' => 37 + (b - b'A') as usize,
        _ => return None,
    })
}

/// A known host-fn import: single-byte module + single-byte field, module recognized,
/// field index in range.
fn is_known(module: &[u8], field: &[u8]) -> bool {
    if module.len() != 1 || field.len() != 1 {
        return false;
    }
    match (module_fn_count(module[0]), field_index(field[0])) {
        (Some(count), Some(idx)) => idx < count,
        _ => false,
    }
}

fn in_set(module: &[u8], field: &[u8], set: &[(u8, u8)]) -> bool {
    module.len() == 1
        && field.len() == 1
        && set.iter().any(|&(m, f)| m == module[0] && f == field[0])
}

/// Audit a Soroban contract's WASM and return the findings bitmask. `Err` if the
/// module can't be parsed (the guest turns that into a panic — never a clean verdict).
pub fn audit_verdict(wasm: &[u8]) -> Result<u32, ParseError> {
    let imports = parse_imports(wasm)?;
    let mut verdict: u32 = 0;
    let mut has_storage_write = false;
    let mut has_auth = false;

    for imp in &imports {
        // bit 0: any import that isn't a recognized host-fn (incl. non-func kinds).
        if imp.kind != 0 || !is_known(imp.module, imp.field) {
            verdict |= 0b001;
        }
        // bit 1: denylisted host fn.
        if in_set(imp.module, imp.field, DENYLIST) {
            verdict |= 0b010;
        }
        if in_set(imp.module, imp.field, STORAGE_WRITE) {
            has_storage_write = true;
        }
        if in_set(imp.module, imp.field, AUTH) {
            has_auth = true;
        }
    }

    // bit 2: writes storage but imports no auth host fn.
    if has_storage_write && !has_auth {
        verdict |= 0b100;
    }
    Ok(verdict)
}
```

- [ ] **Step 5: Run tests to confirm they PASS**

```bash
cd proofreceipt-m0/methods/guest/wasm-policy && cargo test
```
Expected: all parser + policy tests PASS.

- [ ] **Step 6: Commit**

```bash
git add proofreceipt-m0/methods/guest/wasm-policy/src/lib.rs \
        proofreceipt-m0/methods/guest/wasm-policy/src/policy.rs
git commit -m "feat(m3): baked Soroban capability policy + verdict bitmask"
```

---

### Task 3: Wire `audit_verdict` into the RISC Zero guest

Replaces the stub verdict in the guest with the real policy call and adds the path dependency. Verifies the guest still compiles under the RISC-V toolchain (which regenerates `image_id`).

**Files:**
- Modify: `proofreceipt-m0/methods/guest/Cargo.toml` (add `wasm-policy` path dep + `exclude` it from the guest workspace)
- Modify: `proofreceipt-m0/methods/guest/src/main.rs` (replace stub with `audit_verdict`)

**Interfaces:**
- Consumes: `wasm_policy::audit_verdict` (Task 2).
- Produces: a guest whose committed `journal[32..36]` is the real findings bitmask; a new `image_id` (captured in Task 6).

- [ ] **Step 1: Add the path dependency AND exclude the sub-crate from the guest workspace**

`wasm-policy` is its own standalone `[workspace]` (Task 1) but sits *inside* the guest's package dir, which is itself a `[workspace]` root. Without an `exclude`, `risc0-build` runs `cargo metadata` on the guest and aborts with *"multiple workspace roots found in the same workspace"* — the guest build fails before any proving. Fix both lines in `proofreceipt-m0/methods/guest/Cargo.toml`:

Change the existing workspace table:

```toml
[workspace]
```

to:

```toml
[workspace]
exclude = ["wasm-policy"]
```

and add under `[dependencies]`:

```toml
wasm-policy = { path = "wasm-policy" }
```

- [ ] **Step 2: Replace the guest body**

Replace the entire contents of `proofreceipt-m0/methods/guest/src/main.rs` with:

```rust
// M3 guest: read the buyer's Soroban contract WASM bytes, hash them (binding),
// run the REAL bounded capability-policy audit, and commit (input_hash, verdict)
// as RAW journal bytes. Journal layout is byte-identical to M1/M2.
use risc0_zkvm::guest::env;
use sha2::{Digest, Sha256};
use wasm_policy::audit_verdict;

fn main() {
    // The buyer's submitted artifact: compiled Soroban contract WASM.
    let input: alloc::vec::Vec<u8> = env::read();

    let input_hash: [u8; 32] = Sha256::digest(&input).into();

    // Real audit. A malformed module must NEVER produce a clean verdict, so we
    // panic on parse error: the proof simply isn't produced (the buyer gets an
    // error job) rather than a forgeable "verdict = 0".
    let verdict: u32 = audit_verdict(&input).expect("malformed wasm: cannot audit");

    // Journal = input_hash(32) || verdict(4 LE) = 36 bytes, written raw.
    let mut buf = [0u8; 36];
    buf[..32].copy_from_slice(&input_hash);
    buf[32..].copy_from_slice(&verdict.to_le_bytes());
    env::commit_slice(&buf);
}

extern crate alloc;
```

- [ ] **Step 3: Build the guest (regenerates image_id) and the host**

```bash
export PATH="$HOME/.risc0/bin:$HOME/.cargo/bin:$PATH"
cd proofreceipt-m0 && cargo build -p m0-host
```
Expected: clean build. This compiles `wasm-policy` and the guest to RISC-V via `risc0-build` (no Docker needed) and links the host. A successful build means the new `image_id` is baked into `M0_GUEST_ID`.

- [ ] **Step 4: Confirm the host's existing unit tests still compile/pass**

```bash
cd proofreceipt-m0 && cargo test -p m0-host
```
Expected: the existing host tests (`parse_args_*`, `proof_json_is_binary_safe`) PASS (unchanged by this task).

- [ ] **Step 5: Commit**

```bash
git add proofreceipt-m0/methods/guest/Cargo.toml proofreceipt-m0/methods/guest/src/main.rs
git commit -m "feat(m3): wire real capability audit into the guest (replaces stub)"
```

---

### Task 4: Host reads verdict from the journal (drop stub recompute)

The host currently recomputes the stub verdict (`host/src/main.rs:93`). The verdict now lives only in the guest's committed journal — the host must read it from there so its `proof.json` `verdict` field matches what the buyer derives.

**Files:**
- Modify: `proofreceipt-m0/host/src/main.rs`

**Interfaces:**
- Produces: `pub fn verdict_from_journal(journal: &[u8]) -> u32` — reads `journal[32..36]` as LE u32 (0 if the journal is shorter than 36 bytes, which never happens for a valid M3 receipt).

- [ ] **Step 1: Write the failing test**

In `proofreceipt-m0/host/src/main.rs`, add to the `#[cfg(test)] mod tests` block (and add `verdict_from_journal` to the `use super::{...}` import line):

```rust
    #[test]
    fn verdict_from_journal_reads_le_u32() {
        let mut journal = [0u8; 36];
        journal[32..].copy_from_slice(&6u32.to_le_bytes()); // bits 1|2
        assert_eq!(verdict_from_journal(&journal), 6);
    }

    #[test]
    fn verdict_from_journal_short_is_zero() {
        assert_eq!(verdict_from_journal(&[0u8; 10]), 0);
    }
```

- [ ] **Step 2: Run the test to confirm it FAILS**

```bash
cd proofreceipt-m0 && cargo test -p m0-host verdict_from_journal
```
Expected: FAIL — `verdict_from_journal` not defined.

- [ ] **Step 3: Implement the helper and use it**

In `proofreceipt-m0/host/src/main.rs`, add this function (next to `proof_json`):

```rust
/// The verdict is committed by the guest in the last 4 bytes of the 36-byte journal
/// (LE u32). The host reads it from there — it does NOT recompute the audit.
pub fn verdict_from_journal(journal: &[u8]) -> u32 {
    if journal.len() < 36 {
        return 0;
    }
    u32::from_le_bytes(journal[32..36].try_into().expect("36-byte journal"))
}
```

Then replace the stub line in `main()`:

```rust
    let verdict: u32 = if input.is_empty() { 0 } else { 1 };
```

with:

```rust
    let verdict: u32 = verdict_from_journal(&journal);
```

- [ ] **Step 4: Run the tests to confirm they PASS**

```bash
cd proofreceipt-m0 && cargo test -p m0-host
```
Expected: all host tests PASS (incl. the two new ones).

- [ ] **Step 5: Commit**

```bash
git add proofreceipt-m0/host/src/main.rs
git commit -m "feat(m3): host reads verdict from the committed journal, not a recompute"
```

---

### Task 5: Buyer — decode the verdict bitmask + submit a `.wasm` file

Adds a pure bitmask→findings decoder (unit-tested) and lets the buyer submit a real `.wasm` file (so the M3 story audits an actual contract, not a string), while keeping all M2 binding checks intact.

**Files:**
- Create: `proofreceipt-buyer/src/verdict.ts`
- Create: `proofreceipt-buyer/src/verdict.test.ts`
- Modify: `proofreceipt-buyer/src/buyer.ts`
- Modify: `proofreceipt-buyer/package.json` (add a test script)

**Interfaces:**
- Produces: `export function decodeVerdict(verdict: number): string[]` — human-readable finding names for set bits (empty array = clean).

- [ ] **Step 1: Write the failing decoder test**

`proofreceipt-buyer/src/verdict.test.ts`:

```ts
import assert from "node:assert/strict";
import { decodeVerdict } from "./verdict.js";

assert.deepEqual(decodeVerdict(0), []);
assert.deepEqual(decodeVerdict(1), ["allowlist-violation: imports an unknown/non-host-fn"]);
assert.deepEqual(decodeVerdict(2), ["denylist-hit: imports a forbidden host fn"]);
assert.deepEqual(decodeVerdict(4), ["auth-presence: writes storage without importing an auth host fn"]);
assert.deepEqual(decodeVerdict(6), [
  "denylist-hit: imports a forbidden host fn",
  "auth-presence: writes storage without importing an auth host fn",
]);
assert.deepEqual(decodeVerdict(7), [
  "allowlist-violation: imports an unknown/non-host-fn",
  "denylist-hit: imports a forbidden host fn",
  "auth-presence: writes storage without importing an auth host fn",
]);

console.log("decodeVerdict: all assertions passed");
```

- [ ] **Step 2: Add the test script and run it to confirm it FAILS**

Add to `proofreceipt-buyer/package.json` `"scripts"`:

```json
    "test:verdict": "tsx src/verdict.test.ts",
```

```bash
cd proofreceipt-buyer && npm run test:verdict
```
Expected: FAIL — `./verdict.js` / `decodeVerdict` does not exist.

- [ ] **Step 3: Implement the decoder**

`proofreceipt-buyer/src/verdict.ts`:

```ts
// Decode the M3 findings bitmask committed in journal[32..36]. Bits (LSB first):
//   0 = allowlist violation, 1 = denylist hit, 2 = auth-presence failure.
// Bits 3..31 are reserved (always 0 in M3).
//
// Scope of verdict 0 (import-level analysis only): it means no out-of-interface
// imports and no denylisted host fns (test-only / wasm self-upload-update). It does
// NOT mean "no dangerous capability" (e.g. create_contract / cross-contract call are
// not flagged) nor that storage writes are actually auth-gated (bit 2 is presence of
// an auth import, not enforcement).
export function decodeVerdict(verdict: number): string[] {
  const findings: string[] = [];
  if (verdict & 0b001) findings.push("allowlist-violation: imports an unknown/non-host-fn");
  if (verdict & 0b010) findings.push("denylist-hit: imports a forbidden host fn");
  if (verdict & 0b100) findings.push("auth-presence: writes storage without importing an auth host fn");
  return findings;
}
```

- [ ] **Step 4: Run the test to confirm it PASSES**

```bash
cd proofreceipt-buyer && npm run test:verdict
```
Expected: `decodeVerdict: all assertions passed`.

- [ ] **Step 5: Use the decoder + accept a `.wasm` file in `buyer.ts`**

In `proofreceipt-buyer/src/buyer.ts`:

(a) add imports at the top (after the existing imports):

```ts
import { readFileSync, existsSync } from "node:fs";
import { decodeVerdict } from "./verdict.js";
```

(b) replace the artifact line:

```ts
  const artifact = Buffer.from(process.argv[2] ?? "hello", "utf8"); // the bytes to audit
```

with:

```ts
  // Submit a real artifact: if argv[2] is a path to an existing file (e.g. a
  // compiled contract.wasm), audit its raw bytes; otherwise treat it as a UTF-8 string.
  const arg = process.argv[2] ?? "hello";
  const artifact = existsSync(arg) ? readFileSync(arg) : Buffer.from(arg, "utf8");
```

(c) replace the final success log:

```ts
  console.log(`[buyer] ✅ receipt verified: ran agreed program ${AGREED_IMAGE_ID.slice(0,8)}… on my exact ${artifact.length}-byte input; verdict=${verdict}`);
```

with:

```ts
  const findings = decodeVerdict(verdict);
  console.log(`[buyer] ✅ receipt verified: ran agreed program ${AGREED_IMAGE_ID.slice(0,8)}… on my exact ${artifact.length}-byte contract.`);
  if (findings.length === 0) {
    // NOTE: "no violations" is import-level only — see verdict.ts / the policy doc.
    // It does NOT assert the contract has no dangerous capability or that writes are auth-gated.
    console.log(`[buyer] audit verdict: 0 — no policy violations detected (import-level checks only)`);
  } else {
    console.log(`[buyer] audit verdict: ${verdict} — ${findings.length} finding(s):`);
    for (const f of findings) console.log(`  • ${f}`);
  }
```

- [ ] **Step 6: Typecheck + re-run the decoder test**

```bash
cd proofreceipt-buyer && npm run typecheck && npm run test:verdict
```
Expected: typecheck clean; `decodeVerdict: all assertions passed`.

- [ ] **Step 7: Commit**

```bash
git add proofreceipt-buyer/src/verdict.ts proofreceipt-buyer/src/verdict.test.ts \
        proofreceipt-buyer/src/buyer.ts proofreceipt-buyer/package.json
git commit -m "feat(m3): buyer decodes verdict bitmask + can submit a .wasm artifact"
```

---

### Task 6 (environment-gated): image_id refresh + dev-mode wiring check + live Groth16 e2e

Validates the full guest wiring cheaply under RISC0 dev mode (real journal, fake seal, no Docker), then captures the new `image_id`, updates the server config + buyer env, and runs the real Groth16 prove → on-chain verify path. **This task needs the prover environment** (RISC-V toolchain for build/dev-mode; Docker + x86_64 for real Groth16), mirroring M2's gated tasks. Do the dev-mode steps first — they're fast and catch wiring bugs before the slow real prove.

**Files:**
- Create: `proofreceipt-m0/host/tests/policy_journal.rs` (dev-mode integration test over the 4 fixtures)
- Reference (no edit needed beyond values): server config + buyer `AGREED_IMAGE_ID` env (see M2 RUNBOOK)

- [ ] **Step 1: Dev-mode integration test — assert journal verdict for all 4 fixtures**

`proofreceipt-m0/host/tests/policy_journal.rs`:

```rust
// Runs the REAL guest under RISC0 dev mode (fake seal, but the journal is genuinely
// produced by executing the guest) and asserts the committed verdict for each of the
// 4 policy fixtures. No Docker; needs the RISC-V toolchain to build the guest ELF.
use m0_methods::{M0_GUEST_ELF, M0_GUEST_ID};

fn run_verdict(wasm: &[u8]) -> u32 {
    let env = risc0_zkvm::ExecutorEnv::builder()
        .write(&wasm.to_vec())
        .unwrap()
        .build()
        .unwrap();
    let receipt = risc0_zkvm::default_prover()
        .prove(env, M0_GUEST_ELF)
        .unwrap()
        .receipt;
    receipt.verify(M0_GUEST_ID).unwrap();
    let j = &receipt.journal.bytes;
    assert_eq!(j.len(), 36, "journal must be 36 bytes");
    u32::from_le_bytes(j[32..36].try_into().unwrap())
}

const HEADER_AND_TYPE: &[u8] = &[
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    0x01, 0x04, 0x01, 0x60, 0x00, 0x00,
];

fn with_one_import(module: u8, field: u8) -> Vec<u8> {
    let mut v = HEADER_AND_TYPE.to_vec();
    v.extend_from_slice(&[0x02, 0x07, 0x01, 0x01, module, 0x01, field, 0x00, 0x00]);
    v
}

#[test]
fn policy_fixtures_produce_expected_verdicts() {
    // Must run in dev mode (set by the command in the plan).
    // include_bytes! resolves relative to THIS file (host/tests/); the fixture is in
    // the sibling methods/ tree, so two `..` are needed (host/tests -> host -> m0).
    assert_eq!(run_verdict(include_bytes!("../../methods/guest/wasm-policy/tests/fixtures/clean.wasm")), 0);
    assert_eq!(run_verdict(&with_one_import(b'z', b'0')), 0b001); // unknown
    assert_eq!(run_verdict(&with_one_import(b'l', b'6')), 0b010); // denylisted
    assert_eq!(run_verdict(&with_one_import(b'l', b'_')), 0b100); // write, no auth
}
```

Run it in dev mode:

```bash
export PATH="$HOME/.risc0/bin:$HOME/.cargo/bin:$PATH"
cd proofreceipt-m0 && RISC0_DEV_MODE=1 cargo test -p m0-host --test policy_journal -- --nocapture
```
Expected: `policy_fixtures_produce_expected_verdicts` PASS (verdicts 0, 1, 2, 4). Commit this test:

```bash
git add proofreceipt-m0/host/tests/policy_journal.rs
git commit -m "test(m3): dev-mode journal verdicts for the 4 policy fixtures"
```

- [ ] **Step 2: Capture the new image_id from a real Groth16 prove on the clean fixture**

```bash
export PATH="$HOME/.risc0/bin:$HOME/.cargo/bin:$PATH"
# Docker must be running (x86_64). Real prove on the clean contract → verdict 0.
# /usr/bin/time -v records wall-clock + peak RAM to compare against M2 (confirm the
# tiny import parser kept proving cost ~M2 — the spec's "confirm proving cost" item).
cd proofreceipt-m0 && /usr/bin/time -v cargo run --release -p m0-host -- \
  --input methods/guest/wasm-policy/tests/fixtures/clean.wasm --out proof.json
```
Expected: `proof.json` written with `"verdict": 0`. Record the `"image_id"` hex — this is the new agreed `image_id`. (Cross-check it is NOT the M2 value `3601e6ac…`.) Note the "Elapsed (wall clock)" and "Maximum resident set size" from `time -v` and confirm they're within ~M2's envelope (guest only gained a tiny dep-free parser).

- [ ] **Step 3: Update the server config + buyer env to the new image_id**

Set the new `image_id` (captured in Step 2) in two places — no verifier redeploy (`VERIFIER_ID` stays `CCR6QRJJ…`):
- **Server:** edit the `image_id` field in `proofreceipt-server/proofreceipt-server.toml` (currently `3601e6ac4552eff672f171c704bb20085fd9c0691cfefcdb177beea0ed2edf54`) → the new hex. (Loaded into `cfg.image_id`, advertised in the 402's `extra.image_id` — see `proofreceipt-server/src/x402.rs:85`.)
- **Buyer:** `export AGREED_IMAGE_ID=<new hex>` (read at `proofreceipt-buyer/src/buyer.ts:9`; no buyer `.env` example exists in the repo).

Restart the server and confirm it advertises the new `image_id` (the 402 `PAYMENT-REQUIRED` body's `extra.image_id`, or the startup log) before the live run.

- [ ] **Step 4: Live e2e on a real contract**

Run the full M2 paid flow (server in one terminal, buyer in another per the M2 RUNBOOK), but the buyer submits a `.wasm` path:

```bash
cd proofreceipt-buyer && npm run buyer -- ../proofreceipt-m0/methods/guest/wasm-policy/tests/fixtures/clean.wasm
```
Expected: buyer prints `audit verdict: CLEAN (0)` after all three binding checks pass and the on-chain `verify()` returns (existing verifier, new `image_id`). Optionally re-run against a denylisted/unknown fixture to see a non-zero verdict decode.

- [ ] **Step 5: Note completion**

Record in the SDD progress ledger that the live run was performed (or, if blocked on the Circle USDC faucet as in M2, mark Step 4 human-gated — Steps 1–3 are the merge-relevant deliverables).

---

## Self-Review

**Spec coverage:**
- Buyer submits compiled WASM → Task 5 (file submit) + guest input is the WASM bytes (Task 3). ✓
- `input_hash = sha256(wasm)` binding → unchanged, asserted in guest (Task 3). ✓
- Parse only the import section → Task 1 (`parse_imports` reads only id==2, skips rest). ✓
- Three checks (allowlist / denylist / auth-presence) against a baked policy → Task 2. ✓
- Verdict bitmask in the unchanged 36-byte journal → Tasks 2–3; bits 3–31 reserved 0 (no code sets them). ✓
- `image_id` = baked policy; new image_id flows to config, no redeploy → Task 6 Steps 2–3 + Global Constraints. ✓
- Policy contents = 4 host-fn sets, names pinned from real artifact → Global Constraints + Task 2 (denylist = user-confirmed set). ✓
- Parser: hand-rolled bounded no_std vs crate → resolved to hand-rolled, zero deps (Task 1). ✓
- Buyer-side verdict decoder → Task 5. ✓
- Testing: parser unit-tested vs real compiled WASM (Task 1); 4 fixture verdicts (Task 2 pure + Task 6 dev-mode through the real guest); e2e binding reuse (Task 6). ✓
- Host verdict source corrected (was a stub recompute) → Task 4 (gap the spec implied via "server path works untouched"; making the host read the journal keeps proof.json honest). ✓
- Confirm proving cost stays ~M2 → Task 6 real prove on clean.wasm (guest gained only a tiny dep-free parser). ✓

**Placeholder scan:** every code/byte/command step is concrete; fixture bytes computed; no "TBD"/"add error handling"/"similar to". ✓

**Type consistency:** `parse_imports`/`Import`/`ParseError` (Task 1) consumed by `audit_verdict` (Task 2) consumed by the guest (Task 3); `verdict_from_journal` (Task 4); `decodeVerdict` (Task 5) imported identically in `buyer.ts` and `verdict.test.ts`; journal slice `[32..36]` LE u32 consistent across guest/host/buyer. ✓

---

## Verification pass (2026-06-27) — corrections applied

This plan was adversarially verified by a multi-agent workflow that re-derived claims from authoritative sources and executed code (recompiled the sample contract + re-dumped imports vs `env.json`; validated every fixture byte with V8's WASM validator + the spec; built the `wasm-policy` crate and ran all 14 tests; built the real guest+host in an isolated worktree; checked risc0 3.0 APIs against the installed crate). Verdict: **go_with_edits**. All findings below are folded into the tasks above.

**Blockers fixed (each verified):**
1. `module_fn_count(b'x')` was `9`; `env.json` defines **10** context fns (idx 9 = `get_max_live_until_ledger`, field `'8'`). Corrected to `10` here and in Global Constraints — `9` would false-flag (bit 0) any contract importing `x/8`.
2. `wasm-policy`'s own `[workspace]` nested inside the guest's `[workspace]` made `risc0-build`'s `cargo metadata` abort ("multiple workspace roots"). Task 3 Step 1 now adds `exclude = ["wasm-policy"]` to the guest workspace (verified: `cargo build -p m0-host` exits 0, image_id regenerates).
3. `Import<'a>` lacked `#[derive(Debug, PartialEq, Eq)]`; the `assert_eq!(parse_imports(...), Err(...))` tests wouldn't compile. Derive added (after it, all 14 tests pass).
4. Task 6's `include_bytes!` path was one `..` short (`../` → `../../`) for `host/tests/`.
5. `clean.wasm` is gitignored by root `*.wasm`; plain `git add` silently fails. Task 1 now force-adds it + commits a `fixtures/.gitignore` negation and a provenance `README.md`.

**Important edits applied:** documented the two by-design false-clean limitations (bit 2 = auth *presence* not enforcement; allowlist ≠ safelist) in Global Constraints, `policy.rs`, and `verdict.ts`; softened the buyer's CLEAN message; hardened fixture provenance (committed + reproducible). Denylist scope kept at the user-confirmed set.

**Proven correct by execution (do not second-guess):** all 14 parser+policy tests pass; the real 909-byte fixture decodes to exactly the 15 pinned imports → verdict 0; every fixture byte/size is valid WASM; the no_std+alloc dep compiles to riscv32im and image_id regenerates; journal layout is byte-identical to M1/M2 (server/verifier/settle untouched); reserved bits 3–31 can never be set; malformed input returns `Err` (never `Ok(0)`); risc0 stays pinned to 3.0.5. The earlier "rebase Task 4 onto the M1 host" idea came from a stale worktree and is **wrong** — `host/src/main.rs:93` on this branch is exactly the M2 stub line Task 4 targets.
