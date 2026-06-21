//! Backing daemon: scan Sepolia RootUpdated events and anchor recent roots
//! into the Soroban pool. `decide` is the pure core (dedup + index->value);
//! `run_daemon` (Task 6) wires it to I/O.
use crate::evm::RootLog;
use crate::state::BackingState;

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
