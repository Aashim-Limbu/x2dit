use crate::job::{self, JobStatus, Receipt};
use crate::x402;
use crate::AppState;
use axum::{
    extract::{Path, State},
    http::{HeaderMap, HeaderName, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct AuditReq {
    /// base64 of the raw artifact bytes.
    pub artifact: String,
}

fn header(name: &'static str, value: &str) -> (HeaderName, HeaderValue) {
    (HeaderName::from_static(name), HeaderValue::from_str(value).unwrap())
}

pub async fn post_audit(
    State(st): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AuditReq>,
) -> Response {
    let resource_url = format!("http://{}/audit", st.cfg.http_bind);
    let (pr, pr_header) = x402::build_payment_required(&st.cfg, &resource_url);

    // No payment yet → 402 challenge. `payload_val` is the RAW decoded payment payload.
    let Some(payload_val) = x402::read_payment_signature(&headers) else {
        return (
            StatusCode::PAYMENT_REQUIRED,
            [header("payment-required", &pr_header)],
            Json(serde_json::json!({ "error": "payment required" })),
        ).into_response();
    };

    // Decode the artifact up front (bad base64 → 400, no charge).
    let artifact = match base64_decode(&req.artifact) {
        Ok(b) => b,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error":"artifact not base64"}))).into_response(),
    };

    // Forward the WHOLE payment payload (opaque, all fields intact) + the single chosen requirement.
    let requirements_val = serde_json::to_value(&pr.accepts[0]).unwrap();

    // verify (synchronous, before settle/202/prove).
    match st.facilitator.verify(&payload_val, &requirements_val).await {
        Ok(v) if v.is_valid => {}
        Ok(v) => {
            return (
                StatusCode::PAYMENT_REQUIRED,
                [header("payment-required", &pr_header)],
                Json(serde_json::json!({ "error": "payment invalid", "reason": v.invalid_reason })),
            ).into_response();
        }
        Err(e) => return (StatusCode::BAD_GATEWAY, Json(serde_json::json!({"error": e.to_string()}))).into_response(),
    }

    // settle (synchronous; auth entries expire in ~60s, so this must precede proving).
    let settle = match st.facilitator.settle(&payload_val, &requirements_val).await {
        Ok(s) if s.success => s,
        Ok(s) => return (StatusCode::BAD_GATEWAY, Json(serde_json::json!({"error":"settle failed","reason":s.error_reason}))).into_response(),
        Err(e) => return (StatusCode::BAD_GATEWAY, Json(serde_json::json!({"error": e.to_string()}))).into_response(),
    };

    // Enqueue + spawn the (slow) prover; respond 202 immediately.
    let id = job::insert_pending(&st.store);
    {
        let store = st.store.clone();
        let host = st.cfg.m0_host_path.clone();
        let timeout_secs = st.cfg.prover_timeout_secs;
        let sem = st.prover_sem.clone();
        let id2 = id.clone();
        tokio::spawn(async move {
            // Serialize proves (each peaks ~8GB) so a second paid request can't OOM the box.
            let _permit = match sem.acquire_owned().await {
                Ok(p) => p,
                Err(_) => { job::set_error(&store, &id2, "prover semaphore closed".into()); return; }
            };
            match job::run_prover(&host, artifact, timeout_secs).await {
                Ok(r) => job::set_done(&store, &id2, r),
                Err(e) => job::set_error(&store, &id2, e.to_string()),
            }
        });
    }

    let pay_resp = x402::b64_json(&settle);
    (
        StatusCode::ACCEPTED,
        [header("payment-response", &pay_resp)],
        Json(serde_json::json!({ "job_id": id })),
    ).into_response()
}

pub async fn get_audit(State(st): State<AppState>, Path(id): Path<String>) -> Response {
    let guard = st.store.lock().unwrap();
    let Some(job) = guard.get(&id) else {
        return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error":"no such job"}))).into_response();
    };
    match &job.status {
        JobStatus::Pending => (StatusCode::ACCEPTED, Json(serde_json::json!({"status":"pending"}))).into_response(),
        JobStatus::Error => (StatusCode::OK, Json(serde_json::json!({"status":"error","error": job.error}))).into_response(),
        JobStatus::Done => {
            let r: &Receipt = job.receipt.as_ref().unwrap();
            (StatusCode::OK, Json(serde_json::json!({
                "status": "done",
                "seal": r.seal, "image_id": r.image_id,
                "journal": r.journal, "journal_digest": r.journal_digest, "verdict": r.verdict
            }))).into_response()
        }
    }
}

fn base64_decode(s: &str) -> anyhow::Result<Vec<u8>> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    Ok(STANDARD.decode(s.trim())?)
}

#[cfg(test)]
mod tests {
    use crate::{app, config::Config, facilitator::Facilitator, job::new_store, x402, AppState};
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use std::sync::Arc;
    use tower::ServiceExt;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn cfg(host: &str) -> Config {
        Config::from_toml_str(&format!(
            r#"
            pay_to = "GSELLER"
            amount = "100000"
            oz_api_key = "k"
            image_id = "3601e6ac"
            verifier_id = "CV"
            m0_host_path = "{host}"
            "#
        )).unwrap()
    }

    async fn fac_server() -> MockServer {
        let s = MockServer::start().await;
        Mock::given(method("POST")).and(path("/verify"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"isValid":true,"payer":"GBUYER"})))
            .mount(&s).await;
        Mock::given(method("POST")).and(path("/settle"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"success":true,"transaction":"tx1","network":"stellar:testnet","payer":"GBUYER"})))
            .mount(&s).await;
        s
    }

    fn fake_host() -> String {
        let dir = std::env::temp_dir().join(format!("m2audit-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let host = dir.join("fake-host.sh");
        std::fs::write(&host, "#!/usr/bin/env bash\nset -e\nout=\"\"\nwhile [ $# -gt 0 ]; do if [ \"$1\" = \"--out\" ]; then out=\"$2\"; shift; fi; shift; done\ncat > \"$out\" <<'JSON'\n{\"seal\":\"aa\",\"image_id\":\"3601e6ac\",\"journal\":\"cc\",\"journal_digest\":\"dd\",\"verdict\":1}\nJSON\n").unwrap();
        std::fs::set_permissions(&host, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
        host.to_str().unwrap().to_string()
    }

    fn state(fac_uri: String, host: String) -> AppState {
        let c = cfg(&host);
        let fac = Arc::new(Facilitator::new(fac_uri, c.oz_api_key.clone()));
        AppState::new(Arc::new(c), new_store(), fac)
    }

    #[tokio::test]
    async fn unpaid_audit_returns_402_with_header() {
        let st = state("http://unused".into(), fake_host());
        let res = app(st).oneshot(
            Request::builder().method("POST").uri("/audit")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"artifact":"aGVsbG8="}"#)).unwrap()
        ).await.unwrap();
        assert_eq!(res.status(), StatusCode::PAYMENT_REQUIRED);
        let hdr = res.headers().get("payment-required").unwrap().to_str().unwrap().to_string();
        let pr: x402::PaymentRequired = x402::from_b64_json(&hdr).unwrap();
        assert_eq!(pr.accepts[0].extra["areFeesSponsored"], serde_json::json!(true));
    }

    #[tokio::test]
    async fn paid_audit_enqueues_then_poll_completes() {
        let fac = fac_server().await;
        let st = state(fac.uri(), fake_host());
        let signed = x402::b64_json(&x402::PaymentPayload {
            x402_version: 2,
            accepted: serde_json::json!({"scheme":"exact"}),
            payload: serde_json::json!({"transaction":"AAAA"}),
        });
        let app1 = app(st);
        let res = app1.clone().oneshot(
            Request::builder().method("POST").uri("/audit")
                .header("content-type","application/json")
                .header("payment-signature", signed)
                .body(Body::from(r#"{"artifact":"aGVsbG8="}"#)).unwrap()
        ).await.unwrap();
        assert_eq!(res.status(), StatusCode::ACCEPTED);
        assert!(res.headers().get("payment-response").is_some());
        let bytes = axum::body::to_bytes(res.into_body(), 1<<20).await.unwrap();
        let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let id = v["job_id"].as_str().unwrap().to_string();

        // Poll until done (fake prover is fast).
        let mut done = false;
        for _ in 0..50 {
            let r = app1.clone().oneshot(
                Request::builder().method("GET").uri(format!("/audit/{id}")).body(Body::empty()).unwrap()
            ).await.unwrap();
            if r.status() == StatusCode::OK {
                let b = axum::body::to_bytes(r.into_body(), 1<<20).await.unwrap();
                let jv: serde_json::Value = serde_json::from_slice(&b).unwrap();
                if jv["status"] == "done" { assert_eq!(jv["seal"], "aa"); done = true; break; }
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        assert!(done, "job never completed");
    }
}
