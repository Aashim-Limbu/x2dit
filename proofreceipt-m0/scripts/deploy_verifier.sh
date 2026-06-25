#!/usr/bin/env bash
# M0 — clone, build, and deploy the NethermindEth RISC Zero leaf verifier to testnet.
#
# For M0 we deploy ONLY the leaf `groth16-verifier` and call it directly,
# skipping the router/timelock/emergency-stop stack (fewer moving parts).
#
# Requires: stellar CLI, a funded testnet identity.
# Usage:    SOURCE=<identity> ./scripts/deploy_verifier.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$HERE/.verifier-src"
REPO="https://github.com/NethermindEth/stellar-risc0-verifier"
SOURCE="${SOURCE:-}"
NETWORK="${NETWORK:-testnet}"

if [[ -z "$SOURCE" ]]; then
  echo "ERROR: set SOURCE=<your funded testnet identity>. List with: stellar keys ls" >&2
  echo "Create+fund one with: stellar keys generate m0 --network testnet --fund" >&2
  exit 1
fi

if [[ ! -d "$SRC_DIR/.git" ]]; then
  echo "[deploy] cloning $REPO ..."
  git clone --depth 1 "$REPO" "$SRC_DIR"
else
  echo "[deploy] reusing existing clone at $SRC_DIR"
fi

# parameters.json pins the zkVM version the embedded constants target.
echo "[deploy] verifier parameters version:"
grep -m1 '"version"' "$SRC_DIR/contracts/groth16-verifier/parameters.json" || true

echo "[deploy] building groth16-verifier contract (this downloads crates; be patient)..."
( cd "$SRC_DIR/contracts/groth16-verifier" && stellar contract build )

WASM="$(find "$SRC_DIR/target" -name 'groth16_verifier*.wasm' -path '*release*' | head -1)"
if [[ -z "$WASM" ]]; then
  echo "ERROR: could not find built wasm under $SRC_DIR/target" >&2
  exit 1
fi
echo "[deploy] wasm: $WASM"

echo "[deploy] deploying to $NETWORK as '$SOURCE'..."
VERIFIER_ID="$(stellar contract deploy --wasm "$WASM" --source "$SOURCE" --network "$NETWORK")"

echo "$VERIFIER_ID" > "$HERE/verifier_id.txt"
echo
echo "[deploy] DONE. leaf verifier contract id:"
echo "  $VERIFIER_ID"
echo "[deploy] saved to $HERE/verifier_id.txt"
echo "[deploy] next: cargo run --release -p m0-host -- 42   (produces proof.json)"
echo "[deploy]       ./scripts/verify_onchain.sh"
