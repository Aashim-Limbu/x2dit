use crate::config::Config;
use crate::job;

#[derive(Debug, PartialEq, Eq)]
pub enum Decision { Prove, Decline }

/// Prove only when the contract's real (cheap-scanned) verdict equals what the buyer pinned.
pub fn decide(scanned: u32, expected: u32) -> Decision {
    if scanned == expected { Decision::Prove } else { Decision::Decline }
}

fn invoke_base(cfg: &Config) -> Vec<String> {
    vec![
        "contract".into(), "invoke".into(),
        "--id".into(), cfg.settle_contract_id.clone(),
        "--source".into(), cfg.seller_key.clone(),
        "--network".into(), cfg.stellar_network.clone(),
        "--".into(),
    ]
}

pub fn submit_proof_args(cfg: &Config, job_id_hex: &str, seal_hex: &str) -> Vec<String> {
    let mut a = invoke_base(cfg);
    a.extend(["submit_proof".into(),
        "--job_id".into(), job_id_hex.to_string(),
        "--seal".into(), seal_hex.to_string()]);
    a
}

pub fn claim_args(cfg: &Config, job_id_hex: &str) -> Vec<String> {
    let mut a = invoke_base(cfg);
    a.extend(["claim".into(), "--job_id".into(), job_id_hex.to_string()]);
    a
}

/// One escrow job end to end. `wasm` is the buyer-supplied artifact; `expected_verdict`
/// is what the buyer pinned on-chain in open_job.
pub async fn handle_job(cfg: &Config, job_id_hex: String, wasm: Vec<u8>, expected_verdict: u32) -> anyhow::Result<()> {
    let scanned = wasm_policy::audit_verdict(&wasm)
        .map_err(|e| anyhow::anyhow!("scan failed: {e:?}"))?;
    if decide(scanned, expected_verdict) == Decision::Decline {
        // Don't pay the expensive prove cost for a job that can never be claimed.
        eprintln!("[escrow] job {job_id_hex}: scanned verdict {scanned} != pinned {expected_verdict} — declining");
        return Ok(());
    }
    let receipt = job::run_prover(&cfg.m0_host_path, wasm, cfg.prover_timeout_secs).await?;
    run_stellar(submit_proof_args(cfg, &job_id_hex, &receipt.seal)).await?;
    eprintln!("[escrow] job {job_id_hex}: submitted proof; claim after challenge window");
    // Claim is a separate step after the on-chain challenge window; the operator (or a
    // delayed task) runs `claim`. For the demo, claim_args() is invoked by the e2e step.
    Ok(())
}

async fn run_stellar(args: Vec<String>) -> anyhow::Result<()> {
    let out = tokio::process::Command::new("stellar").args(&args).output().await?;
    if !out.status.success() {
        anyhow::bail!("stellar {:?} failed: {}", args, String::from_utf8_lossy(&out.stderr));
    }
    Ok(())
}

// ── HTTP handler ───────────────────────────────────────────────────────────────

use crate::AppState;
use axum::{extract::State, http::StatusCode, response::{IntoResponse, Response}, Json};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
use std::sync::Arc;

#[derive(Deserialize)]
pub struct EscrowJobReq {
    pub job_id_hex: String,
    /// base64 of the raw WASM artifact bytes.
    pub artifact_b64: String,
    pub expected_verdict: u32,
}

pub async fn post_escrow_job(
    State(st): State<AppState>,
    Json(req): Json<EscrowJobReq>,
) -> Response {
    // Decode the artifact up front (bad base64 → 400, no work done).
    let wasm = match STANDARD.decode(req.artifact_b64.trim()) {
        Ok(b) => b,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error":"artifact_b64 not valid base64"}))).into_response(),
    };

    // Spawn the (slow) escrow worker; respond 202 immediately.
    let cfg: Arc<Config> = st.cfg.clone();
    let sem = st.prover_sem.clone();
    let job_id_hex = req.job_id_hex.clone();
    let expected_verdict = req.expected_verdict;
    tokio::spawn(async move {
        // Serialize proves (each peaks ~8GB) so concurrent requests can't OOM the box.
        let _permit = match sem.acquire_owned().await {
            Ok(p) => p,
            Err(_) => {
                eprintln!("[escrow] job {job_id_hex}: prover semaphore closed — dropping");
                return;
            }
        };
        if let Err(e) = handle_job(&cfg, job_id_hex.clone(), wasm, expected_verdict).await {
            eprintln!("[escrow] job {job_id_hex}: error: {e}");
        }
    });

    (StatusCode::ACCEPTED, Json(serde_json::json!({ "accepted": true, "job_id_hex": req.job_id_hex }))).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_cfg() -> crate::config::Config {
        crate::config::Config::from_toml_str(
            r#"
            pay_to = "GSELLER"
            amount = "100000"
            oz_api_key = "k"
            image_id = "00"
            verifier_id = "CV"
            m0_host_path = "/bin/true"
            settle_contract_id = "CID123"
            seller_key = "seller"
            stellar_network = "testnet"
            "#,
        )
        .unwrap()
    }

    #[test]
    fn decide_prove_only_on_match() {
        assert!(matches!(decide(0, 0), Decision::Prove));
        assert!(matches!(decide(2, 0), Decision::Decline)); // dirty, buyer wanted clean
        assert!(matches!(decide(0, 2), Decision::Decline)); // mismatch
    }

    #[test]
    fn submit_proof_args_shape() {
        let cfg = test_cfg();
        let a = submit_proof_args(&cfg, "ab12", "ffaa");
        // stellar contract invoke --id <CID> --source <key> --network testnet -- submit_proof --job_id ab12 --seal ffaa
        assert!(a.windows(2).any(|w| w == ["--id", "CID123"]));
        assert!(a.contains(&"submit_proof".to_string()));
        assert!(a.windows(2).any(|w| w == ["--job_id", "ab12"]));
        assert!(a.windows(2).any(|w| w == ["--seal", "ffaa"]));
    }
}
