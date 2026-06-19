# EVM Deployment — Ethereum Sepolia (chainId 11155111)

Deployed 2026-06-19 via `forge script script/Deploy.s.sol:Deploy --broadcast --verify`.
All contracts verified on Etherscan.

| Contract | Address | Etherscan |
|----------|---------|-----------|
| Poseidon2 (t=2 hasher) | `0x1d67b922dfed90ab36e267c65cd649977a9385c8` | https://sepolia.etherscan.io/address/0x1d67b922dfed90ab36e267c65cd649977a9385c8 |
| MockUSDC (mUSDC, 6dp, open mint) | `0x1a39a02a3a776b354a5c97373dde715c419c6ab5` | https://sepolia.etherscan.io/address/0x1a39a02a3a776b354a5c97373dde715c419c6ab5 |
| PrivacyPoolDeposit | `0x4c781728f3f53f220c6f226610cd24d8b1e8e7ef` | https://sepolia.etherscan.io/address/0x4c781728f3f53f220c6f226610cd24d8b1e8e7ef |
| └ tree denom[0] = 1 USDC | `0x65bb45c28ac0d432c1d0879a49d0dc4e18e7b121` | (nested) |
| └ tree denom[1] = 10 USDC | `0x101de43219b5141aad4563c29f7d2a1c6fa6e9c5` | (nested) |
| └ tree denom[2] = 100 USDC | `0xd48a25c88bb54773eccf88f04f8932068a7a734a` | (nested) |

- Deployer: `0x65ee5CaB1e11e7bd456E15c39E83b997DCD953F9`
- Deploy block: **11089276** (relayer `from_block` start)
- Denominations: index 0/1/2 -> 1e6 / 10e6 / 100e6 mUSDC (6 decimals)
- Deposit event: `Deposit(uint8 indexed denomIndex, uint256 indexed commitment, uint32 leafIndex)`
- Root event: `RootUpdated(uint8 indexed denomIndex, uint256 root, uint32 rootIndex)`

## Demo faucet
`MockUSDC.mint(address,uint256)` is open — anyone can mint mUSDC to test deposits.
