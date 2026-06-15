//! Lightweight EVM reader: pull `Deposit` logs from the Sepolia pool via JSON-RPC
//! (eth_getLogs) and decode them, so the path service can rebuild each denom's tree.
//! Event: Deposit(uint8 indexed denomIndex, uint256 indexed commitment, uint32 leafIndex).
use anyhow::{anyhow, Result};
use serde_json::json;
use tiny_keccak::{Hasher, Keccak};

#[derive(Debug, Clone)]
pub struct DepositLog {
    pub denom_index: u8,
    pub commitment_hex: String, // 0x + 64 hex
    pub leaf_index: u32,
}

/// keccak256("Deposit(uint8,uint256,uint32)") — the event topic0.
pub fn deposit_topic0() -> String {
    let mut k = Keccak::v256();
    k.update(b"Deposit(uint8,uint256,uint32)");
    let mut out = [0u8; 32];
    k.finalize(&mut out);
    format!("0x{}", hex::encode(out))
}

pub fn fetch_deposits(rpc: &str, contract: &str, from_block: u64) -> Result<Vec<DepositLog>> {
    let body = json!({
        "jsonrpc": "2.0", "id": 1, "method": "eth_getLogs",
        "params": [{
            "address": contract,
            "topics": [deposit_topic0()],
            "fromBlock": format!("0x{:x}", from_block),
            "toBlock": "latest"
        }]
    });
    let resp: serde_json::Value = ureq::post(rpc).send_json(body)?.into_json()?;
    if let Some(e) = resp.get("error") {
        return Err(anyhow!("eth_getLogs error: {e}"));
    }
    let logs = resp["result"].as_array().ok_or_else(|| anyhow!("no result array"))?;
    let mut out = Vec::new();
    for log in logs {
        let topics = log["topics"].as_array().ok_or_else(|| anyhow!("no topics"))?;
        let denom_index = u8::from_str_radix(&topics[1].as_str().unwrap()[58..64], 16)?;
        let commitment_hex = topics[2].as_str().unwrap().to_string();
        let data = log["data"].as_str().unwrap();
        let h = data.trim_start_matches("0x");
        let leaf_index = u32::from_str_radix(&h[h.len() - 8..], 16)?;
        out.push(DepositLog { denom_index, commitment_hex, leaf_index });
    }
    out.sort_by_key(|d| d.leaf_index);
    Ok(out)
}
