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

test("pins to an independently computed reference value", () => {
  // Reference computed independently (Python raw base32 strkey decode -> be int mod P),
  // NOT via stellar-sdk StrKey, so this catches a wrong byte order or missing modulo.
  expect(recipientFrField("GBLU6A6OKK35QZR5SIYYNF7PFMKIBEFPOJ6OZP3NM2HWN67DUTFOMIXW")).toBe(
    17602582140721684223703826335999872581136592420623685882918464571095946414821n,
  );
});
