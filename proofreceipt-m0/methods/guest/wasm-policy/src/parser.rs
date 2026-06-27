//! Hand-rolled, bounded WASM import-section reader. Reads ONLY what the policy
//! needs — each import's (kind, module, field) — skipping every other section by
//! its declared size. Every read is bounds-checked: malformed input returns an
//! `Err`, never a panic or out-of-bounds index.

use alloc::vec::Vec;

#[derive(Debug, PartialEq, Eq)]
pub enum ParseError {
    BadMagic,
    Truncated,
    BadLeb,
    SectionOverrun,
}

/// One WASM import. `kind`: 0=func, 1=table, 2=mem, 3=global, 4=tag.
/// `module`/`field` are raw bytes (compared as bytes; multi-byte/UTF-8 names are
/// simply "unknown" to the policy, never a panic).
#[derive(Debug, PartialEq, Eq)]
pub struct Import<'a> {
    pub kind: u8,
    pub module: &'a [u8],
    pub field: &'a [u8],
}

/// Unsigned LEB128 → u32, with overflow rejected.
fn read_u32_leb(buf: &[u8], pos: &mut usize) -> Result<u32, ParseError> {
    let mut result: u32 = 0;
    let mut shift: u32 = 0;
    loop {
        let byte = *buf.get(*pos).ok_or(ParseError::Truncated)?;
        *pos += 1;
        let part = (byte & 0x7f) as u32;
        // reject shifts that would drop bits (malformed / oversized LEB)
        if shift >= 32 || (part << shift) >> shift != part {
            return Err(ParseError::BadLeb);
        }
        result |= part << shift;
        if byte & 0x80 == 0 {
            return Ok(result);
        }
        shift += 7;
    }
}

/// Read a length-prefixed byte string (WASM `name`): (len:LEB128)(bytes).
fn read_name<'a>(buf: &'a [u8], pos: &mut usize) -> Result<&'a [u8], ParseError> {
    let len = read_u32_leb(buf, pos)? as usize;
    let start = *pos;
    let end = start.checked_add(len).ok_or(ParseError::Truncated)?;
    let s = buf.get(start..end).ok_or(ParseError::Truncated)?;
    *pos = end;
    Ok(s)
}

/// Skip a limits descriptor: flag(1) min(LEB) [max(LEB) if flag&1].
fn skip_limits(buf: &[u8], mut p: usize) -> Result<usize, ParseError> {
    let flags = *buf.get(p).ok_or(ParseError::Truncated)?;
    p += 1;
    let _min = read_u32_leb(buf, &mut p)?;
    if flags & 0x01 != 0 {
        let _max = read_u32_leb(buf, &mut p)?;
    }
    Ok(p)
}

/// Skip a table-type descriptor: reftype(1) then limits.
fn skip_table_type(buf: &[u8], mut p: usize) -> Result<usize, ParseError> {
    let _reftype = *buf.get(p).ok_or(ParseError::Truncated)?;
    p += 1;
    skip_limits(buf, p)
}

pub fn parse_imports(wasm: &[u8]) -> Result<Vec<Import<'_>>, ParseError> {
    // Magic "\0asm" + version 1.
    if wasm.len() < 8 || &wasm[0..4] != b"\0asm" || &wasm[4..8] != [1, 0, 0, 0] {
        return Err(ParseError::BadMagic);
    }
    let mut pos = 8usize;
    let mut imports = Vec::new();

    while pos < wasm.len() {
        let id = wasm[pos];
        pos += 1;
        let size = read_u32_leb(wasm, &mut pos)? as usize;
        let sec_start = pos;
        let sec_end = sec_start.checked_add(size).ok_or(ParseError::SectionOverrun)?;
        if sec_end > wasm.len() {
            return Err(ParseError::SectionOverrun);
        }

        if id == 2 {
            // Import section.
            let mut p = sec_start;
            let count = read_u32_leb(wasm, &mut p)?;
            for _ in 0..count {
                let module = read_name(wasm, &mut p)?;
                let field = read_name(wasm, &mut p)?;
                let kind = *wasm.get(p).ok_or(ParseError::Truncated)?;
                p += 1;
                // Skip the kind-specific descriptor so we can keep reading imports.
                match kind {
                    0 => {
                        let _typeidx = read_u32_leb(wasm, &mut p)?;
                    }
                    1 => p = skip_table_type(wasm, p)?,
                    2 => p = skip_limits(wasm, p)?,
                    3 => p = p.checked_add(2).ok_or(ParseError::Truncated)?, // valtype + mut
                    4 => {
                        // tag: attribute(1) + typeidx(LEB)
                        p = p.checked_add(1).ok_or(ParseError::Truncated)?;
                        let _typeidx = read_u32_leb(wasm, &mut p)?;
                    }
                    _ => return Err(ParseError::BadLeb),
                }
                if p > sec_end {
                    return Err(ParseError::SectionOverrun);
                }
                imports.push(Import { kind, module, field });
            }
        }
        pos = sec_end;
    }
    Ok(imports)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Minimal-but-valid WASM: header + a type section (one `()->()`), so a func
    // import can reference type index 0. Import-section bytes are appended per case.
    const HEADER_AND_TYPE: &[u8] = &[
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // \0asm + version 1
        0x01, 0x04, 0x01, 0x60, 0x00, 0x00, // type section: 1 type, ()->()
    ];

    // One func import (module, field) referencing type 0: import section id=2,
    // size=7, count=1, modlen=1, mod, namelen=1, name, kind=0(func), typeidx=0.
    fn with_one_import(module: u8, field: u8) -> alloc::vec::Vec<u8> {
        let mut v = HEADER_AND_TYPE.to_vec();
        v.extend_from_slice(&[0x02, 0x07, 0x01, 0x01, module, 0x01, field, 0x00, 0x00]);
        v
    }

    #[test]
    fn rejects_bad_magic() {
        assert_eq!(parse_imports(&[0, 0, 0, 0, 0, 0, 0, 0]), Err(ParseError::BadMagic));
        assert_eq!(parse_imports(&[0x00, 0x61, 0x73]), Err(ParseError::BadMagic));
    }

    #[test]
    fn no_import_section_yields_empty() {
        // Header + type section only, no import section.
        let imports = parse_imports(HEADER_AND_TYPE).unwrap();
        assert!(imports.is_empty());
    }

    #[test]
    fn parses_one_func_import() {
        let wasm = with_one_import(b'l', b'_');
        let imports = parse_imports(&wasm).unwrap();
        assert_eq!(imports.len(), 1);
        assert_eq!(imports[0].kind, 0);
        assert_eq!(imports[0].module, b"l");
        assert_eq!(imports[0].field, b"_");
    }

    #[test]
    fn truncated_import_section_errors() {
        // import section claims size 7 but the payload is cut short.
        let mut wasm = HEADER_AND_TYPE.to_vec();
        wasm.extend_from_slice(&[0x02, 0x07, 0x01, 0x01, b'l']); // stops mid-import
        assert!(parse_imports(&wasm).is_err());
    }

    #[test]
    fn section_size_overrun_errors() {
        // import section declares a size larger than the remaining buffer.
        let mut wasm = HEADER_AND_TYPE.to_vec();
        wasm.extend_from_slice(&[0x02, 0x7f, 0x01]); // size=127 but ~nothing follows
        assert_eq!(parse_imports(&wasm), Err(ParseError::SectionOverrun));
    }

    #[test]
    fn parses_real_soroban_contract_15_imports() {
        // clean.wasm: a real soroban-sdk 25.3.1 contract (see fixtures provenance).
        let wasm = include_bytes!("../tests/fixtures/clean.wasm");
        let imports = parse_imports(wasm).unwrap();
        // collect (module, field) byte pairs
        let mut got: alloc::vec::Vec<(u8, u8)> = imports
            .iter()
            .map(|i| (i.module[0], i.field[0]))
            .collect();
        got.sort_unstable();
        let mut expected: alloc::vec::Vec<(u8, u8)> = alloc::vec![
            (b'a', b'0'), (b'l', b'_'), (b'l', b'1'), (b'x', b'3'), (b'x', b'4'),
            (b'i', b'0'), (b'm', b'_'), (b'm', b'0'), (b'v', b'_'), (b'v', b'6'),
            (b'b', b'4'), (b'b', b'3'), (b'b', b'e'), (b'c', b'_'), (b'l', b'0'),
        ];
        expected.sort_unstable();
        assert_eq!(got, expected);
        // every import in the real contract is a single-byte module + single-byte field
        assert!(imports.iter().all(|i| i.module.len() == 1 && i.field.len() == 1));
        assert!(imports.iter().all(|i| i.kind == 0));
    }
}
