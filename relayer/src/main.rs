use anyhow::Result;
use clap::{Parser, Subcommand};
use relayer::{config::Config, evm, pathsvc, poseidon::Fr, soroban};

#[derive(Parser)]
#[command(name = "relayer", about = "ZK bridge relayer (backing root-sync + withdrawal submit + path service)")]
struct Cli {
    #[arg(long, default_value = "relayer.toml")]
    config: String,
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Print the keccak topic0 used to scan Deposit logs.
    Topic,
    /// Reconstruct a denomination's tree from Sepolia deposits and print the path proof for a leaf.
    Path { #[arg(long)] denom: u8, #[arg(long)] leaf_index: usize },
    /// One backing pass: not yet wired to NewRoot scan (needs deployed deposit contract).
    BackingOnce { #[arg(long)] denom: u32, #[arg(long)] root: String },
    /// Run the continuous backing daemon (poll RootUpdated -> Pool.update_root).
    Backing {
        #[arg(long, default_value = "backing-state.json")]
        state: String,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.cmd {
        Cmd::Topic => {
            println!("{}", evm::deposit_topic0());
        }
        Cmd::Path { denom, leaf_index } => {
            let cfg = Config::from_path(&cli.config)?;
            let deposits = evm::fetch_deposits(&cfg.evm_rpc, &cfg.deposit_contract, cfg.from_block)?;
            let leaves: Vec<Fr> = deposits
                .iter()
                .filter(|d| d.denom_index == denom)
                .map(|d| {
                    let bytes = hex::decode(d.commitment_hex.trim_start_matches("0x")).unwrap();
                    fr_from_be(&bytes)
                })
                .collect();
            let proof = pathsvc::path_for(&leaves, leaf_index);
            println!("{}", serde_json::to_string_pretty(&proof)?);
        }
        Cmd::BackingOnce { denom, root } => {
            let cfg = Config::from_path(&cli.config)?;
            let tx = soroban::update_root(
                &cfg.pool_id, &cfg.stellar_network, &cfg.soroban_rpc, &cfg.stellar_identity, denom, &root,
            ).await?;
            println!("anchored root for denom {denom}, tx {tx}");
        }
        Cmd::Backing { state } => {
            let cfg = Config::from_path(&cli.config)?;
            relayer::backing::run_daemon(&cfg, &state).await?;
        }
    }
    Ok(())
}

fn fr_from_be(be: &[u8]) -> Fr {
    use ark_ff::PrimeField;
    Fr::from_be_bytes_mod_order(be)
}
