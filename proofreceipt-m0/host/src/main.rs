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
