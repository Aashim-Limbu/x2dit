use serde_json::json;

#[test]
fn decodes_deposit_log() {
    // Deposit(uint8 idx=1, uint256 commitment=0x..0a, uint32 leafIndex=3)
    let log = json!({
        "topics": [
            relayer::evm::deposit_topic0(),
            "0x0000000000000000000000000000000000000000000000000000000000000001",
            "0x000000000000000000000000000000000000000000000000000000000000000a"
        ],
        "data": "0x0000000000000000000000000000000000000000000000000000000000000003",
        "blockNumber": "0x10"
    });
    let d = relayer::evm::decode_deposit_log(&log).unwrap();
    assert_eq!(d.denom_index, 1);
    assert_eq!(d.leaf_index, 3);
    assert!(d.commitment_hex.ends_with("0a"));
}

#[test]
fn decodes_root_log() {
    // RootUpdated(uint8 idx=2, uint256 root=0x..ff, uint32 rootIndex=5)  block 0x2a
    let root_word = "00000000000000000000000000000000000000000000000000000000000000ff";
    let idx_word  = "0000000000000000000000000000000000000000000000000000000000000005";
    let log = json!({
        "topics": [
            relayer::evm::root_updated_topic0(),
            "0x0000000000000000000000000000000000000000000000000000000000000002"
        ],
        "data": format!("0x{root_word}{idx_word}"),
        "blockNumber": "0x2a"
    });
    let r = relayer::evm::decode_root_log(&log).unwrap();
    assert_eq!(r.denom_index, 2);
    assert_eq!(r.root_index, 5);
    assert_eq!(r.block, 42);
    assert_eq!(r.root_hex, format!("0x{root_word}"));
}
