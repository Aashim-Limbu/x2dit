//! Off-chain Merkle path service: reconstruct a denomination's tree from its
//! ordered deposit commitments and emit the circuit-ready proof for a leaf.
use crate::merkle::MerkleTree;
use crate::poseidon::{to_be_bytes, Fr};
use ark_ff::PrimeField;
use serde::Serialize;

pub const DEPTH: usize = 20;

#[derive(Serialize, Debug, Clone)]
pub struct PathProof {
    pub leaf_index: usize,
    pub root: String,                 // decimal
    pub root_hex: String,
    pub path_elements: Vec<String>,   // decimal
    pub path_indices: Vec<String>,    // "0"/"1"
}

fn to_dec(x: &Fr) -> String {
    // big-endian bytes -> decimal string (no extra deps).
    let mut digits = alloc_dec(&to_be_bytes(x));
    if digits.is_empty() { digits.push(b'0'); }
    String::from_utf8(digits).unwrap()
}

// Convert 32 big-endian bytes to a decimal ASCII string via repeated base-256 -> base-10.
fn alloc_dec(be: &[u8]) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::new(); // little-endian decimal digits (0-9)
    for &byte in be {
        let mut carry = byte as u32;
        for d in out.iter_mut() {
            let v = (*d as u32) * 256 + carry;
            *d = (v % 10) as u8;
            carry = v / 10;
        }
        while carry > 0 {
            out.push((carry % 10) as u8);
            carry /= 10;
        }
    }
    out.iter().rev().map(|d| d + b'0').collect()
}

/// Build the tree from ordered leaves and produce the proof for `leaf_index`.
pub fn path_for(leaves: &[Fr], leaf_index: usize) -> PathProof {
    let mut tree = MerkleTree::new(DEPTH);
    for l in leaves { tree.insert(*l); }
    let (pe, pi) = tree.proof(leaf_index);
    let root = tree.root();
    PathProof {
        leaf_index,
        root: to_dec(&root),
        root_hex: crate::poseidon::to_hex(&root),
        path_elements: pe.iter().map(to_dec).collect(),
        path_indices: pi.iter().map(|b| b.to_string()).collect(),
    }
}
