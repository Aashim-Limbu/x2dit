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
