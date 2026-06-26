use proofreceipt_server::{app, config::Config, AppState};
use std::sync::Arc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();
    let path = std::env::args().nth(1).unwrap_or_else(|| "proofreceipt-server.toml".to_string());
    let cfg = Config::from_path(&path)?;
    let bind = cfg.http_bind.clone();
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    println!("[serve] proofreceipt-server listening on {bind}");
    axum::serve(listener, app(AppState { cfg: Arc::new(cfg) })).await?;
    Ok(())
}
