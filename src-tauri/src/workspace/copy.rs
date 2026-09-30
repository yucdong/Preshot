//! Independent project copies with durable ownership and exact-operation recovery.
use super::{ProjectManifest, InspectedProject, validate_project_name, validate_manifest, path_to_string};
use crate::{error::CommandError, library::files, byte_write::{write_bytes_atomically, ByteWriteErrors}};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::{BTreeSet, HashMap}, fs::{self, File, OpenOptions}, io::{Read, Write}, path::{Path, PathBuf}, sync::{Arc, Mutex, OnceLock, atomic::{AtomicBool, Ordering}}};
use uuid::Uuid;

type Result<T> = std::result::Result<T, CommandError>;
fn failure(e: impl std::fmt::Display) -> CommandError { CommandError::new("project_copy", format!("无法复制项目：{e}")) }

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CopyRequest {
    pub operation_id: String, pub source_path: String, pub source_project_id: String,
    pub parent_path: String, pub name: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyStatus {
    pub operation_id: String, pub phase: String, pub copied_bytes: u64, pub total_bytes: u64,
    pub project: Option<InspectedProject>, pub error: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Receipt {
    version: u32, request: CopyRequest, parent: PathBuf, project_id: String,
    phase: String, files: Vec<String>, manifest_hash: String, copied_bytes: u64, total_bytes: u64,
    error: Option<String>, acknowledged: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingCopy { request: CopyRequest, status: CopyStatus }
#[derive(Clone)]
struct Job { request: CopyRequest, cancelled: Arc<AtomicBool>, status: Arc<Mutex<CopyStatus>> }
static JOBS: OnceLock<Mutex<HashMap<String, Job>>> = OnceLock::new();
fn jobs() -> &'static Mutex<HashMap<String, Job>> { JOBS.get_or_init(Default::default) }
fn operation_root(home: &Path) -> Result<PathBuf> { files::child_dir(&files::directory(home)?, "project-copies") }
fn receipt_path(home: &Path, id: &str) -> Result<PathBuf> { files::uuid(id)?; Ok(operation_root(home)?.join(format!("{id}.json"))) }
fn save(home: &Path, receipt: &Receipt) -> Result<()> {
    let path = receipt_path(home, &receipt.request.operation_id)?;
    files::check_leaf(&path)?;
    write_bytes_atomically(&path, &serde_json::to_vec(receipt).map_err(failure)?, ByteWriteErrors {
        decode_code: "project_copy", decode_label: "copy receipt", write_code: "project_copy", write_label: "copy receipt",
    })
}
fn read(home: &Path, id: &str) -> Result<Option<Receipt>> {
    let path = receipt_path(home, id)?;
    if !path.try_exists().map_err(failure)? { return Ok(None); }
    let receipt: Receipt = serde_json::from_slice(&files::read_limited(&path, 8 * 1024 * 1024)?).map_err(failure)?;
    if receipt.version != 1 || receipt.request.operation_id != id || !receipt.parent.is_absolute() { return Err(failure("复制恢复记录无效")); }
    files::uuid(&receipt.project_id)?;
    validate_project_name(&receipt.request.name)?;
    for file in &receipt.files { relative_file(file)?; }
    Ok(Some(receipt))
}
fn stage(receipt: &Receipt) -> PathBuf { receipt.parent.join(format!(".preshot-copy-{}", receipt.request.operation_id)) }
fn destination(receipt: &Receipt) -> PathBuf { receipt.parent.join(&receipt.request.name) }
fn relative_file(value: &str) -> Result<()> {
    let parts: Vec<_> = value.split('/').collect();
    // Covers may live at the root; editor-owned assets have exactly one media directory.
    if parts.is_empty() || parts.len() > 2 || parts.len() == 2 && !matches!(parts[0], "media" | "references") { return Err(failure("图片或附件路径不在项目内")); }
    for part in parts { validate_project_name(part).map_err(|_| failure("图片或附件路径无效"))?;
        if part.chars().any(char::is_control) || matches!(part, "." | "..") || part.starts_with(".preshot") { return Err(failure("图片或附件路径无效")); }
    }
    Ok(())
}
fn manifest_bytes(root: &Path) -> Result<(ProjectManifest, Vec<u8>)> {
    let marker = if root.join(".preshotproj").try_exists().map_err(failure)? { ".preshotproj" } else { ".preshot" };
    let bytes = files::read_limited(&root.join(marker), 40 * 1024 * 1024)?;
    let manifest: ProjectManifest = serde_json::from_slice(&bytes).map_err(failure)?;
    validate_manifest(&manifest)?;
    Ok((manifest, bytes))
}
fn local_files(manifest: &ProjectManifest) -> Result<BTreeSet<String>> {
    use serde_json::Value;
    let mut files = BTreeSet::new();
    if let Some(cover) = &manifest.cover_image { relative_file(cover)?; files.insert(cover.clone()); }
    let Some(plan) = &manifest.plan else { return Ok(files) };
    let version = plan["schemaVersion"].as_u64().ok_or_else(|| failure("项目格式无效"))?;
    if !(13..=18).contains(&version) || plan["document"]["version"].as_u64() != Some((version - 12).min(5)) || plan["document"]["format"] != "preshot-blocks" || !plan["title"].is_string() {
        return Err(failure("无法完整识别此项目，请先使用兼容版本打开并保存"));
    }
    if crate::column_document::has_exif_presentation(plan) && version != 18 { return Err(failure("EXIF 图片需要 v18 项目，请先打开并保存")); }
    crate::column_document::validate(&plan["document"], version >= 16).map_err(failure)?;
    fn array<'a>(value: &'a Value, field: &str) -> Result<&'a Vec<Value>> { value[field].as_array().ok_or_else(|| failure(format!("项目缺少 {field}"))) }
    fn gallery(value: &Value, files: &mut BTreeSet<String>) -> Result<()> {
        for image in array(value, "images")? {
            let file = image["file"].as_str().ok_or_else(|| failure("图片缺少原图路径"))?;
            relative_file(file)?;
            if !file.starts_with("references/") { return Err(failure("图片组原图路径无效")); }
            files.insert(file.to_owned());
        }
        Ok(())
    }
    fn blocks(plan: &Value, values: &[Value], files: &mut BTreeSet<String>, groups: &mut BTreeSet<String>, artifacts: &mut BTreeSet<String>) -> Result<()> {
        for block in values {
            let kind = block["type"].as_str().unwrap_or("");
            match kind {
                "image" | "video" | "audio" | "file" => {
                    let url = block["props"]["url"].as_str().ok_or_else(|| failure("附件缺少地址"))?;
                    if !url.is_empty() && !url.to_ascii_lowercase().starts_with("http://") && !url.to_ascii_lowercase().starts_with("https://") {
                        relative_file(url)?;
                        if !url.starts_with("media/") { return Err(failure("附件不属于项目 media 目录")); }
                        files.insert(url.to_owned());
                    }
                },
                "imageGroup" | "shootingLocation" | "modelCard" | "clothing" | "prop" => {
                    let is_group = kind == "imageGroup";
                    let key = if is_group { "groupId" } else { "artifactId" };
                    let id = block["props"][key].as_str().ok_or_else(|| failure("组件缺少身份"))?;
                    let set = if is_group { &mut *groups } else { &mut *artifacts };
                    if !set.insert(id.to_owned()) { return Err(failure("组件身份重复")); }
                    let entries: Vec<_> = array(plan, if is_group { "imageGroups" } else { "artifacts" })?.iter().filter(|v| v["id"] == id).collect();
                    if entries.len() != 1 { return Err(failure("组件内容缺失或重复")); }
                    let value = entries[0];
                    if !is_group && value["kind"] != kind { return Err(failure("组件类型不一致")); }
                    match kind {
                        "imageGroup" => gallery(value, files)?,
                        "modelCard" => gallery(&value["samples"], files)?,
                        "clothing" => { gallery(&value["mainGallery"], files)?; gallery(&value["tryOn"]["gallery"], files)?; },
                        _ => gallery(&value["gallery"], files)?,
                    }
                },
                _ => (),
            }
            if let Some(children) = block["children"].as_array() { blocks(plan, children, files, groups, artifacts)?; }
        }
        Ok(())
    }
    let mut groups = BTreeSet::new(); let mut artifacts = BTreeSet::new();
    blocks(plan, array(&plan["document"], "blocks")?, &mut files, &mut groups, &mut artifacts)?;
    if groups.len() != array(plan, "imageGroups")?.len() || version >= 15 && artifacts.len() != array(plan, "artifacts")?.len() { return Err(failure("项目包含无法匹配的组件")); }
    Ok(files)
}
fn hash(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }
fn create_file(path: &Path, bytes: &[u8]) -> Result<()> {
    files::check_leaf(path)?;
    let mut file = OpenOptions::new().create_new(true).write(true).open(path).map_err(failure)?;
    file.write_all(bytes).and_then(|_| file.sync_all()).map_err(failure)
}
fn exposed(receipt: &Receipt) -> Result<CopyStatus> {
    let project = if receipt.phase == "completed" {
        let path = files::directory(&destination(receipt))?;
        let (manifest, _) = manifest_bytes(&path)?;
        if manifest.id != receipt.project_id { return Err(failure("副本已被其他项目替换，请检查目标目录")); }
        Some(InspectedProject { path: path_to_string(&path), resolved_cover_image: manifest.cover_image.clone(), cover_data_url: None, manifest })
    } else { None };
    Ok(CopyStatus { operation_id: receipt.request.operation_id.clone(), phase: receipt.phase.clone(), copied_bytes: receipt.copied_bytes, total_bytes: receipt.total_bytes, project, error: receipt.error.clone() })
}
fn cleanup(receipt: &Receipt) -> Result<()> {
    let root = stage(receipt);
    if !root.try_exists().map_err(failure)? { return Ok(()) }
    files::no_links(&root)?;
    let owner = root.join(".preshot-copy-owner");
    if files::read_limited(&owner, 256)? != receipt.request.operation_id.as_bytes() { return Err(failure("临时目录所有权不明确，已保留，请检查")); }
    // Validate the entire tree first. Never recursively sweep unknown files.
    fn check(root: &Path, directory: &Path, allowed: &BTreeSet<PathBuf>) -> Result<()> {
        for entry in fs::read_dir(directory).map_err(failure)? {
            let path = entry.map_err(failure)?.path(); files::no_links(&path)?;
            if path.is_dir() && (path == root.join("media") || path == root.join("references")) { check(root, &path, allowed)?; }
            else if !path.is_file() || !allowed.contains(&path) { return Err(failure("临时目录出现未知文件，已保留，请检查")); }
        }
        Ok(())
    }
    let mut allowed: BTreeSet<_> = receipt.files.iter().map(|f| root.join(f)).collect();
    allowed.insert(root.join(".preshotproj")); allowed.insert(owner.clone());
    check(&root, &root, &allowed)?;
    for file in allowed.iter().filter(|p| **p != owner) { if file.try_exists().map_err(failure)? { fs::remove_file(file).map_err(failure)?; } }
    for dir in ["media", "references"] { if root.join(dir).try_exists().map_err(failure)? { fs::remove_dir(root.join(dir)).map_err(failure)?; } }
    fs::remove_file(owner).map_err(failure)?; fs::remove_dir(root).map_err(failure)
}
fn recover(home: &Path, mut receipt: Receipt) -> Result<Receipt> {
    if matches!(receipt.phase.as_str(), "copying" | "finishing") {
        let target = destination(&receipt);
        if !receipt.manifest_hash.is_empty() && target.try_exists().map_err(failure)? {
            let (manifest, bytes) = manifest_bytes(&target)?;
            if manifest.id != receipt.project_id || hash(&bytes) != receipt.manifest_hash { return Err(failure("目标目录发生变化，无法确认复制结果")); }
            receipt.phase = "completed".into(); receipt.copied_bytes = receipt.total_bytes;
            let owner = target.join(".preshot-copy-owner");
            if owner.try_exists().map_err(failure)? && files::read_limited(&owner, 256)? == receipt.request.operation_id.as_bytes() { fs::remove_file(owner).map_err(failure)?; }
        } else {
            cleanup(&receipt)?;
            receipt.phase = "failed".into(); receipt.error = Some("上次复制已中断，临时文件已清理，请重试。".into());
        }
        save(home, &receipt)?;
    }
    Ok(receipt)
}
fn copy_in(home: &Path, request: &CopyRequest, cancelled: &AtomicBool, progress: &dyn Fn(CopyStatus)) -> Result<CopyStatus> {
    files::uuid(&request.operation_id)?;
    let operations = operation_root(home)?;
    let _operation_lock = files::Lock::acquire(&operations.join(format!("{}.lock", request.operation_id)))?;
    if let Some(existing) = read(home, &request.operation_id)? {
        if existing.request != *request { return Err(failure("同一次复制不能更改来源、名称或目录")); }
        let existing = recover(home, existing)?;
        if existing.phase == "completed" || existing.phase == "cancelled" { return exposed(&existing); }
        cleanup(&existing)?;
    }
    validate_project_name(&request.name)?;
    let source = files::directory(Path::new(&request.source_path))?;
    let parent = files::directory(Path::new(&request.parent_path))?;
    if parent.starts_with(&source) { return Err(failure("不能将副本放入源项目目录内")); }
    let target = parent.join(&request.name);
    files::check_leaf(&target)?;
    if target.try_exists().map_err(failure)? { return Err(failure("目标文件夹已存在，请修改项目名称或存放目录")); }
    let _source_lock = files::project_lock(&source)?;
    let (mut manifest, before) = manifest_bytes(&source)?;
    if manifest.id != request.source_project_id { return Err(failure("源项目身份已变化，请重新选择")); }
    let names = local_files(&manifest)?;
    let mut total = 0u64;
    for name in &names {
        let path = source.join(name); files::no_links(&path)?;
        let metadata = fs::metadata(path).map_err(|e| failure(format!("原图或附件 {name} 无法读取：{e}")))?;
        if !metadata.is_file() { return Err(failure(format!("{name} 不是普通文件"))); }
        total = total.checked_add(metadata.len()).ok_or_else(|| failure("文件总大小超出系统计数范围"))?;
    }
    let mut receipt = Receipt { version: 1, request: request.clone(), parent, project_id: Uuid::new_v4().to_string(), phase: "copying".into(),
        files: names.into_iter().collect(), manifest_hash: String::new(), copied_bytes: 0, total_bytes: total, error: None, acknowledged: false };
    save(home, &receipt)?;
    let cancel_file = operations.join(format!("{}.cancel", request.operation_id));
    let check = || -> Result<()> {
        if cancelled.load(Ordering::Relaxed) || cancel_file.try_exists().map_err(failure)? { Err(CommandError::new("project_copy_cancelled", "复制已取消")) } else { Ok(()) }
    };
    let result = (|| -> Result<()> {
        check()?;
        let temporary = stage(&receipt);
        fs::create_dir(&temporary).map_err(failure)?;
        create_file(&temporary.join(".preshot-copy-owner"), request.operation_id.as_bytes())?;
        for folder in ["media", "references"] { fs::create_dir(temporary.join(folder)).map_err(failure)?; }
        let mut verified = Vec::new();
        for name in receipt.files.clone() {
            check()?;
            let path = source.join(&name); files::no_links(&path)?;
            let mut input = File::open(&path).map_err(failure)?;
            let metadata = input.metadata().map_err(failure)?;
            let mut output = OpenOptions::new().write(true).create_new(true).open(temporary.join(&name)).map_err(failure)?;
            let mut sha = Sha256::new(); let mut count = 0u64; let mut buffer = [0u8; 64 * 1024];
            loop {
                check()?;
                let n = input.read(&mut buffer).map_err(failure)?; if n == 0 { break; }
                output.write_all(&buffer[..n]).map_err(failure)?; sha.update(&buffer[..n]); count += n as u64;
                receipt.copied_bytes += n as u64;
                progress(exposed(&receipt)?);
            }
            output.sync_all().map_err(failure)?;
            if count != metadata.len() || input.metadata().map_err(failure)?.modified().ok() != metadata.modified().ok() { return Err(failure(format!("源文件 {name} 在复制时发生变化"))); }
            verified.push((name, format!("{:x}", sha.finalize())));
            save(home, &receipt)?;
        }
        // Re-read originals without decoding to detect writers outside our project lock.
        for (name, expected) in verified {
            files::no_links(&source.join(&name))?;
            let mut file = File::open(source.join(&name)).map_err(failure)?;
            let mut sha = Sha256::new(); let mut buffer = [0u8; 64 * 1024];
            loop { check()?; let n = file.read(&mut buffer).map_err(failure)?; if n == 0 { break; } sha.update(&buffer[..n]); }
            if format!("{:x}", sha.finalize()) != expected { return Err(failure(format!("源文件 {name} 在复制时发生变化"))); }
        }
        if manifest_bytes(&source)?.1 != before { return Err(failure("源项目内容在复制时发生变化，请重试")); }
        manifest.id = receipt.project_id.clone(); manifest.name = request.name.clone();
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        manifest.created_at = now.clone(); manifest.updated_at = now;
        if let Some(plan) = &mut manifest.plan { plan["title"] = serde_json::Value::String(request.name.clone()); }
        let bytes = serde_json::to_vec_pretty(&manifest).map_err(failure)?;
        create_file(&temporary.join(".preshotproj"), &bytes)?;
        receipt.manifest_hash = hash(&bytes); receipt.phase = "finishing".into(); save(home, &receipt)?;
        progress(exposed(&receipt)?); check()?;
        files::publish_new(&temporary, &target)?;
        // A successful rename is the publication point. Later failures retain a recoverable copy.
        receipt.phase = "completed".into(); receipt.copied_bytes = receipt.total_bytes;
        save(home, &receipt)?;
        fs::remove_file(target.join(".preshot-copy-owner")).map_err(failure)?;
        Ok(())
    })();
    if let Err(error) = result {
        if receipt.phase == "completed" || !receipt.manifest_hash.is_empty() && target.try_exists().map_err(failure)? && !stage(&receipt).exists() { return Err(error); }
        if let Err(cleanup_error) = cleanup(&receipt) { receipt.error = Some(format!("{error}；临时文件清理失败：{cleanup_error}")); save(home, &receipt)?; return Err(failure(receipt.error.unwrap())); }
        receipt.phase = if error.code == "project_copy_cancelled" { "cancelled" } else { "failed" }.into();
        receipt.error = Some(error.message.clone()); save(home, &receipt)?;
        if receipt.phase != "cancelled" { return Err(error); }
    }
    exposed(&receipt)
}

#[tauri::command]
pub async fn copy_project(input: CopyRequest) -> Result<CopyStatus> {
    files::uuid(&input.operation_id)?;
    let home = super::preshot_home()?;
    let job = Job { request: input.clone(), cancelled: Arc::new(AtomicBool::new(false)), status: Arc::new(Mutex::new(CopyStatus { operation_id: input.operation_id.clone(), phase: "copying".into(), copied_bytes: 0, total_bytes: 0, project: None, error: None })) };
    {
        let mut jobs = jobs().lock().map_err(failure)?;
        if let Some(existing) = jobs.get(&input.operation_id) {
            if existing.request != input { return Err(failure("复制操作参数已变化")); }
            return Ok(existing.status.lock().map_err(failure)?.clone());
        }
        jobs.insert(input.operation_id.clone(), job.clone());
    }
    let id = input.operation_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || copy_in(&home, &input, &job.cancelled, &|p| { if let Ok(mut status) = job.status.lock() { *status = p; } })).await.map_err(failure);
    jobs().lock().map_err(failure)?.remove(&id);
    result?
}
#[tauri::command]
pub async fn project_copy_status(operation_id: String) -> Result<Option<CopyStatus>> {
    if let Some(job) = jobs().lock().map_err(failure)?.get(&operation_id) { return Ok(Some(job.status.lock().map_err(failure)?.clone())); }
    tauri::async_runtime::spawn_blocking(move || {
        let home = super::preshot_home()?;
        let _lock = files::Lock::acquire(&receipt_path(&home, &operation_id)?.with_extension("lock"))?;
        read(&home, &operation_id)?.map(|r| recover(&home, r).and_then(|r| exposed(&r))).transpose()
    }).await.map_err(failure)?
}
#[tauri::command]
pub fn cancel_project_copy(operation_id: String) -> Result<()> {
    let home = super::preshot_home()?;
    let path = receipt_path(&home, &operation_id)?.with_extension("cancel");
    if let Some(job) = jobs().lock().map_err(failure)?.get(&operation_id) { job.cancelled.store(true, Ordering::Relaxed); }
    if !path.try_exists().map_err(failure)? { create_file(&path, b"cancel")?; }
    Ok(())
}
#[tauri::command]
pub async fn pending_project_copies() -> Result<Vec<PendingCopy>> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = super::preshot_home()?; let mut pending = Vec::new();
        for entry in fs::read_dir(operation_root(&home)?).map_err(failure)? {
            let path = entry.map_err(failure)?.path();
            if path.extension().is_none_or(|v| v != "json") { continue; }
            let id = path.file_stem().and_then(|v| v.to_str()).ok_or_else(|| failure("复制记录名称无效"))?;
            if jobs().lock().map_err(failure)?.contains_key(id) { continue; }
            let _lock = files::Lock::acquire(&path.with_extension("lock"))?;
            if let Some(receipt) = read(&home, id)? { if !receipt.acknowledged { let receipt = recover(&home, receipt)?; pending.push(PendingCopy { request: receipt.request.clone(), status: exposed(&receipt)? }); } }
        }
        Ok(pending)
    }).await.map_err(failure)?
}
#[tauri::command]
pub async fn acknowledge_project_copy(operation_id: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = super::preshot_home()?;
        let _lock = files::Lock::acquire(&receipt_path(&home, &operation_id)?.with_extension("lock"))?;
        if let Some(mut receipt) = read(&home, &operation_id)? {
            if !matches!(receipt.phase.as_str(), "completed" | "failed" | "cancelled") { return Err(failure("复制结果尚未确认")); }
            receipt.acknowledged = true; save(&home, &receipt)?;
        }
        Ok(())
    }).await.map_err(failure)?
}
#[tauri::command]
pub fn suggest_project_copy(source_path: String, source_project_id: String, base_name: String) -> Result<(String, String)> {
    let source = files::directory(Path::new(&source_path))?;
    if manifest_bytes(&source)?.0.id != source_project_id { return Err(failure("源项目身份已变化")); }
    validate_project_name(&base_name)?;
    let parent = source.parent().ok_or_else(|| failure("源项目没有上级目录"))?;
    let mut name = base_name.clone(); let mut suffix = 2u32;
    while parent.join(&name).try_exists().map_err(failure)? { name = format!("{base_name} {suffix}"); suffix = suffix.checked_add(1).ok_or_else(|| failure("无法生成副本名称"))?; }
    Ok((path_to_string(parent), name))
}

#[cfg(test)]
mod tests;
