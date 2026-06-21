use relayer::state::BackingState;
use relayer::backing::{decide, denom_value_for, AnchorAction};
use relayer::evm::RootLog;

#[test]
fn cursor_defaults_and_roundtrips() {
    let mut st = BackingState::default();
    assert_eq!(st.cursor(10).last_scanned_block, 0);
    assert!(st.cursor(10).last_anchored_root.is_none());

    st.set_scanned(10, 100);
    st.record_anchor(10, "0xaa");
    assert_eq!(st.cursor(10).last_scanned_block, 100);
    assert_eq!(st.cursor(10).last_anchored_root.as_deref(), Some("0xaa"));

    let path = std::env::temp_dir().join("zkh-backing-state-test.json");
    let p = path.to_str().unwrap();
    st.save(p).unwrap();
    let st2 = BackingState::load(p);
    assert_eq!(st2.cursor(10).last_scanned_block, 100);
    assert_eq!(st2.cursor(10).last_anchored_root.as_deref(), Some("0xaa"));
    std::fs::remove_file(p).ok();
}

#[test]
fn load_missing_file_is_default() {
    let st = BackingState::load("/nonexistent/zkh-no-such-state.json");
    assert_eq!(st.cursor(1).last_scanned_block, 0);
}

fn ev(idx: u8, root: &str, block: u64) -> RootLog {
    RootLog { denom_index: idx, root_hex: root.into(), root_index: 0, block }
}

#[test]
fn decide_maps_index_to_value_and_dedups() {
    let denoms = vec![1u32, 10, 100];
    let mut st = BackingState::default();
    st.record_anchor(10, "0xaa"); // denom value 10 already at root aa

    // idx 1 -> value 10. First event repeats aa (skip), second is new bb (anchor).
    let events = vec![ev(1, "0xaa", 5), ev(1, "0xbb", 6)];
    let actions = decide(&st, &denoms, &events);
    assert_eq!(actions, vec![AnchorAction { denom_value: 10, root_hex: "0xbb".into() }]);
}

#[test]
fn decide_collapses_consecutive_duplicates_in_batch() {
    let denoms = vec![1u32, 10, 100];
    let st = BackingState::default();
    let events = vec![ev(0, "0xcc", 1), ev(0, "0xcc", 2), ev(0, "0xdd", 3)];
    let actions = decide(&st, &denoms, &events);
    assert_eq!(actions, vec![
        AnchorAction { denom_value: 1, root_hex: "0xcc".into() },
        AnchorAction { denom_value: 1, root_hex: "0xdd".into() },
    ]);
}

#[test]
fn denom_value_for_maps_by_index() {
    let denoms = vec![1u32, 10, 100];
    assert_eq!(denom_value_for(&denoms, 0), Some(1));
    assert_eq!(denom_value_for(&denoms, 2), Some(100));
    assert_eq!(denom_value_for(&denoms, 9), None);
}
