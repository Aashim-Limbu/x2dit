"use client";
// v2.3.0: StellarWalletsKit is a static-only class — no constructor, no instance.
// Initialise once via StellarWalletsKit.init(); all methods are static.
// FREIGHTER_ID and FreighterModule are NOT re-exported from the main index;
// they live in the separate subpath export "@creit.tech/stellar-wallets-kit/modules/freighter".
import { StellarWalletsKit, Networks } from "@creit.tech/stellar-wallets-kit";
import {
  FREIGHTER_ID,
  FreighterModule,
} from "@creit.tech/stellar-wallets-kit/modules/freighter";

let initialised = false;

function ensureInit(): void {
  if (initialised) return;
  StellarWalletsKit.init({
    network: Networks.TESTNET,
    selectedWalletId: FREIGHTER_ID,
    modules: [new FreighterModule()],
  });
  initialised = true;
}

/**
 * Ask Freighter for the user's public key and return the G-address.
 * Uses fetchAddress() to reach directly into the wallet (getAddress() only
 * returns the cached value already stored in kit state, which is empty on
 * first load).
 */
export async function connectFreighter(): Promise<string> {
  ensureInit();
  StellarWalletsKit.setWallet(FREIGHTER_ID);
  const { address } = await StellarWalletsKit.fetchAddress();
  return address;
}

/**
 * Sign a transaction XDR with the currently-selected wallet module and return
 * the signed XDR string.
 */
export async function signXdr(xdr: string, address: string): Promise<string> {
  ensureInit();
  const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
    address,
    networkPassphrase: Networks.TESTNET,
  });
  return signedTxXdr;
}
