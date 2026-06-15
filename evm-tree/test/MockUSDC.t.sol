// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract MockUSDCTest is Test {
    MockUSDC usdc;
    address alice = address(0xA11CE);

    function setUp() public { usdc = new MockUSDC(); }

    function test_DecimalsIsSix() public view { assertEq(usdc.decimals(), 6); }

    function test_PublicMint() public {
        usdc.mint(alice, 1_000_000);
        assertEq(usdc.balanceOf(alice), 1_000_000);
    }
}
