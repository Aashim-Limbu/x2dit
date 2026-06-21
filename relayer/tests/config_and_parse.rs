use relayer::config::Config;
use relayer::soroban::extract_tx_hash;

#[test]
fn parses_config_toml() {
    let s = r#"
        evm_rpc = "https://sepolia.example/rpc"
        deposit_contract = "0xabc"
        stellar_network = "testnet"
        soroban_rpc = "https://soroban-testnet.stellar.org"
        pool_id = "CABC"
        stellar_identity = "spike-deployer"
        denoms = [1, 10, 100]
        from_block = 1234
    "#;
    let c = Config::from_toml_str(s).unwrap();
    assert_eq!(c.denoms, vec![1, 10, 100]);
    assert_eq!(c.from_block, 1234);
    assert_eq!(c.stellar_network, "testnet");
}

#[test]
fn extracts_tx_hash_from_cli_output() {
    let out = "ℹ️ Signing transaction: 18b0c3b5cb6627564ba36d4e9ef5a001af0bb9941c305a6b1d105436f6505040\n✅ ok";
    assert_eq!(
        extract_tx_hash(out).unwrap(),
        "18b0c3b5cb6627564ba36d4e9ef5a001af0bb9941c305a6b1d105436f6505040"
    );
    assert!(extract_tx_hash("no hash here").is_none());
}

#[test]
fn config_defaults_when_omitted() {
    let toml = r#"
evm_rpc = "https://rpc"
deposit_contract = "0xabc"
stellar_network = "testnet"
soroban_rpc = "https://srpc"
pool_id = "CPOOL"
stellar_identity = "rel"
denoms = [1, 10, 100]
"#;
    let cfg = relayer::config::Config::from_toml_str(toml).unwrap();
    assert_eq!(cfg.poll_interval_secs, 15);
    assert_eq!(cfg.confirmations, 2);
    assert_eq!(cfg.http_bind, "127.0.0.1:8080");
    assert_eq!(cfg.from_block, 0);
}
