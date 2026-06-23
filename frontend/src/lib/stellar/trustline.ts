import {
  Account,
  Asset,
  Networks,
  Operation,
  TransactionBuilder,
  BASE_FEE,
  Horizon,
} from "@stellar/stellar-sdk";
import { STELLAR } from "../config";
import { signXdr } from "./wallet";

const ZUSDC = new Asset(STELLAR.zusdcCode, STELLAR.zusdcIssuer);
const horizon = () => new Horizon.Server(STELLAR.horizonUrl);

export function buildChangeTrustXdr(address: string, sequence: string): string {
  const account = new Account(address, sequence);
  return new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.changeTrust({ asset: ZUSDC }))
    .setTimeout(180)
    .build()
    .toXDR();
}

export async function hasZusdcTrustline(address: string): Promise<boolean> {
  const acct = await horizon().loadAccount(address);
  return acct.balances.some(
    (b) =>
      "asset_code" in b &&
      b.asset_code === STELLAR.zusdcCode &&
      b.asset_issuer === STELLAR.zusdcIssuer,
  );
}

export async function addZusdcTrustline(address: string): Promise<string> {
  const acct = await horizon().loadAccount(address);
  const xdr = buildChangeTrustXdr(address, acct.sequenceNumber());
  const signed = await signXdr(xdr, address);
  const tx = TransactionBuilder.fromXDR(signed, Networks.TESTNET);
  const res = await horizon().submitTransaction(tx);
  return res.hash;
}
