use super::*;

#[test]
fn merged_category_search_preserves_legacy_content_and_paginates_together() {
    let props = Fixture::new("prop");
    let clothes = Fixture::new("clothing");
    let location = Fixture::new("shootingLocation");
    let mut store = props.store();
    let mut request = props.save_request();
    request.metadata.name = "A 玻璃杯".into();
    let prop = store.save(request).unwrap();
    let mut request = clothes.save_request();
    request.metadata.name = "B 外套".into();
    request.metadata.favorite = true;
    let clothing = store.save(request).unwrap();
    store.save(location.save_request()).unwrap();
    drop(store);
    let mut store = props.store();
    let query = |kind: &str, offset, limit, text: &str, favorites, trash| {
        serde_json::from_value(json!({
            "kind":kind,"query":text,"sort":"name","offset":offset,"limit":limit,
            "favorites":favorites,"trash":trash
        })).unwrap()
    };
    // Old filter keys are accepted as aliases for the merged category too.
    for kind in ["propClothing", "prop", "clothing"] {
        let first = store.search(query(kind, 0, 1, "", false, false)).unwrap();
        assert_eq!(first.total, 2);
        assert_eq!(first.items[0].id, prop.summary.id);
        let second = store.search(query(kind, 1, 1, "", false, false)).unwrap();
        assert_eq!(second.total, 2);
        assert_eq!(second.items[0].id, clothing.summary.id);
    }
    let favorite = store.search(query("propClothing", 0, 10, "摄影", true, false)).unwrap();
    assert_eq!(favorite.total, 1);
    assert_eq!(favorite.items[0].id, clothing.summary.id);
    let literal = store.search(query("propClothing", 0, 10, "%_", false, false)).unwrap();
    assert_eq!(literal.total, 0);
    assert_eq!(store.get(&prop.summary.id).unwrap(), prop);
    assert_eq!(store.get(&clothing.summary.id).unwrap(), clothing);
    assert_eq!(store.blob(&clothing.images[0]).unwrap(), clothes.bytes);
    let prepared = store.prepare_insert(props.insert_request(&clothing)).unwrap();
    let next = props.next_plan(&prepared);
    insert::commit(props.commit_request(&prepared, &next)).unwrap();
    assert_eq!(crate::workspace::read_manifest(&props.project).unwrap().plan, Some(next));
    store.set_deleted(&clothing.summary.id, 1, true).unwrap();
    assert_eq!(store.search(query("propClothing", 0, 10, "", false, false)).unwrap().total, 1);
    assert_eq!(store.search(query("propClothing", 0, 10, "", false, true)).unwrap().items[0].id, clothing.summary.id);
    store.set_deleted(&clothing.summary.id, 2, false).unwrap();
    assert_eq!(store.search(query("propClothing", 0, 10, "", false, false)).unwrap().total, 2);
}
