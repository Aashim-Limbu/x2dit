//! Backing daemon: scan Sepolia RootUpdated events and anchor recent roots
//! into the Soroban pool. `decide` is the pure core (dedup + index->value);
//! `run_daemon` (Task 6) wires it to I/O.
use crate::evm::RootLog;
use crate::state::BackingState;
use crate::config::Config;
use crate::{evm, soroban};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnchorAction {
    pub denom_value: u32,
    pub root_hex: String,
}

/// Map an EVM denomIndex to the pool denomination value via the config list.
pub fn denom_value_for(denoms: &[u32], denom_index: u8) -> Option<u32> {
    denoms.get(denom_index as usize).copied()
}

/// Pure: given prior state, the denom value table, and the events found in a
/// block range (assumed block-ordered), return the anchors to perform in order.
/// Skips any root equal to the last-known root for that denom value (carrying
/// the running last-root forward within the batch so duplicates collapse).
pub fn decide(state: &BackingState, denoms: &[u32], events: &[RootLog]) -> Vec<AnchorAction> {
    use std::collections::HashMap;
    let mut last: HashMap<u32, Option<String>> = HashMap::new();
    let mut actions = Vec::new();
    for e in events {
        let Some(value) = denom_value_for(denoms, e.denom_index) else { continue };
        let prev = last
            .entry(value)
            .or_insert_with(|| state.cursor(value).last_anchored_root);
        if prev.as_deref() == Some(e.root_hex.as_str()) {
            continue;
        }
        *prev = Some(e.root_hex.clone());
        actions.push(AnchorAction { denom_value: value, root_hex: e.root_hex.clone() });
    }
    actions
}

/// Continuous backing loop: scan RootUpdated since the cursor, anchor new roots,
/// persist the cursor only after success, then sleep. Never crashes on transient
/// errors — logs and retries next tick.
pub async fn run_daemon(cfg: &Config, state_path: &str) -> anyhow::Result<()> {
    let mut state = BackingState::load(state_path);
    let denoms = cfg.denoms.clone();
    loop {
        if let Err(e) = tick(cfg, &denoms, &mut state, state_path).await {
            eprintln!("[backing] tick error (will retry): {e}");
        }
        tokio::time::sleep(std::time::Duration::from_secs(cfg.poll_interval_secs)).await;
    }
}

async fn tick(cfg: &Config, denoms: &[u32], state: &mut BackingState, state_path: &str) -> anyhow::Result<()> {
    let rpc = cfg.evm_rpc.clone();
    let contract = cfg.deposit_contract.clone();
    let head = {
        let rpc = rpc.clone();
        tokio::task::spawn_blocking(move || evm::current_block(&rpc)).await??
    };
    let to_block = head.saturating_sub(cfg.confirmations);
    // start from the min cursor across denoms (default cfg.from_block)
    let from_block = denoms
        .iter()
        .map(|d| {
            let c = state.cursor(*d).last_scanned_block;
            if c == 0 { cfg.from_block } else { c + 1 }
        })
        .min()
        .unwrap_or(cfg.from_block);
    if to_block < from_block {
        return Ok(());
    }
    let events = {
        let (rpc, contract) = (rpc.clone(), contract.clone());
        let window = cfg.log_window_blocks;
        tokio::task::spawn_blocking(move || evm::fetch_root_updates(&rpc, &contract, from_block, to_block, window))
            .await??
    };
    let actions = decide(state, denoms, &events);
    for a in actions {
        let tx = soroban::update_root(
            &cfg.pool_id, &cfg.stellar_network, &cfg.soroban_rpc, &cfg.stellar_identity,
            a.denom_value, &a.root_hex,
        ).await?;
        println!("[backing] anchored denom {} root {} (tx {})", a.denom_value, a.root_hex, tx);
        state.record_anchor(a.denom_value, &a.root_hex);
    }
    for d in denoms {
        state.set_scanned(*d, to_block);
    }
    state.save(state_path)?;
    Ok(())
}
