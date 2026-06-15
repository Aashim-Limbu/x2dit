pragma circom 2.2.2;

include "poseidon2/poseidon2_compress.circom";
include "../node_modules/circomlib/circuits/switcher.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

// Verifies a Merkle membership proof of `leaf` against `root`.
// node(left,right) = PoseidonCompress(left,right) = Perm([left,right])[0] + left
// pathIndices[i] = 0 => current hash is LEFT child, sibling on right
// pathIndices[i] = 1 => current hash is RIGHT child, sibling on left
template MerkleProof(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices[levels];   // each constrained to be a bit
    signal output root;

    component switcher[levels];
    component hasher[levels];

    signal cur[levels + 1];
    cur[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        pathIndices[i] * (pathIndices[i] - 1) === 0;

        switcher[i] = Switcher();
        switcher[i].sel <== pathIndices[i];
        switcher[i].L <== cur[i];
        switcher[i].R <== pathElements[i];

        hasher[i] = PoseidonCompress();
        hasher[i].inputs[0] <== switcher[i].outL;
        hasher[i].inputs[1] <== switcher[i].outR;

        cur[i + 1] <== hasher[i].out;
    }

    root <== cur[levels];
}
