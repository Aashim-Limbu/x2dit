import { test, expect, vi } from "vitest";
import {
  Keypair,
  Transaction,
  TransactionBuilder,
  Networks,
} from "@stellar/stellar-sdk";
import { STELLAR } from "../config";

// Silence unused-import lint; STELLAR is referenced to confirm the import resolves.
void STELLAR;

// Stub wallet.ts so the freighter-api CJS module is never loaded in the Node test env.
vi.mock("./wallet", () => ({
  connectFreighter: vi.fn(),
  signXdr: vi.fn(),
}));

import { buildChangeTrustXdr } from "./trustline";

test("buildChangeTrustXdr produces a decodable changeTrust tx for the account", () => {
  const kp = Keypair.random();
  // minimal source account at sequence 0
  const xdr = buildChangeTrustXdr(kp.publicKey(), "0");
  // fromXDR returns Transaction | FeeBumpTransaction; cast to Transaction
  // since buildChangeTrustXdr always builds a regular Transaction.
  const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET) as Transaction;
  expect(tx.source).toBe(kp.publicKey());
  expect(tx.operations[0].type).toBe("changeTrust");
});
