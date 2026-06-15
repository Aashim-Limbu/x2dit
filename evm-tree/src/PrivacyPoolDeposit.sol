// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IHasher} from "./IHasher.sol";
import {MerkleTreeWithHistory} from "./MerkleTreeWithHistory.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title PrivacyPoolDeposit
/// @notice One independent Merkle tree per denomination. Locks test-USDC and
///         inserts commitment leaves. Mirrors the shared interface contract:
///         commitment = Poseidon2(2) sponge (t=3, computed off-chain).
contract PrivacyPoolDeposit is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Empty-leaf value for the trees. Pinned to 0 to match the spike's zeros table
    // (keystone-validated) and the circuit/relayer convention. A commitment can never
    // be 0 (rejected below + Poseidon2 outputs are effectively never 0).
    uint256 internal constant ZERO_VALUE = 0;

    IERC20 public immutable token;
    IHasher public immutable hasher;
    uint32 public immutable levels;

    uint256[] public denominations;            // index -> USDC amount (6 decimals)
    MerkleTreeWithHistory[] public trees;       // index -> tree for that denom
    // denomIndex => commitment => used
    mapping(uint8 => mapping(uint256 => bool)) public commitments;

    event Deposit(uint8 indexed denomIndex, uint256 indexed commitment, uint32 leafIndex);
    event RootUpdated(uint8 indexed denomIndex, uint256 root, uint32 rootIndex);

    constructor(
        IHasher _hasher,
        address _token,
        uint32 _levels,
        uint256[] memory _denominations
    ) {
        require(_denominations.length > 0, "no denominations");
        require(_denominations.length <= 256, "too many denominations");
        hasher = _hasher;
        token = IERC20(_token);
        levels = _levels;

        for (uint256 i = 0; i < _denominations.length; i++) {
            require(_denominations[i] > 0, "denom must be > 0");
            denominations.push(_denominations[i]);
            trees.push(new MerkleTreeWithHistory(_levels, _hasher, ZERO_VALUE));
        }
    }

    function denominationCount() external view returns (uint256) {
        return denominations.length;
    }

    function deposit(uint8 denomIndex, uint256 commitment)
        external
        nonReentrant
        returns (uint32 leafIndex)
    {
        require(denomIndex < denominations.length, "bad denom index");
        require(commitment != 0, "zero commitment");
        require(!commitments[denomIndex][commitment], "commitment already used");

        // Lock exactly the denomination amount of test-USDC.
        token.safeTransferFrom(msg.sender, address(this), denominations[denomIndex]);

        commitments[denomIndex][commitment] = true;
        MerkleTreeWithHistory tree = trees[denomIndex];
        leafIndex = tree.insertLeaf(commitment);

        emit Deposit(denomIndex, commitment, leafIndex);
        emit RootUpdated(denomIndex, tree.getLastRoot(), tree.currentRootIndex());
        return leafIndex;
    }

    // --- views proxied per denomination ---
    function getLastRoot(uint8 denomIndex) external view returns (uint256) {
        require(denomIndex < denominations.length, "bad denom index");
        return trees[denomIndex].getLastRoot();
    }

    function isKnownRoot(uint8 denomIndex, uint256 root) external view returns (bool) {
        require(denomIndex < denominations.length, "bad denom index");
        return trees[denomIndex].isKnownRoot(root);
    }

    function nextIndex(uint8 denomIndex) external view returns (uint32) {
        require(denomIndex < denominations.length, "bad denom index");
        return trees[denomIndex].nextIndex();
    }
}
