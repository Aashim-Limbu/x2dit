// Decode the M3 findings bitmask committed in journal[32..36]. Bits (LSB first):
//   0 = allowlist violation, 1 = denylist hit, 2 = auth-presence failure.
// Bits 3..31 are reserved (always 0 in M3).
//
// Scope of verdict 0 (import-level analysis only): it means no out-of-interface
// imports and no denylisted host fns (test-only / wasm self-upload-update). It does
// NOT mean "no dangerous capability" (e.g. create_contract / cross-contract call are
// not flagged) nor that storage writes are actually auth-gated (bit 2 is presence of
// an auth import, not enforcement).
export function decodeVerdict(verdict: number): string[] {
  const findings: string[] = [];
  if (verdict & 0b001) findings.push("allowlist-violation: imports an unknown/non-host-fn");
  if (verdict & 0b010) findings.push("denylist-hit: imports a forbidden host fn");
  if (verdict & 0b100) findings.push("auth-presence: writes storage without importing an auth host fn");
  return findings;
}
