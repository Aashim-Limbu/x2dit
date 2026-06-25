#!/usr/bin/env bash
# e2e_testnet.sh — self-contained ProofReceipt testnet end-to-end
# open_job -> submit_proof(REAL RISC Zero proof) -> claim
#
# Each run deploys a fresh proofreceipt contract + a fresh PRUSDC SAC
# (the SAC is idempotent — re-deploying the same asset returns the same contract id).
# A unique job_id (openssl rand) makes each run independently traceable.
#
# Requirements:
#   - bridge-deployer key in local stellar keystore (funded on testnet)
#   - stellar CLI v26+, curl, openssl on PATH
set -euo pipefail

export PATH="$HOME/.cargo/bin:$HOME/.risc0/bin:$PATH"

RPC_URL="https://soroban-testnet.stellar.org"
PASSPHRASE="Test SDF Network ; September 2015"
VERIFIER_ID="CCR6QRJJBEFKUDE4YXQ2L6VII6M6C57ENXXJ5A4HQWOO6PYKRP4KS4IU"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONTRACT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$CONTRACT_DIR/.." && pwd)"
M0_DIR="$REPO_ROOT/proofreceipt-m0"
PROOF_JSON="$M0_DIR/proof.json"

# ─── Step 0: ensure proof.json exists ────────────────────────────────────────
echo "=== [0] Checking proof.json ==="
if [[ ! -f "$PROOF_JSON" ]]; then
  echo "  proof.json not found, regenerating..."
  (cd "$M0_DIR" && PATH="$HOME/.risc0/bin:$HOME/.cargo/bin:$PATH" RISC0_DEV_MODE=0 ./target/release/m0-host hello)
fi

# Extract fields without jq
SEAL=$(grep -o '"seal": *"[0-9a-f]*"' "$PROOF_JSON" | sed -E 's/.*"([0-9a-f]*)"/\1/')
IMAGE_ID=$(grep -o '"image_id": *"[0-9a-f]*"' "$PROOF_JSON" | sed -E 's/.*"([0-9a-f]*)"/\1/')
INPUT_HASH=$(grep -o '"input_hash": *"[0-9a-f]*"' "$PROOF_JSON" | sed -E 's/.*"([0-9a-f]*)"/\1/')
VERDICT=$(grep -o '"verdict": *[0-9]*' "$PROOF_JSON" | grep -o '[0-9]*')

echo "  seal:       ${SEAL:0:20}..."
echo "  image_id:   $IMAGE_ID"
echo "  input_hash: $INPUT_HASH"
echo "  verdict:    $VERDICT"

# ─── Step 1: build the contract ───────────────────────────────────────────────
echo ""
echo "=== [1] Building contract WASM ==="
(cd "$CONTRACT_DIR/contract" && stellar contract build)
WASM_PATH=$(find "$CONTRACT_DIR/target/wasm32v1-none/release" -name "proofreceipt.wasm" 2>/dev/null | head -1)
if [[ -z "$WASM_PATH" ]]; then
  echo "  ERROR: proofreceipt.wasm not found after build"
  exit 1
fi
echo "  wasm: $WASM_PATH"

# ─── Step 2: deploy PRUSDC SAC ────────────────────────────────────────────────
echo ""
echo "=== [2] Deploying PRUSDC SAC ==="
ISSUER_ADDR=$(stellar keys address bridge-deployer)
echo "  issuer: $ISSUER_ADDR"

DEPLOY_SAC_OUT=$(stellar contract asset deploy \
  --asset "PRUSDC:$ISSUER_ADDR" \
  --source-account bridge-deployer \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$PASSPHRASE" 2>&1)
echo "$DEPLOY_SAC_OUT"

# Last line of output is the contract id
SAC=$(echo "$DEPLOY_SAC_OUT" | grep -E '^C[A-Z0-9]{55}$' | tail -1)
if [[ -z "$SAC" ]]; then
  SAC=$(echo "$DEPLOY_SAC_OUT" | tail -1 | tr -d '[:space:]')
fi

# Fallback: derive deterministically from asset if deploy output is unexpected
if [[ ${#SAC} -ne 56 ]] || [[ "${SAC:0:1}" != "C" ]]; then
  SAC=$(stellar contract id asset \
    --asset "PRUSDC:$ISSUER_ADDR" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$PASSPHRASE" 2>&1 | tail -1)
fi
echo "  SAC id: $SAC"

# ─── Step 3: create + fund buyer and seller ───────────────────────────────────
echo ""
echo "=== [3] Creating test accounts ==="

# Generate keys (--network flag required; if key already exists, overwrite or skip error)
stellar keys generate e2e-buyer --network testnet 2>/dev/null || true
stellar keys generate e2e-seller --network testnet 2>/dev/null || true

BUYER_ADDR=$(stellar keys address e2e-buyer)
SELLER_ADDR=$(stellar keys address e2e-seller)
echo "  buyer:  $BUYER_ADDR"
echo "  seller: $SELLER_ADDR"

echo "  Funding buyer via friendbot..."
curl -sf "https://friendbot.stellar.org/?addr=$BUYER_ADDR" -o /dev/null \
  && echo "  buyer funded" \
  || echo "  buyer may already be funded (friendbot rejected duplicate — continuing)"

echo "  Funding seller via friendbot..."
curl -sf "https://friendbot.stellar.org/?addr=$SELLER_ADDR" -o /dev/null \
  && echo "  seller funded" \
  || echo "  seller may already be funded (friendbot rejected duplicate — continuing)"

# Give friendbot a moment to propagate
sleep 5

# ─── Step 4: establish PRUSDC trustlines ──────────────────────────────────────
echo ""
echo "=== [4] Establishing PRUSDC trustlines ==="

# stellar tx new change-trust submits automatically (no --send flag needed)
echo "  trustline for buyer..."
stellar tx new change-trust \
  --source-account e2e-buyer \
  --line "PRUSDC:$ISSUER_ADDR" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$PASSPHRASE" 2>&1 | tail -5

echo "  trustline for seller..."
stellar tx new change-trust \
  --source-account e2e-seller \
  --line "PRUSDC:$ISSUER_ADDR" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$PASSPHRASE" 2>&1 | tail -5

# ─── Step 5: mint PRUSDC to buyer ─────────────────────────────────────────────
echo ""
echo "=== [5] Minting 1000 PRUSDC to buyer ==="
stellar contract invoke \
  --id "$SAC" \
  --source bridge-deployer \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$PASSPHRASE" \
  -- mint \
  --to "$BUYER_ADDR" \
  --amount 1000 2>&1 | tail -5

# ─── Step 6: deploy proofreceipt contract ─────────────────────────────────────
echo ""
echo "=== [6] Deploying proofreceipt contract ==="
DEPLOY_OUT=$(stellar contract deploy \
  --wasm "$WASM_PATH" \
  --source-account bridge-deployer \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$PASSPHRASE" 2>&1)
echo "$DEPLOY_OUT"

PROOFRECEIPT_ID=$(echo "$DEPLOY_OUT" | grep -E '^C[A-Z0-9]{55}$' | tail -1)
if [[ -z "$PROOFRECEIPT_ID" ]]; then
  PROOFRECEIPT_ID=$(echo "$DEPLOY_OUT" | tail -1 | tr -d '[:space:]')
fi
echo "  proofreceipt contract id: $PROOFRECEIPT_ID"

# ─── Step 7: initialize with verifier ─────────────────────────────────────────
echo ""
echo "=== [7] Initializing proofreceipt ==="
stellar contract invoke \
  --id "$PROOFRECEIPT_ID" \
  --source bridge-deployer \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$PASSPHRASE" \
  -- initialize \
  --verifier "$VERIFIER_ID" 2>&1 | tail -5

# ─── Step 8: open_job ─────────────────────────────────────────────────────────
echo ""
echo "=== [8] open_job (buyer) ==="
JOB_ID=$(openssl rand -hex 32)
echo "  job_id: $JOB_ID"

stellar contract invoke \
  --id "$PROOFRECEIPT_ID" \
  --source e2e-buyer \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$PASSPHRASE" \
  -- open_job \
  --job_id "$JOB_ID" \
  --buyer "$BUYER_ADDR" \
  --seller "$SELLER_ADDR" \
  --token_addr "$SAC" \
  --amount 100 \
  --expected_input_hash "$INPUT_HASH" \
  --expected_image_id "$IMAGE_ID" \
  --challenge_secs 5 2>&1 | tail -8

# ─── Step 9: submit_proof (REAL RISC Zero proof) ──────────────────────────────
echo ""
echo "=== [9] submit_proof (seller, REAL RISC Zero proof) ==="
stellar contract invoke \
  --id "$PROOFRECEIPT_ID" \
  --source e2e-seller \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$PASSPHRASE" \
  -- submit_proof \
  --job_id "$JOB_ID" \
  --seal "$SEAL" \
  --verdict "$VERDICT" 2>&1 | tail -8

# ─── Step 10: wait for challenge window, then claim ───────────────────────────
echo ""
echo "=== [10] Waiting 7s for challenge window, then claim ==="
sleep 7

stellar contract invoke \
  --id "$PROOFRECEIPT_ID" \
  --source e2e-seller \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$PASSPHRASE" \
  -- claim \
  --job_id "$JOB_ID" 2>&1 | tail -8

# ─── Step 11: assert seller balance == 100 ────────────────────────────────────
echo ""
echo "=== [11] Checking seller PRUSDC balance ==="
SELLER_BALANCE=$(stellar contract invoke \
  --id "$SAC" \
  --source bridge-deployer \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$PASSPHRASE" \
  -- balance \
  --id "$SELLER_ADDR" 2>&1 | tail -1 | tr -d '"' | tr -d '[:space:]')

echo "  seller PRUSDC balance: $SELLER_BALANCE"

echo ""
echo "=============================="
echo "  proofreceipt id: $PROOFRECEIPT_ID"
echo "  SAC id:          $SAC"
echo "  job_id:          $JOB_ID"
echo "  seller balance:  $SELLER_BALANCE"

if [[ "$SELLER_BALANCE" == "100" ]]; then
  echo ""
  echo "  SUCCESS: seller received 100 PRUSDC"
  echo "  Flow: open_job -> submit_proof(real RISC Zero seal) -> claim"
  echo "  This proves RISC Zero proof verification works against the live on-chain verifier."
  echo "=============================="
  exit 0
else
  echo ""
  echo "  FAIL: expected seller balance 100, got '$SELLER_BALANCE'"
  echo "=============================="
  exit 1
fi
