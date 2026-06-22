// Real, public testnet deployment facts. Source of truth: deployments/testnet.env.
export const REPO_URL = "https://github.com/Aashim-Limbu/zk-houdini";

export const FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export const EVM = {
  chainId: 11155111,
  name: "Ethereum Sepolia",
  short: "Sepolia",
  pool: "0x4c781728f3f53f220c6f226610cd24d8b1e8e7ef",
  mockUsdc: "0x1a39a02a3a776b354a5c97373dde715c419c6ab5",
  deployBlock: 11089276,
  // Read-only fallback RPC; reads normally go through the injected wallet.
  rpcFallback:
    process.env.NEXT_PUBLIC_SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com",
} as const;

export const STELLAR = {
  name: "Stellar Testnet",
  short: "Stellar",
  passphrase: "Test SDF Network ; September 2015",
  rpcUrl: process.env.NEXT_PUBLIC_SOROBAN_RPC ?? "https://soroban-testnet.stellar.org",
  horizonUrl: "https://horizon-testnet.stellar.org",
  pool: "CDFQ5K2BPKB7BWNW2SJPGIIK5OOFQIR434MOX5YYBDKAN3M5CFVJKHR2",
  verifier: "CBXA7364AEVDQV2Z4CW7IUYSHO7JTETPUR6Y5FET2QAC5GWTNPN3ZGFH",
  zusdcSac: "CAIUOHVZ77RSCDBNWR3BCZPTWHPUXQRTQXSW4VE3HGC2M5PRPJNSFBRU",
  // zUSDC classic asset for trustlines: code + issuer (deployments/testnet.env).
  zusdcCode: "zUSDC",
  zusdcIssuer: "GAA3S6XLOKFX3SGDQ3VGLLXMCFMVB7E6WYNGHRGIRD62AEJ73ASPQ4KX",
} as const;

export const DENOM_VALUES = [1, 10, 100] as const;
export type DenomValue = (typeof DENOM_VALUES)[number];

export const DENOMS = [
  { value: 1, label: "1 USDC" },
  { value: 10, label: "10 USDC" },
  { value: 100, label: "100 USDC" },
] as const;

export function denomIndex(value: number): number {
  const i = DENOM_VALUES.indexOf(value as DenomValue);
  if (i < 0) throw new Error(`unknown denomination: ${value}`);
  return i;
}

export function denomAmountUsdc(value: number): bigint {
  denomIndex(value); // validate
  return BigInt(value) * 1_000_000n;
}

export function relayerPath(suffix: string): string {
  return `/api/relayer/${suffix}`;
}

export const etherscan = {
  address: (a: string) => `https://sepolia.etherscan.io/address/${a}`,
  tx: (h: string) => `https://sepolia.etherscan.io/tx/${h}`,
};

export const stellarExpert = {
  contract: (c: string) => `https://stellar.expert/explorer/testnet/contract/${c}`,
  tx: (h: string) => `https://stellar.expert/explorer/testnet/tx/${h}`,
  account: (a: string) => `https://stellar.expert/explorer/testnet/account/${a}`,
};

export function truncate(id: string, head = 6, tail = 4): string {
  if (id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}
