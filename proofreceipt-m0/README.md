# ProofReceipt M0 — RISC Zero prove → verify on Soroban

The thinnest possible end-to-end proof of life: a trivial Rust guest program is
**proven** with RISC Zero (Groth16), and that proof is **verified on Stellar testnet**
by the NethermindEth RISC Zero verifier. No audit logic, no x402 — just the
hardest part de-risked first: *does a real RISC Zero proof verify on Soroban?*

This is isolated from the bridge (`soroban/`, `relayer/`, `frontend/`) — nothing here
touches it.

## What it proves

The guest (`methods/guest/src/main.rs`) reads `n`, computes `n*n`, and commits both to
the journal. The on-chain verifier confirms a proof that **this exact program** produced
**this exact journal** — the same `verify(seal, image_id, journal)` call ProofReceipt will
later gate USDC settlement on.

## Layout

```
proofreceipt-m0/
├── methods/guest/   # the program whose execution is proven (Rust → RISC-V)
├── methods/         # build glue → M0_GUEST_ELF, M0_GUEST_ID
├── host/            # runs the guest, makes a Groth16 receipt, prints (seal, image_id, journal)
└── scripts/         # deploy the leaf verifier, then call verify() on testnet
```

## Prerequisites

- RISC Zero toolchain: `curl -L https://risczero.com/install | bash && rzup install`
- **Docker running** + **x86_64** (Groth16 proving requirement)
- Stellar CLI + a funded testnet identity:
  `stellar keys generate m0 --network testnet --fund`

## Run it

```bash
# 1. Build (compiles the guest to RISC-V)
cargo build --release

# 2. Prove — produces proof.json with seal/image_id/journal_digest.
#    First run pulls a Docker image and can take several minutes.
cargo run --release -p m0-host -- 42

# 3. Deploy the leaf RISC Zero verifier to testnet (clones the Nethermind repo)
SOURCE=m0 ./scripts/deploy_verifier.sh

# 4. Verify the proof on-chain — success = verify() returns without trapping
SOURCE=m0 ./scripts/verify_onchain.sh
```

## Version pin (important)

The deployed verifier's `parameters.json` targets RISC Zero **3.0.x**; this project pins
`risc0-zkvm = "3.0"` and the toolchain is **3.0.5**. They must stay on the same 3.0 line —
a mismatch changes the 4-byte seal selector and verification fails.

## What M0 de-risks (and what comes next)

- ✅ Local Groth16 proving works on this machine (free, no Bonsai/SP1 credits).
- ✅ The Nethermind verifier accepts our seal on testnet.
- ✅ The version pin (prover 3.0.5 ↔ verifier 3.0.0) lines up.

Next (M1+): replace the trivial guest with bounded audit logic; put
`hash(buyer_input)` + verdict in the journal; fork the bridge pool into a
`settle()` that releases USDC when `verify()` passes and the journal binds the
buyer's exact input.
