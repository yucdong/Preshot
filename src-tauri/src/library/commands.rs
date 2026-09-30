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
    crate::storage::open_library()
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
pub async fn library_load_edit_image(session_id: String, local_image_id: String, presentation_axes: Option<crate::original_image::PresentationAxes>) -> Result<String> {
    blocking(move || store()?.load_edit_image_with_axes(&session_id, &local_image_id, presentation_axes.unwrap_or_default())).await
}

#[tauri::command]
pub async fn library_reveal_edit_image(session_id: String, local_image_id: String) -> Result<()> {
    blocking(move || {
        let store = store()?;
        crate::reveal::reveal_file(&store.edit_original_image_path(&session_id, &local_image_id)?)
    }).await
}

#[tauri::command]
pub async fn library_reveal_image_group(id: String, revision: u32) -> Result<()> {
    blocking(move || {
        let store = store()?;
        crate::reveal::open_project_directory(store.original_group_path(&id, revision)?.to_string_lossy().into_owned())
    }).await
}

#[tauri::command]
pub async fn library_reveal_edit_image_group(session_id: String) -> Result<()> {
    blocking(move || {
        let store = store()?;
        crate::reveal::open_project_directory(store.edit_original_group_path(&session_id)?.to_string_lossy().into_owned())
    }).await
}

#[tauri::command]
pub async fn library_import_library_images(session_id: String, material_id: String, revision: u32, image_ids: Vec<String>) -> Result<Vec<MaterialEditImage>> {
    blocking(move || store()?.import_library_images(&session_id, &material_id, revision, image_ids)).await
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
    presentation_axes: Option<crate::original_image::PresentationAxes>,
) -> Result<MaterialEditImage> {
    blocking(move || store()?.crop_edit_image_with_axes(&session_id, &local_image_id, bounds, presentation_axes.unwrap_or_default())).await
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
pub async fn library_reveal_image(id: String, revision: u32, local_image_id: String) -> Result<()> {
    blocking(move || {
        let store = store()?;
        crate::reveal::reveal_file(&store.original_image_path(&id, revision, &local_image_id)?)
    }).await
}

#[tauri::command]
pub async fn library_load_preview(id: String, revision: u32, render_key: String) -> Result<Option<String>> {
    blocking(move || store()?.load_preview_for_renderer(&id, revision, Some(&render_key))).await
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

#[tauri::command]
pub async fn library_image_display(material_id: String, revision: u32, local_image_id: String, edge: u32, id: String) -> Result<String> {
    let job = crate::original_image::DisplayJob::new(id)?;
    blocking(move || {
        let store = store()?;
        let material = store.revision(&material_id, revision)?;
        let image = material.images.iter().find(|image| image.local_image_id == local_image_id)
            .ok_or_else(|| error("image_not_found", "Image is not owned by this material version"))?;
        let axes = super::validation::image_axes(&material.payload, &local_image_id)?;
        job.render_with_axes(&store.verified_image_path(image)?, edge, axes)
    }).await
}
