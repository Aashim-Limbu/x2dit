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
