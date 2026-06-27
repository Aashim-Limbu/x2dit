//! Pure, dependency-free Soroban-WASM capability-policy audit for the ProofReceipt
//! M3 guest. `no_std` + `alloc` in production; `std` under `cargo test` so the test
//! harness links. Zero external deps: the parser is hand-rolled and fully
//! bounds-checked so the proof means exactly what we say it means.
#![cfg_attr(not(test), no_std)]

extern crate alloc;

pub mod parser;

pub use parser::{parse_imports, Import, ParseError};
