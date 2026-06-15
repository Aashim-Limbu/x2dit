# M2 Withdrawal Circuit — Results (2026-06-15)

- circuit: `src/withdraw.circom` (depth-20). Constraints: **9415**; public inputs: 4; private: 42.
- commitment = `Poseidon2(2)([nullifier, secret], dsep=0)` (t=3); nullifierHash = `Poseidon2(1)([nullifier], dsep=0)` (t=2);
  Merkle node = `PoseidonCompress` (t=2). Public order: **[root, nullifierHash, recipient, denomination]** (sym wires 1..4).
- Witness generation cross-checks off-chain Poseidon2 (Python t=2/t=3) against the circuit constraints — PASS.
- Trusted setup: Hermez `powersOfTau28_hez_final_14.ptau` + one phase-2 contribution → `withdraw_final.zkey`.
- Proof: `snarkjs groth16 prove` → `snarkjs groth16 verify` => **OK!**
- VK: `build/verification_key.json` (groth16/bn128, nPublic=4, IC_len=5) embeds into the Soroban verifier
  (`VERIFIER_VK_JSON=... cargo build -p circom-groth16-verifier --target wasm32v1-none` => OK) — Task 27.
- Shared artifacts copied to `artifacts/circuit/` (vk/proof/public committed; .zkey/.wasm gitignored, regenerable).

Next (M3): deploy a verifier embedding THIS vk + the pool, and verify THIS proof on-chain — closes the
circom→Soroban loop and retires the M0 "live verify with real proof" caveat.
