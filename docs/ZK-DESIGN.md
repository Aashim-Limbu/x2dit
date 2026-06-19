# Zero-knowledge design

Withdrawals are authorized by a **Groth16 proof over the BN254 curve**, generated off-chain and verified **on Soroban** via Stellar's BN254 host functions (CAP-0074/0075, Protocol 25/26 "Yardstick"). The circuit is authored in circom; Rust owns the on-chain verifier and the relayer/tooling.

## The withdraw circuit

The circuit (`circuits/src/withdraw.circom`, instantiated at depth 20) proves, in zero knowledge, that the prover owns an unspent deposit, without revealing which one. Measured from the compiled R1CS, it has **9415 constraints** (9440 wires, 42 private inputs, 4 public inputs).

It does four things:

1. **Commitment** — `commitment = Poseidon2(2)([nullifier, secret])` (domain separation `0`).
2. **Nullifier hash** — `nullifierHash = Poseidon2(1)([nullifier])`, constrained to equal the public `nullifierHash`. This deterministic image is published at withdrawal and recorded in the pool's nullifier set to prevent double-withdrawal; it cannot be linked back to the commitment.
3. **Merkle membership** — the commitment is proven to be a leaf of a depth-20 incremental Merkle tree whose root equals the public `root`.
4. **Malleability binding** — `recipient` and `denomination` are bound into the witness by squaring them (`recipientSq`, `denomSq`), so a proof cannot be re-targeted to a different recipient or denomination.

There is **no amount arithmetic** in the circuit: value transfer is by fixed denomination (one tree per denomination), so withdrawals are Merkle-membership + nullifier only.

**Public input order is EXACTLY `[root, nullifierHash, recipient, denomination]`** (declared as `public [root, nullifierHash, recipient, denomination]` in the circuit `main`, and matched by the verifier's `nPublic = 4`). The verifier consumes public inputs positionally, so this order is load-bearing across the circuit, the proof's `public.json`, and the Soroban verifier.

## The keystone: one Poseidon2-BN254, byte-identical across surfaces

The single most fragile invariant in this project is the hash. A **single Poseidon2-BN254 family** (HorizenLabs `zkhash` `POSEIDON2_BN256_PARAMS_2` and `_3`, mixed arity) must be **byte-for-byte identical** across the **circom circuit, the Solidity tree, and the Rust relayer** — these three compute the hash, and the Soroban verifier checks a proof over the result.

It is **Poseidon2, not classic Poseidon1** — stock `poseidon-solidity`/circomlib are Poseidon1 and would silently fail to match. It also uses **mixed arity**:

| Use | Arity | Permutation | Form |
| --- | --- | --- | --- |
| Merkle node compression | `Poseidon2(2)` argument-pair → t=2 | Permutation width 2 | `node(l, r) = Perm([l, r])[0] + l` |
| `nullifierHash = Poseidon2(1)` | t=2 | Permutation width 2 | one-input hash |
| `commitment = Poseidon2(2)` | t=3 | Permutation width 3 | two-input hash |

The Merkle compression is the `P(l,r)[0] + l` form (confirmed in `circuits/src/merkle.circom`: `node(left,right) = Perm([left,right])[0] + left`). The empty-leaf `ZERO_VALUE` is `0`, kept consistent across EVM, circuit, and relayer.

## Why BN254

The curve choice is a *consequence* of keeping the authoritative commitment tree on-chain on EVM (Sepolia), which requires a SNARK-friendly hash in Solidity. **BN254 is the only field with a working off-the-shelf Solidity Poseidon** (`poseidon-solidity`, zk-kit); a BLS12-381 Poseidon in Solidity does not exist. Choosing BN254 lets one Poseidon instantiation span all four surfaces (circom + Solidity + Rust + Soroban), eliminating the cross-surface mismatch trap. BN254 Groth16 also verifies on Soroban today via the P25/P26 host functions. This **supersedes the earlier BLS12-381 decision** — see [ADR-0003](adr/0003-zk-stack-circom-groth16-bls12-381.md) (superseded) → [ADR-0004](adr/0004-flip-to-bn254-onchain-evm-tree.md).

## Trusted setup

Groth16 requires a per-circuit trusted setup: a universal **powers-of-tau** phase (Hermez ptau-14) followed by a circuit-specific **phase-2** contribution, producing `withdraw_final.zkey` and the `verification_key.json` embedded in the Soroban verifier (artifacts in `circuits/build/`).

## Key insight: Soroban computes no Poseidon

Hashing happens **only** in-circuit, in the EVM tree, and off-chain in the relayer. The Soroban pool is **verify-only**: it stores the root window and the nullifier set, and it checks the Groth16 proof. It never hashes the Merkle tree itself. This keeps the on-chain Soroban cost bounded to a Groth16 verification plus storage bookkeeping.
