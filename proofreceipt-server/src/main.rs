use proofreceipt_server::{app, config::Config, facilitator::Facilitator, job::new_store, AppState};
use std::sync::Arc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();
    let path = std::env::args().nth(1).unwrap_or_else(|| "proofreceipt-server.toml".to_string());
    let cfg = Config::from_path(&path)?;
    let bind = cfg.http_bind.clone();
    let facilitator = Arc::new(Facilitator::new(cfg.facilitator_url.clone(), cfg.oz_api_key.clone()));
    let state = AppState::new(Arc::new(cfg), new_store(), facilitator);
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    println!("[serve] proofreceipt-server listening on {bind}");
    axum::serve(listener, app(state)).await?;
    Ok(())
}
