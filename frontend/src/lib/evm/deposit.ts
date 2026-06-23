"use client";
import { parseEventLogs, type Log } from "viem";
import { publicClient, walletClient } from "./client";
import { MOCK_USDC_ABI, POOL_ABI } from "./abis";
import { EVM, denomIndex, denomAmountUsdc } from "../config";
import { newNoteSecrets, commitmentOf, encodeNote } from "../crypto/note";

const POOL = EVM.pool as `0x${string}`;
const USDC = EVM.mockUsdc as `0x${string}`;

export function leafIndexFromLogs(logs: Log[]): number {
  const parsed = parseEventLogs({ abi: POOL_ABI, eventName: "Deposit", logs });
  if (!parsed.length) throw new Error("Deposit event not found in receipt");
  return Number((parsed[0].args as { leafIndex: number | bigint }).leafIndex);
}

export async function usdcBalance(account: `0x${string}`): Promise<bigint> {
  return publicClient().readContract({
    address: USDC, abi: MOCK_USDC_ABI, functionName: "balanceOf", args: [account],
  });
}

export async function faucet(account: `0x${string}`, value: number): Promise<`0x${string}`> {
  const wc = walletClient(account);
  const hash = await wc.writeContract({
    address: USDC, abi: MOCK_USDC_ABI, functionName: "mint",
    args: [account, denomAmountUsdc(value)],
  });
  await publicClient().waitForTransactionReceipt({ hash });
  return hash;
}

export async function ensureAllowance(account: `0x${string}`, value: number): Promise<void> {
  const amount = denomAmountUsdc(value);
  const current = await publicClient().readContract({
    address: USDC, abi: MOCK_USDC_ABI, functionName: "allowance", args: [account, POOL],
  });
  if (current >= amount) return;
  const hash = await walletClient(account).writeContract({
    address: USDC, abi: MOCK_USDC_ABI, functionName: "approve", args: [POOL, amount],
  });
  await publicClient().waitForTransactionReceipt({ hash });
}

export async function deposit(
  account: `0x${string}`,
  value: number,
): Promise<{ note: string; leafIndex: number; txHash: `0x${string}` }> {
  const secrets = newNoteSecrets();
  const commitment = commitmentOf(secrets);
  const hash = await walletClient(account).writeContract({
    address: POOL, abi: POOL_ABI, functionName: "deposit",
    args: [denomIndex(value), commitment],
  });
  const receipt = await publicClient().waitForTransactionReceipt({ hash });
  const leafIndex = leafIndexFromLogs(receipt.logs);
  const note = encodeNote({ denom: value, ...secrets, leafIndex });
  return { note, leafIndex, txHash: hash };
}
