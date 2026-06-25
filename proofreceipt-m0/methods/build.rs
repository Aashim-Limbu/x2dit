fn main() {
    // Compiles methods/guest to RISC-V and emits, into OUT_DIR/methods.rs,
    // the constants M0_GUEST_ELF (the program bytes) and M0_GUEST_ID (image id).
    risc0_build::embed_methods();
}
