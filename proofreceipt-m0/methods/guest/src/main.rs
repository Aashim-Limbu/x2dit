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
