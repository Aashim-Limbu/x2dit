use relayer::proofconv::{proof_abc, public_fields};
use relayer::withdrawal::{denom_index_of, validate_withdraw, WithdrawRequest};

fn req(denom: u32) -> WithdrawRequest {
    WithdrawRequest {
        proof: "{}".into(),
        root: "0x01".into(),
        nullifier_hash: "0x02".into(),
        recipient_fr: "0x03".into(),
        recipient: "GABC".into(),
        denom,
    }
}

#[test]
fn maps_value_to_index() {
    let denoms = vec![1u32, 10, 100];
    assert_eq!(denom_index_of(&denoms, 1), Some(0));
    assert_eq!(denom_index_of(&denoms, 100), Some(2));
    assert_eq!(denom_index_of(&denoms, 7), None);
}

#[test]
fn validate_accepts_configured_denom() {
    let denoms = vec![1u32, 10, 100];
    assert!(validate_withdraw(&req(10), &denoms).is_ok());
}

#[test]
fn validate_rejects_unconfigured_denom() {
    let denoms = vec![1u32, 10, 100];
    assert!(validate_withdraw(&req(7), &denoms).is_err());
}

#[test]
fn validate_rejects_empty_field() {
    let denoms = vec![1u32, 10, 100];
    let mut r = req(10);
    r.recipient = "".into();
    assert!(validate_withdraw(&r, &denoms).is_err());
}

/// Regression: convert-proof output must deserialize into WithdrawRequest.
///
/// WithdrawRequest.proof is a String, so the JSON body must carry `proof` as a
/// quoted string `"{\"a\":...}"` — NOT a nested object.  If proof were emitted
/// as an object this test fails at from_value with "invalid type: map, expected
/// a string".
#[test]
fn convert_proof_body_deserializes_into_withdraw_request() {
    let proof_json = std::fs::read_to_string("../artifacts/circuit/proof.json")
        .expect("artifacts/circuit/proof.json must exist");
    let public_json = std::fs::read_to_string("../artifacts/circuit/public.json")
        .expect("artifacts/circuit/public.json must exist");

    let (a, b, c) = proof_abc(&proof_json).unwrap();
    let (root, nh, rfr, denom) = public_fields(&public_json).unwrap();

    // Mirror exactly what the ConvertProof arm now does (Change 1).
    let abc = serde_json::json!({ "a": a, "b": b, "c": c });
    let mut body = serde_json::json!({ "proof": abc.to_string() });
    body["root"] = serde_json::Value::String(root);
    body["nullifier_hash"] = serde_json::Value::String(nh);
    body["recipient_fr"] = serde_json::Value::String(rfr);
    body["denom"] = serde_json::Value::Number(denom.into());
    // caller injects recipient (not produced by convert-proof)
    body["recipient"] = serde_json::Value::String("GDUMMYRECIPIENTADDRESS".into());

    let req: WithdrawRequest = serde_json::from_value(body)
        .expect("body produced by convert-proof must deserialize into WithdrawRequest");

    // proof is the STRING form: {"a":"...","b":"...","c":"..."}
    assert!(req.proof.starts_with('{'), "proof must be a JSON-object string, got: {}", req.proof);
    assert!(req.proof.contains("\"a\""), "proof string must contain key 'a'");
    assert!(req.proof.contains("\"b\""), "proof string must contain key 'b'");
    assert!(req.proof.contains("\"c\""), "proof string must contain key 'c'");
    assert_eq!(req.denom, 10);
    assert_eq!(req.recipient, "GDUMMYRECIPIENTADDRESS");
}
