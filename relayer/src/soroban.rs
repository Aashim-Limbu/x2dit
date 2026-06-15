//! Soroban invocation layer — shells out to the `stellar` CLI to anchor roots
//! and submit withdrawals, returning the on-chain transaction hash.
use anyhow::{anyhow, Result};
use std::process::Command;

/// Extract a 64-hex Stellar tx hash from CLI stdout/stderr (the CLI prints it on submit).
pub fn extract_tx_hash(output: &str) -> Option<String> {
    for tok in output.split(|c: char| !c.is_ascii_hexdigit()) {
        if tok.len() == 64 && tok.chars().all(|c| c.is_ascii_hexdigit()) {
            return Some(tok.to_lowercase());
        }
    }
    None
}

fn invoke(args: &[String]) -> Result<String> {
    let out = Command::new("stellar").args(args).output()?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    if !out.status.success() {
        return Err(anyhow!("stellar invoke failed: {stderr}"));
    }
    Ok(format!("{stdout}\n{stderr}"))
}

/// `update_root(denom, root)` — backing relayer anchors an EVM root. Returns tx hash.
pub fn update_root(
    pool_id: &str, network: &str, rpc: &str, identity: &str, denom: u32, root_hex: &str,
) -> Result<String> {
    let args: Vec<String> = vec![
        "contract".into(), "invoke".into(),
        "--id".into(), pool_id.into(),
        "--source-account".into(), identity.into(),
        "--network".into(), network.into(),
        "--rpc-url".into(), rpc.into(),
        "--send".into(), "yes".into(),
        "--".into(), "update_root".into(),
        "--denom".into(), denom.to_string(),
        "--root".into(), root_hex.into(),
    ];
    let out = invoke(&args)?;
    extract_tx_hash(&out).ok_or_else(|| anyhow!("no tx hash in output: {out}"))
}

/// `withdraw(proof, root, nullifier_hash, recipient_fr, recipient, denom)` via the CLI.
/// Args are passed as the SCVal-JSON the CLI expects; returns the tx hash.
#[allow(clippy::too_many_arguments)]
pub fn withdraw(
    pool_id: &str, network: &str, rpc: &str, identity: &str,
    proof_json: &str, root_hex: &str, nullifier_hash_hex: &str,
    recipient_fr_hex: &str, recipient: &str, denom: u32,
) -> Result<String> {
    let args: Vec<String> = vec![
        "contract".into(), "invoke".into(),
        "--id".into(), pool_id.into(),
        "--source-account".into(), identity.into(),
        "--network".into(), network.into(),
        "--rpc-url".into(), rpc.into(),
        "--send".into(), "yes".into(),
        "--".into(), "withdraw".into(),
        "--proof".into(), proof_json.into(),
        "--root".into(), root_hex.into(),
        "--nullifier_hash".into(), nullifier_hash_hex.into(),
        "--recipient_fr".into(), recipient_fr_hex.into(),
        "--recipient".into(), recipient.into(),
        "--denom".into(), denom.to_string(),
    ];
    let out = invoke(&args)?;
    extract_tx_hash(&out).ok_or_else(|| anyhow!("no tx hash in output: {out}"))
}
