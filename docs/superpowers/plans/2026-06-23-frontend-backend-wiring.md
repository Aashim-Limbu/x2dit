# Frontend ↔ Backend Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fully-mocked zk-houdini frontend with real client logic so a user can deposit test-USDC on Ethereum Sepolia and privately withdraw zUSDC on Stellar via a browser-generated Groth16 proof.

**Architecture:** Add a client layer (`src/lib/*`) the mock never had — byte-exact Poseidon2, note codec, viem EVM deposit, snarkjs in-browser proving, a JS port of the relayer's `convert-proof`, a Freighter/trustline layer, and a typed relayer client that reaches the loopback relayer through a same-origin Next.js proxy route. The live contracts and the Rust relayer are unchanged; we only build the missing client.

**Tech Stack:** Next.js 16.2.9 (modified — see Global Constraints), React 19, TypeScript, viem (EVM), `@stellar/stellar-sdk` + `@creit.tech/stellar-wallets-kit` (Stellar/Freighter), snarkjs (Groth16), vitest (tests).

## Global Constraints

- **Modified Next.js:** `frontend/AGENTS.md` says "This is NOT the Next.js you know." Before writing/modifying any Next.js-specific code (route handlers, config), read the relevant guide in `frontend/node_modules/next/dist/docs/`. Heed deprecation notices.
- **BN254 scalar field** `P = 21888242871839275222246405745257275088548364400416034343698204186575808495617`. All field math is `mod P`.
- **Crypto definitions (must be byte-identical to circuit):** `commitment = Poseidon2(2)([nullifier, secret], dsep=0)` (t=3 sponge); `nullifierHash = Poseidon2(1)([nullifier], dsep=0)` (t=2 sponge); Merkle node `compress(l,r) = perm([l,r],2)[0] + l` (t=2).
- **Public input order:** `[root, nullifierHash, recipient_fr, denomination]`.
- **Denomination:** EVM `deposit` uses **index** {0,1,2}; pool/circuit/relayer use **value** {1,10,100}. USDC has 6 decimals (amount = value × 1e6).
- **`/withdraw` body:** `{ proof: string, root: string, nullifier_hash: string, recipient_fr: string, recipient: string, denom: number }` where `proof` is `JSON.stringify({a,b,c})` with a/b/c bare lowercase hex (lengths 128/256/128), and root/nullifier_hash/recipient_fr are bare 64-char hex (no `0x`).
- **Relayer is loopback + no CORS:** browser must call same-origin `/api/relayer/*`; the Next route proxies to `RELAYER_URL` (server env, default `http://127.0.0.1:8080`).
- **Honesty (PRODUCT.md):** never claim more privacy/safety than is real; testnet only; surface the 1-of-1 relayer trust and the unbound `recipient_fr`↔`recipient`.
- **Commit hygiene:** stage explicit files (never `git add -A`/`-am`). Work on branch `feat/frontend-wiring`.
- All commands below run from `frontend/` unless an absolute/repo-root path is shown.

## File Structure

**Create:**
- `frontend/vitest.config.ts` — vitest (node env for lib tests).
- `frontend/src/types/snarkjs.d.ts` — module declaration for snarkjs.
- `frontend/src/lib/config.ts` — addresses, chainId, denom maps, field P, env overrides.
- `frontend/scripts/gen-poseidon-constants.mjs` — parse circom const file → TS module.
- `frontend/src/lib/crypto/poseidon2-constants.ts` — **generated** round constants (t=2, t=3).
- `frontend/src/lib/crypto/poseidon2.ts` — permutation, compress, hash2, hash1, field helpers.
- `frontend/src/lib/crypto/note.ts` — secret/nullifier gen, commitment, nullifierHash, note encode/decode.
- `frontend/src/lib/proof/proofconv.ts` — port of `relayer/src/proofconv.rs`.
- `frontend/src/lib/proof/recipient.ts` — `recipient_fr` from G-address.
- `frontend/src/lib/proof/prove.ts` — snarkjs `groth16.fullProve` wrapper (lazy).
- `frontend/scripts/copy-circuit-artifacts.mjs` — copy wasm/zkey/vk into `public/circuit/`.
- `frontend/src/lib/relayer/client.ts` — typed `/health`, `/path`, `/withdraw` client.
- `frontend/src/app/api/relayer/[...path]/route.ts` — same-origin proxy to `RELAYER_URL`.
- `frontend/src/lib/evm/abis.ts` — MockUSDC + PrivacyPoolDeposit ABI fragments.
- `frontend/src/lib/evm/client.ts` — viem clients + connect + chain-ensure.
- `frontend/src/lib/evm/deposit.ts` — faucet/approve/deposit + parse `leafIndex`.
- `frontend/src/lib/stellar/wallet.ts` — Wallets Kit / Freighter connect.
- `frontend/src/lib/stellar/trustline.ts` — zUSDC trustline check/add.
- `frontend/src/lib/withdraw/run.ts` — orchestrates note→path→prove→proofconv→submit.
- Test files mirror each module under the same dir with `.test.ts`.
- `docs/RUNBOOK-e2e.md` — operational e2e runbook.

**Modify:**
- `frontend/package.json` — deps + `test`/`gen:constants`/`copy:circuit` scripts + dev/build hooks.
- `frontend/src/lib/site.ts` — re-export from `config.ts` (keep existing import paths working).
- `frontend/src/app/deposit/page.tsx` — real connect/lock/note/sealed.
- `frontend/src/components/site/withdraw/withdraw-flow.tsx` — real validate/prove/connect/reveal.
- `frontend/src/components/site/wallet-status.tsx` — real EVM + Stellar state.
- `frontend/.gitignore` — ignore `public/circuit/`.

---

## Phase A — Shared infrastructure

### Task 1 (A1): Test harness + dependencies

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/vitest.config.ts`, `frontend/src/types/snarkjs.d.ts`, `frontend/src/lib/sanity.test.ts`

**Interfaces:**
- Produces: a working `npm test` (vitest) command for all later tasks.

- [ ] **Step 1: Install dependencies**

```bash
cd frontend
npm install viem @stellar/stellar-sdk @creit.tech/stellar-wallets-kit snarkjs
npm install -D vitest
```

- [ ] **Step 2: Add scripts to `package.json`**

Set the `scripts` block to:

```json
"scripts": {
  "dev": "node scripts/copy-circuit-artifacts.mjs && next dev",
  "build": "node scripts/copy-circuit-artifacts.mjs && next build",
  "start": "next start",
  "lint": "eslint",
  "test": "vitest run",
  "gen:constants": "node scripts/gen-poseidon-constants.mjs",
  "copy:circuit": "node scripts/copy-circuit-artifacts.mjs"
}
```

(The `copy-circuit-artifacts.mjs` script is created in Task A9; it must be a no-op-safe script. If running `dev`/`build` before A9, create an empty placeholder that exits 0 — but per task order A9 precedes any `dev` run.)

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // snarkjs proving is single-threaded + heavy; avoid worker pool surprises.
    pool: "forks",
    testTimeout: 120_000,
  },
});
```

- [ ] **Step 4: Create `src/types/snarkjs.d.ts`**

```ts
declare module "snarkjs" {
  export const groth16: {
    fullProve(
      input: Record<string, unknown>,
      wasm: string | Uint8Array,
      zkey: string | Uint8Array,
    ): Promise<{ proof: unknown; publicSignals: string[] }>;
    verify(vk: unknown, publicSignals: string[], proof: unknown): Promise<boolean>;
  };
}
```

- [ ] **Step 5: Create sanity test `src/lib/sanity.test.ts`**

```ts
import { test, expect } from "vitest";

test("vitest runs", () => {
  expect(1 + 1).toBe(2);
});
```

- [ ] **Step 6: Run tests**

Run: `cd frontend && npm test`
Expected: PASS (1 test).

- [ ] **Step 7: Commit**

```bash
cd /home/aashim/hackathon/stellar-hacks
git add frontend/package.json frontend/package-lock.json frontend/vitest.config.ts frontend/src/types/snarkjs.d.ts frontend/src/lib/sanity.test.ts
git commit -m "chore(frontend): add vitest + viem/stellar/snarkjs deps"
```

---

### Task 2 (A2): Config module

**Files:**
- Create: `frontend/src/lib/config.ts`, `frontend/src/lib/config.test.ts`
- Modify: `frontend/src/lib/site.ts`

**Interfaces:**
- Produces:
  - `FIELD: bigint`
  - `EVM`, `STELLAR` (objects; superset of current `site.ts`), `DENOMS`
  - `EVM.mockUsdc: string`, `EVM.rpcFallback: string`
  - `DENOM_VALUES: readonly [1,10,100]`
  - `denomIndex(value: number): number` (0/1/2; throws on unknown)
  - `denomAmountUsdc(value: number): bigint` (value × 1_000_000n)
  - `relayerPath(suffix: string): string` → `/api/relayer/${suffix}`
  - `etherscan`, `stellarExpert`, `truncate` (unchanged behavior)

- [ ] **Step 1: Write failing test `src/lib/config.test.ts`**

```ts
import { test, expect } from "vitest";
import {
  FIELD, denomIndex, denomAmountUsdc, DENOM_VALUES, relayerPath, EVM,
} from "./config";

test("field modulus is BN254 scalar field", () => {
  expect(FIELD).toBe(
    21888242871839275222246405745257275088548364400416034343698204186575808495617n,
  );
});

test("denom value maps to EVM index", () => {
  expect(DENOM_VALUES).toEqual([1, 10, 100]);
  expect(denomIndex(1)).toBe(0);
  expect(denomIndex(10)).toBe(1);
  expect(denomIndex(100)).toBe(2);
  expect(() => denomIndex(5)).toThrow();
});

test("denom amount is 6-decimal USDC", () => {
  expect(denomAmountUsdc(1)).toBe(1_000_000n);
  expect(denomAmountUsdc(100)).toBe(100_000_000n);
});

test("relayer path is same-origin proxied", () => {
  expect(relayerPath("path?denom=10&leaf_index=0")).toBe(
    "/api/relayer/path?denom=10&leaf_index=0",
  );
});

test("mockUsdc address present", () => {
  expect(EVM.mockUsdc.toLowerCase()).toBe(
    "0x1a39a02a3a776b354a5c97373dde715c419c6ab5",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- config`
Expected: FAIL (cannot find `./config`).

- [ ] **Step 3: Write `src/lib/config.ts`**

```ts
// Real, public testnet deployment facts. Source of truth: deployments/testnet.env.
export const REPO_URL = "https://github.com/Aashim-Limbu/zk-houdini";

export const FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export const EVM = {
  chainId: 11155111,
  name: "Ethereum Sepolia",
  short: "Sepolia",
  pool: "0x4c781728f3f53f220c6f226610cd24d8b1e8e7ef",
  mockUsdc: "0x1a39a02a3a776b354a5c97373dde715c419c6ab5",
  deployBlock: 11089276,
  // Read-only fallback RPC; reads normally go through the injected wallet.
  rpcFallback:
    process.env.NEXT_PUBLIC_SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com",
} as const;

export const STELLAR = {
  name: "Stellar Testnet",
  short: "Stellar",
  passphrase: "Test SDF Network ; September 2015",
  rpcUrl: process.env.NEXT_PUBLIC_SOROBAN_RPC ?? "https://soroban-testnet.stellar.org",
  horizonUrl: "https://horizon-testnet.stellar.org",
  pool: "CDFQ5K2BPKB7BWNW2SJPGIIK5OOFQIR434MOX5YYBDKAN3M5CFVJKHR2",
  verifier: "CBXA7364AEVDQV2Z4CW7IUYSHO7JTETPUR6Y5FET2QAC5GWTNPN3ZGFH",
  zusdcSac: "CAIUOHVZ77RSCDBNWR3BCZPTWHPUXQRTQXSW4VE3HGC2M5PRPJNSFBRU",
  // zUSDC classic asset for trustlines: code + issuer (deployments/testnet.env).
  zusdcCode: "zUSDC",
  zusdcIssuer: "GAA3S6XLOKFX3SGDQ3VGLLXMCFMVB7E6WYNGHRGIRD62AEJ73ASPQ4KX",
} as const;

export const DENOM_VALUES = [1, 10, 100] as const;
export type DenomValue = (typeof DENOM_VALUES)[number];

export const DENOMS = [
  { value: 1, label: "1 USDC" },
  { value: 10, label: "10 USDC" },
  { value: 100, label: "100 USDC" },
] as const;

export function denomIndex(value: number): number {
  const i = DENOM_VALUES.indexOf(value as DenomValue);
  if (i < 0) throw new Error(`unknown denomination: ${value}`);
  return i;
}

export function denomAmountUsdc(value: number): bigint {
  denomIndex(value); // validate
  return BigInt(value) * 1_000_000n;
}

export function relayerPath(suffix: string): string {
  return `/api/relayer/${suffix}`;
}

export const etherscan = {
  address: (a: string) => `https://sepolia.etherscan.io/address/${a}`,
  tx: (h: string) => `https://sepolia.etherscan.io/tx/${h}`,
};

export const stellarExpert = {
  contract: (c: string) => `https://stellar.expert/explorer/testnet/contract/${c}`,
  tx: (h: string) => `https://stellar.expert/explorer/testnet/tx/${h}`,
  account: (a: string) => `https://stellar.expert/explorer/testnet/account/${a}`,
};

export function truncate(id: string, head = 6, tail = 4): string {
  if (id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}
```

- [ ] **Step 4: Re-point `src/lib/site.ts` to config (keep existing imports working)**

Replace the entire contents of `src/lib/site.ts` with:

```ts
// Back-compat re-export. Canonical source is ./config.
export * from "./config";
```

- [ ] **Step 5: Run tests**

Run: `cd frontend && npm test -- config`
Expected: PASS (5 tests). Also run `npm run lint` — expect no new errors.

- [ ] **Step 6: Commit**

```bash
cd /home/aashim/hackathon/stellar-hacks
git add frontend/src/lib/config.ts frontend/src/lib/config.test.ts frontend/src/lib/site.ts
git commit -m "feat(frontend): config module with addresses, denom maps, field P"
```

---

### Task 3 (A3): Generate Poseidon2 constants

**Files:**
- Create: `frontend/scripts/gen-poseidon-constants.mjs`, `frontend/src/lib/crypto/poseidon2-constants.ts` (generated), `frontend/src/lib/crypto/poseidon2-constants.test.ts`

**Interfaces:**
- Produces (from `poseidon2-constants.ts`):
  - `FULL_ROUNDS: Record<2 | 3, bigint[][]>` — 8 rows × t each
  - `PARTIAL_ROUNDS: Record<2 | 3, bigint[]>`
  - `INTERNAL_DIAG: Record<2 | 3, bigint[]>` — length t

- [ ] **Step 1: Write the generator `scripts/gen-poseidon-constants.mjs`**

This mirrors `circuits/scripts/gen_input.py`'s `branch()` slicing exactly (validated source of truth).

```js
// Parse circuits/src/poseidon2/poseidon2_const.circom into a TS constants module.
// Mirrors circuits/scripts/gen_input.py branch() slicing exactly.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONST = path.resolve(
  __dirname,
  "../../circuits/src/poseidon2/poseidon2_const.circom",
);
const OUT = path.resolve(__dirname, "../src/lib/crypto/poseidon2-constants.ts");

const src = fs.readFileSync(CONST, "utf8");

function branch(fn, t) {
  let s = src.slice(src.indexOf("function " + fn));
  s = s.slice(s.indexOf("t==" + t));
  const nxt = s.indexOf("t==" + (t + 1));
  if (nxt !== -1) s = s.slice(0, nxt);
  return [...s.matchAll(/0x[0-9a-fA-F]+/g)].map((m) => BigInt(m[0]));
}

function build(t) {
  const fr = branch("POSEIDON_FULL_ROUNDS", t); // expect 8*t
  const pr = branch("POSEIDON_PARTIAL_ROUNDS", t);
  const diag = branch("POSEIDON_INTERNAL_MAT_DIAG", t); // expect t
  if (fr.length !== 8 * t) throw new Error(`t=${t} full rounds: got ${fr.length}, want ${8 * t}`);
  if (diag.length !== t) throw new Error(`t=${t} diag: got ${diag.length}, want ${t}`);
  const full = [];
  for (let i = 0; i < 8; i++) full.push(fr.slice(i * t, (i + 1) * t));
  return { full, partial: pr, diag };
}

const t2 = build(2);
const t3 = build(3);

const lit = (arr) => `[${arr.map((x) => `${x}n`).join(", ")}]`;
const mat = (rows) => `[${rows.map(lit).join(", ")}]`;

const out = `// GENERATED by scripts/gen-poseidon-constants.mjs — do not edit.
// Source: circuits/src/poseidon2/poseidon2_const.circom (validated against gen_input.py).
export const FULL_ROUNDS: Record<2 | 3, bigint[][]> = {
  2: ${mat(t2.full)},
  3: ${mat(t3.full)},
};
export const PARTIAL_ROUNDS: Record<2 | 3, bigint[]> = {
  2: ${lit(t2.partial)},
  3: ${lit(t3.partial)},
};
export const INTERNAL_DIAG: Record<2 | 3, bigint[]> = {
  2: ${lit(t2.diag)},
  3: ${lit(t3.diag)},
};
`;
fs.writeFileSync(OUT, out);
console.log(
  `wrote ${OUT}: t2(partial=${t2.partial.length}) t3(partial=${t3.partial.length})`,
);
```

- [ ] **Step 2: Run the generator**

Run: `cd frontend && npm run gen:constants`
Expected: prints `wrote .../poseidon2-constants.ts: t2(partial=56) t3(partial=56)` (partial counts may differ — that's fine; the keystone test in Task A4 is the real check).

- [ ] **Step 3: Write test `src/lib/crypto/poseidon2-constants.test.ts`**

```ts
import { test, expect } from "vitest";
import { FULL_ROUNDS, PARTIAL_ROUNDS, INTERNAL_DIAG } from "./poseidon2-constants";

test("t=2 constant shapes", () => {
  expect(FULL_ROUNDS[2]).toHaveLength(8);
  FULL_ROUNDS[2].forEach((row) => expect(row).toHaveLength(2));
  expect(INTERNAL_DIAG[2]).toHaveLength(2);
  expect(PARTIAL_ROUNDS[2].length).toBeGreaterThan(0);
});

test("t=3 constant shapes", () => {
  expect(FULL_ROUNDS[3]).toHaveLength(8);
  FULL_ROUNDS[3].forEach((row) => expect(row).toHaveLength(3));
  expect(INTERNAL_DIAG[3]).toHaveLength(3);
  expect(PARTIAL_ROUNDS[3].length).toBeGreaterThan(0);
});
```

- [ ] **Step 4: Run test**

Run: `cd frontend && npm test -- poseidon2-constants`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/aashim/hackathon/stellar-hacks
git add frontend/scripts/gen-poseidon-constants.mjs frontend/src/lib/crypto/poseidon2-constants.ts frontend/src/lib/crypto/poseidon2-constants.test.ts
git commit -m "feat(frontend): generate Poseidon2 round constants from circom"
```

---

### Task 4 (A4): Poseidon2 hash (KEYSTONE)

**Files:**
- Create: `frontend/src/lib/crypto/poseidon2.ts`, `frontend/src/lib/crypto/poseidon2.test.ts`

**Interfaces:**
- Consumes: `FULL_ROUNDS`, `PARTIAL_ROUNDS`, `INTERNAL_DIAG` (Task A3); `FIELD` (Task A2).
- Produces:
  - `permutation(state: bigint[]): bigint[]`
  - `compress(l: bigint, r: bigint): bigint`
  - `hash2(nullifier: bigint, secret: bigint): bigint`
  - `hash1(nullifier: bigint): bigint`
  - `toBe32Hex(x: bigint): string` (64 hex, no `0x`)
  - `fromHex(h: string): bigint`

- [ ] **Step 1: Write the keystone test `src/lib/crypto/poseidon2.test.ts`**

Vectors from `gen_input.py` (nullifier=12345, secret=67890) and `circuits/build/input.json` (the full Merkle fold to `root`, all pathIndices = 0).

```ts
import { test, expect } from "vitest";
import { hash1, hash2, compress, toBe32Hex } from "./poseidon2";

const NULLIFIER = 12345n;
const SECRET = 67890n;

// gen_input.py: commitment = hash2(nullifier, secret)
const COMMITMENT_HEX =
  "1d0760f24738a6e3c3ae24dab1f88cb10420850782c407eaa41f95310f445996";
// gen_input.py: nullifierHash = hash1(nullifier)
const NULLIFIER_HASH_HEX =
  "0750bb23dba2ab2e1f42e914eb8582103d00e462df6864ecec9646ce61311b2b";
// circuits/build/input.json root (commitment folded with pathElements, all indices 0)
const ROOT_DEC =
  "33487828945165570647491552080944375832498357347009638406391689166580451028";
const PATH_ELEMENTS = [
  "0",
  "15621590199821056450610068202457788725601603091791048810523422053872049975191",
  "15180302612178352054084191513289999058431498575847349863917170755410077436260",
  "20846426933296943402289409165716903143674406371782261099735847433924593192150",
  "19570709311100149041770094415303300085749902031216638721752284824736726831172",
  "11737142173000203701607979434185548337265641794352013537668027209469132654026",
  "11865865012735342650993929214218361747705569437250152833912362711743119784159",
  "1493463551715988755902230605042557878234810673525086316376178495918903796315",
  "18746103596419850001763894956142528089435746267438407061601783590659355049966",
  "21234194473503024590374857258930930634542887619436018385581872843343250130100",
  "14681119568252857310414189897145410009875739166689283501408363922419813627484",
  "13243470632183094581890559006623686685113540193867211988709619438324105679244",
  "19463898140191333844443019106944343282402694318119383727674782613189581590092",
  "10565902370220049529800497209344287504121041033501189980624875736992201671117",
  "5560307625408070902174028041423028597194394554482880015024167821933869023078",
  "20576730574720116265513866548855226316241518026808984067485384181494744706390",
  "11166760821615661136366651998133963805984915741187325490784169611245269155689",
  "13692603500396323648417392244466291089928913430742736835590182936663435788822",
  "11129674755567463025028188404867541558752927519269975708924528737249823830641",
  "6673535049007525806710184801639542254440636510496168661971704157154828514023",
].map((s) => BigInt(s));

test("hash2 matches gen_input.py commitment", () => {
  expect(toBe32Hex(hash2(NULLIFIER, SECRET))).toBe(COMMITMENT_HEX);
});

test("hash1 matches gen_input.py nullifierHash", () => {
  expect(toBe32Hex(hash1(NULLIFIER))).toBe(NULLIFIER_HASH_HEX);
});

test("compress + hash2 fold to the real Merkle root", () => {
  let node = hash2(NULLIFIER, SECRET); // leaf = commitment
  for (const sibling of PATH_ELEMENTS) {
    node = compress(node, sibling); // all pathIndices == 0 => current is left
  }
  expect(node).toBe(BigInt(ROOT_DEC));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- poseidon2.test`
Expected: FAIL (cannot find `./poseidon2`).

- [ ] **Step 3: Write `src/lib/crypto/poseidon2.ts`**

Algorithm mirrors `gen_input.py` (`perm`/`ext`/`intl`/`sb`) exactly.

```ts
import { FIELD } from "../config";
import { FULL_ROUNDS, PARTIAL_ROUNDS, INTERNAL_DIAG } from "./poseidon2-constants";

function mod(x: bigint): bigint {
  const r = x % FIELD;
  return r >= 0n ? r : r + FIELD;
}

function sbox(x: bigint): bigint {
  const x2 = mod(x * x);
  const x4 = mod(x2 * x2);
  return mod(x4 * x); // x^5
}

// External (full) matrix: out[i] = sum(state) + state[i].
function ext(s: bigint[]): bigint[] {
  const tot = mod(s.reduce((a, b) => a + b, 0n));
  return s.map((x) => mod(tot + x));
}

// Internal (partial) matrix: out[j] = state[j]*diag[j] + sum(state).
function intl(s: bigint[], diag: bigint[]): bigint[] {
  const tot = mod(s.reduce((a, b) => a + b, 0n));
  return s.map((x, j) => mod(x * diag[j] + tot));
}

export function permutation(input: bigint[]): bigint[] {
  const t = input.length as 2 | 3;
  const full = FULL_ROUNDS[t];
  const partial = PARTIAL_ROUNDS[t];
  const diag = INTERNAL_DIAG[t];
  if (!full || !partial || !diag) throw new Error(`no constants for t=${t}`);
  const rf = full.length; // 8
  const half = rf / 2;

  let s = input.map(mod);
  s = ext(s); // initial linear layer
  for (let i = 0; i < half; i++) {
    s = s.map((x, j) => sbox(mod(x + full[i][j])));
    s = ext(s);
  }
  for (let i = 0; i < partial.length; i++) {
    s[0] = sbox(mod(s[0] + partial[i]));
    s = intl(s, diag);
  }
  for (let i = half; i < rf; i++) {
    s = s.map((x, j) => sbox(mod(x + full[i][j])));
    s = ext(s);
  }
  return s;
}

export const compress = (l: bigint, r: bigint): bigint =>
  mod(permutation([l, r])[0] + l);

export const hash2 = (nullifier: bigint, secret: bigint): bigint =>
  permutation([nullifier, secret, 0n])[0];

export const hash1 = (nullifier: bigint): bigint =>
  permutation([nullifier, 0n])[0];

export function toBe32Hex(x: bigint): string {
  return mod(x).toString(16).padStart(64, "0");
}

export function fromHex(h: string): bigint {
  return BigInt(h.startsWith("0x") ? h : `0x${h}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- poseidon2.test`
Expected: PASS (3 tests). **If the Merkle-fold test fails, the constants or algorithm are wrong — stop and fix before proceeding; everything downstream depends on this.**

- [ ] **Step 5: Commit**

```bash
cd /home/aashim/hackathon/stellar-hacks
git add frontend/src/lib/crypto/poseidon2.ts frontend/src/lib/crypto/poseidon2.test.ts
git commit -m "feat(frontend): byte-exact Poseidon2 (keystone), verified vs circuit vectors"
```

---

### Task 5 (A5): Note codec

**Files:**
- Create: `frontend/src/lib/crypto/note.ts`, `frontend/src/lib/crypto/note.test.ts`

**Interfaces:**
- Consumes: `hash2`, `hash1`, `toBe32Hex`, `fromHex` (A4); `FIELD`, `denomIndex` (A2).
- Produces:
  - `type Note = { denom: number; secret: bigint; nullifier: bigint; leafIndex: number }`
  - `randomFieldElement(): bigint`
  - `newNoteSecrets(): { secret: bigint; nullifier: bigint }`
  - `commitmentOf(n: { secret: bigint; nullifier: bigint }): bigint`
  - `nullifierHashOf(n: { nullifier: bigint }): bigint`
  - `encodeNote(n: Note): string` → `zkh-note-v2:<denom>:<secret64hex>:<nullifier64hex>:<leafIndex>`
  - `decodeNote(s: string): Note` (throws `Error("invalid note")` on any malformed input)
  - `NOTE_PREFIX = "zkh-note-v2:"`

- [ ] **Step 1: Write failing test `src/lib/crypto/note.test.ts`**

```ts
import { test, expect } from "vitest";
import {
  encodeNote, decodeNote, commitmentOf, randomFieldElement, NOTE_PREFIX,
} from "./note";
import { FIELD } from "../config";
import { hash2, toBe32Hex } from "./poseidon2";

test("encode/decode round-trips", () => {
  const note = { denom: 10, secret: 67890n, nullifier: 12345n, leafIndex: 7 };
  const enc = encodeNote(note);
  expect(enc.startsWith(NOTE_PREFIX)).toBe(true);
  expect(decodeNote(enc)).toEqual(note);
});

test("commitmentOf equals Poseidon2 hash2", () => {
  const note = { secret: 67890n, nullifier: 12345n };
  expect(toBe32Hex(commitmentOf(note))).toBe(toBe32Hex(hash2(12345n, 67890n)));
});

test("decodeNote rejects garbage and wrong prefix", () => {
  expect(() => decodeNote("not-a-note")).toThrow();
  expect(() => decodeNote("zkh-note-v1:10:ab:cd:0")).toThrow();
  expect(() => decodeNote("zkh-note-v2:7:ab:cd:0")).toThrow(); // denom 7 invalid
});

test("randomFieldElement is in range", () => {
  for (let i = 0; i < 50; i++) {
    const x = randomFieldElement();
    expect(x).toBeGreaterThanOrEqual(0n);
    expect(x).toBeLessThan(FIELD);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- note.test`
Expected: FAIL (cannot find `./note`).

- [ ] **Step 3: Write `src/lib/crypto/note.ts`**

```ts
import { FIELD, denomIndex } from "../config";
import { hash2, hash1, toBe32Hex, fromHex } from "./poseidon2";

export const NOTE_PREFIX = "zkh-note-v2:";

export type Note = {
  denom: number;
  secret: bigint;
  nullifier: bigint;
  leafIndex: number;
};

export function randomFieldElement(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let x = 0n;
  for (const b of bytes) x = (x << 8n) | BigInt(b);
  return x % FIELD;
}

export function newNoteSecrets(): { secret: bigint; nullifier: bigint } {
  return { secret: randomFieldElement(), nullifier: randomFieldElement() };
}

export function commitmentOf(n: { secret: bigint; nullifier: bigint }): bigint {
  return hash2(n.nullifier, n.secret);
}

export function nullifierHashOf(n: { nullifier: bigint }): bigint {
  return hash1(n.nullifier);
}

export function encodeNote(n: Note): string {
  return [
    NOTE_PREFIX + n.denom,
    toBe32Hex(n.secret),
    toBe32Hex(n.nullifier),
    String(n.leafIndex),
  ].join(":");
}

export function decodeNote(raw: string): Note {
  const s = raw.trim();
  if (!s.startsWith(NOTE_PREFIX)) throw new Error("invalid note");
  const rest = s.slice(NOTE_PREFIX.length);
  const parts = rest.split(":");
  if (parts.length !== 4) throw new Error("invalid note");
  const [denomStr, secretHex, nullifierHex, leafStr] = parts;
  const denom = Number(denomStr);
  const leafIndex = Number(leafStr);
  if (!/^[0-9a-fA-F]{1,64}$/.test(secretHex)) throw new Error("invalid note");
  if (!/^[0-9a-fA-F]{1,64}$/.test(nullifierHex)) throw new Error("invalid note");
  if (!Number.isInteger(leafIndex) || leafIndex < 0) throw new Error("invalid note");
  denomIndex(denom); // throws if denom not in {1,10,100}
  return { denom, secret: fromHex(secretHex), nullifier: fromHex(nullifierHex), leafIndex };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- note.test`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/aashim/hackathon/stellar-hacks
git add frontend/src/lib/crypto/note.ts frontend/src/lib/crypto/note.test.ts
git commit -m "feat(frontend): note codec (secret/nullifier/commitment, v2 format)"
```

---

### Task 6 (A6): Proof conversion (port of proofconv.rs)

**Files:**
- Create: `frontend/src/lib/proof/proofconv.ts`, `frontend/src/lib/proof/proofconv.test.ts`

**Interfaces:**
- Produces:
  - `type SnarkProof = { pi_a: string[]; pi_b: string[][]; pi_c: string[] }`
  - `proofABC(proof: SnarkProof): { a: string; b: string; c: string }`
  - `publicFields(pub: string[]): { root: string; nullifier_hash: string; recipient_fr: string; denom: number }`
  - `buildWithdrawBody(proof, pub, recipient): WithdrawBody` where `WithdrawBody = { proof: string; root: string; nullifier_hash: string; recipient_fr: string; recipient: string; denom: number }`

- [ ] **Step 1: Write failing test `src/lib/proof/proofconv.test.ts`**

Uses the committed artifacts at repo root.

```ts
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { proofABC, publicFields, buildWithdrawBody } from "./proofconv";

const root = resolve(__dirname, "../../../../artifacts/circuit");
const proof = JSON.parse(readFileSync(resolve(root, "proof.json"), "utf8"));
const pub = JSON.parse(readFileSync(resolve(root, "public.json"), "utf8"));

test("proofABC yields 128/256/128 hex", () => {
  const { a, b, c } = proofABC(proof);
  expect(a).toMatch(/^[0-9a-f]{128}$/);
  expect(b).toMatch(/^[0-9a-f]{256}$/);
  expect(c).toMatch(/^[0-9a-f]{128}$/);
});

test("publicFields matches known artifact hex", () => {
  const f = publicFields(pub);
  expect(f.root).toBe("0012f4149c6840973c2dee91e8ecd7dd2839be83b143607114e7b4cd70bd86d4");
  expect(f.nullifier_hash).toBe("0750bb23dba2ab2e1f42e914eb8582103d00e462df6864ecec9646ce61311b2b");
  expect(f.recipient_fr).toBe("0000000000000000000000001234567890abcdef1234567890abcdef12345678");
  expect(f.denom).toBe(10);
});

test("buildWithdrawBody injects recipient + stringifies proof", () => {
  const body = buildWithdrawBody(proof, pub, "GABC");
  expect(body.recipient).toBe("GABC");
  expect(body.denom).toBe(10);
  const parsed = JSON.parse(body.proof);
  expect(parsed).toHaveProperty("a");
  expect(parsed).toHaveProperty("b");
  expect(parsed).toHaveProperty("c");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- proofconv`
Expected: FAIL (cannot find `./proofconv`).

- [ ] **Step 3: Write `src/lib/proof/proofconv.ts`**

```ts
// Port of relayer/src/proofconv.rs. Produces the exact byte layout the Soroban
// verifier expects: A = x||y, B = x_c1||x_c0||y_c1||y_c0, C = x||y; 32-byte BE hex.
export type SnarkProof = { pi_a: string[]; pi_b: string[][]; pi_c: string[] };

export type WithdrawBody = {
  proof: string;
  root: string;
  nullifier_hash: string;
  recipient_fr: string;
  recipient: string;
  denom: number;
};

function be32(decimal: string): string {
  const n = BigInt(decimal.trim());
  if (n < 0n) throw new Error("negative coordinate");
  const hex = n.toString(16);
  if (hex.length > 64) throw new Error("value exceeds 32 bytes");
  return hex.padStart(64, "0");
}

export function proofABC(p: SnarkProof): { a: string; b: string; c: string } {
  const a = be32(p.pi_a[0]) + be32(p.pi_a[1]);
  // pi_b = [[x_c0, x_c1], [y_c0, y_c1], [_, _]] ; Soroban wants x_c1||x_c0||y_c1||y_c0
  const b =
    be32(p.pi_b[0][1]) + be32(p.pi_b[0][0]) + be32(p.pi_b[1][1]) + be32(p.pi_b[1][0]);
  const c = be32(p.pi_c[0]) + be32(p.pi_c[1]);
  return { a, b, c };
}

export function publicFields(pub: string[]): {
  root: string;
  nullifier_hash: string;
  recipient_fr: string;
  denom: number;
} {
  if (pub.length < 4) throw new Error(`expected 4 public signals, got ${pub.length}`);
  return {
    root: be32(pub[0]),
    nullifier_hash: be32(pub[1]),
    recipient_fr: be32(pub[2]),
    denom: Number(pub[3]),
  };
}

export function buildWithdrawBody(
  proof: SnarkProof,
  pub: string[],
  recipient: string,
): WithdrawBody {
  const abc = proofABC(proof);
  const f = publicFields(pub);
  return { proof: JSON.stringify(abc), recipient, ...f };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- proofconv`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/aashim/hackathon/stellar-hacks
git add frontend/src/lib/proof/proofconv.ts frontend/src/lib/proof/proofconv.test.ts
git commit -m "feat(frontend): JS port of proofconv (snarkjs -> Soroban withdraw body)"
```

---

### Task 7 (A7): recipient_fr derivation

**Files:**
- Create: `frontend/src/lib/proof/recipient.ts`, `frontend/src/lib/proof/recipient.test.ts`

**Interfaces:**
- Consumes: `FIELD` (A2). Uses `StrKey` from `@stellar/stellar-sdk`.
- Produces:
  - `recipientFrField(gAddress: string): bigint` — `be_int(ed25519_pubkey) mod P`
  - `recipientFrDecimal(gAddress: string): string` — decimal (circuit input)

- [ ] **Step 1: Write failing test `src/lib/proof/recipient.test.ts`**

```ts
import { test, expect } from "vitest";
import { recipientFrField } from "./recipient";
import { StrKey } from "@stellar/stellar-sdk";
import { FIELD } from "../config";

const ADDR = "GBLU6A6OKK35QZR5SIYYNF7PFMKIBEFPOJ6OZP3NM2HWN67DUTFOMIXW";

test("derivation is deterministic and in field", () => {
  const a = recipientFrField(ADDR);
  const b = recipientFrField(ADDR);
  expect(a).toBe(b);
  expect(a).toBeGreaterThanOrEqual(0n);
  expect(a).toBeLessThan(FIELD);
});

test("matches be_int(pubkey) mod P", () => {
  const raw = StrKey.decodeEd25519PublicKey(ADDR); // 32 bytes
  let x = 0n;
  for (const byte of raw) x = (x << 8n) | BigInt(byte);
  expect(recipientFrField(ADDR)).toBe(x % FIELD);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- recipient`
Expected: FAIL (cannot find `./recipient`).

- [ ] **Step 3: Write `src/lib/proof/recipient.ts`**

```ts
import { StrKey } from "@stellar/stellar-sdk";
import { FIELD } from "../config";

// The contract does NOT bind recipient_fr to the payout recipient; this only
// needs to be deterministic + reproducible. recipient_fr = be_int(pubkey) mod P.
export function recipientFrField(gAddress: string): bigint {
  const raw = StrKey.decodeEd25519PublicKey(gAddress); // Uint8Array(32)
  let x = 0n;
  for (const byte of raw) x = (x << 8n) | BigInt(byte);
  return x % FIELD;
}

export function recipientFrDecimal(gAddress: string): string {
  return recipientFrField(gAddress).toString();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- recipient`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/aashim/hackathon/stellar-hacks
git add frontend/src/lib/proof/recipient.ts frontend/src/lib/proof/recipient.test.ts
git commit -m "feat(frontend): recipient_fr derivation from Stellar G-address"
```

---

### Task 8 (A8): Relayer client + same-origin proxy route

**Files:**
- Create: `frontend/src/lib/relayer/client.ts`, `frontend/src/lib/relayer/client.test.ts`, `frontend/src/app/api/relayer/[...path]/route.ts`

**Interfaces:**
- Consumes: `relayerPath` (A2); `WithdrawBody` (A6).
- Produces:
  - `type PathProof = { leaf_index: number; root: string; root_hex: string; path_elements: string[]; path_indices: string[] }`
  - `getHealth(): Promise<{ status: string; deposit_contract: string; pool_id: string; denoms: number[] }>`
  - `getPath(denom: number, leafIndex: number): Promise<PathProof>`
  - `postWithdraw(body: WithdrawBody): Promise<{ tx_hash: string }>`
  - `RelayerError extends Error` (carries `status` + parsed message)

- [ ] **Step 1: Read the Next.js route-handler guide**

Run: `ls frontend/node_modules/next/dist/docs/` and read the route-handler / API guide before writing `route.ts`. Confirm the handler signature for dynamic `[...path]` segments and how query strings are accessed in this Next version.

- [ ] **Step 2: Write failing test `src/lib/relayer/client.test.ts`**

```ts
import { test, expect, vi, afterEach } from "vitest";
import { getPath, postWithdraw, RelayerError } from "./client";

afterEach(() => vi.restoreAllMocks());

test("getPath calls same-origin proxy with query", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        leaf_index: 0, root: "1", root_hex: "00", path_elements: [], path_indices: [],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  const res = await getPath(10, 0);
  expect(fetchMock).toHaveBeenCalledWith("/api/relayer/path?denom=10&leaf_index=0");
  expect(res.leaf_index).toBe(0);
});

test("postWithdraw throws RelayerError on non-200", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("UnknownRoot", { status: 400 })),
  );
  await expect(
    postWithdraw({
      proof: "{}", root: "00", nullifier_hash: "00", recipient_fr: "00",
      recipient: "G", denom: 10,
    }),
  ).rejects.toBeInstanceOf(RelayerError);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npm test -- relayer`
Expected: FAIL (cannot find `./client`).

- [ ] **Step 4: Write `src/lib/relayer/client.ts`**

```ts
import { relayerPath } from "../config";
import type { WithdrawBody } from "../proof/proofconv";

export type PathProof = {
  leaf_index: number;
  root: string;
  root_hex: string;
  path_elements: string[];
  path_indices: string[];
};

export class RelayerError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "RelayerError";
    this.status = status;
  }
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new RelayerError(res.status, text || res.statusText);
  }
  return (await res.json()) as T;
}

export async function getHealth() {
  return asJson<{ status: string; deposit_contract: string; pool_id: string; denoms: number[] }>(
    await fetch(relayerPath("health")),
  );
}

export async function getPath(denom: number, leafIndex: number): Promise<PathProof> {
  return asJson<PathProof>(
    await fetch(relayerPath(`path?denom=${denom}&leaf_index=${leafIndex}`)),
  );
}

export async function postWithdraw(body: WithdrawBody): Promise<{ tx_hash: string }> {
  return asJson<{ tx_hash: string }>(
    await fetch(relayerPath("withdraw"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npm test -- relayer`
Expected: PASS (2 tests).

- [ ] **Step 6: Write the proxy `src/app/api/relayer/[...path]/route.ts`**

Adapt the handler signature to what the Next 16 docs (Step 1) specify. Reference implementation:

```ts
import { NextRequest } from "next/server";

const RELAYER_URL = process.env.RELAYER_URL ?? "http://127.0.0.1:8080";

async function forward(req: NextRequest, path: string[]) {
  const suffix = path.join("/");
  const search = req.nextUrl.search;
  const target = `${RELAYER_URL}/${suffix}${search}`;
  const init: RequestInit = {
    method: req.method,
    headers: { "content-type": req.headers.get("content-type") ?? "application/json" },
  };
  if (req.method !== "GET" && req.method !== "HEAD") init.body = await req.text();
  const upstream = await fetch(target, init);
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return forward(req, path);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return forward(req, path);
}
```

- [ ] **Step 7: Manually verify the proxy (relayer running)**

Start the relayer per `docs/RUNBOOK-e2e.md` (Task D3) or: `relayer --config relayer/config.toml serve`. Then:

Run: `cd frontend && npm run dev` and in another shell `curl -fsS http://localhost:3000/api/relayer/health`
Expected: JSON `{"status":"ok",...}` proxied from the relayer.

- [ ] **Step 8: Commit**

```bash
cd /home/aashim/hackathon/stellar-hacks
git add frontend/src/lib/relayer/client.ts frontend/src/lib/relayer/client.test.ts "frontend/src/app/api/relayer/[...path]/route.ts"
git commit -m "feat(frontend): typed relayer client + same-origin proxy route"
```

---

### Task 9 (A9): Browser proving wrapper + artifacts

**Files:**
- Create: `frontend/scripts/copy-circuit-artifacts.mjs`, `frontend/src/lib/proof/prove.ts`, `frontend/src/lib/proof/prove.test.ts`
- Modify: `frontend/.gitignore`

**Interfaces:**
- Consumes: snarkjs; `nullifierHashOf`/`commitmentOf` (A5); `recipientFrDecimal` (A7); `PathProof` (A8).
- Produces:
  - `type WithdrawInputs = { secret: bigint; nullifier: bigint; denom: number; path: PathProof; recipientG: string }`
  - `buildCircuitInput(i: WithdrawInputs): Record<string, string | string[]>`
  - `prove(input): Promise<{ proof: SnarkProof; publicSignals: string[] }>` (lazy-imports snarkjs; fetches `/circuit/withdraw.wasm` + `/circuit/withdraw_final.zkey`)

- [ ] **Step 1: Write the artifact copy script `scripts/copy-circuit-artifacts.mjs`**

```js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "../../artifacts/circuit");
const DST = path.resolve(__dirname, "../public/circuit");
const FILES = ["withdraw.wasm", "withdraw_final.zkey", "verification_key.json"];

fs.mkdirSync(DST, { recursive: true });
for (const f of FILES) {
  const from = path.join(SRC, f);
  if (!fs.existsSync(from)) {
    console.warn(`WARN: missing artifact ${from} (proving will fail until built)`);
    continue;
  }
  fs.copyFileSync(from, path.join(DST, f));
  console.log(`copied ${f}`);
}
```

- [ ] **Step 2: Run it + ignore the output dir**

Run: `cd frontend && npm run copy:circuit`
Expected: `copied withdraw.wasm` / `copied withdraw_final.zkey` / `copied verification_key.json`.

Append to `frontend/.gitignore`:

```
# Generated/copied ZK artifacts (large; produced by scripts/copy-circuit-artifacts.mjs)
public/circuit/
```

- [ ] **Step 3: Write integration test `src/lib/proof/prove.test.ts`**

Proves the proving+conversion path end-to-end against committed artifacts (node loads zkey/wasm by path; verifies with VK). This is slow (seconds).

```ts
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as snarkjs from "snarkjs";
import { buildCircuitInput } from "./prove";
import { proofABC, publicFields } from "./proofconv";

const circuit = resolve(__dirname, "../../../../circuits/build");
const wasm = resolve(circuit, "withdraw_js/withdraw.wasm");
const zkey = resolve(circuit, "withdraw_final.zkey");
const vk = JSON.parse(readFileSync(resolve(circuit, "verification_key.json"), "utf8"));
const input = JSON.parse(readFileSync(resolve(circuit, "input.json"), "utf8"));

test("buildCircuitInput shapes match the circuit input.json keys", () => {
  const built = buildCircuitInput({
    secret: BigInt(input.secret),
    nullifier: BigInt(input.nullifier),
    denom: Number(input.denomination),
    path: {
      leaf_index: 0,
      root: input.root,
      root_hex: "",
      path_elements: input.pathElements,
      path_indices: input.pathIndices,
    },
    recipientG: "GBLU6A6OKK35QZR5SIYYNF7PFMKIBEFPOJ6OZP3NM2HWN67DUTFOMIXW",
  });
  expect(Object.keys(built).sort()).toEqual(
    ["denomination", "nullifier", "nullifierHash", "pathElements", "pathIndices", "recipient", "root", "secret"].sort(),
  );
});

test("fullProve(input.json) produces a proof that verifies", async () => {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey);
  expect(await snarkjs.groth16.verify(vk, publicSignals, proof)).toBe(true);
  // and our converters accept snarkjs output shape
  const abc = proofABC(proof as never);
  expect(abc.a).toMatch(/^[0-9a-f]{128}$/);
  expect(publicFields(publicSignals).denom).toBe(10);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd frontend && npm test -- prove`
Expected: FAIL (cannot find `./prove` for the first test).

- [ ] **Step 5: Write `src/lib/proof/prove.ts`**

```ts
import type { SnarkProof } from "./proofconv";
import type { PathProof } from "../relayer/client";
import { nullifierHashOf } from "../crypto/note";
import { recipientFrDecimal } from "./recipient";

export type WithdrawInputs = {
  secret: bigint;
  nullifier: bigint;
  denom: number;
  path: PathProof;
  recipientG: string;
};

export function buildCircuitInput(i: WithdrawInputs): Record<string, string | string[]> {
  return {
    secret: i.secret.toString(),
    nullifier: i.nullifier.toString(),
    pathElements: i.path.path_elements,
    pathIndices: i.path.path_indices,
    root: i.path.root,
    nullifierHash: nullifierHashOf({ nullifier: i.nullifier }).toString(),
    recipient: recipientFrDecimal(i.recipientG),
    denomination: String(i.denom),
  };
}

const WASM_URL = "/circuit/withdraw.wasm";
const ZKEY_URL = "/circuit/withdraw_final.zkey";

export async function prove(
  i: WithdrawInputs,
): Promise<{ proof: SnarkProof; publicSignals: string[] }> {
  const snarkjs = await import("snarkjs");
  const input = buildCircuitInput(i);
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    WASM_URL,
    ZKEY_URL,
  );
  return { proof: proof as SnarkProof, publicSignals };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd frontend && npm test -- prove`
Expected: PASS (2 tests). The second test takes several seconds (real proving). If snarkjs errors under vitest, run with `--pool forks` (already configured) — do not weaken the assertion.

- [ ] **Step 7: Commit**

```bash
cd /home/aashim/hackathon/stellar-hacks
git add frontend/scripts/copy-circuit-artifacts.mjs frontend/src/lib/proof/prove.ts frontend/src/lib/proof/prove.test.ts frontend/.gitignore
git commit -m "feat(frontend): in-browser Groth16 proving wrapper + circuit artifacts"
```

---

## Phase B — Deposit wiring

### Task 10 (B1): EVM ABIs + client + wallet connect

**Files:**
- Create: `frontend/src/lib/evm/abis.ts`, `frontend/src/lib/evm/client.ts`, `frontend/src/lib/evm/client.test.ts`

**Interfaces:**
- Consumes: `EVM` (A2); viem.
- Produces:
  - `MOCK_USDC_ABI`, `POOL_ABI` (const ABI arrays)
  - `getInjected(): EIP1193Provider` (throws "No EVM wallet found" if absent)
  - `connectWallet(): Promise<{ address: \`0x${string}\` }>` (requests accounts; ensures Sepolia)
  - `ensureSepolia(provider): Promise<void>` (wallet_switchEthereumChain; add if 4902)
  - `publicClient()` / `walletClient(account)` (viem clients over injected transport)

- [ ] **Step 1: Write `src/lib/evm/abis.ts`**

```ts
export const MOCK_USDC_ABI = [
  { type: "function", name: "mint", stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "approve", stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

export const POOL_ABI = [
  { type: "function", name: "deposit", stateMutability: "nonpayable",
    inputs: [{ name: "denomIndex", type: "uint8" }, { name: "commitment", type: "uint256" }],
    outputs: [{ name: "leafIndex", type: "uint32" }] },
  { type: "event", name: "Deposit", inputs: [
    { name: "denomIndex", type: "uint8", indexed: true },
    { name: "commitment", type: "uint256", indexed: true },
    { name: "leafIndex", type: "uint32", indexed: false },
  ] },
] as const;
```

- [ ] **Step 2: Write failing test `src/lib/evm/client.test.ts`**

```ts
import { test, expect } from "vitest";
import { MOCK_USDC_ABI, POOL_ABI } from "./abis";

test("pool ABI exposes deposit + Deposit event", () => {
  expect(POOL_ABI.find((x) => x.name === "deposit")).toBeTruthy();
  const ev = POOL_ABI.find((x) => x.type === "event" && x.name === "Deposit");
  expect(ev).toBeTruthy();
});

test("mock usdc ABI exposes mint/approve/allowance", () => {
  for (const fn of ["mint", "approve", "allowance"]) {
    expect(MOCK_USDC_ABI.find((x) => x.name === fn)).toBeTruthy();
  }
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npm test -- evm/client`
Expected: FAIL (cannot find `./abis` import path until file exists — if A B1 Step 1 done, this passes; ensure test references compile). If abis.ts exists, this passes immediately; that's fine — proceed to write client.ts which the deposit task needs.

- [ ] **Step 4: Write `src/lib/evm/client.ts`**

```ts
"use client";
import {
  createPublicClient, createWalletClient, custom, type EIP1193Provider,
} from "viem";
import { sepolia } from "viem/chains";
import { EVM } from "../config";

export function getInjected(): EIP1193Provider {
  const eth = (globalThis as { ethereum?: EIP1193Provider }).ethereum;
  if (!eth) throw new Error("No EVM wallet found. Install MetaMask to deposit.");
  return eth;
}

export async function ensureSepolia(provider: EIP1193Provider): Promise<void> {
  const hexId = `0x${EVM.chainId.toString(16)}`;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch (err) {
    if ((err as { code?: number }).code === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: hexId, chainName: EVM.name,
          nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: [EVM.rpcFallback], blockExplorerUrls: ["https://sepolia.etherscan.io"],
        }],
      });
    } else throw err;
  }
}

export async function connectWallet(): Promise<{ address: `0x${string}` }> {
  const provider = getInjected();
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as `0x${string}`[];
  if (!accounts?.length) throw new Error("No account authorized.");
  await ensureSepolia(provider);
  return { address: accounts[0] };
}

export function publicClient() {
  return createPublicClient({ chain: sepolia, transport: custom(getInjected()) });
}

export function walletClient(account: `0x${string}`) {
  return createWalletClient({ account, chain: sepolia, transport: custom(getInjected()) });
}
```

- [ ] **Step 5: Run test + lint**

Run: `cd frontend && npm test -- evm/client && npm run lint`
Expected: tests PASS; lint clean.

- [ ] **Step 6: Commit**

```bash
cd /home/aashim/hackathon/stellar-hacks
git add frontend/src/lib/evm/abis.ts frontend/src/lib/evm/client.ts frontend/src/lib/evm/client.test.ts
git commit -m "feat(frontend): EVM ABIs + viem client + wallet connect/chain-ensure"
```

---

### Task 11 (B2): Deposit action (faucet/approve/deposit/leafIndex)

**Files:**
- Create: `frontend/src/lib/evm/deposit.ts`, `frontend/src/lib/evm/deposit.test.ts`

**Interfaces:**
- Consumes: `publicClient`/`walletClient` (B1); `MOCK_USDC_ABI`/`POOL_ABI` (B1); `EVM`/`denomIndex`/`denomAmountUsdc` (A2); `commitmentOf`/`newNoteSecrets`/`encodeNote` (A5).
- Produces:
  - `faucet(account, value): Promise<\`0x${string}\`>` (tx hash) — mints `denomAmountUsdc(value)`
  - `ensureAllowance(account, value): Promise<void>` (approve if allowance < amount)
  - `usdcBalance(account): Promise<bigint>`
  - `deposit(account, value): Promise<{ note: string; leafIndex: number; txHash: \`0x${string}\` }>` — generates secrets, computes commitment, deposits, parses `Deposit` event → leafIndex, encodes the note

- [ ] **Step 1: Write failing test `src/lib/evm/deposit.test.ts`**

Pure-logic test for `leafIndexFromLogs` (event decoding) — extract it as an exported helper so it is unit-testable without a chain.

```ts
import { test, expect } from "vitest";
import { encodeEventTopics, encodeAbiParameters } from "viem";
import { POOL_ABI } from "./abis";
import { leafIndexFromLogs } from "./deposit";

test("leafIndexFromLogs decodes the Deposit event leafIndex", () => {
  const topics = encodeEventTopics({
    abi: POOL_ABI, eventName: "Deposit",
    args: { denomIndex: 1, commitment: 123n },
  });
  const data = encodeAbiParameters([{ type: "uint32" }], [7]);
  const logs = [{
    address: "0x4c781728f3f53f220c6f226610cd24d8b1e8e7ef",
    topics, data,
  }] as never;
  expect(leafIndexFromLogs(logs)).toBe(7);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- evm/deposit`
Expected: FAIL (cannot find `./deposit`).

- [ ] **Step 3: Write `src/lib/evm/deposit.ts`**

```ts
"use client";
import { parseEventLogs, type Log } from "viem";
import { publicClient, walletClient } from "./client";
import { MOCK_USDC_ABI, POOL_ABI } from "./abis";
import { EVM, denomIndex, denomAmountUsdc } from "../config";
import { newNoteSecrets, commitmentOf, encodeNote } from "../crypto/note";

const POOL = EVM.pool as `0x${string}`;
const USDC = EVM.mockUsdc as `0x${string}`;

export function leafIndexFromLogs(logs: Log[]): number {
  const parsed = parseEventLogs({ abi: POOL_ABI, eventName: "Deposit", logs });
  if (!parsed.length) throw new Error("Deposit event not found in receipt");
  return Number((parsed[0].args as { leafIndex: number | bigint }).leafIndex);
}

export async function usdcBalance(account: `0x${string}`): Promise<bigint> {
  return publicClient().readContract({
    address: USDC, abi: MOCK_USDC_ABI, functionName: "balanceOf", args: [account],
  });
}

export async function faucet(account: `0x${string}`, value: number): Promise<`0x${string}`> {
  const wc = walletClient(account);
  const hash = await wc.writeContract({
    address: USDC, abi: MOCK_USDC_ABI, functionName: "mint",
    args: [account, denomAmountUsdc(value)],
  });
  await publicClient().waitForTransactionReceipt({ hash });
  return hash;
}

export async function ensureAllowance(account: `0x${string}`, value: number): Promise<void> {
  const amount = denomAmountUsdc(value);
  const current = await publicClient().readContract({
    address: USDC, abi: MOCK_USDC_ABI, functionName: "allowance", args: [account, POOL],
  });
  if (current >= amount) return;
  const hash = await walletClient(account).writeContract({
    address: USDC, abi: MOCK_USDC_ABI, functionName: "approve", args: [POOL, amount],
  });
  await publicClient().waitForTransactionReceipt({ hash });
}

export async function deposit(
  account: `0x${string}`,
  value: number,
): Promise<{ note: string; leafIndex: number; txHash: `0x${string}` }> {
  const secrets = newNoteSecrets();
  const commitment = commitmentOf(secrets);
  const hash = await walletClient(account).writeContract({
    address: POOL, abi: POOL_ABI, functionName: "deposit",
    args: [denomIndex(value), commitment],
  });
  const receipt = await publicClient().waitForTransactionReceipt({ hash });
  const leafIndex = leafIndexFromLogs(receipt.logs);
  const note = encodeNote({ denom: value, ...secrets, leafIndex });
  return { note, leafIndex, txHash: hash };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- evm/deposit`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
cd /home/aashim/hackathon/stellar-hacks
git add frontend/src/lib/evm/deposit.ts frontend/src/lib/evm/deposit.test.ts
git commit -m "feat(frontend): EVM deposit action (faucet/approve/deposit/leafIndex)"
```

---

### Task 12 (B3): Wire the deposit page to real logic

**Files:**
- Modify: `frontend/src/app/deposit/page.tsx`

**Interfaces:**
- Consumes: `connectWallet` (B1); `faucet`/`ensureAllowance`/`deposit`/`usdcBalance` (B2); `denomAmountUsdc`/`truncate`/`EVM`/`etherscan` (A2).

- [ ] **Step 1: Replace mock state + handlers**

In `src/app/deposit/page.tsx`:

1. Delete `const MOCK_SENDER = ...` (line 26).
2. Add real state after `const [error, setError] = useState<string | null>(null);`:

```tsx
  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [busy, setBusy] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
```

3. Replace `connect()` (lines ~93-97):

```tsx
  async function connect() {
    setError(null);
    setStep("connecting");
    try {
      const { address } = await connectWallet();
      setAccount(address);
      setStep("connected");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wallet connection failed.");
      setStep("idle");
    }
  }
```

4. Replace `lock()` (lines ~99-109) with a real deposit driver. `LOCK_LINES` now reflect real progress; we advance `lockDone` as each on-chain step resolves:

```tsx
  async function lock() {
    if (account === null || amount === null) return;
    setError(null);
    setStep("locking");
    setLockDone(0);
    try {
      await ensureAllowance(account, amount); // "Signing the deposit" (approve if needed)
      setLockDone(1);
      const res = await deposit(account, amount); // "Broadcasting to Sepolia"
      setLockDone(2);
      setNote(res.note);
      setTxHash(res.txHash);
      setLockDone(3); // "Confirmed on-chain"
      after(350, () => setStep("vanishing"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Deposit failed.");
      setStep("connected");
    }
  }
```

5. Replace `makeMockNote` usage: `onVanished` no longer fabricates a note (the note is set in `lock()`):

```tsx
  const onVanished = useCallback(() => {
    setStep("noted");
  }, []);
```

Delete the `makeMockNote` function (lines ~62-69).

6. In `reset()`, also clear the new state: add `setAccount(null); setBusy(false); setTxHash(null);`.

- [ ] **Step 2: Update imports + display**

1. Replace the deposit-action imports block. Add near the top:

```tsx
import { connectWallet } from "@/lib/evm/client";
import { ensureAllowance, deposit, faucet, usdcBalance } from "@/lib/evm/deposit";
```

2. In the `connected` step `SummaryPanel`, replace `truncate(MOCK_SENDER)` with `account ? truncate(account) : ""`.

3. Add an optional faucet affordance in the `connected` step (above the Lock button) so a fresh wallet can fund:

```tsx
                  <CtaButton
                    variant="glass"
                    onClick={async () => {
                      if (account === null || amount === null) return;
                      setBusy(true); setError(null);
                      try { await faucet(account, amount); }
                      catch (e) { setError(e instanceof Error ? e.message : "Faucet failed."); }
                      finally { setBusy(false); }
                    }}
                    disabled={busy}
                  >
                    Get {amountLabel} test USDC
                  </CtaButton>
```

- [ ] **Step 3: Make the footer + copy honest (real funds now)**

Replace the persistent footer (lines ~317-325) text "Mock flow · no real wallet or funds" with:

```tsx
            <Wallet className="size-3.5" aria-hidden />
            Live testnet · real Sepolia transactions ·{" "}
```

In the `sealed` step, link the deposit tx. Add under the success header:

```tsx
              {txHash && (
                <a
                  href={etherscan.tx(txHash)}
                  target="_blank" rel="noopener noreferrer"
                  className="font-mono text-xs text-cyan underline-offset-4 hover:underline"
                >
                  View deposit on Etherscan ↗
                </a>
              )}
```

Update the connected-step note copy ("Nothing is private yet…") to add the honest anchor note:

```tsx
                      After locking you&rsquo;ll get a savable secret note — keep
                      it. It becomes withdrawable on Stellar once the relayer
                      anchors the new pool root (about a minute).
```

- [ ] **Step 4: Verify build + lint + manual check**

Run: `cd frontend && npm run lint && npx tsc --noEmit`
Expected: no errors.

Manual: `npm run dev`, open `/deposit`, connect MetaMask on Sepolia, faucet, deposit 1 USDC, confirm a real note is produced and the Etherscan link resolves to your tx. (Requires a funded Sepolia account for gas.)

- [ ] **Step 5: Commit**

```bash
cd /home/aashim/hackathon/stellar-hacks
git add frontend/src/app/deposit/page.tsx
git commit -m "feat(frontend): wire deposit page to real Sepolia deposit + note"
```

---

### Task 13 (B4): Wire EVM side of the wallet status bar

**Files:**
- Modify: `frontend/src/components/site/wallet-status.tsx`

**Interfaces:**
- Consumes: `connectWallet`, `getInjected` (B1); `truncate` (A2).

- [ ] **Step 1: Read the current component**

Run: `sed -n '1,120p' frontend/src/components/site/wallet-status.tsx` to see the `WalletChip` shape and the 700ms mock toggle.

- [ ] **Step 2: Replace the EVM chip's mock `toggle()` with a real connect**

Replace the EVM `WalletChip.toggle()` 700ms timer with:

```tsx
  async function toggleEvm() {
    if (evmAddress) return; // already connected; no disconnect in injected wallets
    setEvmConnecting(true);
    try {
      const { address } = await connectWallet();
      setEvmAddress(address);
    } catch {
      /* user rejected / no wallet — leave disconnected */
    } finally {
      setEvmConnecting(false);
    }
  }
```

Render `evmAddress ? truncate(evmAddress) : "Connect"`. Keep the existing chip styling. (The Stellar chip is wired in Task C4.)

- [ ] **Step 3: Verify + commit**

Run: `cd frontend && npm run lint && npx tsc --noEmit`
Expected: no errors.

```bash
cd /home/aashim/hackathon/stellar-hacks
git add frontend/src/components/site/wallet-status.tsx
git commit -m "feat(frontend): real EVM connect in wallet status bar"
```

---

## Phase C — Withdraw wiring

### Task 14 (C1): Stellar wallet + zUSDC trustline

**Files:**
- Create: `frontend/src/lib/stellar/wallet.ts`, `frontend/src/lib/stellar/trustline.ts`, `frontend/src/lib/stellar/trustline.test.ts`

**Interfaces:**
- Consumes: `STELLAR` (A2); `@creit.tech/stellar-wallets-kit`; `@stellar/stellar-sdk`.
- Produces:
  - `connectFreighter(): Promise<string>` (returns G-address)
  - `signXdr(xdr: string, address: string): Promise<string>` (signed XDR)
  - `hasZusdcTrustline(address: string): Promise<boolean>`
  - `addZusdcTrustline(address: string): Promise<string>` (builds changeTrust, signs via kit, submits; returns tx hash)
  - `buildChangeTrustXdr(address, account): string` (pure-ish helper, unit-tested)

- [ ] **Step 1: Read Wallets Kit + stellar-sdk usage**

Use context7 (`resolve-library-id` → `query-docs`) for `@creit.tech/stellar-wallets-kit` and `@stellar/stellar-sdk` to confirm the current API: `StellarWalletsKit` construction, `FREIGHTER_ID`, `kit.getAddress()`, `kit.signTransaction()`, and `TransactionBuilder`/`Operation.changeTrust`/`Asset`/`Horizon.Server` names in the installed version.

- [ ] **Step 2: Write failing test `src/lib/stellar/trustline.test.ts`**

Tests the pure XDR builder (no network).

```ts
import { test, expect } from "vitest";
import { Keypair, TransactionBuilder, Networks } from "@stellar/stellar-sdk";
import { buildChangeTrustXdr } from "./trustline";
import { STELLAR } from "../config";

test("buildChangeTrustXdr produces a decodable changeTrust tx for the account", () => {
  const kp = Keypair.random();
  // minimal source account at sequence 0
  const xdr = buildChangeTrustXdr(kp.publicKey(), "0");
  const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
  expect(tx.source).toBe(kp.publicKey());
  expect(tx.operations[0].type).toBe("changeTrust");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npm test -- stellar/trustline`
Expected: FAIL (cannot find `./trustline`).

- [ ] **Step 4: Write `src/lib/stellar/trustline.ts`**

Adjust import names to the installed stellar-sdk per Step 1.

```ts
import {
  Account, Asset, Networks, Operation, TransactionBuilder, BASE_FEE, Horizon,
} from "@stellar/stellar-sdk";
import { STELLAR } from "../config";
import { signXdr } from "./wallet";

const ZUSDC = new Asset(STELLAR.zusdcCode, STELLAR.zusdcIssuer);
const horizon = () => new Horizon.Server(STELLAR.horizonUrl);

export function buildChangeTrustXdr(address: string, sequence: string): string {
  const account = new Account(address, sequence);
  return new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.changeTrust({ asset: ZUSDC }))
    .setTimeout(180)
    .build()
    .toXDR();
}

export async function hasZusdcTrustline(address: string): Promise<boolean> {
  const acct = await horizon().loadAccount(address);
  return acct.balances.some(
    (b) =>
      "asset_code" in b &&
      b.asset_code === STELLAR.zusdcCode &&
      b.asset_issuer === STELLAR.zusdcIssuer,
  );
}

export async function addZusdcTrustline(address: string): Promise<string> {
  const acct = await horizon().loadAccount(address);
  const xdr = buildChangeTrustXdr(address, acct.sequenceNumber());
  const signed = await signXdr(xdr, address);
  const tx = TransactionBuilder.fromXDR(signed, Networks.TESTNET);
  const res = await horizon().submitTransaction(tx);
  return res.hash;
}
```

- [ ] **Step 5: Write `src/lib/stellar/wallet.ts`**

Adjust to the Wallets Kit API confirmed in Step 1.

```ts
"use client";
import {
  StellarWalletsKit, WalletNetwork, FREIGHTER_ID, FreighterModule,
} from "@creit.tech/stellar-wallets-kit";

let kit: StellarWalletsKit | null = null;
function getKit(): StellarWalletsKit {
  if (!kit) {
    kit = new StellarWalletsKit({
      network: WalletNetwork.TESTNET,
      selectedWalletId: FREIGHTER_ID,
      modules: [new FreighterModule()],
    });
  }
  return kit;
}

export async function connectFreighter(): Promise<string> {
  const k = getKit();
  k.setWallet(FREIGHTER_ID);
  const { address } = await k.getAddress();
  return address;
}

export async function signXdr(xdr: string, address: string): Promise<string> {
  const { signedTxXdr } = await getKit().signTransaction(xdr, {
    address,
    networkPassphrase: "Test SDF Network ; September 2015",
  });
  return signedTxXdr;
}
```

- [ ] **Step 6: Run test + lint**

Run: `cd frontend && npm test -- stellar/trustline && npm run lint`
Expected: test PASS; lint clean.

- [ ] **Step 7: Commit**

```bash
cd /home/aashim/hackathon/stellar-hacks
git add frontend/src/lib/stellar/wallet.ts frontend/src/lib/stellar/trustline.ts frontend/src/lib/stellar/trustline.test.ts
git commit -m "feat(frontend): Freighter connect + zUSDC trustline (Wallets Kit)"
```

---

### Task 15 (C2): Withdraw orchestration

**Files:**
- Create: `frontend/src/lib/withdraw/run.ts`, `frontend/src/lib/withdraw/run.test.ts`

**Interfaces:**
- Consumes: `decodeNote` (A5); `getPath`/`postWithdraw` (A8); `prove` (A9); `buildWithdrawBody` (A6).
- Produces:
  - `type Stage = "path" | "witness" | "proof" | "submit"`
  - `runWithdraw(noteStr: string, recipientG: string, onStage?: (s: Stage) => void): Promise<{ txHash: string }>`

- [ ] **Step 1: Write failing test `src/lib/withdraw/run.test.ts`**

Mocks the network + proving layers; asserts orchestration order and that the note drives `/path`.

```ts
import { test, expect, vi, afterEach } from "vitest";

afterEach(() => vi.restoreAllMocks());

test("runWithdraw fetches path by note denom+leafIndex then submits", async () => {
  const getPath = vi.fn().mockResolvedValue({
    leaf_index: 3, root: "1", root_hex: "00", path_elements: [], path_indices: [],
  });
  const postWithdraw = vi.fn().mockResolvedValue({ tx_hash: "deadbeef" });
  const prove = vi.fn().mockResolvedValue({ proof: { pi_a: [], pi_b: [], pi_c: [] }, publicSignals: ["1", "2", "3", "10"] });
  vi.doMock("../relayer/client", () => ({ getPath, postWithdraw }));
  vi.doMock("../proof/prove", () => ({ prove }));
  vi.doMock("../proof/proofconv", () => ({
    buildWithdrawBody: () => ({ proof: "{}", root: "00", nullifier_hash: "00", recipient_fr: "00", recipient: "G", denom: 10 }),
  }));
  const { runWithdraw } = await import("./run");
  const note = "zkh-note-v2:10:0a:0b:3";
  const res = await runWithdraw(note, "GBLU6A6OKK35QZR5SIYYNF7PFMKIBEFPOJ6OZP3NM2HWN67DUTFOMIXW");
  expect(getPath).toHaveBeenCalledWith(10, 3);
  expect(res.txHash).toBe("deadbeef");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- withdraw/run`
Expected: FAIL (cannot find `./run`).

- [ ] **Step 3: Write `src/lib/withdraw/run.ts`**

```ts
import { decodeNote } from "../crypto/note";
import { getPath, postWithdraw } from "../relayer/client";
import { prove } from "../proof/prove";
import { buildWithdrawBody } from "../proof/proofconv";

export type Stage = "path" | "witness" | "proof" | "submit";

export async function runWithdraw(
  noteStr: string,
  recipientG: string,
  onStage?: (s: Stage) => void,
): Promise<{ txHash: string }> {
  const note = decodeNote(noteStr);
  onStage?.("path");
  const path = await getPath(note.denom, note.leafIndex);
  onStage?.("witness");
  const { proof, publicSignals } = await prove({
    secret: note.secret, nullifier: note.nullifier, denom: note.denom, path, recipientG,
  });
  onStage?.("proof");
  const body = buildWithdrawBody(proof, publicSignals, recipientG);
  onStage?.("submit");
  const { tx_hash } = await postWithdraw(body);
  return { txHash: tx_hash };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- withdraw/run`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
cd /home/aashim/hackathon/stellar-hacks
git add frontend/src/lib/withdraw/run.ts frontend/src/lib/withdraw/run.test.ts
git commit -m "feat(frontend): withdraw orchestration (note -> path -> prove -> submit)"
```

---

### Task 16 (C3): Wire the withdraw flow to real logic

**Files:**
- Modify: `frontend/src/components/site/withdraw/withdraw-flow.tsx`

**Interfaces:**
- Consumes: `decodeNote`/`NOTE_PREFIX` (A5); `runWithdraw` (C2); `connectFreighter`/`hasZusdcTrustline`/`addZusdcTrustline` (C1); `stellarExpert` (A2).

- [ ] **Step 1: Replace mock constants + note validation**

In `withdraw-flow.tsx`:
1. Replace `const NOTE_PREFIX = "zkh-note-v1:";` with an import: `import { NOTE_PREFIX, decodeNote } from "@/lib/crypto/note";`
2. Delete `MOCK_NOTE`, `AMOUNT_USDC`, `AMOUNT_ZUSDC`, `FREIGHTER_ADDR`. Replace the "Use a demo note" button with nothing (or a link to `/deposit`).
3. Replace `looksLikeNote` with real decode:

```tsx
  function decodeOk(v: string): { denom: number; leafIndex: number } | null {
    try { const n = decodeNote(v); return { denom: n.denom, leafIndex: n.leafIndex }; }
    catch { return null; }
  }
```
4. Add state for decoded note + tx + stage:

```tsx
  const [decoded, setDecoded] = useState<{ denom: number; leafIndex: number } | null>(null);
  const [destAddr, setDestAddr] = useState<string>("");
  const [trustlineReady, setTrustlineReady] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
```

- [ ] **Step 2: Real `onValidate`**

```tsx
  function onValidate() {
    setStep("validating");
    const d = decodeOk(note);
    later(() => {
      if (d) { setDecoded(d); setStep("ready"); }
      else setStep("invalidNote");
    }, 300);
  }
```

In the `ready` step, replace the hardcoded `{AMOUNT_USDC} USDC → {AMOUNT_ZUSDC}` with `{decoded?.denom} USDC → {decoded?.denom} zUSDC`.

- [ ] **Step 3: Real Freighter connect + trustline (in `addressing` step)**

Replace `connectFreighter()` (the 700ms mock) with:

```tsx
  async function connectFreighter() {
    if (connectingFreighter) return;
    setConnectingFreighter(true); setErrMsg(null);
    try {
      const addr = await connectStellar();           // imported from "@/lib/stellar/wallet"
      setDestAddr(addr);
      const ok = await hasZusdcTrustline(addr);
      setTrustlineReady(ok);
      setFreighterConnected(true);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "Freighter connection failed.");
    } finally {
      setConnectingFreighter(false);
    }
  }

  async function addTrustline() {
    setErrMsg(null);
    try { await addZusdcTrustline(destAddr); setTrustlineReady(true); }
    catch (e) { setErrMsg(e instanceof Error ? e.message : "Could not add trustline."); }
  }
```

Import alias to avoid the name clash: `import { connectFreighter as connectStellar, hasZusdcTrustline, addZusdcTrustline } from "@/lib/stellar/wallet";` — wait, `hasZusdcTrustline`/`addZusdcTrustline` live in `@/lib/stellar/trustline`. Import accordingly:

```tsx
import { connectFreighter as connectStellar } from "@/lib/stellar/wallet";
import { hasZusdcTrustline, addZusdcTrustline } from "@/lib/stellar/trustline";
```

In the connected-wallet option UI, show `truncate(destAddr)` instead of `FREIGHTER_ADDR`, and when `freighterConnected && !trustlineReady`, render an "Add zUSDC trustline" button calling `addTrustline()`. Gate `destReady` on `freighterConnected && trustlineReady` (for the connected mode).

- [ ] **Step 4: Real proving + submit (`onProve` drives prove; `onReveal` submits)**

This flow proves AND submits in one labor phase. Keep the staged progress UI. Replace `onProve` and `onReveal`:

```tsx
  async function onProve() {
    setStep("proving"); setProofDone(0); setErrMsg(null);
    try {
      // map orchestration stages to the 4-step progress bar
      const stageToIdx: Record<string, number> = { path: 1, witness: 2, proof: 3, submit: 4 };
      const { txHash } = await runWithdraw(note, destAddr, (s) => setProofDone(stageToIdx[s]));
      setTxHash(txHash);
      setStep("revealing");
    } catch (e) {
      setErrMsg(friendlyWithdrawError(e));
      setStep("error");
    }
  }
```

Because `runWithdraw` needs the destination address, the destination step must come **before** proving. Reorder the flow: after `ready`, go to `addressing` (choose destination + trustline), then `onReveal` triggers `onProve()`:

```tsx
  function onReveal() {
    if (!destReady) return;
    onProve();
  }
```

Update the `ready` step button to advance to `addressing` (set `setStep("addressing")`) instead of calling the old `onProve`. The rail still reads Prove→Destination→Reveal; that's fine — the proof now runs at reveal time, which is honest ("generating proof…" then "revealed").

Add a `friendlyWithdrawError` helper near the top:

```tsx
  function friendlyWithdrawError(e: unknown): string {
    const m = e instanceof Error ? e.message : String(e);
    if (m.includes("UnknownRoot")) return "The relayer hasn't anchored your deposit's root on Stellar yet. Wait ~a minute after depositing and try again.";
    if (m.includes("NullifierAlreadyUsed")) return "This note has already been withdrawn. Each note withdraws once.";
    if (m.includes("InvalidProof")) return "Proof rejected. Double-check you pasted the exact note from your deposit.";
    return m || "Withdrawal failed.";
  }
```

- [ ] **Step 5: Real success screen**

In `revealed`, replace the hardcoded amounts with `{decoded?.denom} zUSDC`, show `truncate(destAddr)` for the destination, and add the Stellar tx link when `txHash`:

```tsx
                  {txHash && (
                    <SummaryRow>
                      Stellar tx{" "}
                      <ExplorerLink href={stellarExpert.tx(txHash)}>
                        {truncate(txHash)}
                      </ExplorerLink>
                    </SummaryRow>
                  )}
```

Add an `error` step section (the type already includes `"error"`) rendering `errMsg` with a "Try again" button that returns to `addressing`.

Update the demo-only privacy copy line "Your note never leaves your browser in this demo." → "Your note never leaves your browser — the proof is generated locally." (now true).

- [ ] **Step 6: Add imports**

```tsx
import { runWithdraw } from "@/lib/withdraw/run";
```
(plus the stellar + note imports from Steps 1/3, and `stellarExpert` is already imported via `@/lib/site`).

- [ ] **Step 7: Verify build/lint + manual**

Run: `cd frontend && npm run lint && npx tsc --noEmit`
Expected: no errors.

Manual e2e per `docs/RUNBOOK-e2e.md`: paste a real note from a Task B3 deposit, connect Freighter, add trustline, reveal → confirm zUSDC arrives and the Stellar tx link resolves.

- [ ] **Step 8: Commit**

```bash
cd /home/aashim/hackathon/stellar-hacks
git add frontend/src/components/site/withdraw/withdraw-flow.tsx
git commit -m "feat(frontend): wire withdraw flow to real proof + relayer + zUSDC"
```

---

### Task 17 (C4): Wire Stellar side of the wallet status bar

**Files:**
- Modify: `frontend/src/components/site/wallet-status.tsx`

**Interfaces:**
- Consumes: `connectFreighter` (C1); `truncate` (A2).

- [ ] **Step 1: Replace the Stellar chip mock toggle**

```tsx
  async function toggleStellar() {
    if (stellarAddress) return;
    setStellarConnecting(true);
    try { setStellarAddress(await connectFreighter()); }
    catch { /* user cancelled */ }
    finally { setStellarConnecting(false); }
  }
```

Render `stellarAddress ? truncate(stellarAddress) : "Connect"`. Import: `import { connectFreighter } from "@/lib/stellar/wallet";`.

- [ ] **Step 2: Verify + commit**

Run: `cd frontend && npm run lint && npx tsc --noEmit`
Expected: no errors.

```bash
cd /home/aashim/hackathon/stellar-hacks
git add frontend/src/components/site/wallet-status.tsx
git commit -m "feat(frontend): real Freighter connect in wallet status bar"
```

---

## Phase D — Polish, honesty, runbook

### Task 18 (D1): Honest status + pre-flight checks

**Files:**
- Modify: `frontend/src/components/site/withdraw/withdraw-flow.tsx` (pre-flight); `frontend/src/app/deposit/page.tsx` (limitation note)

**Interfaces:**
- Consumes: `getHealth` (A8).

- [ ] **Step 1: Surface the relayer/limitation honestly**

In the withdraw `ready` step, add a quiet note:

```tsx
              <p className="text-xs text-faint">
                Withdrawal is submitted by a single relayer (1-of-1 trust, testnet).
                The proof binds your note; the relayer is trusted to pay the address you choose.
              </p>
```

In the deposit `sealed` step, keep the "withdrawable once anchored" copy from Task B3.

- [ ] **Step 2: Verify + commit**

Run: `cd frontend && npm run lint`
Expected: clean.

```bash
cd /home/aashim/hackathon/stellar-hacks
git add frontend/src/components/site/withdraw/withdraw-flow.tsx frontend/src/app/deposit/page.tsx
git commit -m "feat(frontend): surface 1-of-1 relayer trust + anchor timing honestly"
```

---

### Task 19 (D2): Error/loading/reduced-motion sweep

**Files:**
- Modify: `frontend/src/app/deposit/page.tsx`, `frontend/src/components/site/withdraw/withdraw-flow.tsx`

- [ ] **Step 1: Audit every async path for a visible error/loading state**

Confirm: wallet-not-installed, wrong-chain, user-rejected, faucet failure, deposit revert, invalid note, `/path` 502, proof failure, `UnknownRoot`/`NullifierAlreadyUsed`/`InvalidProof` all set `error`/`errMsg` and render in the existing alert/`error` step. Confirm `VanishStage`/`RevealClimax` still fire `onDone` immediately under `prefers-reduced-motion` and that the real async completion (not an animation timer) drives the step transition (deposit `lock()` already gates on the awaited result; verify reveal does too).

- [ ] **Step 2: Verify + commit**

Run: `cd frontend && npm run lint && npx tsc --noEmit`
Expected: clean.

```bash
cd /home/aashim/hackathon/stellar-hacks
git add frontend/src/app/deposit/page.tsx frontend/src/components/site/withdraw/withdraw-flow.tsx
git commit -m "fix(frontend): complete error/loading/reduced-motion states for live flows"
```

---

### Task 20 (D3): End-to-end runbook

**Files:**
- Create: `docs/RUNBOOK-e2e.md`

- [ ] **Step 1: Write the runbook**

```markdown
# zk-houdini local e2e runbook

Prereqs: `stellar` CLI on PATH with a funded `bridge-relayer` identity; `relayer/config.toml` present (copy from `config.example.toml`, set `evm_rpc`); a MetaMask account funded with Sepolia ETH; Freighter on testnet.

1. Start the relayer HTTP server (loopback):
   `cargo run --manifest-path relayer/Cargo.toml -- --config relayer/config.toml serve`
2. Start the backing daemon (anchors EVM roots into the Soroban pool):
   `cargo run --manifest-path relayer/Cargo.toml -- --config relayer/config.toml backing`
3. Start the frontend (proxies /api/relayer/* to 127.0.0.1:8080):
   `cd frontend && RELAYER_URL=http://127.0.0.1:8080 npm run dev`
4. Deposit: open http://localhost:3000/deposit → connect MetaMask (Sepolia) → "Get test USDC" → pick 1 USDC → Lock. Save the printed note.
5. Wait ~1 min for the backing daemon to anchor the new root (watch its logs for `update_root ... tx`).
6. Withdraw: open /withdraw → paste the note → connect Freighter → add zUSDC trustline if prompted → Reveal. Confirm zUSDC arrives at your Stellar address.

Troubleshooting:
- `UnknownRoot` on withdraw → the root isn't anchored yet; wait for the backing daemon, retry.
- `/path` 502 → EVM RPC down or rate-limited; check `evm_rpc` in config.toml.
- Proof slow → first proof loads the 4.3 MB zkey; subsequent proofs reuse it.
```

- [ ] **Step 2: Commit**

```bash
cd /home/aashim/hackathon/stellar-hacks
git add docs/RUNBOOK-e2e.md
git commit -m "docs: local end-to-end runbook (relayer + backing + frontend)"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** config/env (A2), proxy (A8), poseidon2+tests (A3/A4), note (A5), proofconv (A6), recipient_fr (A7), relayer client (A8), browser proving + artifacts (A9), EVM deposit (B1–B3), wallet bar (B4/C4), Freighter+trustline (C1), withdraw orchestration+UI (C2/C3), honest limitations (D1), errors/reduced-motion (D2), runbook (D3). All §-sections of the spec map to tasks.
- **Placeholder scan:** none — every code step has full code; the only deliberately deferred detail is exact third-party import names (stellar-sdk / Wallets Kit / Next route handler), each gated behind a "read the docs" step because the installed versions are the source of truth.
- **Type consistency:** `WithdrawBody` (A6) consumed by relayer client (A8) and orchestration (C2); `PathProof` (A8) consumed by `prove` (A9) and `run` (C2); `Note` fields (`denom/secret/nullifier/leafIndex`) consistent across A5→B2→C2; `recipient_fr` decimal (A7) feeds `prove` circuit input and hex (A6) feeds the withdraw body. Names align.
