use std::{fs, path::Path};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{error, files, models::*, validation, Result, Store};
use crate::workspace::ProjectManifest;

const JOURNAL_DIR: &str = ".preshot-library";

fn read_manifest(project: &Path) -> Result<ProjectManifest> {
    crate::workspace::read_manifest(project).map_err(|_| error(
        "manifest",
        "Unable to read a valid project manifest. Preserve the project and its insertion journal; restore or repair the manifest before retrying",
    ))
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Phase {
    Preparing,
    Prepared,
    Committing,
    Committed,
    Cancelled,
    Conflict,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OwnedImage {
    file: String,
    image: MaterialImage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Journal {
    version: u32,
    project_id: String,
    phase: Phase,
    base_plan: Value,
    next_plan: Option<Value>,
    prepared: PreparedMaterialInsert,
    owned: Vec<OwnedImage>,
    published_count: usize,
    publishing: bool,
}

pub(super) fn check_base(
    project: &Path,
    project_id: &str,
    plan: &Value,
) -> Result<ProjectManifest> {
    validation::plan(plan)?;
    files::no_links(&project.join(".preshotproj"))?;
    let manifest = read_manifest(project)?;
    if manifest.id != project_id || manifest.plan.as_ref() != Some(plan) {
        return Err(error(
            "stale_plan",
            "Project identity or committed plan changed; refresh before retrying",
        ));
    }
    Ok(manifest)
}

fn read(project: &Path, operation: &str) -> Result<Option<Journal>> {
    files::uuid(operation)?;
    let path = project.join(JOURNAL_DIR).join(format!("{operation}.json"));
    if !path.try_exists().map_err(|e| error("journal", e))? {
        return Ok(None);
    }
    let bytes = files::read_limited(&path, 68 * 1024 * 1024)?;
    let journal: Journal =
        serde_json::from_slice(&bytes).map_err(|e| error("journal_corrupt", e))?;
    if journal.version != 1 || journal.prepared.operation_id != operation {
        return Err(error(
            "journal_corrupt",
            "Unsupported or mismatched insertion journal",
        ));
    }
    files::uuid(&journal.prepared.material_id)?;
    validation::plan(&journal.base_plan)?;
    validation::payload(&journal.prepared.payload)?;
    if journal.prepared.images.len() != journal.owned.len() {
        return Err(error(
            "journal_corrupt",
            "Journal image ownership is inconsistent",
        ));
    }
    if journal.published_count > journal.owned.len()
        || journal.publishing && journal.published_count == journal.owned.len()
        || matches!(
            journal.phase,
            Phase::Prepared | Phase::Committing | Phase::Committed
        ) && (journal.published_count != journal.owned.len() || journal.publishing)
    {
        return Err(error(
            "journal_corrupt",
            "Invalid insertion file-publication progress",
        ));
    }
    for (source, owned) in journal.prepared.images.iter().zip(&journal.owned) {
        if source.file != owned.file || source.local_image_id != owned.image.local_image_id {
            return Err(error(
                "journal_corrupt",
                "Journal image ownership does not match prepared result",
            ));
        }
        files::reference_name(&owned.file)?;
        if matches!(
            journal.phase,
            Phase::Preparing | Phase::Prepared | Phase::Committing
        ) {
            files::reference(project, &owned.file, false)?;
        }
    }
    if let Some(next) = &journal.next_plan {
        validation::insertion(&journal.base_plan, next, &journal.prepared)?;
    }
    Ok(Some(journal))
}

fn write(project: &Path, journal: &Journal) -> Result<()> {
    files::uuid(&journal.prepared.operation_id)?;
    let root = files::child_dir(project, JOURNAL_DIR)?;
    let path = root.join(format!("{}.json", journal.prepared.operation_id));
    files::atomic(
        &path,
        &serde_json::to_vec(journal).map_err(|e| error("journal", e))?,
    )
}

fn journals(project: &Path) -> Result<Vec<Journal>> {
    let path = project.join(JOURNAL_DIR);
    if !path.try_exists().map_err(|e| error("journal", e))? {
        return Ok(Vec::new());
    }
    files::directory(&path)?;
    let mut result = Vec::new();
    for entry in fs::read_dir(path).map_err(|e| error("journal", e))? {
        let path = entry.map_err(|e| error("journal", e))?.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let operation = path
            .file_stem()
            .and_then(|s| s.to_str())
            .ok_or_else(|| error("journal", "Invalid journal filename"))?;
        result.push(
            read(project, operation)?
                .ok_or_else(|| error("journal", "Insertion journal disappeared"))?,
        );
    }
    Ok(result)
}

fn contains_reference(value: &Value, file: &str) -> bool {
    match value {
        Value::String(text) => text == file || text.replace('\\', "/") == file,
        Value::Array(array) => array.iter().any(|v| contains_reference(v, file)),
        Value::Object(object) => object.values().any(|v| contains_reference(v, file)),
        _ => false,
    }
}

fn conflict(project: &Path, journal: &mut Journal) -> Result<()> {
    journal.phase = Phase::Conflict;
    write(project, journal)?;
    Err(error("insert_conflict", "An insertion conflicts with this project's current plan. Keep its recovery journal and resolve the conflict before editing"))
}

fn cleanup(project: &Path, journal: &mut Journal, manifest: &ProjectManifest) -> Result<()> {
    if manifest.id != journal.project_id || manifest.plan.as_ref() != Some(&journal.base_plan) {
        return conflict(project, journal);
    }
    // Verify every owned file before deleting any: unexpected contents are a conflict,
    // not permission to delete a user's replacement image.
    let staging = project
        .join(JOURNAL_DIR)
        .join(format!("{}.copy", journal.prepared.operation_id));
    files::check_leaf(&staging)?;
    let staged_exists = staging
        .try_exists()
        .map_err(|e| error("journal_cleanup", e))?;
    let mut paths = Vec::new();
    for (index, owned) in journal.owned.iter().enumerate() {
        // If a no-replace rename collided, the staged file is still present.
        // Never mistake that foreign destination (even identical bytes) for ours.
        let published = index < journal.published_count
            || index == journal.published_count && journal.publishing && !staged_exists;
        if !published {
            continue;
        }
        if contains_reference(&journal.base_plan, &owned.file) {
            return conflict(project, journal);
        }
        let path = files::reference(project, &owned.file, false)?;
        if path.try_exists().map_err(|e| error("journal_cleanup", e))? {
            let bytes = match files::read_limited(&path, files::MAX_IMAGE_BYTES) {
                Ok(bytes) => bytes,
                Err(_) => return conflict(project, journal),
            };
            if files::hash(&bytes) != owned.image.blob_id {
                return conflict(project, journal);
            }
            paths.push(path);
        }
    }
    for path in paths {
        fs::remove_file(path).map_err(|e| error("journal_cleanup", e))?;
    }
    if staged_exists {
        fs::remove_file(staging).map_err(|e| error("journal_cleanup", e))?;
    }
    journal.phase = Phase::Cancelled;
    write(project, journal)
}

fn observe(
    project: &Path,
    journal: &mut Journal,
    manifest: &ProjectManifest,
) -> Result<MaterialInsertStatus> {
    if manifest.id != journal.project_id {
        conflict(project, journal).or_else(|e| {
            if e.code == "library_insert_conflict" {
                Ok(())
            } else {
                Err(e)
            }
        })?;
        return Ok(MaterialInsertStatus::Conflict);
    }
    if journal.phase == Phase::Committed {
        return Ok(MaterialInsertStatus::Committed);
    }
    if journal.phase == Phase::Cancelled {
        return Ok(MaterialInsertStatus::Cancelled);
    }
    if journal.phase == Phase::Conflict {
        return Ok(MaterialInsertStatus::Conflict);
    }
    if journal.phase == Phase::Committing && journal.next_plan.as_ref() == manifest.plan.as_ref() {
        journal.phase = Phase::Committed;
        write(project, journal)?;
        return Ok(MaterialInsertStatus::Committed);
    }
    if manifest.plan.as_ref() != Some(&journal.base_plan) {
        conflict(project, journal).or_else(|e| {
            if e.code == "library_insert_conflict" {
                Ok(())
            } else {
                Err(e)
            }
        })?;
        return Ok(MaterialInsertStatus::Conflict);
    }
    Ok(MaterialInsertStatus::Prepared)
}

pub(crate) fn ensure_no_conflicts(project: &Path) -> Result<()> {
    if !project.join(JOURNAL_DIR).exists() {
        return Ok(());
    }
    let manifest = read_manifest(project)?;
    for mut journal in journals(project)? {
        if observe(project, &mut journal, &manifest)? == MaterialInsertStatus::Conflict {
            return Err(error("insert_conflict", "Unresolved material insertion recovery blocks project mutations; preserve the journal and resolve the conflict"));
        }
        // A regular save must not erase evidence of a successfully-written target
        // before its receipt is durable. observe() records that receipt first.
    }
    Ok(())
}

pub(crate) fn before_regular_mutation(project: &Path) -> Result<()> {
    ensure_no_conflicts(project)?;
    if !project.join(JOURNAL_DIR).exists() {
        return Ok(());
    }
    let manifest = read_manifest(project)?;
    for mut journal in journals(project)? {
        // A regular edit supersedes any pending insertion. Cancel while its base
        // still matches, before changing the manifest or reusing reserved names.
        // The shared lock excludes an actively publishing prepare/commit worker.
        if matches!(
            journal.phase,
            Phase::Preparing | Phase::Prepared | Phase::Committing
        ) {
            cleanup(project, &mut journal, &manifest)?;
        }
    }
    Ok(())
}

pub(crate) fn reconcile_project(project: &Path) -> Result<()> {
    if !project.join(JOURNAL_DIR).exists() {
        return Ok(());
    }
    files::no_links(&project.join(".preshotproj"))?;
    let manifest = read_manifest(project)?;
    for mut journal in journals(project)? {
        match observe(project, &mut journal, &manifest)? {
            MaterialInsertStatus::Prepared => cleanup(project, &mut journal, &manifest)?,
            MaterialInsertStatus::Conflict => return Err(error("insert_conflict",
                "Material insertion recovery found newer or conflicting project content. Nothing was overwritten; preserve .preshot-library and resolve the conflict")),
            _ => (),
        }
    }
    Ok(())
}

pub(crate) fn retain_reference_for_material_history(project: &Path, file: &str) -> Result<bool> {
    let file = file.replace('\\', "/");
    for journal in journals(project)? {
        if !journal
            .owned
            .iter()
            .any(|owned| owned.file.eq_ignore_ascii_case(&file))
        {
            continue;
        }
        match journal.phase {
            Phase::Committed => return Ok(true),
            Phase::Cancelled => (),
            Phase::Conflict => return Err(error(
                "insert_conflict",
                "Reference removal is blocked by unresolved material insertion recovery",
            )),
            _ => return Err(error(
                "reference_reserved",
                "This reference belongs to an unfinished material insertion. Abort or finish that operation before removing it",
            )),
        }
    }
    Ok(false)
}

fn verify_owned(project: &Path, journal: &Journal) -> Result<()> {
    for owned in &journal.owned {
        let bytes = files::read_limited(
            &files::reference(project, &owned.file, true)?,
            files::MAX_IMAGE_BYTES,
        )?;
        if files::hash(&bytes) != owned.image.blob_id {
            return Err(error(
                "insert_image_changed",
                "Prepared project reference bytes changed; insertion was not committed",
            ));
        }
    }
    Ok(())
}

impl Store {
    pub(super) fn prepare_insert(
        &self,
        input: MaterialInsertRequest,
    ) -> Result<PreparedMaterialInsert> {
        files::uuid(&input.operation_id)?;
        files::uuid(&input.material_id)?;
        validation::plan(&input.expected_plan)?;
        let project = files::directory(Path::new(&input.project_path))?;
        let _lock = files::project_lock(&project)?;
        if let Some(mut journal) = read(&project, &input.operation_id)? {
            if journal.project_id != input.project_id
                || journal.base_plan != input.expected_plan
                || journal.prepared.material_id != input.material_id
                || journal.prepared.revision != input.revision
            {
                return Err(error(
                    "operation_conflict",
                    "Insertion operation ID was reused with a different request",
                ));
            }
            let manifest = read_manifest(&project)?;
            match observe(&project, &mut journal, &manifest)? {
                MaterialInsertStatus::Committed => return Ok(journal.prepared),
                MaterialInsertStatus::Prepared if journal.phase == Phase::Prepared => {
                    verify_owned(&project, &journal)?;
                    return Ok(journal.prepared);
                }
                MaterialInsertStatus::Prepared => {
                    cleanup(&project, &mut journal, &manifest)?;
                    return Err(error(
                        "insert_interrupted",
                        "Interrupted preparation was cancelled safely; retry with a new operation",
                    ));
                }
                _ => {
                    return Err(error(
                        "operation_conflict",
                        "Insertion operation is cancelled or conflicted",
                    ))
                }
            }
        }
        check_base(&project, &input.project_id, &input.expected_plan)?;
        ensure_no_conflicts(&project)?;
        let detail = self.revision(&input.material_id, input.revision)?;
        if detail.summary.deleted_at.is_some() {
            return Err(error(
                "deleted",
                "Restore this material before inserting it",
            ));
        }
        let references = files::child_dir(&project, "references")?;
        let mut number = 0u32;
        for entry in fs::read_dir(&references).map_err(|e| error("references", e))? {
            let path = entry.map_err(|e| error("references", e))?.path();
            if let Some(value) = path
                .file_stem()
                .and_then(|s| s.to_str())
                .and_then(|s| s.parse::<u32>().ok())
            {
                number = number.max(value);
            }
        }
        // Reserve filenames even if an interrupted operation has not written them yet.
        for journal in journals(&project)? {
            for owned in journal.owned {
                if let Some(value) = Path::new(&owned.file)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .and_then(|s| s.parse::<u32>().ok())
                {
                    number = number.max(value);
                }
            }
        }
        let mut owned = Vec::new();
        let mut sources = Vec::new();
        for image in &detail.images {
            number = number
                .checked_add(1)
                .ok_or_else(|| error("references", "Project reference numbers are exhausted"))?;
            let extension = if image.mime_type == "image/png" {
                "png"
            } else {
                "jpg"
            };
            let file = format!("references/{number:04}.{extension}");
            if contains_reference(&input.expected_plan, &file) {
                return Err(error(
                    "references",
                    "Allocated reference is already mentioned by the base plan",
                ));
            }
            sources.push(MaterialImageSource {
                file: file.clone(),
                local_image_id: image.local_image_id.clone(),
            });
            owned.push(OwnedImage {
                file,
                image: image.clone(),
            });
        }
        let prepared = PreparedMaterialInsert {
            operation_id: input.operation_id,
            material_id: input.material_id,
            revision: input.revision,
            payload: detail.payload,
            images: sources,
        };
        let mut journal = Journal {
            version: 1,
            project_id: input.project_id,
            phase: Phase::Preparing,
            base_plan: input.expected_plan,
            next_plan: None,
            prepared,
            owned,
            published_count: 0,
            publishing: false,
        };
        write(&project, &journal)?;
        let copy_result = (|| {
            for index in 0..journal.owned.len() {
                let owned = &journal.owned[index];
                let bytes = self.blob(&owned.image)?;
                let destination = files::reference(&project, &owned.file, false)?;
                let staged = project
                    .join(JOURNAL_DIR)
                    .join(format!("{}.copy", journal.prepared.operation_id));
                files::write_new(&staged, &bytes)?;
                journal.publishing = true;
                write(&project, &journal)?;
                files::publish_new(&staged, &destination)?;
                journal.publishing = false;
                journal.published_count += 1;
                write(&project, &journal)?;
            }
            check_base(&project, &journal.project_id, &journal.base_plan)?;
            journal.phase = Phase::Prepared;
            write(&project, &journal)
        })();
        if let Err(cause) = copy_result {
            let manifest = read_manifest(&project)?;
            cleanup(&project, &mut journal, &manifest).map_err(|cleanup| error("insert_cleanup",
                format!("Preparation failed ({cause}); recovery also failed ({cleanup}). Preserve the journal")))?;
            return Err(cause);
        }
        Ok(journal.prepared)
    }
}

pub(super) fn commit(input: MaterialInsertCommit) -> Result<()> {
    files::uuid(&input.operation_id)?;
    let project = files::directory(Path::new(&input.project_path))?;
    let _lock = files::project_lock(&project)?;
    let mut journal = read(&project, &input.operation_id)?.ok_or_else(|| {
        error(
            "operation_not_found",
            "Prepare this material insertion first",
        )
    })?;
    if journal.project_id != input.project_id || journal.base_plan != input.expected_plan {
        return Err(error(
            "operation_conflict",
            "Commit identity/base plan does not match its prepared operation",
        ));
    }
    validation::insertion(&journal.base_plan, &input.next_plan, &journal.prepared)?;
    if journal
        .next_plan
        .as_ref()
        .is_some_and(|next| next != &input.next_plan)
    {
        return Err(error(
            "operation_conflict",
            "Commit retry has a different target plan",
        ));
    }
    let current = read_manifest(&project)?;
    match observe(&project, &mut journal, &current)? {
        MaterialInsertStatus::Committed => return Ok(()),
        MaterialInsertStatus::Prepared if journal.phase != Phase::Preparing => (),
        _ => {
            return Err(error(
                "operation_conflict",
                "Insertion is not prepared or has a retained conflict",
            ))
        }
    }
    ensure_no_conflicts(&project)?;
    verify_owned(&project, &journal)?;
    let mut manifest = check_base(&project, &input.project_id, &input.expected_plan)?;
    journal.next_plan = Some(input.next_plan.clone());
    journal.phase = Phase::Committing;
    write(&project, &journal)?;
    manifest.plan = Some(input.next_plan);
    manifest.updated_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    files::atomic(
        &project.join(".preshotproj"),
        &serde_json::to_vec_pretty(&manifest).map_err(|e| error("manifest", e))?,
    )?;
    journal.phase = Phase::Committed;
    // A receipt failure must surface. status()/reopen recognize the exact target
    // without ever rolling back or overwriting a newer project manifest.
    write(&project, &journal)
}

pub(super) fn abort(project_path: &str, operation: &str) -> Result<()> {
    files::uuid(operation)?;
    let project = files::directory(Path::new(project_path))?;
    let _lock = files::project_lock(&project)?;
    let Some(mut journal) = read(&project, operation)? else {
        return Ok(());
    };
    if journal.phase == Phase::Cancelled {
        return Ok(());
    }
    let manifest = read_manifest(&project)?;
    match observe(&project, &mut journal, &manifest)? {
        MaterialInsertStatus::Cancelled => Ok(()),
        MaterialInsertStatus::Prepared => cleanup(&project, &mut journal, &manifest),
        _ => Err(error(
            "operation_conflict",
            "Cannot abort a committed or conflicted insertion",
        )),
    }
}

pub(super) fn status(project_path: &str, operation: &str) -> Result<MaterialInsertStatus> {
    let project = files::directory(Path::new(project_path))?;
    let _lock = files::project_lock(&project)?;
    let mut journal = read(&project, operation)?.ok_or_else(|| {
        error(
            "operation_not_found",
            "No durable insertion operation exists",
        )
    })?;
    observe(&project, &mut journal, &read_manifest(&project)?)
}
