#!/usr/bin/env bash
# e2e relayer-plumbing smoke. Proves the backing daemon + withdrawal server
# against the LIVE testnet using the existing known-good proof artifacts.
# Prereqs: relayer/config.toml present; `cast` (foundry) + `stellar` on PATH;
# a recipient account with a zUSDC trustline; env vars below.
#
#   RECIPIENT   : G... account that holds a zUSDC trustline (mint destination)
#   BASE        : relayer base URL (default http://127.0.0.1:8080)
#
#   RECIPIENT must hold a zUSDC trustline first:
#     stellar tx new change-trust --source-account <RECIPIENT-identity> \
#       --line zUSDC:<issuer-G-address> --network testnet
set -euo pipefail
cd "$(dirname "$0")/../.."   # run from repo root so artifacts/ paths resolve
BASE="${BASE:-http://127.0.0.1:8080}"
RECIPIENT="${RECIPIENT:?set RECIPIENT to a G-address holding a zUSDC trustline}"

echo "== 1. health =="
curl -fsS "$BASE/health" | tee /dev/stderr | grep -q '"status":"ok"'

echo "== 2. path for denom 10 leaf 0 =="
curl -fsS "$BASE/path?denom=10&leaf_index=0" | tee /tmp/path.json

echo "== 3. convert proof + withdraw =="
# Build the withdraw body from the known-good artifacts proof. The artifacts'
# root (0012f4...) must already be anchored on-chain under denom 10, and
# $RECIPIENT must hold a zUSDC trustline (stellar tx new change-trust).
REL=./relayer/target/debug/relayer
BODY=$("$REL" --config relayer/config.toml convert-proof \
  --proof artifacts/circuit/proof.json --public artifacts/circuit/public.json \
  | python3 -c "import sys,json; d=json.load(sys.stdin); d['recipient']='$RECIPIENT'; print(json.dumps(d))")
curl -fsS -X POST "$BASE/withdraw" -H 'content-type: application/json' -d "$BODY" | tee /tmp/withdraw.json

echo "== 4. assert a tx hash came back =="
grep -q '"tx_hash"' /tmp/withdraw.json && echo "SMOKE OK"
