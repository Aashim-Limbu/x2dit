//! Idempotency cursor for the backing daemon, persisted as JSON.
//! Cursor is the EVM block number (monotonic) — NOT the RootUpdated.rootIndex
//! (a ring-buffer index that wraps).
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
pub struct DenomCursor {
    pub last_scanned_block: u64,
    pub last_anchored_root: Option<String>,
}

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
pub struct BackingState {
    denoms: BTreeMap<u32, DenomCursor>,
}

impl BackingState {
    pub fn load(path: &str) -> BackingState {
        match std::fs::read_to_string(path) {
            Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
            Err(_) => BackingState::default(),
        }
    }

    pub fn save(&self, path: &str) -> anyhow::Result<()> {
        std::fs::write(path, serde_json::to_string_pretty(self)?)?;
        Ok(())
    }

    pub fn cursor(&self, denom_value: u32) -> DenomCursor {
        self.denoms.get(&denom_value).cloned().unwrap_or_default()
    }

    pub fn record_anchor(&mut self, denom_value: u32, root_hex: &str) {
        self.denoms.entry(denom_value).or_default().last_anchored_root = Some(root_hex.to_string());
    }

    pub fn set_scanned(&mut self, denom_value: u32, block: u64) {
        self.denoms.entry(denom_value).or_default().last_scanned_block = block;
    }
}
