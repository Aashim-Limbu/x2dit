# zk-houdini local e2e runbook

Prereqs: `stellar` CLI on PATH with a funded `bridge-relayer` identity; `relayer/config.toml` present (copy from `config.example.toml`, set `evm_rpc`); a MetaMask account funded with Sepolia ETH; Freighter on testnet.

1. Start the relayer HTTP server (loopback):
   `cargo run --manifest-path relayer/Cargo.toml -- --config relayer/config.toml serve`
2. Start the backing daemon (anchors EVM roots into the Soroban pool):
   `cargo run --manifest-path relayer/Cargo.toml -- --config relayer/config.toml backing`
3. Start the frontend (proxies /api/relayer/* to 127.0.0.1:8080):
   `cd frontend && RELAYER_URL=http://127.0.0.1:8080 npm run dev`
4. Deposit: open http://localhost:3000/deposit → connect MetaMask (Sepolia) → "Get test USDC" → pick 1 USDC → Lock. Save the printed note.
5. Wait ~1 min for the backing daemon to anchor the new root (watch its logs for `update_root ... tx`).
6. Withdraw: open /withdraw → paste the note → connect Freighter → add zUSDC trustline if prompted → Reveal. Confirm zUSDC arrives at your Stellar address.

Troubleshooting:
- `UnknownRoot` on withdraw → the root isn't anchored yet; wait for the backing daemon, retry.
- `/path` 502 → EVM RPC down or rate-limited; check `evm_rpc` in config.toml.
- Proof slow → first proof loads the 4.3 MB zkey; subsequent proofs reuse it.
