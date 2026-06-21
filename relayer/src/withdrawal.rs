//! Withdrawal HTTP server (axum): GET /health, GET /path, POST /withdraw.
use crate::config::Config;
use crate::poseidon::Fr;
use crate::{evm, pathsvc, soroban};
use ark_ff::PrimeField;
use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct WithdrawRequest {
    pub proof: String,
    pub root: String,
    pub nullifier_hash: String,
    pub recipient_fr: String,
    pub recipient: String,
    pub denom: u32,
}

pub fn denom_index_of(denoms: &[u32], value: u32) -> Option<usize> {
    denoms.iter().position(|d| *d == value)
}

pub fn validate_withdraw(req: &WithdrawRequest, denoms: &[u32]) -> Result<(), String> {
    if denom_index_of(denoms, req.denom).is_none() {
        return Err(format!("denom {} not configured", req.denom));
    }
    for (name, v) in [
        ("proof", &req.proof), ("root", &req.root), ("nullifier_hash", &req.nullifier_hash),
        ("recipient_fr", &req.recipient_fr), ("recipient", &req.recipient),
    ] {
        if v.trim().is_empty() {
            return Err(format!("{name} must not be empty"));
        }
    }
    Ok(())
}

#[derive(Deserialize)]
struct PathQuery { denom: u32, leaf_index: usize }

#[derive(Clone)]
struct AppState { cfg: Arc<Config> }

fn fr_from_be(be: &[u8]) -> Fr { Fr::from_be_bytes_mod_order(be) }

async fn health(State(st): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "deposit_contract": st.cfg.deposit_contract,
        "pool_id": st.cfg.pool_id,
        "denoms": st.cfg.denoms,
    }))
}

async fn path_handler(State(st): State<AppState>, Query(q): Query<PathQuery>) -> impl IntoResponse {
    let Some(idx) = denom_index_of(&st.cfg.denoms, q.denom) else {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": format!("denom {} not configured", q.denom)}))).into_response();
    };
    let (rpc, contract, from_block) = (st.cfg.evm_rpc.clone(), st.cfg.deposit_contract.clone(), st.cfg.from_block);
    let window = st.cfg.log_window_blocks;
    let deposits = match tokio::task::spawn_blocking(move || evm::fetch_deposits(&rpc, &contract, from_block, window)).await {
        Ok(Ok(d)) => d,
        Ok(Err(e)) => return (StatusCode::BAD_GATEWAY, Json(serde_json::json!({"error": e.to_string()}))).into_response(),
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e.to_string()}))).into_response(),
    };
    let leaves: Vec<Fr> = match deposits.iter()
        .filter(|d| d.denom_index as usize == idx)
        .map(|d| hex::decode(d.commitment_hex.trim_start_matches("0x")).map(|b| fr_from_be(&b)))
        .collect::<Result<Vec<_>, _>>()
    {
        Ok(v) => v,
        Err(e) => return (StatusCode::BAD_GATEWAY, Json(serde_json::json!({"error": format!("bad commitment hex: {e}")}))).into_response(),
    };
    if q.leaf_index >= leaves.len() {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "leaf_index out of range"}))).into_response();
    }
    let proof = pathsvc::path_for(&leaves, q.leaf_index);
    match serde_json::to_value(proof) {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e.to_string()}))).into_response(),
    }
}

async fn withdraw_handler(State(st): State<AppState>, Json(req): Json<WithdrawRequest>) -> impl IntoResponse {
    if let Err(e) = validate_withdraw(&req, &st.cfg.denoms) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": e}))).into_response();
    }
    let c = &st.cfg;
    match soroban::withdraw(
        &c.pool_id, &c.stellar_network, &c.soroban_rpc, &c.stellar_identity,
        &req.proof, &req.root, &req.nullifier_hash, &req.recipient_fr, &req.recipient, req.denom,
    ).await {
        Ok(tx) => (StatusCode::OK, Json(serde_json::json!({"tx_hash": tx}))).into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, Json(serde_json::json!({"error": e.to_string()}))).into_response(),
    }
}

pub fn app(cfg: Arc<Config>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/path", get(path_handler))
        .route("/withdraw", post(withdraw_handler))
        .with_state(AppState { cfg })
}

pub async fn serve(cfg: Config) -> anyhow::Result<()> {
    let bind = cfg.http_bind.clone();
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    println!("[serve] withdrawal server listening on {bind}");
    axum::serve(listener, app(Arc::new(cfg))).await?;
    Ok(())
}
