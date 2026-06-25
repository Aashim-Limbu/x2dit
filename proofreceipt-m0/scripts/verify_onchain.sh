#!/usr/bin/env bash
# M0 — call verify(seal, image_id, journal) on the deployed leaf verifier.
# A successful call returns void (no trap). A bad proof traps with VerifierError.
#
# Requires: proof.json (from `cargo run -p m0-host`) and a deployed verifier id.
# Usage:    SOURCE=<identity> ./scripts/verify_onchain.sh [VERIFIER_ID]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="${SOURCE:-}"
NETWORK="${NETWORK:-testnet}"
VERIFIER_ID="${1:-$(cat "$HERE/verifier_id.txt" 2>/dev/null || true)}"
PROOF="$HERE/proof.json"

[[ -z "$SOURCE" ]]      && { echo "ERROR: set SOURCE=<funded identity>" >&2; exit 1; }
[[ -z "$VERIFIER_ID" ]] && { echo "ERROR: pass VERIFIER_ID or run deploy first" >&2; exit 1; }
[[ -f "$PROOF" ]]       || { echo "ERROR: $PROOF missing — run the host first" >&2; exit 1; }

# Pull hex values out of proof.json without needing jq.
val() { grep -o "\"$1\": *\"[0-9a-fx]*\"" "$PROOF" | head -1 | sed -E 's/.*"([0-9a-fx]*)"$/\1/'; }
SEAL="$(val seal)"
IMAGE_ID="$(val image_id)"
JOURNAL_DIGEST="$(val journal_digest)"

echo "[verify] verifier:        $VERIFIER_ID"
echo "[verify] seal bytes:      $(( ${#SEAL} / 2 ))"
echo "[verify] image_id:        $IMAGE_ID"
echo "[verify] journal_digest:  $JOURNAL_DIGEST"
echo "[verify] invoking verify() on $NETWORK ..."

stellar contract invoke \
  --id "$VERIFIER_ID" \
  --source "$SOURCE" \
  --network "$NETWORK" \
  --send yes \
  -- verify \
  --seal "$SEAL" \
  --image_id "$IMAGE_ID" \
  --journal "$JOURNAL_DIGEST"

echo
echo "[verify] ✅ verify() returned without trapping — the RISC Zero proof is valid on-chain."
