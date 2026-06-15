# Private Cross-Chain Bridge (EVM Sepolia → Stellar) — Stellar Hacks: ZK

Deposit/lock test-USDC on EVM Sepolia (commitment into an on-chain Merkle tree) →
trusted Backing Relayer anchors a recent EVM root into the Soroban pool root window →
withdraw on Stellar via a Groth16/BN254 proof (Merkle membership + nullifier) verified
on Soroban, releasing a pool-minted SAC token to the recipient via a Withdrawal Relayer.

> ⚠️ Demo / hackathon project on **unaudited** reference code — never frame as securing real funds.
> Privacy is trustless (ZK); backing/solvency relies on a single 1-of-1 relayer.

## Reference implementation (pinned)
- Upstream: NethermindEth/stellar-private-payments
- HEAD SHA: `e6a69f0752cb555bdb6020f9f29be1a36ced1a3e` (2026-06-12)
- Vendored at: `vendor/stellar-private-payments` (checked out to the SHA above; gitignored)

## Toolchain (authoritative list in spike/versions.lock)
| tool | version |
|------|---------|
| rust | 1.92.0 (edition 2024) via vendor/rust-toolchain.toml |
| wasm targets | wasm32v1-none, wasm32-unknown-unknown |
| soroban-sdk | 26 (features = ["hazmat"]) |
| stellar-cli | 26.1.0 (Protocol 26 "Yardstick") |
| circom | 2.2.2 (built from source) |
| snarkjs | 0.7.5 |
| node | 24.x |
| foundry/forge | 1.5.1 |
| ark-{bn254,ff,groth16} | 0.5 (off-chain relayer only) |

## Validated facts (2026-06-15)
- BN254 host functions are LIVE on Soroban: CAP-0074 (Final, Protocol 25; expanded in 26) and
  CAP-0075 Poseidon (Final, Protocol 25). soroban-sdk 26 exposes `env.crypto().bn254()`.
- Poseidon2 is **mixed-arity**: Merkle compression = `Permutation(2)` (t=2); commitment
  `Poseidon2(2)` = `Permutation(3)` (t=3); nullifierHash `Poseidon2(1)` = `Permutation(2)` (t=2).
- Soroban computes **no** Poseidon — hashing is in-circuit + EVM + off-chain.

## Day-1 Spike gate
See `spike/` — the project is GREEN-LIT only when the keystone (Task 2) and on-chain
verify (Task 3/4) pass. See the GREEN-LIGHT GATE in the plan's spike section.
