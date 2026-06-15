pragma circom 2.2.2;

include "poseidon2/poseidon2_hash.circom";
include "merkle.circom";

// Withdrawal proof for the private bridge.
// PRIVATE: secret, nullifier, pathElements[20], pathIndices[20]
// PUBLIC : root, nullifierHash, recipient, denomination   (EXACT order)
template Withdraw(levels) {
    signal input secret;
    signal input nullifier;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    signal input root;
    signal input nullifierHash;
    signal input recipient;
    signal input denomination;

    // 1) commitment = Poseidon2(2)([nullifier, secret], dsep=0)
    component commit = Poseidon2(2);
    commit.inputs[0] <== nullifier;
    commit.inputs[1] <== secret;
    commit.domainSeparation <== 0;

    // 2) nullifierHash = Poseidon2(1)([nullifier], dsep=0)
    component nh = Poseidon2(1);
    nh.inputs[0] <== nullifier;
    nh.domainSeparation <== 0;
    nullifierHash === nh.out;

    // 3) Merkle membership of the commitment under the public root
    component tree = MerkleProof(levels);
    tree.leaf <== commit.out;
    for (var i = 0; i < levels; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i]  <== pathIndices[i];
    }
    root === tree.root;

    // 4) Malleability guard: bind recipient & denomination into the witness.
    signal recipientSq;
    signal denomSq;
    recipientSq <== recipient * recipient;
    denomSq     <== denomination * denomination;
}

component main {public [root, nullifierHash, recipient, denomination]} = Withdraw(20);
