// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Poseidon2} from "../src/Poseidon2.sol";

// Parity against the keystone vectors (spike/poseidon2_vectors.json), validated 2026-06-15.
contract Poseidon2Test is Test {
    Poseidon2 h;
    function setUp() public { h = new Poseidon2(); }

    function test_PermParity() public view {
        (uint256 o0, uint256 o1) = h.perm(1, 2);
        assertEq(o0, 0x0e90c132311e864e0c8bca37976f28579a2dd9436bbc11326e21ec7c00cea5b2, "perm[0]");
        assertEq(o1, 0x303a321e3ba2d1e7a7ad5b7d72cb13c4cbf5547c947a5c59c549d98498adbafe, "perm[1]");
    }
    function test_CompressParity() public view {
        assertEq(h.compress(1, 2), 0x0e90c132311e864e0c8bca37976f28579a2dd9436bbc11326e21ec7c00cea5b3, "compress");
    }
}
