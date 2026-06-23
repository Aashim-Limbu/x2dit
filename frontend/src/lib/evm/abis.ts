export const MOCK_USDC_ABI = [
  { type: "function", name: "mint", stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "approve", stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

export const POOL_ABI = [
  { type: "function", name: "deposit", stateMutability: "nonpayable",
    inputs: [{ name: "denomIndex", type: "uint8" }, { name: "commitment", type: "uint256" }],
    outputs: [{ name: "leafIndex", type: "uint32" }] },
  { type: "event", name: "Deposit", inputs: [
    { name: "denomIndex", type: "uint8", indexed: true },
    { name: "commitment", type: "uint256", indexed: true },
    { name: "leafIndex", type: "uint32", indexed: false },
  ] },
] as const;
