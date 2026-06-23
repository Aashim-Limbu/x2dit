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
