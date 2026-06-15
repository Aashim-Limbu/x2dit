// SPDX-License-Identifier: MIT
// Adapted from tornadocash/tornado-core MerkleTreeWithHistory.sol (MIT).
// Changes: solc ^0.8.24; uint256 leaves; IHasher.compress instead of MiMC sponge;
//          zeros[] HARDCODED (O(1)) so a deposit stays well under the Sepolia block gas limit.
//          The hardcoded values are asserted == hasher-computed in the test suite.
pragma solidity ^0.8.24;

import {IHasher} from "./IHasher.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract MerkleTreeWithHistory is Ownable {
    uint256 public constant FIELD_SIZE =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint32 public constant ROOT_HISTORY_SIZE = 30;

    IHasher public immutable hasher;
    uint32 public immutable levels;
    uint256 public immutable zeroValue;

    mapping(uint256 => uint256) public filledSubtrees;
    mapping(uint256 => uint256) public roots;
    uint32 public currentRootIndex = 0;
    uint32 public nextIndex = 0;

    constructor(uint32 _levels, IHasher _hasher, uint256 _zeroValue) Ownable(msg.sender) {
        require(_levels == 20, "this build hardcodes zeros for levels=20");
        require(_zeroValue == _zeros(0), "zeroValue must match hardcoded zeros[0]");
        levels = _levels;
        hasher = _hasher;
        zeroValue = _zeroValue;

        for (uint32 i = 0; i < _levels; i++) {
            filledSubtrees[i] = _zeros(i);
        }
        roots[0] = _zeros(_levels); // root of the empty tree = zeros[levels]
    }

    /// @dev Precomputed zeros[0..20] for the t=2 Poseidon2 compress (zeros[0]=0; zeros[i]=compress(z,z)).
    ///      Asserted equal to the on-chain hasher in MerkleTreeWithHistoryTest.test_HardcodedZerosMatchHasher.
    function _zeros(uint256 i) internal pure returns (uint256) {
        uint256[21] memory z = [
            uint256(0x0000000000000000000000000000000000000000000000000000000000000000),
            uint256(0x228981b886e5effb2c05a6be7ab4a05fde6bf702a2d039e46c87057dd729ef97),
            uint256(0x218fbf2e2f12f0475d3dcf2e0ab1bd4b9ab528e954738c18c4b7c9b5f4b84964),
            uint256(0x2e16a8d602271ea50b5a1bd35b854610ef0bddf8f385bdeb0bb31c4562fa0cd6),
            uint256(0x2b44a101801fa0b810feb3d82c25e71b88bc6f4aeecd9fcdc2152b1f3c38d044),
            uint256(0x19f2fcaf65567ab8803e4fb84e67854815d83a4e1b7be24c6814ba2ba9bdc5ca),
            uint256(0x1a3bd772e2782ad018b9c451bf66c3b0ad223a0e68347fae11c78681bf6478df),
            uint256(0x034d4539eb24682272ab024133ca575c1cade051f9fdce5948b6b806767e225b),
            uint256(0x2971eb2b9cd60a1270db7ab8aada485f64fae5a5e85bed736c67329c410fffee),
            uint256(0x2ef220cf75c94a6bc8f4900fe8153ce53132c2de05163d55ecd0fd13519104b4),
            uint256(0x2075381e03f1e1f60029fc3079d49b918c967b58e2655b1770c86ca3984ab65c),
            uint256(0x1d4789eb40dffb09091a0690d88df7ff993c23d172e866a93631f6792909118c),
            uint256(0x2b082d0afac14544d746c924d6fc882f6931b7b6aacd796c82d7fe81ce33ce4c),
            uint256(0x175c16bc97822dba5fdf5580638d4983831dab655f5095bde23b6685f61981cd),
            uint256(0x0c4b05c87053bf236ef505872eac4304546d3c4f989b1d19b93ef9115e883f66),
            uint256(0x2d7e044c16807771000769efac4e9147a90359c5f58da39880697de3afdd6d56),
            uint256(0x18b029a33a590d748323e8d6cb8ac7636cdff4a154ddb7e19ac9cb6845adff69),
            uint256(0x1e45bd2b39d74ef50d211fc7303d55a06478517cd44887308ba40cb6d4d44216),
            uint256(0x189b2c3495c37308649a0c3e9fe3dd06e83612e9cb1528833acf358bc9b43271),
            uint256(0x0ec11644818dab9d62fdacacda9fdc5d2fb6f4627a332e3b25bbbc7dfb0672e7),
            uint256(0x119827e780a1850d7b7e34646edc1ce918211c26dda4e13bcd1611f6f81c3680)
        ];
        return z[i];
    }

    function zeros(uint256 i) external pure returns (uint256) {
        return _zeros(i);
    }

    function _insert(uint256 _leaf) internal returns (uint32 index) {
        uint32 _nextIndex = nextIndex;
        require(_nextIndex != uint32(2) ** levels, "Merkle tree is full");
        require(_leaf < FIELD_SIZE, "leaf not in field");

        uint32 currentIndex = _nextIndex;
        uint256 currentLevelHash = _leaf;
        uint256 left;
        uint256 right;

        for (uint32 i = 0; i < levels; i++) {
            if (currentIndex % 2 == 0) {
                left = currentLevelHash;
                right = _zeros(i);
                filledSubtrees[i] = currentLevelHash;
            } else {
                left = filledSubtrees[i];
                right = currentLevelHash;
            }
            currentLevelHash = hasher.compress(left, right);
            currentIndex /= 2;
        }

        uint32 newRootIndex = (currentRootIndex + 1) % ROOT_HISTORY_SIZE;
        currentRootIndex = newRootIndex;
        roots[newRootIndex] = currentLevelHash;
        nextIndex = _nextIndex + 1;
        return _nextIndex;
    }

    function isKnownRoot(uint256 _root) public view returns (bool) {
        if (_root == 0) {
            return false;
        }
        uint32 _currentRootIndex = currentRootIndex;
        uint32 i = _currentRootIndex;
        do {
            if (_root == roots[i]) {
                return true;
            }
            if (i == 0) {
                i = ROOT_HISTORY_SIZE;
            }
            i--;
        } while (i != _currentRootIndex);
        return false;
    }

    function getLastRoot() public view returns (uint256) {
        return roots[currentRootIndex];
    }

    /// @notice Owner (the PrivacyPoolDeposit that deployed this tree) inserts a leaf.
    function insertLeaf(uint256 leaf) external onlyOwner returns (uint32) {
        return _insert(leaf);
    }
}
