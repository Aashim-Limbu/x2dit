# ProofReceipt M2 — Live E2E Runbook

Run the full **x402 agent-payment → ZK audit → on-chain-verified receipt** loop on Stellar
testnet. An AI-agent buyer pays a seller's audit API over real x402 v2; the audit runs
asynchronously (RISC Zero Groth16); the buyer gets a proof receipt and verifies it on-chain.

> Verified end-to-end on testnet 2026-06-26:
> `[buyer] ✅ receipt verified: ran agreed program 3601e6ac… on my exact 15-byte input; verdict=1`
> Real USDC moved buyer → seller via the OZ Channels facilitator.

## Components
- `proofreceipt-server/` — Rust/axum seller server (hand-rolled x402 v2 + async prover spawn).
- `proofreceipt-buyer/` — TS buyer agent (`@x402/fetch` pay + poll + on-chain verify).
- `proofreceipt-m0/` — the RISC Zero prover (`m0-host`) the server shells out to.
- Deployed RISC Zero verifier (testnet, reused from M0/M1): `CCR6QRJJBEFKUDE4YXQ2L6VII6M6C57ENXXJ5A4HQWOO6PYKRP4KS4IU`.

## Prerequisites (one-time)

1. **Toolchains:** Rust + the RISC Zero toolchain (`rzup` → cargo-risczero/r0vm **3.0.x**),
   Docker running (x86_64), Node 20+, the `stellar` CLI.
2. **Build the prover (release) — do this after ANY change to `proofreceipt-m0/host`:**
   ```bash
   cd proofreceipt-m0 && PATH="$HOME/.risc0/bin:$HOME/.cargo/bin:$PATH" cargo build --release -p m0-host
   ```
   The server invokes the release binary at `proofreceipt-m0/target/release/m0-host`. If it's
   stale it won't understand `--input`/`--out` (see Troubleshooting #1).
3. **Install the buyer deps:** `cd proofreceipt-buyer && npm install`
4. **Testnet identities:** two funded accounts, e.g. `e2e-buyer` (payer) and `e2e-seller`
   (`payTo`). Fund + add a USDC trustline to BOTH:
   ```bash
   ./proofreceipt-buyer/scripts/setup-testnet.sh   # friendbot XLM + USDC trustlines + prints an OZ key
   ```
5. **Fund the buyer with testnet USDC** (manual — Captcha): https://faucet.circle.com →
   Stellar testnet → USDC → the buyer's `G...` address. (The seller's `payTo` only needs the
   trustline, not a balance.)
6. **A free facilitator API key:** `curl -s https://channels.openzeppelin.com/testnet/gen` → `{"apiKey":"..."}`

## Configure the server

```bash
cd proofreceipt-server
cp proofreceipt-server.example.toml proofreceipt-server.toml   # gitignored; holds your key
```
Fill `proofreceipt-server.toml`:
```toml
pay_to       = "<e2e-seller G-address>"
amount       = "100000"        # $0.01 USDC (7 decimals)
oz_api_key   = "<key from /testnet/gen>"
image_id     = "<image_id from a fresh proof.json — see below>"
verifier_id  = "CCR6QRJJBEFKUDE4YXQ2L6VII6M6C57ENXXJ5A4HQWOO6PYKRP4KS4IU"
m0_host_path = "/absolute/path/to/proofreceipt-m0/target/release/m0-host"
http_bind    = "127.0.0.1:8081"
```
Get the `image_id` (it is the guest program commitment; deterministic for a given guest):
```bash
cd proofreceipt-m0 && PATH="$HOME/.risc0/bin:$HOME/.cargo/bin:$PATH" RISC0_DEV_MODE=0 ./target/release/m0-host hello
grep image_id proof.json   # the same value feeds the server config AND the buyer's AGREED_IMAGE_ID
```

## Run it (two terminals)

**Terminal A — server:**
```bash
cd proofreceipt-server && cargo run --release -- proofreceipt-server.toml
# -> [serve] proofreceipt-server listening on 127.0.0.1:8081
```

**Terminal B — buyer agent:**
```bash
cd proofreceipt-buyer
export SERVER_URL=http://127.0.0.1:8081
export VERIFIER_ID=CCR6QRJJBEFKUDE4YXQ2L6VII6M6C57ENXXJ5A4HQWOO6PYKRP4KS4IU
export AGREED_IMAGE_ID="<same image_id as the server>"
export CLIENT_PRIVATE_KEY="$(stellar keys show e2e-buyer)"   # S... seed
export CLIENT_PUBLIC_KEY="$(stellar keys address e2e-buyer)"
npm run buyer -- "audit me please"
```

Expected:
```
[buyer] paid, job_id=...
[buyer] ✅ receipt verified: ran agreed program <image_id>… on my exact N-byte input; verdict=1
```
The first request pays USDC up front, then the server runs a Groth16 prove (a few minutes,
Docker) while the buyer polls; finally the buyer reconstructs the journal from its own bytes
and verifies the proof on-chain (read-only simulate — free).

## Troubleshooting (real snags hit during the first live run)

1. **`m0-host failed: [m1] input = "--input"`** — the **release prover binary is stale**
   (pre-M2, no flag parsing), so the server's `--input` was read as the literal input. Fix:
   rebuild it (`cargo build --release -p m0-host`, Prereq #2). Confirm the binary prints the
   `[m2]` banner.

2. **`m0-host failed: docker returned failure exit code: Some(137)`** — exit 137 is an **OOM
   kill**. The Groth16 prove peaks around ~8 GB; on a 15 GB box it competes with the editor's
   `rust-analyzer` (~3.5 GB, which auto-respawns from VS Code) and a full swap. Fixes:
   - Kill orphaned provers between attempts: `pkill -9 -x r0vm` and
     `docker ps --format '{{.ID}} {{.Image}}' | grep -iE 'groth|snark|rapidsnark' | awk '{print $1}' | xargs -r docker kill`.
   - Suppress `rust-analyzer` for the prove window (or close VS Code / the Rust extension):
     ```bash
     # run while the buyer/prove is in flight
     while pgrep -f 'tsx src/buyer.ts' >/dev/null; do pkill -9 rust-analyzer 2>/dev/null; sleep 3; done
     ```
   - A standalone prove is the isolation test: `m0-host --input <file> --out /tmp/p.json` —
     if that succeeds, the server path will too once memory is freed.

3. **`402 ... "reason":"invalid_exact_stellar_payload_auth_expiration_too_far"`** — the signed
   auth entry's expiration ledger drifted too far ahead (intermittent Soroban RPC ledger lag).
   It's transient: **just re-run the buyer.**

## Notes
- `proofreceipt-server.toml` is gitignored (it holds the OZ key) — never commit it.
- Settlement is **up front** (x402 Option B): a buyer is charged before the prove; if the
  prover later fails, the job ends `error` and there is no refund (by design — a refundable
  escrow is the M1 model, not this path).
- Each run pays `amount` (default $0.01) of real testnet USDC to the seller.
