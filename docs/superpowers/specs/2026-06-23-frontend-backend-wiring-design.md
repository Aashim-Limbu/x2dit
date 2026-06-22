# Frontend ↔ Backend Wiring — Design Spec

**Date:** 2026-06-23
**Status:** Approved (design); pending implementation plan
**Scope:** Replace the fully-mocked zk-houdini frontend with real client logic against the live testnet deployment. Full end-to-end: **deposit (Ethereum Sepolia)** and **withdraw (browser ZK proof → relayer → Stellar/Soroban zUSDC mint)**.

---

## 1. Context & current state

The contracts and relayer are **live on testnet** (`deployments/testnet.env`). The frontend (`frontend/`, Next.js 16) is **100% presentation-only mock**: both `/deposit` and `/withdraw` are `setTimeout`-driven state machines with no wallet, no SDKs, no crypto, no HTTP calls. `src/lib/site.ts` holds the real deployed addresses but only for explorer-link chrome.

"Wiring it up" therefore means **building the entire client layer from scratch** against unchanged live contracts and an unchanged relayer.

### Live system facts (load-bearing)

- **EVM (Sepolia, chainId 11155111):**
  - `MockUSDC` `0x1a39a02a3a776b354a5c97373dde715c419c6ab5` — 6 decimals, open `mint(to, amount)` faucet.
  - `PrivacyPoolDeposit` `0x4c781728f3f53f220c6f226610cd24d8b1e8e7ef` — `deposit(uint8 denomIndex, uint256 commitment) returns (uint32 leafIndex)`; emits `Deposit(uint8 indexed denomIndex, uint256 indexed commitment, uint32 leafIndex)` and `RootUpdated(...)`.
  - Denomination **index** {0,1,2} = **value** {1,10,100} USDC; deposit amounts {1e6, 10e6, 100e6}.
- **Stellar (testnet):** Soroban RPC `https://soroban-testnet.stellar.org`, passphrase `Test SDF Network ; September 2015`.
  - Pool `CDFQ5K2BPKB7BWNW2SJPGIIK5OOFQIR434MOX5YYBDKAN3M5CFVJKHR2` — `withdraw(proof, root, nullifier_hash, recipient_fr, recipient, denom)`, `update_root` (relayer-authed), read helpers (`is_known_root`, `is_nullifier_used`, `get_roots`, `get_denom_amount`).
  - Verifier `CBXA7364AEVDQV2Z4CW7IUYSHO7JTETPUR6Y5FET2QAC5GWTNPN3ZGFH`; public input order `[root, nullifierHash, recipient_fr, denomination]`, nPublic=4.
  - zUSDC SAC `CAIUOHVZ77RSCDBNWR3BCZPTWHPUXQRTQXSW4VE3HGC2M5PRPJNSFBRU` — 7 decimals, admin = pool; pool mints on successful withdraw.
  - Pool denom amounts (7 decimals): {1→10000000, 10→100000000, 100→1000000000}.
- **Relayer** (`relayer/`, Rust + axum, default bind `127.0.0.1:8080`, **no CORS**):
  - `GET /health` → `{status, deposit_contract, pool_id, denoms}`
  - `GET /path?denom=<value>&leaf_index=<n>` → `{leaf_index, root, root_hex, path_elements[], path_indices[]}` (DEPTH=20; re-scans Sepolia logs per request).
  - `POST /withdraw` `{proof, root, nullifier_hash, recipient_fr, recipient, denom}` → `{tx_hash}`. `proof` is the `{a,b,c}` JSON serialized to a string; root/nullifier_hash/recipient_fr are hex; `denom` is the **value** (1/10/100). Submits on-chain by shelling out to the `stellar` CLI (needs CLI + funded `bridge-relayer` identity).
  - `convert-proof` exists **CLI-only** (snarkjs `proof.json`+`public.json` → Soroban byte layout) — must be ported to JS for the browser.
  - Backing daemon (`backing`) watches `RootUpdated` and anchors roots into the Soroban pool. Frontend does not touch it, but it **must be running** for a deposited root to become withdrawable.

### Cryptography (from `circuits/src/withdraw.circom`, `circuits/scripts/gen_input.py`, `relayer/src/poseidon.rs`)

- `commitment = Poseidon2(2)([nullifier, secret], dsep=0)` — t=3 sponge.
- `nullifierHash = Poseidon2(1)([nullifier], dsep=0)` — t=2 sponge.
- Merkle node = `PoseidonCompress(l, r) = perm([l,r], 2)[0] + l` — t=2.
- Public input order: `[root, nullifierHash, recipient, denomination]`. The circuit's `recipient` is bound only by a malleability guard (`recipientSq = recipient*recipient`); it is **not** derived from a Stellar address.

### `recipient_fr` ↔ `recipient` — honest limitation

`Pool.withdraw` uses `recipient_fr` directly as public input #3 and **separately** mints to the `recipient` Address. There is **no on-chain binding** between them — the relayer is trusted not to swap the payout address. This matches the documented 1-of-1 relayer trust assumption. We **surface the limitation in the UI**, and derive `recipient_fr` deterministically from the recipient G-address (best-effort intent binding):

> `recipient_fr = be_int(ed25519_pubkey_bytes(G-address)) mod P`, where the G-address strkey-decodes to a 32-byte ed25519 public key and `P` is the BN254 scalar field. Deterministic, reproducible, and a valid field element (`< P`). The exact function only needs to be stable — the contract does not enforce it — so this choice is for reproducibility, not security.

### Proving artifacts (browser-shippable, already built)

`artifacts/circuit/withdraw.wasm` (347 KB), `artifacts/circuit/withdraw_final.zkey` (4.3 MB), `artifacts/circuit/verification_key.json`. snarkjs `groth16.fullProve` runs client-side → **the secret never leaves the browser**, satisfying the product's core privacy claim.

---

## 2. Decisions (confirmed)

- **Scope:** Full e2e — deposit + withdraw, sequenced infra → deposit → withdraw.
- **Recipient:** Connect Stellar wallet (Freighter via Stellar Wallets Kit); read G-address and help add the zUSDC trustline in-flow.
- **EVM wallet lib:** `viem` + injected connector (no wagmi/RainbowKit — single chain, single approve+deposit).
- **Relayer access:** Next.js Route Handler proxy (`/api/relayer/*`) → `RELAYER_URL` server env. Relayer stays loopback; no CORS added to Rust.
- **Faucet:** Include a "Get test USDC" affordance (`MockUSDC.mint`).
- **Proving:** In-browser snarkjs with artifacts served from `public/`.

---

## 3. Module architecture

Each module has one purpose, a typed interface, and is independently testable.

| Module | Responsibility | Depends on |
|---|---|---|
| `src/lib/config.ts` | Addresses, chainId, RPC URLs, denom value↔index map; reads optional env overrides. Extends/absorbs `site.ts` display constants. | — |
| `src/lib/crypto/poseidon2.ts` | Poseidon2 permutation + `hash2`/`hash1`/`compress` (t=2, t=3). **Pure.** | — |
| `src/lib/crypto/note.ts` | CSPRNG `secret`/`nullifier` (`crypto.getRandomValues`), `commitment`, `nullifierHash`, versioned note encode/decode + validation. **Pure.** | poseidon2 |
| `src/lib/evm/client.ts` | viem public + wallet clients (Sepolia); chain ensure/switch. | viem, config |
| `src/lib/evm/abis.ts` | Minimal ABIs: MockUSDC (`mint`, `approve`, `allowance`, `balanceOf`), PrivacyPoolDeposit (`deposit`, `Deposit` event). | — |
| `src/lib/evm/deposit.ts` | faucet → approve (if needed) → deposit → parse `Deposit` event → `leafIndex`. | client, abis |
| `src/lib/stellar/wallet.ts` | Stellar Wallets Kit (Freighter) connect; recipient G-address. | stellar-wallets-kit |
| `src/lib/stellar/trustline.ts` | Check zUSDC trustline; build + sign `changeTrust` via stellar-sdk + Soroban/Horizon. | stellar-sdk, config |
| `src/lib/proof/recipient.ts` | Derive `recipient_fr` (field element) from G-address, deterministic. | poseidon2/hash util |
| `src/lib/proof/prove.ts` | Lazy snarkjs `groth16.fullProve`; optional local verify with VK. | snarkjs (dynamic) |
| `src/lib/proof/proofconv.ts` | Port of `relayer/src/proofconv.rs`: snarkjs proof+public → `{proofString, root_hex, nullifier_hash_hex, recipient_fr_hex, denom}`. | — |
| `src/lib/relayer/client.ts` | Typed `health()`, `path(denom, leafIndex)`, `withdraw(body)` → calls same-origin `/api/relayer/*`. | — |
| `src/app/api/relayer/[...path]/route.ts` | Server proxy → `RELAYER_URL`. | — |

**Static assets:** copy `withdraw.wasm`, `withdraw_final.zkey`, `verification_key.json` into `frontend/public/circuit/` (lazy-fetched on withdraw only).

**Wiring into existing UI:** keep all components/animations. Replace the mock handlers:
- `src/app/deposit/page.tsx`: `connect()`, `lock()`, `makeMockNote()`, `onVanished()` → real async logic; gate "sealed" on tx confirmation.
- `src/components/site/withdraw/withdraw-flow.tsx`: `onValidate`, `onProve`, `connectFreighter`, `onReveal` → real logic.
- `src/components/site/wallet-status.tsx`: real EVM + Stellar connection state.

---

## 4. Data flows

### Deposit
1. Connect injected EVM wallet → ensure/switch to Sepolia.
2. Pick denom (1/10/100) → `{value, index}`.
3. *(Optional)* Faucet: `MockUSDC.mint(account, amount)`.
4. Generate `secret`, `nullifier` (CSPRNG); `commitment = Poseidon2(2)(nullifier, secret)`.
5. `MockUSDC.approve(pool, amount)` if `allowance < amount`.
6. `PrivacyPoolDeposit.deposit(denomIndex, commitment)` → await receipt → parse `Deposit` → `leafIndex`.
7. Encode note `{v, denom value, secret, nullifier, leafIndex}`; show/download/copy via existing card. **"Sealed" gates on real confirmation.**
8. Honest status: "Deposited on Sepolia. Withdrawable on Stellar once the relayer anchors the new root."

### Withdraw
1. Paste note → decode `{denom, secret, nullifier, leafIndex}`; recompute `commitment`, `nullifierHash`.
2. Connect Freighter → recipient G-address; check zUSDC trustline, offer `changeTrust`.
3. Derive `recipient_fr` from G-address.
4. `GET /path?denom=<value>&leaf_index=<leafIndex>` → `{root, path_elements, path_indices}`.
5. Build circuit input `{secret, nullifier, pathElements, pathIndices, root, nullifierHash, recipient: recipient_fr, denomination: value}`.
6. `groth16.fullProve(input, withdraw.wasm, withdraw_final.zkey)` → `{proof, publicSignals}`; optional local VK verify.
7. `proofconv(proof, publicSignals)` → `{proofString, root_hex, nullifier_hash_hex, recipient_fr_hex, denom}`.
8. `POST /withdraw {proof, root, nullifier_hash, recipient_fr, recipient: G-address, denom}` → `{tx_hash}`.
9. Reveal zUSDC mint (stellar.expert link via existing reveal UI).

---

## 5. Hard parts & risks

1. **Byte-exact JS Poseidon2 (keystone).** Port permutation + constants from `poseidon2_const.circom` / `poseidon.rs`. Lock with a vitest suite asserting `commitment`/`nullifierHash`/`compress` equal `gen_input.py` and `circuits/build/input.json` outputs **before** anything builds on top.
2. **snarkjs in Next 16 / browser.** Serve wasm+zkey from `public/`; lazy + dynamic-import snarkjs to avoid node-polyfill bundling; verify locally with VK. Risk: bundler quirks — isolate in a client-only module.
3. **Operational e2e dependency.** Live withdraw requires relayer `serve` + `backing` daemon + `stellar` CLI + funded `bridge-relayer` identity so the deposited root is anchored before proving. Provide a runbook; map `/withdraw` `UnknownRoot` → friendly "waiting for relayer to anchor."

---

## 6. Error handling

Real states replace every fake timer:
- **Wallet:** not installed, wrong chain, user rejected, insufficient balance/allowance.
- **Deposit:** tx revert, `Deposit` event parse failure.
- **Note:** malformed / wrong version / failed decode (with validation).
- **Trustline:** missing / can't add.
- **/path:** 502 (RPC), leaf not yet indexed.
- **Proof:** `fullProve` failure (bad input), artifact load failure.
- **Contract:** `UnknownRoot` (root not anchored yet), `NullifierAlreadyUsed` (already withdrawn), `InvalidProof`, relayer 502 (stellar CLI) → friendly messages.
- `prefers-reduced-motion` preserved throughout (animations cosmetic, not state-of-record).

---

## 7. Testing

- **Vitest (unit):** Poseidon2 vectors (keystone); note encode/decode round-trip; `proofconv` vs `artifacts/circuit/proof.json`+`public.json` (compare to `relayer convert-proof` output); `recipient_fr` determinism.
- **Integration:** `fullProve(circuits/build/input.json)` produces a proof that verifies against `verification_key.json` — proves the browser proving path without chains.
- **Manual e2e runbook:** start `relayer serve` + `backing`; faucet → deposit → wait for anchor → withdraw → confirm zUSDC mint. Verification-before-done.

---

## 8. Honest limitations surfaced in UI

- `recipient_fr` ↔ `recipient` not cryptographically bound on-chain (relayer trusted not to swap payout).
- Single-relayer backing/solvency (1-of-1 key).
- Testnet only, unaudited prototype — never framed as securing real funds.

---

## 9. Build sequence (→ implementation plan)

- **A — Shared infra:** config/env, proxy route, poseidon2 + note + tests, viem client + ABIs, relayer client, stellar connector scaffold, copy artifacts to `public/`.
- **B — Deposit wiring:** real wallet + faucet + approve + deposit + note in `deposit/page.tsx`.
- **C — Withdraw wiring:** note decode + Freighter + trustline + `/path` + snarkjs + proofconv + `/withdraw` + reveal in `withdraw-flow.tsx`.
- **D — Polish:** honest-status reads, error/loading states, reduced-motion pass, e2e runbook.

---

## 10. New dependencies

`viem`, `@stellar/stellar-sdk`, `@creit.tech/stellar-wallets-kit`, `snarkjs`. (Dev: ensure `vitest` is available for the crypto tests.)
