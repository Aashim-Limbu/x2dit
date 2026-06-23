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
