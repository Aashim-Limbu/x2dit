//! Baked-in Soroban capability policy. The constants below ARE the agreed policy:
//! changing any of them changes the guest's image_id. Pinned from a real
//! soroban-sdk 25.3.1 artifact cross-checked against soroban-env-common 25.0.1
//! (env.json). See the plan's Global Constraints for the full provenance.
//!
//! Limitations of CLEAN (verdict 0) — this is IMPORT-LEVEL analysis only:
//!  - bit 2 attests an auth host fn is IMPORTED alongside storage writes, NOT that
//!    writes are auth-gated (an unused `require_auth` import clears it).
//!  - allowlist != safelist: `is_known` accepts any real host fn, so CLEAN means
//!    "no test-only fns and no wasm self-upload/update" (the denylist) — NOT "no
//!    dangerous capability". Powerful-but-not-denylisted fns (e.g. create_contract,
//!    cross-contract call, authorize_as_curr_contract) audit CLEAN by design.
//!  - durability (persistent/temporary/instance) is invisible in imports.

use crate::parser::{parse_imports, ParseError};

/// Forbidden host fns (bit 1). Test-only + code self-modification.
const DENYLIST: &[(u8, u8)] = &[(b't', b'_'), (b't', b'0'), (b'l', b'5'), (b'l', b'6')];
/// Storage mutators (auth-presence gate input). put_contract_data, del_contract_data.
const STORAGE_WRITE: &[(u8, u8)] = &[(b'l', b'_'), (b'l', b'2')];
/// Access-control host fns. require_auth, require_auth_for_args.
const AUTH: &[(u8, u8)] = &[(b'a', b'0'), (b'a', b'_')];

/// Number of host fns in each known module (an import is a *known* host fn iff its
/// module is here and its field index < count). Any other module / out-of-range
/// field / non-func kind is an allowlist violation.
fn module_fn_count(m: u8) -> Option<usize> {
    Some(match m {
        b'x' => 10,
        b'i' => 44,
        b'm' => 12,
        b'v' => 19,
        b'l' => 16,
        b'd' => 2,
        b'b' => 26,
        b'c' => 28,
        b'a' => 8,
        b't' => 2,
        b'p' => 4,
        _ => return None,
    })
}

/// Soroban Symbol-alphabet position of a single field byte.
fn field_index(b: u8) -> Option<usize> {
    Some(match b {
        b'_' => 0,
        b'0'..=b'9' => 1 + (b - b'0') as usize,
        b'a'..=b'z' => 11 + (b - b'a') as usize,
        b'A'..=b'Z' => 37 + (b - b'A') as usize,
        _ => return None,
    })
}

/// A known host-fn import: single-byte module + single-byte field, module recognized,
/// field index in range.
fn is_known(module: &[u8], field: &[u8]) -> bool {
    if module.len() != 1 || field.len() != 1 {
        return false;
    }
    match (module_fn_count(module[0]), field_index(field[0])) {
        (Some(count), Some(idx)) => idx < count,
        _ => false,
    }
}

fn in_set(module: &[u8], field: &[u8], set: &[(u8, u8)]) -> bool {
    module.len() == 1
        && field.len() == 1
        && set.iter().any(|&(m, f)| m == module[0] && f == field[0])
}

/// Audit a Soroban contract's WASM and return the findings bitmask. `Err` if the
/// module can't be parsed (the guest turns that into a panic — never a clean verdict).
pub fn audit_verdict(wasm: &[u8]) -> Result<u32, ParseError> {
    let imports = parse_imports(wasm)?;
    let mut verdict: u32 = 0;
    let mut has_storage_write = false;
    let mut has_auth = false;

    for imp in &imports {
        // bit 0: any import that isn't a recognized host-fn (incl. non-func kinds).
        if imp.kind != 0 || !is_known(imp.module, imp.field) {
            verdict |= 0b001;
        }
        // bit 1: denylisted host fn.
        if in_set(imp.module, imp.field, DENYLIST) {
            verdict |= 0b010;
        }
        if in_set(imp.module, imp.field, STORAGE_WRITE) {
            has_storage_write = true;
        }
        if in_set(imp.module, imp.field, AUTH) {
            has_auth = true;
        }
    }

    // bit 2: writes storage but imports no auth host fn.
    if has_storage_write && !has_auth {
        verdict |= 0b100;
    }
    Ok(verdict)
}

#[cfg(test)]
mod tests {
    use super::*;

    const HEADER_AND_TYPE: &[u8] = &[
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
        0x01, 0x04, 0x01, 0x60, 0x00, 0x00,
    ];

    fn with_one_import(module: u8, field: u8) -> alloc::vec::Vec<u8> {
        let mut v = HEADER_AND_TYPE.to_vec();
        v.extend_from_slice(&[0x02, 0x07, 0x01, 0x01, module, 0x01, field, 0x00, 0x00]);
        v
    }

    #[test]
    fn clean_real_contract_is_zero() {
        let wasm = include_bytes!("../tests/fixtures/clean.wasm");
        assert_eq!(audit_verdict(wasm).unwrap(), 0);
    }

    #[test]
    fn empty_imports_is_zero() {
        assert_eq!(audit_verdict(HEADER_AND_TYPE).unwrap(), 0);
    }

    #[test]
    fn unknown_import_sets_bit0() {
        // module 'z' is not a real host module → allowlist violation.
        assert_eq!(audit_verdict(&with_one_import(b'z', b'0')).unwrap(), 0b001);
    }

    #[test]
    fn out_of_range_field_sets_bit0() {
        // module 'd' (call) has only 2 fns (indices 0,1 = '_','0'); field '5' (idx 6)
        // is out of range → allowlist violation.
        assert_eq!(audit_verdict(&with_one_import(b'd', b'5')).unwrap(), 0b001);
    }

    #[test]
    fn denylisted_import_sets_bit1_only() {
        // (l,'6') = update_current_contract_wasm: known (no bit0), denylisted (bit1),
        // not a storage-write (no bit2).
        assert_eq!(audit_verdict(&with_one_import(b'l', b'6')).unwrap(), 0b010);
    }

    #[test]
    fn storage_write_without_auth_sets_bit2() {
        // (l,'_') = put_contract_data, no auth import → auth-presence failure.
        assert_eq!(audit_verdict(&with_one_import(b'l', b'_')).unwrap(), 0b100);
    }

    #[test]
    fn storage_write_with_auth_is_clean() {
        // put_contract_data + require_auth → no bit2.
        let mut wasm = HEADER_AND_TYPE.to_vec();
        // two imports: (l,'_') then (a,'0'); rebuild an import section with count=2.
        // import entry = modlen,mod,namelen,name,kind,typeidx = 6 bytes each.
        // section payload = count(1) + 6 + 6 = 13 bytes.
        wasm.extend_from_slice(&[
            0x02, 0x0d, 0x02,
            0x01, b'l', 0x01, b'_', 0x00, 0x00,
            0x01, b'a', 0x01, b'0', 0x00, 0x00,
        ]);
        assert_eq!(audit_verdict(&wasm).unwrap(), 0);
    }

    #[test]
    fn malformed_wasm_is_err_not_clean() {
        // bad magic must NOT decode to verdict 0.
        assert!(audit_verdict(&[0u8; 8]).is_err());
    }
}
