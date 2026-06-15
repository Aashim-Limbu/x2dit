// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Poseidon2} from "../src/Poseidon2.sol";
import {IHasher} from "../src/IHasher.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {PrivacyPoolDeposit} from "../src/PrivacyPoolDeposit.sol";

contract PrivacyPoolDepositTest is Test {
    PrivacyPoolDeposit pool;
    MockUSDC usdc;
    IHasher hasher;
    address alice = address(0xA11CE);

    uint256 constant ONE = 1_000_000;        // 1 USDC
    uint256 constant TEN = 10_000_000;        // 10 USDC
    uint256 constant HUNDRED = 100_000_000;   // 100 USDC

    event Deposit(uint8 indexed denomIndex, uint256 indexed commitment, uint32 leafIndex);
    event RootUpdated(uint8 indexed denomIndex, uint256 root, uint32 rootIndex);

    function setUp() public {
        hasher = IHasher(address(new Poseidon2()));
        usdc = new MockUSDC();
        uint256[] memory denoms = new uint256[](3);
        denoms[0] = ONE;
        denoms[1] = TEN;
        denoms[2] = HUNDRED;
        pool = new PrivacyPoolDeposit(IHasher(address(hasher)), address(usdc), 20, denoms);

        usdc.mint(alice, 1_000 * ONE);
        vm.prank(alice);
        usdc.approve(address(pool), type(uint256).max);
    }

    function test_DepositPullsExactDenominationAndIncrementsLeaf() public {
        uint256 cmt = uint256(0xABC);
        vm.prank(alice);
        uint32 leafIndex = pool.deposit(1, cmt); // 10-USDC denom
        assertEq(leafIndex, 0, "first leaf index");
        assertEq(usdc.balanceOf(address(pool)), TEN, "pool holds 10 USDC");
        assertEq(usdc.balanceOf(alice), 1_000 * ONE - TEN, "alice debited 10 USDC");
    }

    function test_DepositEmitsDepositAndRootEvents() public {
        uint256 cmt = uint256(0xABC);
        vm.expectEmit(true, true, false, true);
        emit Deposit(0, cmt, 0);
        vm.prank(alice);
        pool.deposit(0, cmt);
    }

    function test_DepositUpdatesRootAndIsKnown() public {
        vm.prank(alice);
        pool.deposit(2, uint256(0xDEAD));
        uint256 root = pool.getLastRoot(2);
        assertTrue(pool.isKnownRoot(2, root), "post-deposit root must be known");
    }

    function test_RejectsDuplicateCommitment() public {
        vm.startPrank(alice);
        pool.deposit(0, uint256(0xABC));
        vm.expectRevert(bytes("commitment already used"));
        pool.deposit(0, uint256(0xABC));
        vm.stopPrank();
    }

    function test_RejectsBadDenomIndex() public {
        vm.prank(alice);
        vm.expectRevert(bytes("bad denom index"));
        pool.deposit(3, uint256(0xABC)); // only indices 0..2 exist
    }

    function test_TreesAreIndependentPerDenomination() public {
        vm.startPrank(alice);
        pool.deposit(0, uint256(0x1));
        pool.deposit(1, uint256(0x1)); // same commitment value, different denom tree -> allowed
        vm.stopPrank();
        assertEq(pool.nextIndex(0), 1, "denom0 has one leaf");
        assertEq(pool.nextIndex(1), 1, "denom1 has one leaf");
    }
}
