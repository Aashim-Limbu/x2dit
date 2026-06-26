pub mod config;

use axum::{routing::get, Json, Router};
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub cfg: Arc<config::Config>,
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok" }))
}

pub fn app(state: AppState) -> Router {
    Router::new().route("/health", get(health)).with_state(state)
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
        let app = app(AppState { cfg: Arc::new(test_cfg()) });
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
