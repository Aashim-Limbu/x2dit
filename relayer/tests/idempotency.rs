use relayer::state::BackingState;

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
