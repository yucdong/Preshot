use super::{error, insert, models::*, Result, Store};

async fn blocking<T, F>(operation: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|_| error("worker", "The material library worker failed. Retry, or reopen the project to reconcile any insertion journal"))?
}

fn store() -> Result<Store> {
    Store::open(&crate::workspace::preshot_home()?)
}

#[tauri::command]
pub async fn library_search(input: MaterialSearch) -> Result<MaterialSearchResult> {
    blocking(move || store()?.search(input)).await
}

#[tauri::command]
pub async fn library_get(id: String) -> Result<MaterialDetail> {
    blocking(move || store()?.get(&id)).await
}

#[tauri::command]
pub async fn library_save(input: MaterialSaveRequest) -> Result<MaterialDetail> {
    blocking(move || store()?.save(input)).await
}

#[tauri::command]
pub async fn library_begin_create(payload: MaterialPayload) -> Result<MaterialEditSession> {
    blocking(move || store()?.begin_create(payload)).await
}

#[tauri::command]
pub async fn library_begin_edit(material_id: String, revision: u32) -> Result<MaterialEditSession> {
    blocking(move || store()?.begin_edit(&material_id, revision)).await
}

#[tauri::command]
pub async fn library_load_edit_image(session_id: String, local_image_id: String) -> Result<String> {
    blocking(move || store()?.load_edit_image(&session_id, &local_image_id)).await
}

#[tauri::command]
pub async fn library_import_edit_images(
    session_id: String,
    source_paths: Vec<String>,
) -> Result<Vec<MaterialEditImage>> {
    blocking(move || store()?.import_edit_images(&session_id, source_paths)).await
}

#[tauri::command]
pub async fn library_import_edit_image_data(
    session_id: String,
    input: MaterialEditImageData,
) -> Result<MaterialEditImage> {
    blocking(move || store()?.import_edit_image_data(&session_id, input)).await
}

#[tauri::command]
pub async fn library_crop_edit_image(
    session_id: String,
    local_image_id: String,
    bounds: MaterialEditCropBounds,
) -> Result<MaterialEditImage> {
    blocking(move || store()?.crop_edit_image(&session_id, &local_image_id, bounds)).await
}

#[tauri::command]
pub async fn library_commit_edit(input: MaterialContentUpdate) -> Result<MaterialDetail> {
    blocking(move || store()?.commit_edit(input)).await
}

#[tauri::command]
pub async fn library_discard_edit(session_id: String) -> Result<()> {
    blocking(move || store()?.discard_edit(&session_id)).await
}

#[tauri::command]
pub async fn library_update_metadata(
    id: String,
    expected_version: u32,
    metadata: MaterialMetadata,
) -> Result<MaterialSummary> {
    blocking(move || store()?.update_metadata(&id, expected_version, metadata)).await
}

#[tauri::command]
pub async fn library_set_deleted(
    id: String,
    expected_version: u32,
    deleted: bool,
) -> Result<MaterialSummary> {
    blocking(move || store()?.set_deleted(&id, expected_version, deleted)).await
}

#[tauri::command]
pub async fn library_purge(id: String, expected_version: u32) -> Result<()> {
    blocking(move || store()?.purge(&id, expected_version)).await
}

#[tauri::command]
pub async fn library_load_image(
    id: String,
    revision: u32,
    local_image_id: String,
) -> Result<String> {
    blocking(move || store()?.load_image(&id, revision, &local_image_id)).await
}

#[tauri::command]
pub async fn library_load_preview(id: String, revision: u32) -> Result<Option<String>> {
    blocking(move || store()?.load_preview(&id, revision)).await
}

#[tauri::command]
pub async fn library_save_preview(
    id: String,
    revision: u32,
    preview: MaterialPreviewInput,
) -> Result<()> {
    blocking(move || store()?.save_preview(&id, revision, preview)).await
}

#[tauri::command]
pub async fn library_mark_preview_failed(id: String, revision: u32) -> Result<()> {
    blocking(move || store()?.mark_preview_failed(&id, revision)).await
}

#[tauri::command]
pub async fn library_prepare_insert(
    input: MaterialInsertRequest,
) -> Result<PreparedMaterialInsert> {
    blocking(move || store()?.prepare_insert(input)).await
}

#[tauri::command]
pub async fn library_commit_insert(input: MaterialInsertCommit) -> Result<()> {
    blocking(move || insert::commit(input)).await
}

#[tauri::command]
pub async fn library_abort_insert(project_path: String, operation_id: String) -> Result<()> {
    blocking(move || insert::abort(&project_path, &operation_id)).await
}

#[tauri::command]
pub async fn library_insert_status(
    project_path: String,
    operation_id: String,
) -> Result<MaterialInsertStatus> {
    blocking(move || insert::status(&project_path, &operation_id)).await
}
