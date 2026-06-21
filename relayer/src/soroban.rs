//! Soroban invocation layer — shells out to the `stellar` CLI to anchor roots
//! and submit withdrawals, returning the on-chain transaction hash.
use anyhow::{anyhow, Result};
use tokio::process::Command;

/// Extract a 64-hex Stellar tx hash from CLI stdout/stderr (the CLI prints it on submit).
pub fn extract_tx_hash(output: &str) -> Option<String> {
    for tok in output.split(|c: char| !c.is_ascii_hexdigit()) {
        if tok.len() == 64 && tok.chars().all(|c| c.is_ascii_hexdigit()) {
            return Some(tok.to_lowercase());
        }
    }
    None
}

/// Strip a leading `0x` so a hex string parses as the CLI's `BytesN<32>` arg
/// (the `stellar` CLI wants bare 64-hex, not `0x`-prefixed).
pub fn strip0x(s: &str) -> String {
    s.strip_prefix("0x").unwrap_or(s).to_string()
}

/// Resolve a network name to its passphrase. We pass `--rpc-url` + an explicit
/// `--network-passphrase` (rather than `--network <alias>`) so submission does
/// not depend on a correctly-configured local CLI network alias. An unrecognized
/// value is treated as a literal passphrase, so a caller can pass one directly.
pub fn passphrase_for(network: &str) -> &str {
    match network {
        "testnet" => "Test SDF Network ; September 2015",
        "mainnet" | "pubnet" | "public" => "Public Global Stellar Network ; September 2015",
        "futurenet" => "Test SDF Future Network ; October 2022",
        other => other,
    }
}

async fn invoke(args: &[String]) -> Result<String> {
    let out = Command::new("stellar").args(args).output().await?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    if !out.status.success() {
        return Err(anyhow!("stellar invoke failed: {stderr}"));
    }
    Ok(format!("{stdout}\n{stderr}"))
}

/// `update_root(denom, root)` — backing relayer anchors an EVM root. Returns tx hash.
pub async fn update_root(
    pool_id: &str, network: &str, rpc: &str, identity: &str, denom: u32, root_hex: &str,
) -> Result<String> {
    let args: Vec<String> = vec![
        "contract".into(), "invoke".into(),
        "--id".into(), pool_id.into(),
        "--source-account".into(), identity.into(),
        "--rpc-url".into(), rpc.into(),
        "--network-passphrase".into(), passphrase_for(network).into(),
        "--send".into(), "yes".into(),
        "--".into(), "update_root".into(),
        "--denom".into(), denom.to_string(),
        "--root".into(), strip0x(root_hex),
    ];
    let out = invoke(&args).await?;
    extract_tx_hash(&out).ok_or_else(|| anyhow!("no tx hash in output: {out}"))
}

/// `withdraw(proof, root, nullifier_hash, recipient_fr, recipient, denom)` via the CLI.
/// Args are passed as the SCVal-JSON the CLI expects; returns the tx hash.
#[allow(clippy::too_many_arguments)]
pub async fn withdraw(
    pool_id: &str, network: &str, rpc: &str, identity: &str,
    proof_json: &str, root_hex: &str, nullifier_hash_hex: &str,
    recipient_fr_hex: &str, recipient: &str, denom: u32,
) -> Result<String> {
    let args: Vec<String> = vec![
        "contract".into(), "invoke".into(),
        "--id".into(), pool_id.into(),
        "--source-account".into(), identity.into(),
        "--rpc-url".into(), rpc.into(),
        "--network-passphrase".into(), passphrase_for(network).into(),
        "--send".into(), "yes".into(),
        "--".into(), "withdraw".into(),
        "--proof".into(), proof_json.into(),
        "--root".into(), strip0x(root_hex),
        "--nullifier_hash".into(), strip0x(nullifier_hash_hex),
        "--recipient_fr".into(), strip0x(recipient_fr_hex),
        "--recipient".into(), recipient.into(),
        "--denom".into(), denom.to_string(),
    ];
    let out = invoke(&args).await?;
    extract_tx_hash(&out).ok_or_else(|| anyhow!("no tx hash in output: {out}"))
}
