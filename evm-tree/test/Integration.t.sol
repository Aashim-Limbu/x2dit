// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Poseidon2} from "../src/Poseidon2.sol";
import {IHasher} from "../src/IHasher.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {PrivacyPoolDeposit} from "../src/PrivacyPoolDeposit.sol";

contract IntegrationTest is Test {
    PrivacyPoolDeposit pool;
    MockUSDC usdc;
    address alice = address(0xA11CE);
    uint256 constant ONE = 1_000_000;

    function setUp() public {
        IHasher hasher = IHasher(address(new Poseidon2()));
        usdc = new MockUSDC();
        uint256[] memory d = new uint256[](3);
        d[0] = ONE; d[1] = 10 * ONE; d[2] = 100 * ONE;
        pool = new PrivacyPoolDeposit(hasher, address(usdc), 20, d);
        usdc.mint(alice, 10_000 * ONE);
        vm.prank(alice);
        usdc.approve(address(pool), type(uint256).max);
    }

    function test_LeafIndexMonotonicPerDenomAndRootHistory() public {
        vm.startPrank(alice);
        uint256[] memory roots = new uint256[](5);
        for (uint256 i = 0; i < 5; i++) {
            uint32 idx = pool.deposit(0, uint256(1_000 + i));
            assertEq(idx, uint32(i), "leaf index must equal deposit count");
            roots[i] = pool.getLastRoot(0);
        }
        vm.stopPrank();

        for (uint256 i = 0; i < 5; i++) {
            assertTrue(pool.isKnownRoot(0, roots[i]), "recent root must be anchorable");
        }
        assertFalse(pool.isKnownRoot(0, uint256(0xBADBAD)), "unknown root rejected");
    }

    function test_DenomTreesDoNotShareState() public {
        vm.startPrank(alice);
        pool.deposit(0, uint256(0xA));
        uint256 root0 = pool.getLastRoot(0);
        pool.deposit(2, uint256(0xB));
        uint256 root2 = pool.getLastRoot(2);
        vm.stopPrank();
        assertFalse(pool.isKnownRoot(2, root0), "denom0 root must not be known in denom2");
        assertFalse(pool.isKnownRoot(0, root2), "denom2 root must not be known in denom0");
    }
}
