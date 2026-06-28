#![cfg(test)]
use soroban_sdk::{testutils::Address as _, Address, Env};
use crate::{ProofReceipt, ProofReceiptClient};
use soroban_sdk::{token, BytesN};
use soroban_sdk::{contract, contractimpl, Bytes};
use soroban_sdk::testutils::Ledger as _;

#[contract]
pub struct GoodVerifier;
#[contractimpl]
impl GoodVerifier {
    pub fn verify(_e: Env, _seal: Bytes, _image_id: BytesN<32>, _journal: BytesN<32>) {}
}

#[contract]
pub struct BadVerifier;
#[contractimpl]
impl BadVerifier {
    pub fn verify(_e: Env, _seal: Bytes, _image_id: BytesN<32>, _journal: BytesN<32>) {
        panic!("invalid proof");
    }
}

#[contract]
pub struct StrictVerifier;
#[contractimpl]
impl StrictVerifier {
    // Panics unless journal == sha256([1u8;32] ‖ 7u32.to_le_bytes()) — i.e. submit_proof
    // built the journal from expected_input_hash + the PINNED expected_verdict (7).
    // Using a nonzero verdict ensures a mutation replacing the pinned verdict with a
    // constant 0 is caught (verdict 0 would produce a different digest → panic here).
    pub fn verify(e: Env, _seal: Bytes, _image_id: BytesN<32>, journal: BytesN<32>) {
        let mut buf = Bytes::from_array(&e, &[1u8; 32]);
        buf.extend_from_array(&7u32.to_le_bytes());
        let expected: BytesN<32> = e.crypto().sha256(&buf).to_bytes();
        if journal != expected { panic!("journal not built from pinned verdict"); }
    }
}

fn open_default_job(
    env: &Env, client: &ProofReceiptClient, token_addr: &Address,
    buyer: &Address, seller: &Address, expected_verdict: u32,
) -> BytesN<32> {
    let job_id = BytesN::from_array(env, &[9u8; 32]);
    let ih = BytesN::from_array(env, &[1u8; 32]);
    let img = BytesN::from_array(env, &[2u8; 32]);
    // expected_verdict, reclaim_secs=3600, challenge_secs=60
    client.open_job(&job_id, buyer, seller, token_addr, &100, &ih, &img, &expected_verdict, &3600, &60);
    job_id
}

#[test]
fn submit_proof_marks_proven_on_valid() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let (token_addr, mint, _tok) = make_token(&env, &admin);
    mint.mint(&buyer, &1000);

    let verifier = env.register(GoodVerifier, ());
    let id = env.register(ProofReceipt, ());
    let client = ProofReceiptClient::new(&env, &id);
    client.initialize(&verifier);
    let job_id = open_default_job(&env, &client, &token_addr, &buyer, &seller, 1);

    client.submit_proof(&job_id, &Bytes::from_array(&env, &[0u8; 4]));
    let job = client.get_job(&job_id);
    assert_eq!(job.status, crate::storage::Status::Proven);
    assert_eq!(job.verdict, 1);
    assert_eq!(job.claimable_at, env.ledger().timestamp() + 60);
}

#[test]
#[should_panic]
fn submit_proof_traps_on_invalid() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let (token_addr, mint, _tok) = make_token(&env, &admin);
    mint.mint(&buyer, &1000);

    let verifier = env.register(BadVerifier, ());
    let id = env.register(ProofReceipt, ());
    let client = ProofReceiptClient::new(&env, &id);
    client.initialize(&verifier);
    let job_id = open_default_job(&env, &client, &token_addr, &buyer, &seller, 0);
    client.submit_proof(&job_id, &Bytes::from_array(&env, &[0u8; 4]));
}

#[test]
#[should_panic]
fn submit_proof_rejects_non_open() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let (token_addr, mint, _tok) = make_token(&env, &admin);
    mint.mint(&buyer, &1000);
    let verifier = env.register(GoodVerifier, ());
    let id = env.register(ProofReceipt, ());
    let client = ProofReceiptClient::new(&env, &id);
    client.initialize(&verifier);
    let job_id = open_default_job(&env, &client, &token_addr, &buyer, &seller, 0);
    client.submit_proof(&job_id, &Bytes::from_array(&env, &[0u8; 4]));
    // Second submit on a Proven job must fail.
    client.submit_proof(&job_id, &Bytes::from_array(&env, &[0u8; 4]));
}

fn make_token<'a>(env: &'a Env, admin: &Address) -> (Address, token::StellarAssetClient<'a>, token::TokenClient<'a>) {
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let addr = sac.address();
    (addr.clone(), token::StellarAssetClient::new(env, &addr), token::TokenClient::new(env, &addr))
}

#[test]
fn initialize_sets_verifier() {
    let env = Env::default();
    let verifier = Address::generate(&env);
    let id = env.register(ProofReceipt, ());
    let client = ProofReceiptClient::new(&env, &id);
    client.initialize(&verifier);
    assert_eq!(client.get_verifier(), verifier);
}

#[test]
fn open_job_escrows_funds() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let (token_addr, mint, tok) = make_token(&env, &admin);
    mint.mint(&buyer, &1000);

    let id = env.register(ProofReceipt, ());
    let client = ProofReceiptClient::new(&env, &id);
    client.initialize(&Address::generate(&env));

    let job_id = BytesN::from_array(&env, &[7u8; 32]);
    let ih = BytesN::from_array(&env, &[1u8; 32]);
    let img = BytesN::from_array(&env, &[2u8; 32]);
    client.open_job(&job_id, &buyer, &seller, &token_addr, &100, &ih, &img, &0, &3600, &60);

    assert_eq!(tok.balance(&buyer), 900);
    assert_eq!(tok.balance(&id), 100);
    let job = client.get_job(&job_id);
    assert_eq!(job.status, crate::storage::Status::Open);
    assert_eq!(job.amount, 100);
}

#[test]
#[should_panic]
fn open_job_rejects_duplicate_id() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let (token_addr, mint, _tok) = make_token(&env, &admin);
    mint.mint(&buyer, &1000);
    let id = env.register(ProofReceipt, ());
    let client = ProofReceiptClient::new(&env, &id);
    client.initialize(&Address::generate(&env));
    let job_id = BytesN::from_array(&env, &[7u8; 32]);
    let ih = BytesN::from_array(&env, &[1u8; 32]);
    let img = BytesN::from_array(&env, &[2u8; 32]);
    client.open_job(&job_id, &buyer, &seller, &token_addr, &100, &ih, &img, &0, &3600, &60);
    client.open_job(&job_id, &buyer, &seller, &token_addr, &100, &ih, &img, &0, &3600, &60);
}

#[test]
fn claim_pays_seller_after_window() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let (token_addr, mint, tok) = make_token(&env, &admin);
    mint.mint(&buyer, &1000);
    let verifier = env.register(GoodVerifier, ());
    let id = env.register(ProofReceipt, ());
    let client = ProofReceiptClient::new(&env, &id);
    client.initialize(&verifier);
    let job_id = open_default_job(&env, &client, &token_addr, &buyer, &seller, 0);
    client.submit_proof(&job_id, &Bytes::from_array(&env, &[0u8; 4]));

    env.ledger().set_timestamp(env.ledger().timestamp() + 61);
    client.claim(&job_id);

    assert_eq!(tok.balance(&seller), 100);
    assert_eq!(tok.balance(&id), 0);
    assert_eq!(client.get_job(&job_id).status, crate::storage::Status::Claimed);
}

#[test]
#[should_panic]
fn claim_rejected_before_window() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let (token_addr, mint, _tok) = make_token(&env, &admin);
    mint.mint(&buyer, &1000);
    let verifier = env.register(GoodVerifier, ());
    let id = env.register(ProofReceipt, ());
    let client = ProofReceiptClient::new(&env, &id);
    client.initialize(&verifier);
    let job_id = open_default_job(&env, &client, &token_addr, &buyer, &seller, 0);
    client.submit_proof(&job_id, &Bytes::from_array(&env, &[0u8; 4]));
    client.claim(&job_id); // window not elapsed -> ChallengeWindowOpen
}

#[test]
#[should_panic]
fn claim_rejects_double_claim() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let (token_addr, mint, _tok) = make_token(&env, &admin);
    mint.mint(&buyer, &1000);
    let verifier = env.register(GoodVerifier, ());
    let id = env.register(ProofReceipt, ());
    let client = ProofReceiptClient::new(&env, &id);
    client.initialize(&verifier);
    let job_id = open_default_job(&env, &client, &token_addr, &buyer, &seller, 0);
    client.submit_proof(&job_id, &Bytes::from_array(&env, &[0u8; 4]));
    env.ledger().set_timestamp(env.ledger().timestamp() + 61);
    client.claim(&job_id);
    client.claim(&job_id); // second claim -> JobNotProven (status now Claimed)
}

// Guard: the contract's journal reconstruction (expected_input_hash || verdict_le,
// then sha256) MUST equal the host/guest journal_digest for the SAME input.
// Fixture is the host output for input "hello" (Task 1). If the guest's
// commit_slice layout or the contract's concat ever drifts, this fails.
#[test]
fn contract_journal_digest_matches_host_fixture() {
    let env = Env::default();
    let input_hash = BytesN::from_array(&env, &[
        0x2c,0xf2,0x4d,0xba,0x5f,0xb0,0xa3,0x0e,0x26,0xe8,0x3b,0x2a,0xc5,0xb9,0xe2,0x9e,
        0x1b,0x16,0x1e,0x5c,0x1f,0xa7,0x42,0x5e,0x73,0x04,0x33,0x62,0x93,0x8b,0x98,0x24,
    ]);
    let verdict: u32 = 1;

    let mut buf = Bytes::from_array(&env, &input_hash.to_array());
    buf.extend_from_array(&verdict.to_le_bytes());
    let digest: BytesN<32> = env.crypto().sha256(&buf).to_bytes();

    let expected = BytesN::from_array(&env, &[
        0x49,0x31,0x4a,0x2e,0xd2,0xb8,0x0d,0xb1,0xd7,0x17,0xbd,0xdf,0xf8,0xd1,0x92,0x7c,
        0x50,0x9e,0x3e,0xad,0xfb,0x3c,0xde,0xfa,0x17,0xaf,0x80,0xde,0x83,0x25,0x4e,0xba,
    ]);
    assert_eq!(digest, expected);
}

#[test]
fn submit_proof_builds_journal_from_pinned_verdict() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let (token_addr, mint, _tok) = make_token(&env, &admin);
    mint.mint(&buyer, &1000);
    let verifier = env.register(StrictVerifier, ());
    let id = env.register(ProofReceipt, ());
    let client = ProofReceiptClient::new(&env, &id);
    client.initialize(&verifier);
    let job_id = open_default_job(&env, &client, &token_addr, &buyer, &seller, 7);
    // StrictVerifier only passes if submit_proof reconstructed the journal from the
    // pinned (ih, expected_verdict=7). Using 7 (nonzero) ensures that a mutation
    // replacing the pinned verdict with constant 0 would produce a different digest
    // and cause StrictVerifier to panic — the mutation is caught.
    client.submit_proof(&job_id, &Bytes::from_array(&env, &[0u8; 4]));
    assert_eq!(client.get_job(&job_id).status, crate::storage::Status::Proven);
}

#[test]
fn buyer_reclaim_refunds_after_deadline() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let (token_addr, mint, tok) = make_token(&env, &admin);
    mint.mint(&buyer, &1000);
    let verifier = env.register(GoodVerifier, ());
    let id = env.register(ProofReceipt, ());
    let client = ProofReceiptClient::new(&env, &id);
    client.initialize(&verifier);
    let job_id = open_default_job(&env, &client, &token_addr, &buyer, &seller, 0);
    assert_eq!(tok.balance(&buyer), 900); // 100 escrowed
    // jump past reclaim_after (opened at t0, reclaim_secs=3600)
    env.ledger().set_timestamp(env.ledger().timestamp() + 3601);
    client.buyer_reclaim(&job_id);
    assert_eq!(client.get_job(&job_id).status, crate::storage::Status::Reclaimed);
    assert_eq!(tok.balance(&buyer), 1000); // refunded
}

#[test]
#[should_panic] // Error::ReclaimTooEarly
fn buyer_reclaim_too_early_traps() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let (token_addr, mint, _tok) = make_token(&env, &admin);
    mint.mint(&buyer, &1000);
    let verifier = env.register(GoodVerifier, ());
    let id = env.register(ProofReceipt, ());
    let client = ProofReceiptClient::new(&env, &id);
    client.initialize(&verifier);
    let job_id = open_default_job(&env, &client, &token_addr, &buyer, &seller, 0);
    client.buyer_reclaim(&job_id); // before reclaim_after → traps
}

#[test]
#[should_panic] // Error::JobNotOpen — can't reclaim a proven job
fn buyer_reclaim_rejects_proven() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);
    let (token_addr, mint, _tok) = make_token(&env, &admin);
    mint.mint(&buyer, &1000);
    let verifier = env.register(GoodVerifier, ());
    let id = env.register(ProofReceipt, ());
    let client = ProofReceiptClient::new(&env, &id);
    client.initialize(&verifier);
    let job_id = open_default_job(&env, &client, &token_addr, &buyer, &seller, 0);
    client.submit_proof(&job_id, &Bytes::from_array(&env, &[0u8; 4]));
    env.ledger().set_timestamp(env.ledger().timestamp() + 3601);
    client.buyer_reclaim(&job_id); // status Proven → JobNotOpen
}
