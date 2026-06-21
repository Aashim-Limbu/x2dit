//! Typed relayer configuration (TOML).
use serde::Deserialize;

fn default_poll_interval() -> u64 {
    15
}
fn default_confirmations() -> u64 {
    2
}
fn default_http_bind() -> String {
    "127.0.0.1:8080".to_string()
}
fn default_log_window() -> u64 {
    9
}

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    /// EVM (Sepolia) JSON-RPC URL.
    pub evm_rpc: String,
    /// Deployed PrivacyPoolDeposit address on Sepolia (0x...).
    pub deposit_contract: String,
    /// Stellar network passphrase name for the CLI (e.g. "testnet").
    pub stellar_network: String,
    /// Soroban RPC URL.
    pub soroban_rpc: String,
    /// Deployed Soroban pool contract id (C...).
    pub pool_id: String,
    /// Stellar CLI identity used to sign (backing relayer + withdrawal submitter).
    pub stellar_identity: String,
    /// Denomination indices, aligned across all components (e.g. [1, 10, 100]).
    pub denoms: Vec<u32>,
    /// EVM block to start scanning from.
    #[serde(default)]
    pub from_block: u64,
    /// Backing daemon loop cadence (seconds).
    #[serde(default = "default_poll_interval")]
    pub poll_interval_secs: u64,
    /// Scan only up to head - confirmations (EVM reorg safety).
    #[serde(default = "default_confirmations")]
    pub confirmations: u64,
    /// Withdrawal HTTP server bind address.
    #[serde(default = "default_http_bind")]
    pub http_bind: String,
    /// Max block span per eth_getLogs call (free RPCs cap this; Alchemy free = 10).
    #[serde(default = "default_log_window")]
    pub log_window_blocks: u64,
}

impl Config {
    pub fn from_toml_str(s: &str) -> anyhow::Result<Self> {
        Ok(toml::from_str(s)?)
    }
    pub fn from_path(path: &str) -> anyhow::Result<Self> {
        Self::from_toml_str(&std::fs::read_to_string(path)?)
    }
}
