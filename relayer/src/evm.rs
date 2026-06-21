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

#[derive(Debug, Clone)]
pub struct RootLog {
    pub denom_index: u8,
    pub root_hex: String,   // 0x + 64 hex
    pub root_index: u32,
    pub block: u64,
}

/// keccak256("Deposit(uint8,uint256,uint32)") — the event topic0.
pub fn deposit_topic0() -> String {
    let mut k = Keccak::v256();
    k.update(b"Deposit(uint8,uint256,uint32)");
    let mut out = [0u8; 32];
    k.finalize(&mut out);
    format!("0x{}", hex::encode(out))
}

/// keccak256("RootUpdated(uint8,uint256,uint32)") — the event topic0.
pub fn root_updated_topic0() -> String {
    let mut k = Keccak::v256();
    k.update(b"RootUpdated(uint8,uint256,uint32)");
    let mut out = [0u8; 32];
    k.finalize(&mut out);
    format!("0x{}", hex::encode(out))
}

fn block_of(log: &serde_json::Value) -> Result<u64> {
    let b = log["blockNumber"].as_str().ok_or_else(|| anyhow!("no blockNumber"))?;
    Ok(u64::from_str_radix(b.trim_start_matches("0x"), 16)?)
}

pub fn decode_deposit_log(log: &serde_json::Value) -> Result<DepositLog> {
    let topics = log["topics"].as_array().ok_or_else(|| anyhow!("no topics"))?;
    // uint8 indexed denomIndex is right-aligned in the 32-byte topic: last 2 hex.
    // (NOTE: the previous inline decode used [58..64], which read the wrong bytes
    // and always yielded 0 for nonzero denom indices — this fixes that latent bug.)
    let t1 = topics[1].as_str().unwrap();
    let denom_index = u8::from_str_radix(&t1[t1.len() - 2..], 16)?;
    let commitment_hex = topics[2].as_str().unwrap().to_string();
    let data = log["data"].as_str().unwrap();
    let h = data.trim_start_matches("0x");
    let leaf_index = u32::from_str_radix(&h[h.len() - 8..], 16)?;
    Ok(DepositLog { denom_index, commitment_hex, leaf_index })
}

pub fn decode_root_log(log: &serde_json::Value) -> Result<RootLog> {
    let topics = log["topics"].as_array().ok_or_else(|| anyhow!("no topics"))?;
    let t1 = topics[1].as_str().unwrap();
    let denom_index = u8::from_str_radix(&t1[t1.len() - 2..], 16)?;
    let data = log["data"].as_str().unwrap().trim_start_matches("0x");
    // abi: word0 = root (uint256), word1 = rootIndex (uint32, right-aligned)
    let root_hex = format!("0x{}", &data[0..64]);
    let root_index = u32::from_str_radix(&data[120..128], 16)?;
    Ok(RootLog { denom_index, root_hex, root_index, block: block_of(log)? })
}

pub fn current_block(rpc: &str) -> Result<u64> {
    let body = json!({"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]});
    let resp: serde_json::Value = ureq::post(rpc).send_json(body)?.into_json()?;
    let s = resp["result"].as_str().ok_or_else(|| anyhow!("no result"))?;
    Ok(u64::from_str_radix(s.trim_start_matches("0x"), 16)?)
}

/// Split an inclusive [from, to] range into <= `window`-block chunks.
pub fn plan_windows(from: u64, to: u64, window: u64) -> Vec<(u64, u64)> {
    let mut out = Vec::new();
    if window == 0 || to < from {
        return out;
    }
    let mut start = from;
    loop {
        let end = core::cmp::min(start + window - 1, to);
        out.push((start, end));
        if end >= to {
            break;
        }
        start = end + 1;
    }
    out
}

/// Page an eth_getLogs query for `topic0` over [from, to] in <= `window`-block
/// chunks and return the raw log values (free-tier RPCs cap the per-call span).
fn get_logs_chunked(
    rpc: &str, contract: &str, topic0: &str, from: u64, to: u64, window: u64,
) -> Result<Vec<serde_json::Value>> {
    let mut all = Vec::new();
    for (start, end) in plan_windows(from, to, window) {
        let body = json!({
            "jsonrpc": "2.0", "id": 1, "method": "eth_getLogs",
            "params": [{
                "address": contract,
                "topics": [topic0],
                "fromBlock": format!("0x{:x}", start),
                "toBlock": format!("0x{:x}", end)
            }]
        });
        let resp: serde_json::Value = ureq::post(rpc).send_json(body)?.into_json()?;
        if let Some(e) = resp.get("error") {
            return Err(anyhow!("eth_getLogs error: {e}"));
        }
        let logs = resp["result"].as_array().ok_or_else(|| anyhow!("no result array"))?;
        all.extend(logs.iter().cloned());
    }
    Ok(all)
}

pub fn fetch_root_updates(
    rpc: &str, contract: &str, from_block: u64, to_block: u64, window: u64,
) -> Result<Vec<RootLog>> {
    let logs = get_logs_chunked(rpc, contract, &root_updated_topic0(), from_block, to_block, window)?;
    let mut out = Vec::new();
    for log in &logs {
        out.push(decode_root_log(log)?);
    }
    out.sort_by_key(|r| r.block);
    Ok(out)
}

pub fn fetch_deposits(
    rpc: &str, contract: &str, from_block: u64, window: u64,
) -> Result<Vec<DepositLog>> {
    let head = current_block(rpc)?;
    let logs = get_logs_chunked(rpc, contract, &deposit_topic0(), from_block, head, window)?;
    let mut out = Vec::new();
    for log in &logs {
        out.push(decode_deposit_log(log)?);
    }
    out.sort_by_key(|d| d.leaf_index);
    Ok(out)
}
