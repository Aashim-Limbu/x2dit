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
