"use client";
import {
  createPublicClient, createWalletClient, custom, type EIP1193Provider,
} from "viem";
import { sepolia } from "viem/chains";
import { EVM } from "../config";

export function getInjected(): EIP1193Provider {
  const eth = (globalThis as { ethereum?: EIP1193Provider }).ethereum;
  if (!eth) throw new Error("No EVM wallet found. Install MetaMask to deposit.");
  return eth;
}

export async function ensureSepolia(provider: EIP1193Provider): Promise<void> {
  const hexId = `0x${EVM.chainId.toString(16)}`;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch (err) {
    if ((err as { code?: number }).code === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: hexId, chainName: EVM.name,
          nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: [EVM.rpcFallback], blockExplorerUrls: ["https://sepolia.etherscan.io"],
        }],
      });
    } else throw err;
  }
}

export async function connectWallet(): Promise<{ address: `0x${string}` }> {
  const provider = getInjected();
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as `0x${string}`[];
  if (!accounts?.length) throw new Error("No account authorized.");
  await ensureSepolia(provider);
  return { address: accounts[0] };
}

export function publicClient() {
  return createPublicClient({ chain: sepolia, transport: custom(getInjected()) });
}

export function walletClient(account: `0x${string}`) {
  return createWalletClient({ account, chain: sepolia, transport: custom(getInjected()) });
}
