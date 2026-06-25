// M1 host — runs the M1 guest (input_hash, verdict journal), produces a Groth16
// receipt, and emits proof.json with the binding fields for the on-chain verifier.
//
// Usage:
//   cargo run --release -p m0-host -- [input_string]
// input_string defaults to "hello". Requires the RISC Zero Groth16 prover
// (Docker + x86_64); the first run pulls a Docker image and can take several minutes.

use m0_methods::{M0_GUEST_ELF, M0_GUEST_ID};
use sha2::{Digest as _, Sha256};

fn main() -> anyhow::Result<()> {
    use anyhow::Context;
    // Input artifact: argv[1] as UTF-8 bytes, default "hello".
    let input_str = std::env::args().nth(1).unwrap_or_else(|| "hello".to_string());
    let input = input_str.clone().into_bytes();

    eprintln!("[m1] input = {:?} ({} bytes)", input_str, input.len());
    eprintln!("[m1] proving with Groth16 (needs Docker; first run is slow)...");

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

    let out = format!(
        "{{\n  \"input\": \"{input_str}\",\n  \"seal\": \"{}\",\n  \"image_id\": \"{}\",\n  \"input_hash\": \"{}\",\n  \"verdict\": {verdict},\n  \"journal\": \"{}\",\n  \"journal_digest\": \"{}\"\n}}\n",
        hex::encode(&seal), hex::encode(image_id.as_bytes()),
        hex::encode(input_hash), hex::encode(&journal), hex::encode(journal_digest),
    );
    std::fs::write("proof.json", &out).context("writing proof.json")?;
    println!("{out}");
    Ok(())
}
