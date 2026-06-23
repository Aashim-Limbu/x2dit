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
