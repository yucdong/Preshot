use super::*;

pub(crate) fn move_fixture(home: &Path, target: &Path) {
    status_in(home).unwrap();
    transfer::move_in(home, Some(target)).unwrap();
}

fn fixture() -> (tempfile::TempDir, PathBuf) {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("profile");
    fs::create_dir(&home).unwrap();
    (temp, home)
}
#[test]
fn new_profile_requires_setup_and_retains_configuration_across_install_locations() {
    let (_temp, home) = fixture();
    assert!(status_in(&home).unwrap().needs_setup);
    configure_in(&home, &home.join("library"), false).unwrap();
    let first = read_config(&home).unwrap().unwrap();
    assert!(!status_in(&home).unwrap().needs_setup);
    assert_eq!(
        read_config(&home).unwrap().unwrap().library_id,
        first.library_id
    );
}
#[test]
fn existing_library_is_adopted_and_missing_configured_library_never_recreated() {
    let (_temp, home) = fixture();
    fs::create_dir(home.join("library")).unwrap();
    drop(Store::open_root(&home.join("library")).unwrap());
    assert!(!status_in(&home).unwrap().needs_setup);
    fs::rename(home.join("library"), home.join("retained")).unwrap();
    assert!(status_in(&home).unwrap().problem.is_some());
    assert!(!home.join("library").exists());
    configure_in(&home, &home.join("retained"), true).unwrap();
    assert!(status_in(&home).unwrap().problem.is_none());
}
#[test]
fn corrupt_configuration_does_not_fall_back_to_an_empty_library() {
    let (_temp, home) = fixture();
    fs::write(home.join(CONFIG), b"broken").unwrap();
    assert!(status_in(&home).is_err());
    assert!(!home.join("library").exists());
}
#[test]
fn move_preserves_every_original_identity_and_keeps_source_as_backup() {
    let (temp, home) = fixture();
    configure_in(&home, &home.join("library"), false).unwrap();
    let before = read_config(&home).unwrap().unwrap();
    let original = before
        .library_path
        .join("instances")
        .join("retained-original.jpg");
    fs::write(&original, b"original bytes").unwrap();
    let target = temp.path().join("new library");
    transfer::move_in(&home, Some(&target)).unwrap();
    let after = read_config(&home).unwrap().unwrap();
    assert_eq!(after.library_id, before.library_id);
    assert_eq!(after.generation, before.generation + 1);
    assert_eq!(
        fs::read(after.library_path.join("instances/retained-original.jpg")).unwrap(),
        b"original bytes"
    );
    assert!(original.exists());
    assert!(!home.join(TRANSACTION).exists());
    assert!(status_in(&home).unwrap().problem.is_none());
}
#[test]
fn occupied_destination_and_nested_directory_are_rejected() {
    let (temp, home) = fixture();
    configure_in(&home, &home.join("library"), false).unwrap();
    let target = temp.path().join("occupied");
    fs::create_dir(&target).unwrap();
    fs::write(target.join("keep.txt"), "keep").unwrap();
    assert!(transfer::move_in(&home, Some(&target)).is_err());
    assert!(transfer::move_in(&home, Some(&home.join("library/nested"))).is_err());
    assert_eq!(fs::read_to_string(target.join("keep.txt")).unwrap(), "keep");
    assert!(!home.join(TRANSACTION).exists());
}
#[test]
fn workspace_adoption_is_once_only_and_keeps_legacy_source() {
    let (temp, home) = fixture();
    let legacy = temp.path().join("workspace.json");
    let old = serde_json::json!({"schemaVersion":1,"projects":[{"projectId":"retained", "path":"D:/project",
        "name":"Retained", "coverImage":null, "status":"unavailable", "createdAt":"a", "updatedAt":"b", "lastOpenedAt":"c"}]});
    write_json(&legacy, &serde_json::json!({"workspace":old})).unwrap();
    assert_eq!(workspace_registry::read(&home, &legacy).unwrap(), Some(old));
    let new = serde_json::json!({"schemaVersion":1,"projects":[]});
    workspace_registry::write(&home, new.clone()).unwrap();
    assert_eq!(workspace_registry::read(&home, &legacy).unwrap(), Some(new));
    assert!(legacy.exists());
    assert!(home.join("workspace.previous.json").exists());
}
#[test]
fn invalid_workspace_never_initializes_a_new_registry() {
    let (temp, home) = fixture();
    let legacy = temp.path().join("workspace.json");
    fs::write(&legacy, b"{bad").unwrap();
    assert!(workspace_registry::read(&home, &legacy).is_err());
    assert!(!home.join("workspace.json").exists());
}

#[test]
fn workspace_writes_remain_available_while_library_root_is_locked() {
    let (_temp, home) = fixture();
    let _guard = lock(&home).unwrap();
    workspace_registry::write(&home, serde_json::json!({"schemaVersion":1,"projects":[]})).unwrap();
    assert!(home.join("workspace.json").exists());
}

#[test]
fn concurrent_first_launch_creates_one_profile_without_false_failures() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("new-profile");
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(4));
    let threads: Vec<_> = (0..4)
        .map(|_| {
            let home = home.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                status_in(&home).unwrap().needs_setup
            })
        })
        .collect();
    for thread in threads {
        assert!(thread.join().unwrap());
    }
}

#[test]
fn locating_an_unrelated_database_does_not_create_tables_or_modify_it() {
    let (temp, home) = fixture();
    let other = temp.path().join("other-app");
    fs::create_dir(&other).unwrap();
    let path = other.join("library.db");
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch("CREATE TABLE unrelated(value TEXT); INSERT INTO unrelated VALUES('keep');")
        .unwrap();
    drop(conn);
    let before = fs::read(&path).unwrap();
    assert!(configure_in(&home, &other, true).is_err());
    assert_eq!(fs::read(&path).unwrap(), before);
    assert!(!other.join("drafts").exists());
    assert!(!home.join(CONFIG).exists());
}
