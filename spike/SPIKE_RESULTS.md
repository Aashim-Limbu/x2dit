# Day-1 Spike Results — GREEN LIGHT (2026-06-15)

The two hardest unknowns are retired. Evidence below.

## Keystone — Poseidon2 cross-surface parity (Task 2) ✅
Byte-identical across **circom (authoritative witness) + Solidity (forge) + Rust (vendored zkhash)**.
Mixed-arity confirmed from source: compress = `Permutation(2)` (t=2), commitment = `Poseidon2(2)`→`Permutation(3)` (t=3),
nullifierHash = `Poseidon2(1)`→`Permutation(2)` (t=2). Rust instances `POSEIDON2_BN256_PARAMS_2`/`_3`.

Canonical vectors (`spike/poseidon2_vectors.json`):
- compress(1,2)    t=2 = `0x0e90c132311e864e0c8bca37976f28579a2dd9436bbc11326e21ec7c00cea5b3`
- hash2(1,2)       t=3 = `0x2afac3bdc3663b71eefeecdf21b147d0ba7dd7a169a7757c05ed6bfb065bffd2`
- nullifierHash(1) t=2 = `0x09546fe32f579f77c33ffb629a91ed18c4594804519846d143d3c1ba79b04d54`

Surfaces:
- circom: `spike/circom/keystone.circom` (compiled, witness via snarkjs)
- Solidity: `spike/sol` — `forge test` → 2 passed (perm + compress parity)
- Rust: `spike/keystone_rust.rs.txt` (run as a zkhash example) → all 3 match

## BN254 Groth16 verify on Soroban (Task 3) ✅
Upstream `circom-groth16-verifier` (soroban-sdk 26, `env.crypto().bn254()`) builds + tests pass:
- `cargo test -p circom-groth16-verifier` → 3 passed, incl. `verifies_valid_proof` (real arkworks BN254 proof).
- Builds to `wasm32v1-none` (optimized 9523 bytes).

## Verify instruction cost (Task 4) ✅
`spike_measure_verify_budget` (soroban test env, isolated): **CPU = 37,246,988 instructions** (mem 203,868 bytes).
**37.2M < 100M budget gate.**

## Live testnet (Protocol 26 "Yardstick") ✅ (deploy + network)
- testnet `getNetwork` → `protocolVersion: 26` (BN254 host fns, CAP-0074, enabled).
- Funded identity: `spike-deployer` (GDZ7FHCM…ZHH7).
- Verifier deployed live: contract `CA3DEXAKJ27FJANCTGEWKIJYY4TK6GVZZP76R3PP5RX6IL2WVIVWYBFI`
  (tx 18b0c3b5…5040).

## Toolchain validated (Task 1) ✅
rust 1.92.0 (auto via vendor rust-toolchain.toml) + soroban-sdk 26.0.0 + edition 2024 → wasm32v1-none OK.
stellar-cli 26.1.0 (prebuilt), circom 2.2.2 (source), snarkjs 0.7.5, forge 1.5.1, node 24, ark-* 0.6.0.

## Caveat (one literal-gate item not yet executed)
A **live testnet `verify` invoke with a real proof** has not been run — only (a) host-env verify with a real
proof, (b) live deploy, (c) live Protocol-26 confirmation. The deployed `verify` uses the embedded
policy_tx_2_2 VK, so a live success needs a proof matching that VK (or a redeploy with an exportable test VK).
The de-risk goal is met; this is confirmatory and can be done before M3 if desired.
