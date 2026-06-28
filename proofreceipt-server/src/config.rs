use serde::Deserialize;

fn default_http_bind() -> String { "127.0.0.1:8081".to_string() }
fn default_stellar_network() -> String { "testnet".to_string() }
fn default_facilitator() -> String { "https://channels.openzeppelin.com/x402/testnet".to_string() }
fn default_network() -> String { "stellar:testnet".to_string() }
fn default_asset() -> String { "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA".to_string() }
fn default_prover_timeout_secs() -> u64 { 900 }
fn default_max_concurrent_proves() -> usize { 1 }

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    /// Seller classic G-address receiving USDC (needs a USDC trustline).
    pub pay_to: String,
    /// USDC base units as a decimal string, 7 decimals (e.g. "100000" = $0.01).
    pub amount: String,
    /// OZ Channels facilitator API key (Bearer). From https://channels.openzeppelin.com/testnet/gen
    pub oz_api_key: String,
    /// Agreed RISC Zero image id (hex), advertised in the 402 and asserted by the buyer.
    pub image_id: String,
    /// Deployed verifier router contract id (for reference / buyer config).
    pub verifier_id: String,
    /// Absolute path to the built m0-host binary.
    pub m0_host_path: String,
    #[serde(default = "default_facilitator")]
    pub facilitator_url: String,
    #[serde(default = "default_network")]
    pub network: String,
    #[serde(default = "default_asset")]
    pub asset: String,
    #[serde(default = "default_http_bind")]
    pub http_bind: String,
    /// Max wall-clock seconds for a single prove before it is killed and the job errors
    /// (a hung r0vm otherwise leaves the job Pending forever).
    #[serde(default = "default_prover_timeout_secs")]
    pub prover_timeout_secs: u64,
    /// Max simultaneous proves. Each Groth16 prove peaks ~8GB; 1 prevents a second
    /// concurrent request from OOM-killing the box.
    #[serde(default = "default_max_concurrent_proves")]
    pub max_concurrent_proves: usize,
    /// settle-core (escrow) contract id the seller submits proofs to.
    pub settle_contract_id: String,
    /// `stellar` CLI identity name (or secret key) the seller signs submit_proof/claim with.
    pub seller_key: String,
    #[serde(default = "default_stellar_network")]
    pub stellar_network: String,
}

impl Config {
    pub fn from_toml_str(s: &str) -> anyhow::Result<Self> { Ok(toml::from_str(s)?) }
    pub fn from_path(path: &str) -> anyhow::Result<Self> {
        Self::from_toml_str(&std::fs::read_to_string(path)?)
    }
}
