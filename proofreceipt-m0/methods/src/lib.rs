// Re-exports the build-time-generated guest constants:
//   M0_GUEST_ELF: &[u8]      — the guest program image
//   M0_GUEST_ID:  [u32; 8]   — the image id (program commitment)
include!(concat!(env!("OUT_DIR"), "/methods.rs"));
