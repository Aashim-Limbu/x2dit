//! Typed relayer configuration (TOML).
use serde::Deserialize;

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
}

impl Config {
    pub fn from_toml_str(s: &str) -> anyhow::Result<Self> {
        Ok(toml::from_str(s)?)
    }
    pub fn from_path(path: &str) -> anyhow::Result<Self> {
        Self::from_toml_str(&std::fs::read_to_string(path)?)
    }
}
