pub mod audit;
pub mod config;
pub mod facilitator;
pub mod job;
pub mod x402;

use axum::{extract::DefaultBodyLimit, routing::{get, post}, Json, Router};
use std::sync::Arc;
use tokio::sync::Semaphore;

#[derive(Clone)]
pub struct AppState {
    pub cfg: Arc<config::Config>,
    pub store: job::JobStore,
    pub facilitator: Arc<facilitator::Facilitator>,
    /// Limits how many proves run at once (each Groth16 prove peaks ~8GB).
    pub prover_sem: Arc<Semaphore>,
}

impl AppState {
    pub fn new(
        cfg: Arc<config::Config>,
        store: job::JobStore,
        facilitator: Arc<facilitator::Facilitator>,
    ) -> Self {
        let permits = cfg.max_concurrent_proves.max(1);
        Self { cfg, store, facilitator, prover_sem: Arc::new(Semaphore::new(permits)) }
    }
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok" }))
}

pub fn app(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/audit", post(audit::post_audit).layer(DefaultBodyLimit::max(4 * 1024 * 1024)))
        .route("/audit/:id", get(audit::get_audit))
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    fn test_cfg() -> config::Config {
        config::Config::from_toml_str(
            r#"
            pay_to = "GSELLER"
            amount = "100000"
            oz_api_key = "k"
            image_id = "00"
            verifier_id = "CV"
            m0_host_path = "/bin/true"
            "#,
        )
        .unwrap()
    }

    #[tokio::test]
    async fn health_ok() {
        let st = AppState::new(
            Arc::new(test_cfg()),
            crate::job::new_store(),
            Arc::new(crate::facilitator::Facilitator::new("http://unused".into(), "k".into())),
        );
        let app = app(st);
        let res = app
            .oneshot(Request::builder().uri("/health").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), 1 << 20).await.unwrap();
        let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(v["status"], "ok");
    }

    #[test]
    fn config_defaults_apply() {
        let c = test_cfg();
        assert_eq!(c.facilitator_url, "https://channels.openzeppelin.com/x402/testnet");
        assert_eq!(c.asset, "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA");
        assert_eq!(c.http_bind, "127.0.0.1:8081");
    }
}
