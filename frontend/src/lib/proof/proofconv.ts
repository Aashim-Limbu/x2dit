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
