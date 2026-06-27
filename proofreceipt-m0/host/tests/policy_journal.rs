// Runs the REAL guest under RISC0 dev mode (fake seal, but the journal is genuinely
// produced by executing the guest) and asserts the committed verdict for each of the
// 4 policy fixtures. No Docker; needs the RISC-V toolchain to build the guest ELF.
use m0_methods::{M0_GUEST_ELF, M0_GUEST_ID};

fn run_verdict(wasm: &[u8]) -> u32 {
    let env = risc0_zkvm::ExecutorEnv::builder()
        .write(&wasm.to_vec())
        .unwrap()
        .build()
        .unwrap();
    let receipt = risc0_zkvm::default_prover()
        .prove(env, M0_GUEST_ELF)
        .unwrap()
        .receipt;
    receipt.verify(M0_GUEST_ID).unwrap();
    let j = &receipt.journal.bytes;
    assert_eq!(j.len(), 36, "journal must be 36 bytes");
    u32::from_le_bytes(j[32..36].try_into().unwrap())
}

const HEADER_AND_TYPE: &[u8] = &[
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    0x01, 0x04, 0x01, 0x60, 0x00, 0x00,
];

fn with_one_import(module: u8, field: u8) -> Vec<u8> {
    let mut v = HEADER_AND_TYPE.to_vec();
    v.extend_from_slice(&[0x02, 0x07, 0x01, 0x01, module, 0x01, field, 0x00, 0x00]);
    v
}

#[test]
fn policy_fixtures_produce_expected_verdicts() {
    // Always run in dev mode: this integration test asserts the committed journal
    // verdict (real guest execution), not the cryptographic seal. Setting it here
    // (not just via the CLI) stops a plain `cargo test` from doing real Groth16 proofs.
    std::env::set_var("RISC0_DEV_MODE", "1");
    // include_bytes! resolves relative to THIS file (host/tests/); the fixture is in
    // the sibling methods/ tree, so two `..` are needed (host/tests -> host -> m0).
    assert_eq!(run_verdict(include_bytes!("../../methods/guest/wasm-policy/tests/fixtures/clean.wasm")), 0);
    assert_eq!(run_verdict(&with_one_import(b'z', b'0')), 0b001); // unknown
    assert_eq!(run_verdict(&with_one_import(b'l', b'6')), 0b010); // denylisted
    assert_eq!(run_verdict(&with_one_import(b'l', b'_')), 0b100); // write, no auth
}
