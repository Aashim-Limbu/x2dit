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
