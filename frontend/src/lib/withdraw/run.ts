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
