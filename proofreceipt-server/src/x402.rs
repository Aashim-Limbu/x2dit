use axum::http::HeaderMap;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{de::DeserializeOwned, Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceInfo {
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(rename = "mimeType", skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentRequirements {
    pub scheme: String,
    pub network: String,
    pub asset: String,
    pub amount: String,
    #[serde(rename = "payTo")]
    pub pay_to: String,
    #[serde(rename = "maxTimeoutSeconds")]
    pub max_timeout_seconds: u32,
    pub extra: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentRequired {
    #[serde(rename = "x402Version")]
    pub x402_version: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub resource: ResourceInfo,
    pub accepts: Vec<PaymentRequirements>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentPayload {
    #[serde(rename = "x402Version")]
    pub x402_version: u32,
    pub accepted: serde_json::Value,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifyResponse {
    #[serde(rename = "isValid")]
    pub is_valid: bool,
    #[serde(rename = "invalidReason")]
    pub invalid_reason: Option<String>,
    pub payer: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettleResponse {
    pub success: bool,
    #[serde(default)]
    pub transaction: String,
    #[serde(default)]
    pub network: String,
    pub payer: Option<String>,
    #[serde(rename = "errorReason")]
    pub error_reason: Option<String>,
}

pub fn b64_json<T: Serialize>(v: &T) -> String {
    STANDARD.encode(serde_json::to_vec(v).expect("serialize"))
}

pub fn from_b64_json<T: DeserializeOwned>(s: &str) -> anyhow::Result<T> {
    let bytes = STANDARD.decode(s.trim())?;
    Ok(serde_json::from_slice(&bytes)?)
}

/// Build the v2 PaymentRequired object + its base64 `PAYMENT-REQUIRED` header value.
pub fn build_payment_required(cfg: &crate::config::Config, resource_url: &str) -> (PaymentRequired, String) {
    let req = PaymentRequirements {
        scheme: "exact".into(),
        network: cfg.network.clone(),
        asset: cfg.asset.clone(),
        amount: cfg.amount.clone(),
        pay_to: cfg.pay_to.clone(),
        max_timeout_seconds: 60,
        // areFeesSponsored:true is REQUIRED; image_id advertises the agreed program.
        extra: serde_json::json!({ "areFeesSponsored": true, "image_id": cfg.image_id }),
    };
    let pr = PaymentRequired {
        x402_version: 2,
        error: None,
        resource: ResourceInfo {
            url: resource_url.to_string(),
            description: Some("Async ZK proof audit (RISC Zero Groth16 receipt)".into()),
            mime_type: Some("application/json".into()),
        },
        accepts: vec![req],
    };
    let header = b64_json(&pr);
    (pr, header)
}

/// Read + base64-decode the v2 `PAYMENT-SIGNATURE` header into the RAW payment-payload JSON
/// (returning a `serde_json::Value` so NO fields are dropped before forwarding to the
/// facilitator — re-serializing a typed struct would silently lose `resource`/`extensions`).
/// `HeaderMap::get` is already case-insensitive. Returns None only if the header is absent or
/// undecodable; a decode failure is logged for diagnostics (so a paid-but-malformed request
/// doesn't silently look "unpaid" and loop on 402).
pub fn read_payment_signature(headers: &HeaderMap) -> Option<serde_json::Value> {
    let raw = headers.get("payment-signature")?;
    let s = raw.to_str().ok()?;
    match from_b64_json::<serde_json::Value>(s) {
        Ok(v) => Some(v),
        Err(e) => {
            eprintln!("[x402] PAYMENT-SIGNATURE decode failed: {e}");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderMap;

    fn cfg() -> crate::config::Config {
        crate::config::Config::from_toml_str(
            r#"
            pay_to = "GSELLERADDR"
            amount = "100000"
            oz_api_key = "k"
            image_id = "3601e6ac"
            verifier_id = "CV"
            m0_host_path = "/bin/true"
            settle_contract_id = "CID123"
            seller_key = "seller"
            "#,
        ).unwrap()
    }

    #[test]
    fn build_402_has_required_v2_fields() {
        let (pr, header) = build_payment_required(&cfg(), "https://s/audit");
        assert_eq!(pr.x402_version, 2);
        let acc = &pr.accepts[0];
        assert_eq!(acc.scheme, "exact");
        assert_eq!(acc.network, "stellar:testnet");
        assert_eq!(acc.amount, "100000");
        assert_eq!(acc.pay_to, "GSELLERADDR");
        // areFeesSponsored MUST be present and true or the buyer client throws
        assert_eq!(acc.extra["areFeesSponsored"], serde_json::json!(true));
        assert_eq!(acc.extra["image_id"], serde_json::json!("3601e6ac"));
        // header decodes back to the same object
        let back: PaymentRequired = from_b64_json(&header).unwrap();
        assert_eq!(back.accepts[0].pay_to, "GSELLERADDR");
    }

    #[test]
    fn read_payment_signature_case_insensitive() {
        let payload = PaymentPayload {
            x402_version: 2,
            accepted: serde_json::json!({"scheme":"exact"}),
            payload: serde_json::json!({"transaction":"AAAA"}),
        };
        let b64 = b64_json(&payload);
        let mut h = HeaderMap::new();
        h.insert("payment-signature", b64.parse().unwrap()); // lowercase on the wire
        let got = read_payment_signature(&h).unwrap(); // raw serde_json::Value
        assert_eq!(got["x402Version"], 2);
        assert_eq!(got["payload"]["transaction"], "AAAA");
    }

    #[test]
    fn read_payment_signature_absent_is_none() {
        assert!(read_payment_signature(&HeaderMap::new()).is_none());
    }
}
