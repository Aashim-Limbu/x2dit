pragma circom 2.2.2;

// Keystone: prove the SAME engine yields all three bridge hashes, and export them
// as public outputs to pin the canonical cross-surface vectors.
//   - hash2         = Poseidon2(2)  -> Permutation(3) (t=3, domainSeparation=0)  [commitment form]
//   - compress      = PoseidonCompress() -> Permutation(2) (t=2, no domain sep)  [Merkle node]
//   - nullifierHash = Poseidon2(1)  -> Permutation(2) (t=2, domainSeparation=0)  [nullifier]
include "poseidon2/poseidon2_hash.circom";
include "poseidon2/poseidon2_compress.circom";

template Keystone() {
    signal input l;
    signal input r;
    signal output hash2;
    signal output compress;
    signal output nullifierHash;

    component h = Poseidon2(2);
    h.inputs[0] <== l;
    h.inputs[1] <== r;
    h.domainSeparation <== 0;
    hash2 <== h.out;

    component c = PoseidonCompress();
    c.inputs[0] <== l;
    c.inputs[1] <== r;
    compress <== c.out;

    component n = Poseidon2(1);
    n.inputs[0] <== l;
    n.domainSeparation <== 0;
    nullifierHash <== n.out;
}

component main = Keystone();
