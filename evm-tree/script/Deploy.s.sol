// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {Poseidon2} from "../src/Poseidon2.sol";
import {IHasher} from "../src/IHasher.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {PrivacyPoolDeposit} from "../src/PrivacyPoolDeposit.sol";

/// Deploys the hasher, MockUSDC, and the pool ([1,10,100] USDC) in one broadcast.
/// Usage:
///   DEPLOYER_PRIVATE_KEY=0x... forge script script/Deploy.s.sol:Deploy \
///     --rpc-url "$SEPOLIA_RPC_URL" --broadcast --verify --etherscan-api-key "$ETHERSCAN_API_KEY"
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(pk);

        Poseidon2 hasher = new Poseidon2();
        MockUSDC usdc = new MockUSDC();

        uint256 ONE = 1_000_000; // 6 decimals
        uint256[] memory denoms = new uint256[](3);
        denoms[0] = 1 * ONE;
        denoms[1] = 10 * ONE;
        denoms[2] = 100 * ONE;

        PrivacyPoolDeposit pool =
            new PrivacyPoolDeposit(IHasher(address(hasher)), address(usdc), 20, denoms);

        vm.stopBroadcast();

        console2.log("Poseidon2:          ", address(hasher));
        console2.log("MockUSDC:           ", address(usdc));
        console2.log("PrivacyPoolDeposit: ", address(pool));
        console2.log("Denominations (6dp): 1e6 / 10e6 / 100e6");
    }
}
