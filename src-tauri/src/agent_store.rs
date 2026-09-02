use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
    sync::Arc,
    thread,
    time::Duration,
};

use chrono::{SecondsFormat, Utc};
use rusqlite::{
    params, types::Type, Connection, ErrorCode, OptionalExtension, TransactionBehavior,
};
use serde_json::Value;
use uuid::Uuid;

use crate::{
    error::CommandError,
    workspace::{
        canonicalize_directory, ensure_user_data_roots_for_current_user, inspect_project_directory,
    },
};

const CURRENT_SCHEMA_VERSION: i64 = 4;
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);
const BUSY_RETRY_ATTEMPTS: usize = 4;
const BUSY_RETRY_DELAY: Duration = Duration::from_millis(40);
const MAX_ID_CHARS: usize = 200;
const MAX_TITLE_CHARS: usize = 500;
const MAX_DRAFT_CHARS: usize = 20_000;
const MAX_ERROR_CHARS: usize = 4_000;
const MAX_OPERATION_JSON_BYTES: usize = 256 * 1024;
const MAX_OPERATION_TEXT_CHARS: usize = 100_000;
const MAX_OPERATION_COUNT: usize = 50;
const MAX_INSERTED_BLOCKS: usize = 100;
const MAX_BLOCK_DEPTH: usize = 8;
const MAX_CHECKPOINT_JSON_BYTES: usize = 4 * 1024 * 1024;
const MAX_FINALIZATION_JSON_BYTES: usize = 4 * 1024;

const MIGRATION_1: &str = r#"
CREATE TABLE agent_projects (
    project_id TEXT PRIMARY KEY NOT NULL CHECK(length(project_id) BETWEEN 1 AND 200),
    canonical_path TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK(length(canonical_path) BETWEEN 1 AND 32767),
    project_name TEXT NOT NULL CHECK(length(project_name) BETWEEN 1 AND 255),
    state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active', 'deleting', 'cleanup_pending')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE agent_sessions (
    session_id TEXT PRIMARY KEY NOT NULL CHECK(length(session_id) BETWEEN 1 AND 200),
    project_id TEXT NOT NULL REFERENCES agent_projects(project_id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 500),
    status TEXT NOT NULL CHECK(status IN (
        'creating', 'idle', 'running', 'waiting_permission', 'waiting_user_input',
        'stopping', 'disconnected', 'error', 'deleting'
    )),
    model_id TEXT CHECK(model_id IS NULL OR length(model_id) BETWEEN 1 AND 200),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX agent_sessions_project_newest_idx
    ON agent_sessions(project_id, updated_at DESC, created_at DESC, session_id);
"#;

const MIGRATION_2: &str = r#"
ALTER TABLE agent_sessions ADD COLUMN interrupted_at TEXT;
ALTER TABLE agent_sessions ADD COLUMN last_error_code TEXT CHECK(last_error_code IS NULL OR length(last_error_code) <= 100);
ALTER TABLE agent_sessions ADD COLUMN last_error_phase TEXT CHECK(last_error_phase IS NULL OR length(last_error_phase) <= 100);
ALTER TABLE agent_sessions ADD COLUMN last_error_message TEXT CHECK(last_error_message IS NULL OR length(last_error_message) <= 4000);
ALTER TABLE agent_sessions ADD COLUMN last_error_retryable INTEGER CHECK(last_error_retryable IS NULL OR last_error_retryable IN (0, 1));
ALTER TABLE agent_sessions ADD COLUMN last_error_recovery TEXT CHECK(last_error_recovery IS NULL OR length(last_error_recovery) <= 4000);
ALTER TABLE agent_sessions ADD COLUMN input_tokens INTEGER CHECK(input_tokens IS NULL OR input_tokens >= 0);
ALTER TABLE agent_sessions ADD COLUMN output_tokens INTEGER CHECK(output_tokens IS NULL OR output_tokens >= 0);
ALTER TABLE agent_sessions ADD COLUMN reasoning_tokens INTEGER CHECK(reasoning_tokens IS NULL OR reasoning_tokens >= 0);
ALTER TABLE agent_sessions ADD COLUMN cache_read_tokens INTEGER CHECK(cache_read_tokens IS NULL OR cache_read_tokens >= 0);
ALTER TABLE agent_sessions ADD COLUMN cache_write_tokens INTEGER CHECK(cache_write_tokens IS NULL OR cache_write_tokens >= 0);
ALTER TABLE agent_sessions ADD COLUMN request_count INTEGER CHECK(request_count IS NULL OR request_count >= 0);
ALTER TABLE agent_sessions ADD COLUMN context_used_tokens INTEGER CHECK(context_used_tokens IS NULL OR context_used_tokens >= 0);
ALTER TABLE agent_sessions ADD COLUMN context_limit_tokens INTEGER CHECK(context_limit_tokens IS NULL OR context_limit_tokens > 0);
ALTER TABLE agent_sessions ADD COLUMN cost_amount REAL CHECK(cost_amount IS NULL OR cost_amount >= 0);
ALTER TABLE agent_sessions ADD COLUMN cost_currency TEXT CHECK(cost_currency IS NULL OR length(cost_currency) = 3);
ALTER TABLE agent_sessions ADD COLUMN cost_source TEXT CHECK(cost_source IS NULL OR cost_source IN ('proxy', 'configured_price_table'));

CREATE TABLE agent_drafts (
    session_id TEXT PRIMARY KEY NOT NULL REFERENCES agent_sessions(session_id) ON DELETE CASCADE,
    draft_text TEXT NOT NULL CHECK(length(draft_text) <= 20000),
    updated_at TEXT NOT NULL
);

CREATE TABLE agent_proposals (
    proposal_id TEXT PRIMARY KEY NOT NULL CHECK(length(proposal_id) BETWEEN 1 AND 200),
    session_id TEXT NOT NULL REFERENCES agent_sessions(session_id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('staged', 'applied', 'discarded', 'undone')),
    summary TEXT NOT NULL CHECK(length(summary) BETWEEN 1 AND 500),
    base_revision INTEGER NOT NULL CHECK(base_revision >= 0),
    base_document_hash TEXT NOT NULL CHECK(length(base_document_hash) = 71),
    operation_count INTEGER NOT NULL CHECK(operation_count BETWEEN 1 AND 50),
    operations_json TEXT CHECK(operations_json IS NULL OR length(CAST(operations_json AS BLOB)) <= 262144),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    applied_at TEXT,
    applied_revision INTEGER CHECK(applied_revision IS NULL OR applied_revision >= 0),
    applied_document_hash TEXT CHECK(applied_document_hash IS NULL OR length(applied_document_hash) = 71),
    discarded_at TEXT,
    undone_at TEXT
);

CREATE INDEX agent_proposals_session_newest_idx
    ON agent_proposals(session_id, updated_at DESC, proposal_id);

CREATE TABLE agent_cleanup_tombstones (
    tombstone_id TEXT PRIMARY KEY NOT NULL CHECK(length(tombstone_id) BETWEEN 1 AND 200),
    project_id TEXT NOT NULL CHECK(length(project_id) BETWEEN 1 AND 200),
    resource_kind TEXT NOT NULL CHECK(resource_kind IN ('copilot_session')),
    resource_id TEXT NOT NULL CHECK(length(resource_id) BETWEEN 1 AND 200),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
    last_error TEXT CHECK(last_error IS NULL OR length(last_error) <= 4000),
    retry_after TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(resource_kind, resource_id)
);

CREATE INDEX agent_cleanup_retry_idx
    ON agent_cleanup_tombstones(retry_after, created_at, tombstone_id);
"#;

const MIGRATION_3: &str = r#"
DROP INDEX agent_proposals_session_newest_idx;
ALTER TABLE agent_proposals RENAME TO agent_proposals_v2;

CREATE TABLE agent_proposals (
    proposal_id TEXT PRIMARY KEY NOT NULL CHECK(length(proposal_id) BETWEEN 1 AND 200),
    session_id TEXT NOT NULL REFERENCES agent_sessions(session_id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('staged', 'stale', 'applied', 'discarded', 'undone')),
    summary TEXT NOT NULL CHECK(length(summary) BETWEEN 1 AND 500),
    base_revision INTEGER NOT NULL CHECK(base_revision >= 0),
    base_document_hash TEXT NOT NULL CHECK(length(base_document_hash) = 71),
    operation_count INTEGER NOT NULL CHECK(operation_count BETWEEN 1 AND 50),
    operations_json TEXT CHECK(operations_json IS NULL OR length(CAST(operations_json AS BLOB)) <= 262144),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    applied_at TEXT,
    applied_revision INTEGER CHECK(applied_revision IS NULL OR applied_revision >= 0),
    applied_document_hash TEXT CHECK(applied_document_hash IS NULL OR length(applied_document_hash) = 71),
    discarded_at TEXT,
    undone_at TEXT
);

INSERT INTO agent_proposals SELECT * FROM agent_proposals_v2;
DROP TABLE agent_proposals_v2;

CREATE INDEX agent_proposals_session_newest_idx
    ON agent_proposals(session_id, updated_at DESC, proposal_id);

CREATE TABLE agent_proposal_checkpoints (
    checkpoint_id TEXT PRIMARY KEY NOT NULL CHECK(length(checkpoint_id) BETWEEN 1 AND 200),
    proposal_id TEXT NOT NULL UNIQUE REFERENCES agent_proposals(proposal_id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES agent_sessions(session_id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES agent_projects(project_id) ON DELETE CASCADE,
    checkpoint_json TEXT NOT NULL CHECK(length(CAST(checkpoint_json AS BLOB)) <= 4194304),
    created_at TEXT NOT NULL
);

CREATE INDEX agent_proposal_checkpoints_session_idx
    ON agent_proposal_checkpoints(session_id, created_at DESC, checkpoint_id);
"#;

const MIGRATION_4: &str = r#"
CREATE TABLE agent_proposal_recovery (
    operation_id TEXT PRIMARY KEY NOT NULL CHECK(length(operation_id) BETWEEN 1 AND 200),
    kind TEXT NOT NULL CHECK(kind IN ('apply', 'undo')),
    proposal_id TEXT NOT NULL CHECK(length(proposal_id) BETWEEN 1 AND 200),
    session_id TEXT NOT NULL CHECK(length(session_id) BETWEEN 1 AND 200),
    project_id TEXT NOT NULL CHECK(length(project_id) BETWEEN 1 AND 200),
    before_document_hash TEXT NOT NULL CHECK(length(before_document_hash) = 71),
    before_revision INTEGER NOT NULL CHECK(before_revision >= 0),
    after_document_hash TEXT NOT NULL CHECK(length(after_document_hash) = 71),
    after_revision INTEGER NOT NULL CHECK(after_revision >= 0),
    checkpoint_json TEXT NOT NULL CHECK(length(CAST(checkpoint_json AS BLOB)) <= 4194304),
    finalization_json TEXT NOT NULL CHECK(length(CAST(finalization_json AS BLOB)) <= 4096),
    status TEXT NOT NULL CHECK(status IN ('pending', 'conflict')),
    error TEXT CHECK(error IS NULL OR length(error) <= 4000),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX agent_proposal_recovery_project_pending_idx
    ON agent_proposal_recovery(project_id)
    WHERE status = 'pending';

CREATE INDEX agent_proposal_recovery_project_created_idx
    ON agent_proposal_recovery(project_id, created_at, operation_id);
"#;

const SESSION_STATES: [&str; 9] = [
    "creating",
    "idle",
    "running",
    "waiting_permission",
    "waiting_user_input",
    "stopping",
    "disconnected",
    "error",
    "deleting",
];

#[derive(Clone)]
pub struct AgentMetadataStore {
    database_path: Arc<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProjectMetadata {
    project_id: String,
    project_path: String,
    project_name: String,
    state: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStoredError {
    code: String,
    phase: String,
    message: String,
    retryable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    recovery: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTokenUsage {
    input_tokens: i64,
    output_tokens: i64,
    reasoning_tokens: i64,
    cache_read_tokens: i64,
    cache_write_tokens: i64,
    request_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentContextUsage {
    used_tokens: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    limit_tokens: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMonetaryCost {
    amount: f64,
    currency: String,
    source: String,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionMetadata {
    session_id: String,
    project_id: String,
    project_path: String,
    title: String,
    state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    model_id: Option<String>,
    created_at: String,
    updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_error: Option<AgentStoredError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    interrupted_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    usage: Option<AgentTokenUsage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    context: Option<AgentContextUsage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cost: Option<AgentMonetaryCost>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionCreate {
    session_id: String,
    project_id: String,
    title: String,
    state: String,
    #[serde(default)]
    model_id: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionUpdate {
    session_id: String,
    state: String,
    #[serde(default)]
    model_id: Option<String>,
    #[serde(default)]
    last_error: Option<AgentStoredError>,
    #[serde(default)]
    interrupted_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDraft {
    session_id: String,
    text: String,
    updated_at: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProposalCreate {
    proposal_id: String,
    session_id: String,
    summary: String,
    base_revision: i64,
    base_document_hash: String,
    operation_count: i64,
    #[serde(default)]
    operations: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStoredProposal {
    proposal_id: String,
    session_id: String,
    status: String,
    summary: String,
    base_revision: i64,
    base_document_hash: String,
    operation_count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    operations: Option<Value>,
    created_at: String,
    updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    applied_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    applied_revision: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    applied_document_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    discarded_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    undone_at: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProposalApply {
    proposal_id: String,
    applied_revision: i64,
    applied_document_hash: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentCheckpointSave {
    checkpoint_id: String,
    proposal_id: String,
    session_id: String,
    project_id: String,
    checkpoint: Value,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentProposalApplyCommit {
    checkpoint: AgentCheckpointSave,
    applied_revision: i64,
    applied_document_hash: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentProposalRecoveryBegin {
    operation_id: String,
    kind: String,
    proposal_id: String,
    session_id: String,
    project_id: String,
    before_document_hash: String,
    before_revision: i64,
    after_document_hash: String,
    after_revision: i64,
    checkpoint: Value,
    finalization: Value,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProposalRecoveryOperation {
    operation_id: String,
    kind: String,
    proposal_id: String,
    session_id: String,
    project_id: String,
    before_document_hash: String,
    before_revision: i64,
    after_document_hash: String,
    after_revision: i64,
    checkpoint: Value,
    finalization: Value,
    status: String,
    created_at: String,
    updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionUsageUpdate {
    session_id: String,
    usage: AgentTokenUsage,
    #[serde(default)]
    context: Option<AgentContextUsage>,
    #[serde(default)]
    cost: Option<AgentMonetaryCost>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCleanupTombstoneCreate {
    project_id: String,
    resource_kind: String,
    resource_id: String,
    #[serde(default)]
    last_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCleanupTombstone {
    tombstone_id: String,
    project_id: String,
    resource_kind: String,
    resource_id: String,
    attempt_count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    retry_after: Option<String>,
    created_at: String,
    updated_at: String,
}

fn validate_and_encode_checkpoint(input: &AgentCheckpointSave) -> Result<String, CommandError> {
    validate_identifier(&input.checkpoint_id, "checkpoint ID")?;
    validate_identifier(&input.proposal_id, "proposal ID")?;
    validate_identifier(&input.session_id, "session ID")?;
    validate_identifier(&input.project_id, "project ID")?;
    let object = json_object(&input.checkpoint, "proposal checkpoint")?;
    exact_json_keys(
        object,
        &[
            "checkpointId",
            "proposalId",
            "sessionId",
            "projectId",
            "beforeRevision",
            "beforeDocumentHash",
            "appliedRevision",
            "appliedDocumentHash",
            "beforePlan",
            "changes",
        ],
    )?;
    for (key, expected) in [
        ("checkpointId", input.checkpoint_id.as_str()),
        ("proposalId", input.proposal_id.as_str()),
        ("sessionId", input.session_id.as_str()),
        ("projectId", input.project_id.as_str()),
    ] {
        if json_string(object.get(key), key)? != expected {
            return Err(store_validation_error(
                "Proposal checkpoint identity does not match its envelope",
            ));
        }
    }
    validate_hash(
        json_string(object.get("beforeDocumentHash"), "beforeDocumentHash")?,
        "checkpoint before document hash",
    )?;
    validate_hash(
        json_string(object.get("appliedDocumentHash"), "appliedDocumentHash")?,
        "checkpoint applied document hash",
    )?;
    for key in ["beforeRevision", "appliedRevision"] {
        if object.get(key).and_then(Value::as_u64).is_none() {
            return Err(store_validation_error(
                "Proposal checkpoint revision is invalid",
            ));
        }
    }
    let before_plan = object
        .get("beforePlan")
        .and_then(Value::as_object)
        .ok_or_else(|| store_validation_error("Checkpoint beforePlan must be an object"))?;
    if before_plan.get("schemaVersion").and_then(Value::as_u64) != Some(14)
        || before_plan
            .get("document")
            .and_then(Value::as_object)
            .and_then(|document| document.get("format"))
            .and_then(Value::as_str)
            != Some("preshot-blocks")
    {
        return Err(store_validation_error(
            "Proposal checkpoint plan schema is invalid",
        ));
    }
    let changes = object
        .get("changes")
        .and_then(Value::as_array)
        .ok_or_else(|| store_validation_error("Checkpoint changes must be an array"))?;
    if changes.len() > 150 {
        return Err(store_validation_error(
            "Proposal checkpoint contains too many affected blocks",
        ));
    }
    let serialized = input.checkpoint.to_string();
    let lower = serialized.to_ascii_lowercase();
    if lower.contains("data:image")
        || lower.contains("data:audio")
        || lower.contains("data:video")
        || serialized.contains(":\\")
        || serialized.contains("\\\\")
    {
        return Err(store_validation_error(
            "Proposal checkpoint contains raw media or an absolute path",
        ));
    }
    let encoded = serde_json::to_string(&input.checkpoint).map_err(|error| {
        store_validation_error(format!("Unable to encode proposal checkpoint: {error}"))
    })?;
    if encoded.len() > MAX_CHECKPOINT_JSON_BYTES {
        return Err(store_validation_error(
            "Proposal checkpoint exceeds the 4 MiB storage limit",
        ));
    }
    Ok(encoded)
}

fn validate_recovery_begin(
    input: &AgentProposalRecoveryBegin,
) -> Result<(String, String), CommandError> {
    validate_identifier(&input.operation_id, "recovery operation ID")?;
    validate_identifier(&input.proposal_id, "proposal ID")?;
    validate_identifier(&input.session_id, "session ID")?;
    validate_identifier(&input.project_id, "project ID")?;
    if input.kind != "apply" && input.kind != "undo" {
        return Err(store_validation_error("Proposal recovery kind is invalid"));
    }
    if input.before_revision < 0 || input.after_revision < 0 {
        return Err(store_validation_error(
            "Proposal recovery revisions must be non-negative",
        ));
    }
    validate_hash(
        &input.before_document_hash,
        "proposal recovery before document hash",
    )?;
    validate_hash(
        &input.after_document_hash,
        "proposal recovery after document hash",
    )?;
    let checkpoint_input = AgentCheckpointSave {
        checkpoint_id: json_string(
            json_object(&input.checkpoint, "proposal recovery checkpoint")?.get("checkpointId"),
            "checkpointId",
        )?
        .to_string(),
        proposal_id: input.proposal_id.clone(),
        session_id: input.session_id.clone(),
        project_id: input.project_id.clone(),
        checkpoint: input.checkpoint.clone(),
    };
    let checkpoint_json = validate_and_encode_checkpoint(&checkpoint_input)?;
    let checkpoint = json_object(&input.checkpoint, "proposal recovery checkpoint")?;
    if input.kind == "apply"
        && (checkpoint.get("beforeRevision").and_then(Value::as_i64) != Some(input.before_revision)
            || checkpoint.get("beforeDocumentHash").and_then(Value::as_str)
                != Some(input.before_document_hash.as_str())
            || checkpoint.get("appliedRevision").and_then(Value::as_i64)
                != Some(input.after_revision)
            || checkpoint
                .get("appliedDocumentHash")
                .and_then(Value::as_str)
                != Some(input.after_document_hash.as_str()))
    {
        return Err(store_validation_error(
            "Apply recovery boundaries do not match its checkpoint",
        ));
    }

    let finalization = json_object(&input.finalization, "proposal finalization")?;
    if input.kind == "apply" {
        exact_json_keys(
            finalization,
            &["status", "finalizedAt", "revision", "documentHash"],
        )?;
        if json_string(finalization.get("status"), "finalization status")? != "applied"
            || finalization.get("revision").and_then(Value::as_i64) != Some(input.after_revision)
            || json_string(
                finalization.get("documentHash"),
                "finalization document hash",
            )? != input.after_document_hash
        {
            return Err(store_validation_error(
                "Apply finalization does not match its recovery boundary",
            ));
        }
        let finalized_at =
            json_string(finalization.get("finalizedAt"), "finalization timestamp")?.to_string();
        normalize_utc_timestamp(&finalized_at)?;
    } else {
        exact_json_keys(finalization, &["status", "finalizedAt"])?;
        if json_string(finalization.get("status"), "finalization status")? != "undone" {
            return Err(store_validation_error(
                "Undo finalization does not match its recovery boundary",
            ));
        }
        let finalized_at =
            json_string(finalization.get("finalizedAt"), "finalization timestamp")?.to_string();
        normalize_utc_timestamp(&finalized_at)?;
    }
    let finalization_json = serde_json::to_string(&input.finalization).map_err(|error| {
        store_validation_error(format!("Unable to encode proposal finalization: {error}"))
    })?;
    if finalization_json.len() > MAX_FINALIZATION_JSON_BYTES {
        return Err(store_validation_error(
            "Proposal finalization exceeds the 4 KiB storage limit",
        ));
    }
    Ok((checkpoint_json, finalization_json))
}

impl AgentMetadataStore {
    pub fn for_current_user() -> Result<Self, CommandError> {
        let roots = ensure_user_data_roots_for_current_user()?;
        Self::open(PathBuf::from(roots.user_root).join("agent.db"))
    }

    fn open(database_path: PathBuf) -> Result<Self, CommandError> {
        let parent = database_path.parent().ok_or_else(|| {
            CommandError::new(
                "agent_store_path_invalid",
                "Agent database path has no parent directory",
            )
        })?;
        std::fs::create_dir_all(parent).map_err(|error| {
            CommandError::new(
                "agent_store_open_failed",
                format!("Unable to create the agent metadata directory: {error}"),
            )
        })?;
        let store = Self {
            database_path: Arc::new(database_path),
        };
        store.with_connection("initialize agent metadata", |_| Ok(()))?;
        Ok(store)
    }

    fn with_connection<T, F>(&self, context: &str, mut operation: F) -> Result<T, CommandError>
    where
        F: FnMut(&mut Connection) -> rusqlite::Result<T>,
    {
        let mut last_busy = None;
        for attempt in 0..BUSY_RETRY_ATTEMPTS {
            let result = self
                .open_configured_connection()
                .and_then(|mut connection| operation(&mut connection));
            match result {
                Ok(value) => return Ok(value),
                Err(error) if is_busy_error(&error) && attempt + 1 < BUSY_RETRY_ATTEMPTS => {
                    last_busy = Some(error);
                    thread::sleep(BUSY_RETRY_DELAY * (attempt as u32 + 1));
                }
                Err(error) => return Err(store_sql_error(context, error)),
            }
        }
        Err(store_sql_error(
            context,
            last_busy.expect("busy retry loop should retain its final error"),
        ))
    }

    fn open_configured_connection(&self) -> rusqlite::Result<Connection> {
        let mut connection = Connection::open(self.database_path.as_ref())?;
        connection.busy_timeout(BUSY_TIMEOUT)?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "synchronous", "NORMAL")?;
        migrate(&mut connection)?;
        Ok(connection)
    }

    fn adopt_project(&self, path: &Path) -> Result<AgentProjectMetadata, CommandError> {
        let canonical = canonicalize_directory(
            path,
            "agent_project_not_found",
            "agent_project_not_directory",
        )?;
        let inspected = inspect_project_directory(&canonical)?;
        validate_identifier(&inspected.manifest.id, "project ID")?;
        validate_required_text(&inspected.manifest.name, 255, "project name")?;
        let canonical_path = canonical.to_string_lossy().into_owned();
        let now = utc_now();
        let project_id = inspected.manifest.id;
        let project_name = inspected.manifest.name;

        self.with_connection("adopt project metadata", |connection| {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            transaction.execute(
                "INSERT INTO agent_projects (
                    project_id, canonical_path, project_name, state, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, 'active', ?4, ?4)
                 ON CONFLICT(project_id) DO UPDATE SET
                    canonical_path = excluded.canonical_path,
                    project_name = excluded.project_name,
                    state = 'active',
                    updated_at = excluded.updated_at",
                params![project_id, canonical_path, project_name, now],
            )?;
            let project = query_project(&transaction, &project_id)?;
            transaction.commit()?;
            Ok(project)
        })
    }

    fn list_sessions(&self, project_id: &str) -> Result<Vec<AgentSessionMetadata>, CommandError> {
        validate_identifier(project_id, "project ID")?;
        self.with_connection("list agent sessions", |connection| {
            let mut statement = connection.prepare_cached(
                "SELECT
                    s.session_id, s.project_id, p.canonical_path, s.title, s.status, s.model_id,
                    s.created_at, s.updated_at, s.last_error_code, s.last_error_phase,
                    s.last_error_message, s.last_error_retryable, s.last_error_recovery,
                    s.interrupted_at, s.input_tokens, s.output_tokens, s.reasoning_tokens,
                    s.cache_read_tokens, s.cache_write_tokens, s.request_count,
                    s.context_used_tokens, s.context_limit_tokens, s.cost_amount,
                    s.cost_currency, s.cost_source
                 FROM agent_sessions s
                 JOIN agent_projects p ON p.project_id = s.project_id
                 WHERE s.project_id = ?1
                 ORDER BY s.updated_at DESC, s.created_at DESC, s.session_id",
            )?;
            let sessions = statement
                .query_map([project_id], session_from_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(sessions)
        })
    }

    fn create_session(
        &self,
        input: &AgentSessionCreate,
    ) -> Result<AgentSessionMetadata, CommandError> {
        validate_identifier(&input.session_id, "session ID")?;
        validate_identifier(&input.project_id, "project ID")?;
        validate_required_text(&input.title, MAX_TITLE_CHARS, "session title")?;
        validate_session_state(&input.state)?;
        validate_optional_identifier(input.model_id.as_deref(), "model ID")?;
        let now = utc_now();

        self.with_connection("create agent session", |connection| {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            transaction.execute(
                "INSERT INTO agent_sessions (
                    session_id, project_id, title, status, model_id, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
                params![
                    input.session_id,
                    input.project_id,
                    input.title,
                    input.state,
                    input.model_id,
                    now
                ],
            )?;
            let session = query_session(&transaction, &input.session_id)?;
            transaction.commit()?;
            Ok(session)
        })
    }

    fn update_session(
        &self,
        input: &AgentSessionUpdate,
    ) -> Result<AgentSessionMetadata, CommandError> {
        validate_identifier(&input.session_id, "session ID")?;
        validate_session_state(&input.state)?;
        validate_optional_identifier(input.model_id.as_deref(), "model ID")?;
        validate_stored_error(input.last_error.as_ref())?;
        let interrupted_at = input
            .interrupted_at
            .as_deref()
            .map(normalize_utc_timestamp)
            .transpose()?;
        let now = utc_now();

        self.with_connection("update agent session", |connection| {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let changed = transaction.execute(
                "UPDATE agent_sessions SET
                    status = ?2,
                    model_id = ?3,
                    interrupted_at = ?4,
                    last_error_code = ?5,
                    last_error_phase = ?6,
                    last_error_message = ?7,
                    last_error_retryable = ?8,
                    last_error_recovery = ?9,
                    updated_at = ?10
                 WHERE session_id = ?1",
                params![
                    input.session_id,
                    input.state,
                    input.model_id,
                    interrupted_at,
                    input.last_error.as_ref().map(|error| &error.code),
                    input.last_error.as_ref().map(|error| &error.phase),
                    input.last_error.as_ref().map(|error| &error.message),
                    input
                        .last_error
                        .as_ref()
                        .map(|error| i64::from(error.retryable)),
                    input
                        .last_error
                        .as_ref()
                        .and_then(|error| error.recovery.as_deref()),
                    now
                ],
            )?;
            require_changed(changed)?;
            let session = query_session(&transaction, &input.session_id)?;
            transaction.commit()?;
            Ok(session)
        })
    }

    fn rename_session(
        &self,
        session_id: &str,
        title: &str,
    ) -> Result<AgentSessionMetadata, CommandError> {
        validate_identifier(session_id, "session ID")?;
        validate_required_text(title, MAX_TITLE_CHARS, "session title")?;
        let now = utc_now();
        self.with_connection("rename agent session", |connection| {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            require_changed(transaction.execute(
                "UPDATE agent_sessions SET title = ?2, updated_at = ?3 WHERE session_id = ?1",
                params![session_id, title, now],
            )?)?;
            let session = query_session(&transaction, session_id)?;
            transaction.commit()?;
            Ok(session)
        })
    }

    fn delete_session(&self, session_id: &str) -> Result<(), CommandError> {
        validate_identifier(session_id, "session ID")?;
        self.with_connection("delete agent session", |connection| {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            require_changed(transaction.execute(
                "DELETE FROM agent_sessions WHERE session_id = ?1",
                [session_id],
            )?)?;
            transaction.commit()
        })
    }

    fn read_draft(&self, session_id: &str) -> Result<Option<AgentDraft>, CommandError> {
        validate_identifier(session_id, "session ID")?;
        self.with_connection("read agent draft", |connection| {
            connection
                .query_row(
                    "SELECT session_id, draft_text, updated_at
                     FROM agent_drafts WHERE session_id = ?1",
                    [session_id],
                    |row| {
                        Ok(AgentDraft {
                            session_id: row.get(0)?,
                            text: row.get(1)?,
                            updated_at: row.get(2)?,
                        })
                    },
                )
                .optional()
        })
    }

    fn write_draft(&self, session_id: &str, text: &str) -> Result<AgentDraft, CommandError> {
        validate_identifier(session_id, "session ID")?;
        validate_text_length(text, MAX_DRAFT_CHARS, "draft")?;
        let now = utc_now();
        self.with_connection("write agent draft", |connection| {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            transaction.execute(
                "INSERT INTO agent_drafts (session_id, draft_text, updated_at)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(session_id) DO UPDATE SET
                    draft_text = excluded.draft_text,
                    updated_at = excluded.updated_at",
                params![session_id, text, now],
            )?;
            let draft = AgentDraft {
                session_id: session_id.to_string(),
                text: text.to_string(),
                updated_at: now.clone(),
            };
            transaction.commit()?;
            Ok(draft)
        })
    }

    pub(crate) fn create_proposal(
        &self,
        input: &AgentProposalCreate,
    ) -> Result<AgentStoredProposal, CommandError> {
        validate_identifier(&input.proposal_id, "proposal ID")?;
        validate_identifier(&input.session_id, "session ID")?;
        validate_required_text(&input.summary, MAX_TITLE_CHARS, "proposal summary")?;
        if input.base_revision < 0 {
            return Err(store_validation_error(
                "Proposal base revision must be non-negative",
            ));
        }

        validate_hash(&input.base_document_hash, "base document hash")?;
        if input.operation_count < 1 || input.operation_count > MAX_OPERATION_COUNT as i64 {
            return Err(store_validation_error(format!(
                "Proposal must contain 1-{MAX_OPERATION_COUNT} operations"
            )));
        }
        let operations_json = input
            .operations
            .as_ref()
            .map(validate_operations)
            .transpose()?;
        if operations_json
            .as_ref()
            .is_some_and(|(count, _)| *count != input.operation_count)
        {
            return Err(store_validation_error(
                "Proposal operation count does not match operation JSON",
            ));
        }
        let operations_json = operations_json.and_then(|(_, encoded)| encoded);
        let now = utc_now();
        self.with_connection("create agent proposal", |connection| {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            transaction.execute(
                "INSERT INTO agent_proposals (
                    proposal_id, session_id, status, summary, base_revision,
                    base_document_hash, operation_count, operations_json, created_at, updated_at
                 ) VALUES (?1, ?2, 'staged', ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
                params![
                    input.proposal_id,
                    input.session_id,
                    input.summary,
                    input.base_revision,
                    input.base_document_hash,
                    input.operation_count,
                    operations_json,
                    now
                ],
            )?;
            let proposal = query_proposal(&transaction, &input.proposal_id)?;
            transaction.commit()?;
            Ok(proposal)
        })
    }

    pub(crate) fn stage_tool_proposal(
        &self,
        session_id: &str,
        project_id: &str,
        summary: String,
        base_revision: i64,
        base_document_hash: String,
        operations: Vec<Value>,
    ) -> Result<AgentStoredProposal, CommandError> {
        validate_identifier(session_id, "session ID")?;
        validate_identifier(project_id, "project ID")?;
        self.with_connection("verify proposal session project", |connection| {
            let stored_project: String = connection.query_row(
                "SELECT project_id FROM agent_sessions WHERE session_id = ?1",
                [session_id],
                |row| row.get(0),
            )?;
            if stored_project != project_id {
                return Err(rusqlite::Error::QueryReturnedNoRows);
            }
            Ok(())
        })?;
        let input = AgentProposalCreate {
            proposal_id: Uuid::new_v4().to_string(),
            session_id: session_id.to_string(),
            summary,
            base_revision,
            base_document_hash,
            operation_count: operations.len() as i64,
            operations: Some(Value::Array(operations)),
        };
        self.create_proposal(&input)
    }

    fn list_proposals(
        &self,
        session_id: &str,
        limit: u32,
    ) -> Result<Vec<AgentStoredProposal>, CommandError> {
        validate_identifier(session_id, "session ID")?;
        if limit == 0 || limit > 100 {
            return Err(store_validation_error(
                "Proposal limit must be between 1 and 100",
            ));
        }
        self.with_connection("list agent proposals", |connection| {
            let mut statement = connection.prepare_cached(
                "SELECT proposal_id, session_id, status, summary, base_revision,
                        base_document_hash, operation_count, operations_json, created_at,
                        updated_at, applied_at, applied_revision, applied_document_hash,
                        discarded_at, undone_at
                 FROM agent_proposals
                 WHERE session_id = ?1
                 ORDER BY updated_at DESC, proposal_id DESC
                 LIMIT ?2",
            )?;
            let proposals = statement
                .query_map(params![session_id, i64::from(limit)], proposal_from_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(proposals)
        })
    }

    fn mark_proposal_stale(&self, proposal_id: &str) -> Result<AgentStoredProposal, CommandError> {
        validate_identifier(proposal_id, "proposal ID")?;
        let now = utc_now();
        self.with_connection("mark agent proposal stale", |connection| {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            require_changed(transaction.execute(
                "UPDATE agent_proposals SET status = 'stale', updated_at = ?2
                 WHERE proposal_id = ?1 AND status = 'staged'",
                params![proposal_id, now],
            )?)?;
            let proposal = query_proposal(&transaction, proposal_id)?;
            transaction.commit()?;
            Ok(proposal)
        })
    }

    fn set_proposal_status(
        &self,
        proposal_id: &str,
        status: &str,
    ) -> Result<AgentStoredProposal, CommandError> {
        validate_identifier(proposal_id, "proposal ID")?;
        if status != "discarded" {
            return Err(store_validation_error(
                "Only the discarded proposal status may be set directly",
            ));
        }
        let now = utc_now();
        self.with_connection("discard agent proposal", |connection| {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            require_changed(transaction.execute(
                "UPDATE agent_proposals SET
                    status = 'discarded', discarded_at = ?2, updated_at = ?2
                 WHERE proposal_id = ?1 AND status = 'staged'",
                params![proposal_id, now],
            )?)?;
            let proposal = query_proposal(&transaction, proposal_id)?;
            transaction.commit()?;
            Ok(proposal)
        })
    }

    fn apply_proposal(
        &self,
        input: &AgentProposalApply,
    ) -> Result<AgentStoredProposal, CommandError> {
        validate_identifier(&input.proposal_id, "proposal ID")?;
        if input.applied_revision < 0 {
            return Err(store_validation_error(
                "Applied revision must be non-negative",
            ));
        }
        validate_hash(&input.applied_document_hash, "applied document hash")?;
        let now = utc_now();
        self.with_connection("apply agent proposal receipt", |connection| {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            require_changed(transaction.execute(
                "UPDATE agent_proposals SET
                    status = 'applied',
                    applied_at = ?2,
                    applied_revision = ?3,
                    applied_document_hash = ?4,
                    updated_at = ?2
                 WHERE proposal_id = ?1 AND status = 'staged'",
                params![
                    input.proposal_id,
                    now,
                    input.applied_revision,
                    input.applied_document_hash
                ],
            )?)?;
            let proposal = query_proposal(&transaction, &input.proposal_id)?;
            transaction.commit()?;
            Ok(proposal)
        })
    }

    fn undo_proposal(&self, proposal_id: &str) -> Result<AgentStoredProposal, CommandError> {
        validate_identifier(proposal_id, "proposal ID")?;
        let now = utc_now();
        self.with_connection("undo agent proposal receipt", |connection| {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            require_changed(transaction.execute(
                "UPDATE agent_proposals SET
                    status = 'undone', undone_at = ?2, updated_at = ?2
                 WHERE proposal_id = ?1 AND status = 'applied'",
                params![proposal_id, now],
            )?)?;
            let proposal = query_proposal(&transaction, proposal_id)?;
            transaction.commit()?;
            Ok(proposal)
        })
    }

    fn save_checkpoint(&self, input: &AgentCheckpointSave) -> Result<(), CommandError> {
        let encoded = validate_and_encode_checkpoint(input)?;
        let now = utc_now();
        self.with_connection("save agent proposal checkpoint", |connection| {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let identity: (String, String) = transaction.query_row(
                "SELECT p.session_id, s.project_id
                 FROM agent_proposals p
                 JOIN agent_sessions s ON s.session_id = p.session_id
                 WHERE p.proposal_id = ?1 AND p.status = 'staged'",
                [&input.proposal_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            if identity.0 != input.session_id || identity.1 != input.project_id {
                return Err(rusqlite::Error::QueryReturnedNoRows);
            }
            transaction.execute(
                "INSERT INTO agent_proposal_checkpoints (
                    checkpoint_id, proposal_id, session_id, project_id,
                    checkpoint_json, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(proposal_id) DO UPDATE SET
                    checkpoint_id = excluded.checkpoint_id,
                    session_id = excluded.session_id,
                    project_id = excluded.project_id,
                    checkpoint_json = excluded.checkpoint_json,
                    created_at = excluded.created_at",
                params![
                    input.checkpoint_id,
                    input.proposal_id,
                    input.session_id,
                    input.project_id,
                    encoded,
                    now
                ],
            )?;
            transaction.commit()
        })
    }

    fn commit_proposal_apply(
        &self,
        input: &AgentProposalApplyCommit,
    ) -> Result<AgentStoredProposal, CommandError> {
        if input.applied_revision < 0 {
            return Err(store_validation_error(
                "Applied revision must be non-negative",
            ));
        }
        validate_hash(&input.applied_document_hash, "applied document hash")?;
        let encoded = validate_and_encode_checkpoint(&input.checkpoint)?;
        let checkpoint = input
            .checkpoint
            .checkpoint
            .as_object()
            .ok_or_else(|| store_validation_error("Proposal checkpoint must be an object"))?;
        if checkpoint.get("appliedRevision").and_then(Value::as_i64) != Some(input.applied_revision)
            || checkpoint
                .get("appliedDocumentHash")
                .and_then(Value::as_str)
                != Some(input.applied_document_hash.as_str())
        {
            return Err(store_validation_error(
                "Proposal apply receipt does not match its checkpoint",
            ));
        }

        let now = utc_now();
        self.with_connection("commit agent proposal apply", |connection| {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let identity: (String, String) = transaction.query_row(
                "SELECT p.session_id, s.project_id
                 FROM agent_proposals p
                 JOIN agent_sessions s ON s.session_id = p.session_id
                 WHERE p.proposal_id = ?1 AND p.status = 'staged'",
                [&input.checkpoint.proposal_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            if identity.0 != input.checkpoint.session_id
                || identity.1 != input.checkpoint.project_id
            {
                return Err(rusqlite::Error::QueryReturnedNoRows);
            }
            transaction.execute(
                "INSERT INTO agent_proposal_checkpoints (
                    checkpoint_id, proposal_id, session_id, project_id,
                    checkpoint_json, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(proposal_id) DO UPDATE SET
                    checkpoint_id = excluded.checkpoint_id,
                    session_id = excluded.session_id,
                    project_id = excluded.project_id,
                    checkpoint_json = excluded.checkpoint_json,
                    created_at = excluded.created_at",
                params![
                    input.checkpoint.checkpoint_id,
                    input.checkpoint.proposal_id,
                    input.checkpoint.session_id,
                    input.checkpoint.project_id,
                    encoded,
                    now
                ],
            )?;
            require_changed(transaction.execute(
                "UPDATE agent_proposals SET
                    status = 'applied',
                    applied_at = ?2,
                    applied_revision = ?3,
                    applied_document_hash = ?4,
                    updated_at = ?2
                 WHERE proposal_id = ?1 AND status = 'staged'",
                params![
                    input.checkpoint.proposal_id,
                    now,
                    input.applied_revision,
                    input.applied_document_hash
                ],
            )?)?;
            let proposal = query_proposal(&transaction, &input.checkpoint.proposal_id)?;
            transaction.commit()?;
            Ok(proposal)
        })
    }

    fn read_latest_checkpoint(&self, session_id: &str) -> Result<Option<Value>, CommandError> {
        validate_identifier(session_id, "session ID")?;
        self.with_connection("read latest agent proposal checkpoint", |connection| {
            connection
                .query_row(
                    "SELECT c.checkpoint_json
                     FROM agent_proposal_checkpoints c
                     JOIN agent_proposals p ON p.proposal_id = c.proposal_id
                     WHERE c.session_id = ?1 AND p.status = 'applied'
                     ORDER BY c.created_at DESC, c.checkpoint_id DESC
                     LIMIT 1",
                    [session_id],
                    |row| {
                        let encoded: String = row.get(0)?;
                        serde_json::from_str(&encoded).map_err(|error| {
                            rusqlite::Error::FromSqlConversionFailure(
                                0,
                                Type::Text,
                                Box::new(error),
                            )
                        })
                    },
                )
                .optional()
        })
    }

    fn begin_proposal_recovery(
        &self,
        input: &AgentProposalRecoveryBegin,
    ) -> Result<AgentProposalRecoveryOperation, CommandError> {
        let (checkpoint_json, finalization_json) = validate_recovery_begin(input)?;
        let now = utc_now();
        self.with_connection("begin proposal recovery", |connection| {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let identity: (String, String, String, i64, String, Option<String>) = transaction
                .query_row(
                    "SELECT p.session_id, s.project_id, p.status, p.base_revision,
                        p.base_document_hash, c.checkpoint_json
                 FROM agent_proposals p
                 JOIN agent_sessions s ON s.session_id = p.session_id
                 LEFT JOIN agent_proposal_checkpoints c ON c.proposal_id = p.proposal_id
                 WHERE p.proposal_id = ?1",
                    [&input.proposal_id],
                    |row| {
                        Ok((
                            row.get(0)?,
                            row.get(1)?,
                            row.get(2)?,
                            row.get(3)?,
                            row.get(4)?,
                            row.get(5)?,
                        ))
                    },
                )?;
            let expected_status = if input.kind == "apply" {
                "staged"
            } else {
                "applied"
            };
            if identity.0 != input.session_id
                || identity.1 != input.project_id
                || identity.2 != expected_status
                || (input.kind == "apply"
                    && (identity.3 != input.before_revision
                        || identity.4 != input.before_document_hash))
                || (input.kind == "undo" && identity.5.as_deref() != Some(checkpoint_json.as_str()))
            {
                return Err(rusqlite::Error::QueryReturnedNoRows);
            }
            transaction.execute(
                "INSERT INTO agent_proposal_recovery (
                    operation_id, kind, proposal_id, session_id, project_id,
                    before_document_hash, before_revision, after_document_hash,
                    after_revision, checkpoint_json, finalization_json, status,
                    error, created_at, updated_at
                 ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                    'pending', NULL, ?12, ?12
                 )",
                params![
                    input.operation_id,
                    input.kind,
                    input.proposal_id,
                    input.session_id,
                    input.project_id,
                    input.before_document_hash,
                    input.before_revision,
                    input.after_document_hash,
                    input.after_revision,
                    checkpoint_json,
                    finalization_json,
                    now,
                ],
            )?;
            let operation = query_proposal_recovery(&transaction, &input.operation_id)?;
            transaction.commit()?;
            Ok(operation)
        })
    }

    fn list_proposal_recovery(
        &self,
        project_id: &str,
    ) -> Result<Vec<AgentProposalRecoveryOperation>, CommandError> {
        validate_identifier(project_id, "project ID")?;
        self.with_connection("list proposal recovery", |connection| {
            let mut statement = connection.prepare_cached(
                "SELECT operation_id, kind, proposal_id, session_id, project_id,
                        before_document_hash, before_revision, after_document_hash,
                        after_revision, checkpoint_json, finalization_json, status,
                        created_at, updated_at, error
                 FROM agent_proposal_recovery
                 WHERE project_id = ?1
                 ORDER BY created_at, operation_id",
            )?;
            let operations = statement
                .query_map([project_id], proposal_recovery_from_row)?
                .collect();
            operations
        })
    }

    fn finalize_proposal_recovery(&self, operation_id: &str) -> Result<(), CommandError> {
        validate_identifier(operation_id, "recovery operation ID")?;
        self.with_connection("finalize proposal recovery", |connection| {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let operation = transaction
                .query_row(
                    "SELECT operation_id, kind, proposal_id, session_id, project_id,
                            before_document_hash, before_revision, after_document_hash,
                            after_revision, checkpoint_json, finalization_json, status,
                            created_at, updated_at, error
                     FROM agent_proposal_recovery WHERE operation_id = ?1",
                    [operation_id],
                    proposal_recovery_from_row,
                )
                .optional()?;
            let Some(operation) = operation else {
                return transaction.commit();
            };
            if operation.status != "pending" {
                return Err(rusqlite::Error::InvalidQuery);
            }
            let finalization = operation
                .finalization
                .as_object()
                .ok_or(rusqlite::Error::InvalidQuery)?;
            let finalized_at = finalization
                .get("finalizedAt")
                .and_then(Value::as_str)
                .ok_or(rusqlite::Error::InvalidQuery)?;
            if operation.kind == "apply" {
                let proposal: (String, Option<String>, Option<i64>, Option<String>) = transaction
                    .query_row(
                    "SELECT status, applied_at, applied_revision, applied_document_hash
                         FROM agent_proposals WHERE proposal_id = ?1",
                    [&operation.proposal_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )?;
                if proposal.0 == "staged" {
                    let checkpoint_id = operation
                        .checkpoint
                        .get("checkpointId")
                        .and_then(Value::as_str)
                        .ok_or(rusqlite::Error::InvalidQuery)?;
                    let checkpoint_json = serde_json::to_string(&operation.checkpoint)
                        .map_err(|_| rusqlite::Error::InvalidQuery)?;
                    transaction.execute(
                        "INSERT INTO agent_proposal_checkpoints (
                            checkpoint_id, proposal_id, session_id, project_id,
                            checkpoint_json, created_at
                         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                         ON CONFLICT(proposal_id) DO UPDATE SET
                            checkpoint_id = excluded.checkpoint_id,
                            session_id = excluded.session_id,
                            project_id = excluded.project_id,
                            checkpoint_json = excluded.checkpoint_json,
                            created_at = excluded.created_at",
                        params![
                            checkpoint_id,
                            operation.proposal_id,
                            operation.session_id,
                            operation.project_id,
                            checkpoint_json,
                            finalized_at,
                        ],
                    )?;
                    require_changed(transaction.execute(
                        "UPDATE agent_proposals SET
                            status = 'applied', applied_at = ?2,
                            applied_revision = ?3, applied_document_hash = ?4,
                            updated_at = ?2
                         WHERE proposal_id = ?1 AND status = 'staged'",
                        params![
                            operation.proposal_id,
                            finalized_at,
                            operation.after_revision,
                            operation.after_document_hash,
                        ],
                    )?)?;
                } else if proposal.0 != "applied"
                    || proposal.1.as_deref() != Some(finalized_at)
                    || proposal.2 != Some(operation.after_revision)
                    || proposal.3.as_deref() != Some(operation.after_document_hash.as_str())
                {
                    return Err(rusqlite::Error::InvalidQuery);
                }
            } else {
                let proposal: (String, Option<String>) = transaction.query_row(
                    "SELECT status, undone_at FROM agent_proposals WHERE proposal_id = ?1",
                    [&operation.proposal_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )?;
                if proposal.0 == "applied" {
                    require_changed(transaction.execute(
                        "UPDATE agent_proposals SET
                            status = 'undone', undone_at = ?2, updated_at = ?2
                         WHERE proposal_id = ?1 AND status = 'applied'",
                        params![operation.proposal_id, finalized_at],
                    )?)?;
                } else if proposal.0 != "undone" || proposal.1.as_deref() != Some(finalized_at) {
                    return Err(rusqlite::Error::InvalidQuery);
                }
            }
            transaction.execute(
                "DELETE FROM agent_proposal_recovery
                 WHERE operation_id = ?1 AND status = 'pending'",
                [operation_id],
            )?;
            transaction.commit()
        })
    }

    fn abort_proposal_recovery(&self, operation_id: &str) -> Result<(), CommandError> {
        validate_identifier(operation_id, "recovery operation ID")?;
        self.with_connection("abort proposal recovery", |connection| {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let status: Option<String> = transaction
                .query_row(
                    "SELECT status FROM agent_proposal_recovery
                     WHERE operation_id = ?1",
                    [operation_id],
                    |row| row.get(0),
                )
                .optional()?;
            if status.as_deref() == Some("conflict") {
                return Err(rusqlite::Error::InvalidQuery);
            }
            transaction.execute(
                "DELETE FROM agent_proposal_recovery
                 WHERE operation_id = ?1 AND status = 'pending'",
                [operation_id],
            )?;
            transaction.commit()
        })
    }

    fn update_proposal_recovery_error(
        &self,
        operation_id: &str,
        error: &str,
        conflict: bool,
    ) -> Result<AgentProposalRecoveryOperation, CommandError> {
        validate_identifier(operation_id, "recovery operation ID")?;
        validate_required_text(error, MAX_ERROR_CHARS, "proposal recovery error")?;
        let now = utc_now();
        self.with_connection("update proposal recovery error", |connection| {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            require_changed(transaction.execute(
                if conflict {
                    "UPDATE agent_proposal_recovery SET
                        status = 'conflict', error = ?2, updated_at = ?3
                     WHERE operation_id = ?1 AND status IN ('pending', 'conflict')"
                } else {
                    "UPDATE agent_proposal_recovery SET
                        error = ?2, updated_at = ?3
                     WHERE operation_id = ?1 AND status = 'pending'"
                },
                params![operation_id, error, now],
            )?)?;
            let operation = query_proposal_recovery(&transaction, operation_id)?;
            transaction.commit()?;
            Ok(operation)
        })
    }

    fn update_usage(
        &self,
        input: &AgentSessionUsageUpdate,
    ) -> Result<AgentSessionMetadata, CommandError> {
        validate_identifier(&input.session_id, "session ID")?;
        validate_usage(&input.usage, input.context.as_ref(), input.cost.as_ref())?;
        let now = utc_now();
        self.with_connection("update agent session usage", |connection| {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            require_changed(transaction.execute(
                "UPDATE agent_sessions SET
                    input_tokens = ?2,
                    output_tokens = ?3,
                    reasoning_tokens = ?4,
                    cache_read_tokens = ?5,
                    cache_write_tokens = ?6,
                    request_count = ?7,
                    context_used_tokens = ?8,
                    context_limit_tokens = ?9,
                    cost_amount = ?10,
                    cost_currency = ?11,
                    cost_source = ?12,
                    updated_at = ?13
                 WHERE session_id = ?1",
                params![
                    input.session_id,
                    input.usage.input_tokens,
                    input.usage.output_tokens,
                    input.usage.reasoning_tokens,
                    input.usage.cache_read_tokens,
                    input.usage.cache_write_tokens,
                    input.usage.request_count,
                    input.context.as_ref().map(|context| context.used_tokens),
                    input.context.as_ref().and_then(|context| context.limit_tokens),
                    input.cost.as_ref().map(|cost| cost.amount),
                    input.cost.as_ref().map(|cost| &cost.currency),
                    input.cost.as_ref().map(|cost| &cost.source),
                    now
                ],
            )?)?;
            let session = query_session(&transaction, &input.session_id)?;
            transaction.commit()?;
            Ok(session)
        })
    }

    fn delete_project(&self, project_id: &str) -> Result<(), CommandError> {
        validate_identifier(project_id, "project ID")?;
        self.with_connection("delete agent project metadata", |connection| {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let now = utc_now();
            transaction.execute(
                "UPDATE agent_proposal_recovery SET
                    status = 'conflict',
                    error = 'The project was deleted before proposal recovery completed',
                    updated_at = ?2
                 WHERE project_id = ?1 AND status = 'pending'",
                params![project_id, now],
            )?;
            require_changed(transaction.execute(
                "DELETE FROM agent_projects WHERE project_id = ?1",
                [project_id],
            )?)?;
            transaction.commit()
        })
    }

    fn add_cleanup_tombstone(
        &self,
        input: &AgentCleanupTombstoneCreate,
    ) -> Result<AgentCleanupTombstone, CommandError> {
        validate_identifier(&input.project_id, "project ID")?;
        validate_identifier(&input.resource_id, "cleanup resource ID")?;
        validate_cleanup_kind(&input.resource_kind)?;
        validate_optional_text(
            input.last_error.as_deref(),
            MAX_ERROR_CHARS,
            "cleanup error",
        )?;
        let tombstone_id = Uuid::new_v4().to_string();
        let now = utc_now();
        self.with_connection("add agent cleanup tombstone", |connection| {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            transaction.execute(
                "INSERT INTO agent_cleanup_tombstones (
                    tombstone_id, project_id, resource_kind, resource_id,
                    attempt_count, last_error, retry_after, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6, ?6, ?6)
                 ON CONFLICT(resource_kind, resource_id) DO UPDATE SET
                    project_id = excluded.project_id,
                    last_error = excluded.last_error,
                    retry_after = excluded.retry_after,
                    updated_at = excluded.updated_at",
                params![
                    tombstone_id,
                    input.project_id,
                    input.resource_kind,
                    input.resource_id,
                    input.last_error,
                    now
                ],
            )?;
            let tombstone = query_cleanup_tombstone_by_resource(
                &transaction,
                &input.resource_kind,
                &input.resource_id,
            )?;
            transaction.commit()?;
            Ok(tombstone)
        })
    }

    fn list_cleanup_tombstones(
        &self,
        limit: u32,
    ) -> Result<Vec<AgentCleanupTombstone>, CommandError> {
        if limit == 0 || limit > 1_000 {
            return Err(store_validation_error(
                "Cleanup tombstone limit must be between 1 and 1000",
            ));
        }
        self.with_connection("list agent cleanup tombstones", |connection| {
            let mut statement = connection.prepare_cached(
                "SELECT tombstone_id, project_id, resource_kind, resource_id,
                        attempt_count, last_error, retry_after, created_at, updated_at
                 FROM agent_cleanup_tombstones
                 ORDER BY COALESCE(retry_after, created_at), created_at, tombstone_id
                 LIMIT ?1",
            )?;
            let tombstones = statement
                .query_map([i64::from(limit)], cleanup_tombstone_from_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(tombstones)
        })
    }

    fn retry_cleanup_tombstone(
        &self,
        tombstone_id: &str,
        last_error: Option<&str>,
    ) -> Result<AgentCleanupTombstone, CommandError> {
        validate_identifier(tombstone_id, "cleanup tombstone ID")?;
        validate_optional_text(last_error, MAX_ERROR_CHARS, "cleanup error")?;
        let now = utc_now();
        self.with_connection("retry agent cleanup tombstone", |connection| {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let attempt_count: i64 = transaction
                .query_row(
                    "SELECT attempt_count FROM agent_cleanup_tombstones WHERE tombstone_id = ?1",
                    [tombstone_id],
                    |row| row.get(0),
                )
                .optional()?
                .ok_or(rusqlite::Error::QueryReturnedNoRows)?;
            let delay_seconds = 30_i64
                .saturating_mul(2_i64.saturating_pow((attempt_count as u32).min(6)))
                .min(3_600);
            let retry_after = (Utc::now() + chrono::Duration::seconds(delay_seconds))
                .to_rfc3339_opts(SecondsFormat::Millis, true);
            require_changed(transaction.execute(
                "UPDATE agent_cleanup_tombstones SET
                    attempt_count = attempt_count + 1,
                    last_error = ?2,
                    retry_after = ?3,
                    updated_at = ?4
                 WHERE tombstone_id = ?1",
                params![tombstone_id, last_error, retry_after, now],
            )?)?;
            let tombstone = query_cleanup_tombstone(&transaction, tombstone_id)?;
            transaction.commit()?;
            Ok(tombstone)
        })
    }

    fn remove_cleanup_tombstone(&self, tombstone_id: &str) -> Result<(), CommandError> {
        validate_identifier(tombstone_id, "cleanup tombstone ID")?;
        self.with_connection("remove agent cleanup tombstone", |connection| {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            require_changed(transaction.execute(
                "DELETE FROM agent_cleanup_tombstones WHERE tombstone_id = ?1",
                [tombstone_id],
            )?)?;
            transaction.commit()
        })
    }
}

fn migrate(connection: &mut Connection) -> rusqlite::Result<()> {
    {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute_batch(
            "CREATE TABLE IF NOT EXISTS agent_schema_migrations (
                version INTEGER PRIMARY KEY NOT NULL CHECK(version > 0),
                name TEXT NOT NULL UNIQUE,
                applied_at TEXT NOT NULL
            );",
        )?;
        transaction.commit()?;
    }

    let latest: Option<i64> = connection.query_row(
        "SELECT MAX(version) FROM agent_schema_migrations",
        [],
        |row| row.get(0),
    )?;
    if latest.unwrap_or(0) > CURRENT_SCHEMA_VERSION {
        return Err(rusqlite::Error::InvalidQuery);
    }
    apply_migration(connection, 1, "core_projects_sessions", MIGRATION_1)?;
    apply_migration(connection, 2, "metadata_receipts_cleanup", MIGRATION_2)?;
    apply_migration(connection, 3, "proposal_checkpoints", MIGRATION_3)?;
    apply_migration(connection, 4, "proposal_recovery_journal", MIGRATION_4)?;
    Ok(())
}

fn apply_migration(
    connection: &mut Connection,
    version: i64,
    name: &str,
    sql: &str,
) -> rusqlite::Result<()> {
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let exists = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM agent_schema_migrations WHERE version = ?1)",
        [version],
        |row| row.get::<_, bool>(0),
    )?;
    if exists {
        return transaction.commit();
    }
    transaction.execute_batch(sql)?;
    transaction.execute(
        "INSERT INTO agent_schema_migrations (version, name, applied_at) VALUES (?1, ?2, ?3)",
        params![version, name, utc_now()],
    )?;
    transaction.commit()
}

fn query_project(
    connection: &Connection,
    project_id: &str,
) -> rusqlite::Result<AgentProjectMetadata> {
    connection.query_row(
        "SELECT project_id, canonical_path, project_name, state, created_at, updated_at
         FROM agent_projects WHERE project_id = ?1",
        [project_id],
        |row| {
            Ok(AgentProjectMetadata {
                project_id: row.get(0)?,
                project_path: row.get(1)?,
                project_name: row.get(2)?,
                state: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        },
    )
}

fn query_session(
    connection: &Connection,
    session_id: &str,
) -> rusqlite::Result<AgentSessionMetadata> {
    connection.query_row(
        "SELECT
            s.session_id, s.project_id, p.canonical_path, s.title, s.status, s.model_id,
            s.created_at, s.updated_at, s.last_error_code, s.last_error_phase,
            s.last_error_message, s.last_error_retryable, s.last_error_recovery,
            s.interrupted_at, s.input_tokens, s.output_tokens, s.reasoning_tokens,
            s.cache_read_tokens, s.cache_write_tokens, s.request_count,
            s.context_used_tokens, s.context_limit_tokens, s.cost_amount,
            s.cost_currency, s.cost_source
         FROM agent_sessions s
         JOIN agent_projects p ON p.project_id = s.project_id
         WHERE s.session_id = ?1",
        [session_id],
        session_from_row,
    )
}

fn session_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentSessionMetadata> {
    let error_code: Option<String> = row.get(8)?;
    let input_tokens: Option<i64> = row.get(14)?;
    let context_used_tokens: Option<i64> = row.get(20)?;
    let cost_amount: Option<f64> = row.get(22)?;
    Ok(AgentSessionMetadata {
        session_id: row.get(0)?,
        project_id: row.get(1)?,
        project_path: row.get(2)?,
        title: row.get(3)?,
        state: row.get(4)?,
        model_id: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        last_error: error_code
            .map(|code| {
                Ok::<_, rusqlite::Error>(AgentStoredError {
                    code,
                    phase: required_related_column(row, 9, "last_error_phase")?,
                    message: required_related_column(row, 10, "last_error_message")?,
                    retryable: required_related_column::<i64>(row, 11, "last_error_retryable")?
                        != 0,
                    recovery: row.get(12)?,
                })
            })
            .transpose()?,
        interrupted_at: row.get(13)?,
        usage: input_tokens
            .map(|input_tokens| {
                Ok::<_, rusqlite::Error>(AgentTokenUsage {
                    input_tokens,
                    output_tokens: required_related_column(row, 15, "output_tokens")?,
                    reasoning_tokens: required_related_column(row, 16, "reasoning_tokens")?,
                    cache_read_tokens: required_related_column(row, 17, "cache_read_tokens")?,
                    cache_write_tokens: required_related_column(row, 18, "cache_write_tokens")?,
                    request_count: required_related_column(row, 19, "request_count")?,
                })
            })
            .transpose()?,
        context: context_used_tokens
            .map(|used_tokens| {
                Ok::<_, rusqlite::Error>(AgentContextUsage {
                    used_tokens,
                    limit_tokens: row.get(21)?,
                })
            })
            .transpose()?,
        cost: cost_amount
            .map(|amount| {
                Ok::<_, rusqlite::Error>(AgentMonetaryCost {
                    amount,
                    currency: required_related_column(row, 23, "cost_currency")?,
                    source: required_related_column(row, 24, "cost_source")?,
                })
            })
            .transpose()?,
    })
}

fn required_related_column<T: rusqlite::types::FromSql>(
    row: &rusqlite::Row<'_>,
    index: usize,
    name: &str,
) -> rusqlite::Result<T> {
    row.get::<_, Option<T>>(index)?.ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            index,
            Type::Null,
            format!("missing related {name} column").into(),
        )
    })
}

fn query_proposal(
    connection: &Connection,
    proposal_id: &str,
) -> rusqlite::Result<AgentStoredProposal> {
    connection.query_row(
        "SELECT proposal_id, session_id, status, summary, base_revision,
                base_document_hash, operation_count, operations_json, created_at, updated_at,
                applied_at, applied_revision, applied_document_hash, discarded_at, undone_at
         FROM agent_proposals WHERE proposal_id = ?1",
        [proposal_id],
        proposal_from_row,
    )
}

fn query_proposal_recovery(
    connection: &Connection,
    operation_id: &str,
) -> rusqlite::Result<AgentProposalRecoveryOperation> {
    connection.query_row(
        "SELECT operation_id, kind, proposal_id, session_id, project_id,
                before_document_hash, before_revision, after_document_hash,
                after_revision, checkpoint_json, finalization_json, status,
                created_at, updated_at, error
         FROM agent_proposal_recovery WHERE operation_id = ?1",
        [operation_id],
        proposal_recovery_from_row,
    )
}

fn proposal_recovery_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<AgentProposalRecoveryOperation> {
    let checkpoint_json: String = row.get(9)?;
    let finalization_json: String = row.get(10)?;
    let decode = |value: String, column| {
        serde_json::from_str(&value).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(column, Type::Text, Box::new(error))
        })
    };
    Ok(AgentProposalRecoveryOperation {
        operation_id: row.get(0)?,
        kind: row.get(1)?,
        proposal_id: row.get(2)?,
        session_id: row.get(3)?,
        project_id: row.get(4)?,
        before_document_hash: row.get(5)?,
        before_revision: row.get(6)?,
        after_document_hash: row.get(7)?,
        after_revision: row.get(8)?,
        checkpoint: decode(checkpoint_json, 9)?,
        finalization: decode(finalization_json, 10)?,
        status: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
        error: row.get(14)?,
    })
}

fn proposal_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentStoredProposal> {
    let raw_operations: Option<String> = row.get(7)?;
    let operations = raw_operations
        .map(|raw| {
            serde_json::from_str(&raw).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(7, Type::Text, Box::new(error))
            })
        })
        .transpose()?;
    Ok(AgentStoredProposal {
        proposal_id: row.get(0)?,
        session_id: row.get(1)?,
        status: row.get(2)?,
        summary: row.get(3)?,
        base_revision: row.get(4)?,
        base_document_hash: row.get(5)?,
        operation_count: row.get(6)?,
        operations,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
        applied_at: row.get(10)?,
        applied_revision: row.get(11)?,
        applied_document_hash: row.get(12)?,
        discarded_at: row.get(13)?,
        undone_at: row.get(14)?,
    })
}

fn query_cleanup_tombstone(
    connection: &Connection,
    tombstone_id: &str,
) -> rusqlite::Result<AgentCleanupTombstone> {
    connection.query_row(
        "SELECT tombstone_id, project_id, resource_kind, resource_id,
                attempt_count, last_error, retry_after, created_at, updated_at
         FROM agent_cleanup_tombstones WHERE tombstone_id = ?1",
        [tombstone_id],
        cleanup_tombstone_from_row,
    )
}

fn query_cleanup_tombstone_by_resource(
    connection: &Connection,
    resource_kind: &str,
    resource_id: &str,
) -> rusqlite::Result<AgentCleanupTombstone> {
    connection.query_row(
        "SELECT tombstone_id, project_id, resource_kind, resource_id,
                attempt_count, last_error, retry_after, created_at, updated_at
         FROM agent_cleanup_tombstones WHERE resource_kind = ?1 AND resource_id = ?2",
        params![resource_kind, resource_id],
        cleanup_tombstone_from_row,
    )
}

fn cleanup_tombstone_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentCleanupTombstone> {
    Ok(AgentCleanupTombstone {
        tombstone_id: row.get(0)?,
        project_id: row.get(1)?,
        resource_kind: row.get(2)?,
        resource_id: row.get(3)?,
        attempt_count: row.get(4)?,
        last_error: row.get(5)?,
        retry_after: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn validate_identifier(value: &str, field: &str) -> Result<(), CommandError> {
    validate_required_text(value, MAX_ID_CHARS, field)
}

fn validate_optional_identifier(value: Option<&str>, field: &str) -> Result<(), CommandError> {
    if let Some(value) = value {
        validate_identifier(value, field)?;
    }
    Ok(())
}

fn validate_required_text(value: &str, max_chars: usize, field: &str) -> Result<(), CommandError> {
    if value.is_empty() || value.trim() != value || value.chars().count() > max_chars {
        return Err(store_validation_error(format!(
            "{field} must be trimmed and contain 1-{max_chars} characters"
        )));
    }
    Ok(())
}

fn validate_text_length(value: &str, max_chars: usize, field: &str) -> Result<(), CommandError> {
    if value.chars().count() > max_chars {
        return Err(store_validation_error(format!(
            "{field} must contain at most {max_chars} characters"
        )));
    }
    Ok(())
}

fn validate_optional_text(
    value: Option<&str>,
    max_chars: usize,
    field: &str,
) -> Result<(), CommandError> {
    if let Some(value) = value {
        validate_text_length(value, max_chars, field)?;
    }
    Ok(())
}

fn validate_session_state(value: &str) -> Result<(), CommandError> {
    if !SESSION_STATES.contains(&value) {
        return Err(store_validation_error("Agent session state is invalid"));
    }
    Ok(())
}

fn validate_stored_error(error: Option<&AgentStoredError>) -> Result<(), CommandError> {
    if let Some(error) = error {
        validate_required_text(&error.code, 100, "error code")?;
        validate_required_text(&error.phase, 100, "error phase")?;
        validate_required_text(&error.message, MAX_ERROR_CHARS, "error message")?;
        validate_optional_text(error.recovery.as_deref(), MAX_ERROR_CHARS, "error recovery")?;
    }
    Ok(())
}

fn validate_hash(value: &str, field: &str) -> Result<(), CommandError> {
    let valid = value.len() == 71
        && value.starts_with("sha256:")
        && value[7..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase());
    if !valid {
        return Err(store_validation_error(format!(
            "{field} must be a canonical SHA-256 hash"
        )));
    }
    Ok(())
}

fn validate_usage(
    usage: &AgentTokenUsage,
    context: Option<&AgentContextUsage>,
    cost: Option<&AgentMonetaryCost>,
) -> Result<(), CommandError> {
    if [
        usage.input_tokens,
        usage.output_tokens,
        usage.reasoning_tokens,
        usage.cache_read_tokens,
        usage.cache_write_tokens,
        usage.request_count,
    ]
    .iter()
    .any(|value| *value < 0)
    {
        return Err(store_validation_error(
            "Agent token usage values must be non-negative",
        ));
    }
    if let Some(context) = context {
        if context.used_tokens < 0 || context.limit_tokens.is_some_and(|limit| limit <= 0) {
            return Err(store_validation_error(
                "Agent context usage values are invalid",
            ));
        }
    }
    if let Some(cost) = cost {
        if !cost.amount.is_finite()
            || cost.amount < 0.0
            || cost.currency.len() != 3
            || !cost.currency.bytes().all(|byte| byte.is_ascii_uppercase())
            || (cost.source != "proxy" && cost.source != "configured_price_table")
        {
            return Err(store_validation_error("Agent monetary cost is invalid"));
        }
    }
    Ok(())
}

fn validate_cleanup_kind(value: &str) -> Result<(), CommandError> {
    if value != "copilot_session" {
        return Err(store_validation_error(
            "Cleanup resource kind must be copilot_session",
        ));
    }
    Ok(())
}

fn validate_operations(operations: &Value) -> Result<(i64, Option<String>), CommandError> {
    let list = operations
        .as_array()
        .ok_or_else(|| store_validation_error("Proposal operations must be a JSON array"))?;
    if list.is_empty() || list.len() > MAX_OPERATION_COUNT {
        return Err(store_validation_error(format!(
            "Proposal must contain 1-{MAX_OPERATION_COUNT} operations"
        )));
    }
    let mut counters = OperationCounters::default();
    for operation in list {
        validate_operation(operation, &mut counters)?;
    }
    if counters.text_chars > MAX_OPERATION_TEXT_CHARS {
        return Err(store_validation_error(
            "Proposal operation text exceeds the storage limit",
        ));
    }
    let encoded = serde_json::to_string(operations).map_err(|error| {
        store_validation_error(format!("Unable to encode proposal operations: {error}"))
    })?;
    if encoded.len() > MAX_OPERATION_JSON_BYTES {
        return Err(store_validation_error(
            "Proposal operation JSON exceeds the storage limit",
        ));
    }
    Ok((list.len() as i64, Some(encoded)))
}

#[derive(Default)]
struct OperationCounters {
    inserted_blocks: usize,
    text_chars: usize,
}

fn validate_operation(value: &Value, counters: &mut OperationCounters) -> Result<(), CommandError> {
    let object = json_object(value, "proposal operation")?;
    let op = json_string(object.get("op"), "proposal operation op")?;
    match op {
        "update" => {
            exact_json_keys(object, &["op", "blockId", "expectedBlockHash", "patch"])?;
            validate_identifier(json_string(object.get("blockId"), "blockId")?, "block ID")?;
            validate_hash(
                json_string(object.get("expectedBlockHash"), "expectedBlockHash")?,
                "expected block hash",
            )?;
            validate_patch(
                object
                    .get("patch")
                    .ok_or_else(|| store_validation_error("Proposal update patch is required"))?,
                counters,
            )
        }
        "delete" => {
            exact_json_keys(object, &["op", "blockId", "expectedBlockHash"])?;
            validate_identifier(json_string(object.get("blockId"), "blockId")?, "block ID")?;
            validate_hash(
                json_string(object.get("expectedBlockHash"), "expectedBlockHash")?,
                "expected block hash",
            )
        }
        "insertBefore" | "insertAfter" => {
            exact_json_keys(
                object,
                &["op", "referenceBlockId", "expectedReferenceHash", "blocks"],
            )?;
            validate_identifier(
                json_string(object.get("referenceBlockId"), "referenceBlockId")?,
                "reference block ID",
            )?;
            validate_hash(
                json_string(object.get("expectedReferenceHash"), "expectedReferenceHash")?,
                "expected reference hash",
            )?;
            let blocks = object
                .get("blocks")
                .and_then(Value::as_array)
                .ok_or_else(|| store_validation_error("Proposal blocks must be an array"))?;
            if blocks.is_empty() {
                return Err(store_validation_error(
                    "Proposal insert must contain at least one block",
                ));
            }
            for block in blocks {
                validate_block_draft(block, 1, counters)?;
            }
            Ok(())
        }
        _ => Err(store_validation_error(
            "Proposal operation type is unsupported",
        )),
    }
}

fn validate_patch(value: &Value, counters: &mut OperationCounters) -> Result<(), CommandError> {
    let object = json_object(value, "proposal patch")?;
    exact_json_keys(object, &["type", "text", "props"])?;
    if object.is_empty() {
        return Err(store_validation_error(
            "Proposal patch must change at least one field",
        ));
    }
    let block_type = object
        .get("type")
        .map(|kind| json_string(Some(kind), "block type"))
        .transpose()?;
    if let Some(block_type) = block_type {
        validate_text_block_type(block_type)?;
    }
    if let Some(text) = object.get("text") {
        count_operation_text(json_string(Some(text), "block text")?, counters)?;
    }
    if let Some(props) = object.get("props") {
        validate_block_props(props, block_type)?;
    }
    Ok(())
}

fn validate_block_draft(
    value: &Value,
    depth: usize,
    counters: &mut OperationCounters,
) -> Result<(), CommandError> {
    if depth > MAX_BLOCK_DEPTH {
        return Err(store_validation_error(
            "Proposal block nesting exceeds the storage limit",
        ));
    }
    counters.inserted_blocks += 1;
    if counters.inserted_blocks > MAX_INSERTED_BLOCKS {
        return Err(store_validation_error(
            "Proposal inserted block count exceeds the storage limit",
        ));
    }
    let object = json_object(value, "proposal block")?;
    exact_json_keys(object, &["type", "text", "props", "children"])?;
    let block_type = json_string(object.get("type"), "block type")?;
    validate_text_block_type(block_type)?;
    count_operation_text(json_string(object.get("text"), "block text")?, counters)?;
    if let Some(props) = object.get("props") {
        validate_block_props(props, Some(block_type))?;
    }
    if let Some(children) = object.get("children") {
        let children = children
            .as_array()
            .ok_or_else(|| store_validation_error("Block children must be an array"))?;
        for child in children {
            validate_block_draft(child, depth + 1, counters)?;
        }
    }
    Ok(())
}

fn validate_block_props(value: &Value, block_type: Option<&str>) -> Result<(), CommandError> {
    let object = json_object(value, "block props")?;
    exact_json_keys(
        object,
        &[
            "textAlignment",
            "textColor",
            "backgroundColor",
            "level",
            "checked",
            "language",
        ],
    )?;
    if let Some(alignment) = object.get("textAlignment") {
        if !["left", "center", "right", "justify"]
            .contains(&json_string(Some(alignment), "text alignment")?)
        {
            return Err(store_validation_error("Proposal text alignment is invalid"));
        }
    }
    for key in ["textColor", "backgroundColor"] {
        if let Some(color) = object.get(key) {
            let color = json_string(Some(color), key)?;
            let valid = !color.is_empty()
                && color.chars().count() <= 64
                && color.chars().all(|character| {
                    character.is_ascii_alphanumeric() || matches!(character, '#' | '_' | '-')
                });
            if !valid {
                return Err(store_validation_error(format!("Proposal {key} is invalid")));
            }
        }
    }
    if let Some(level) = object.get("level") {
        if block_type.is_some_and(|kind| kind != "heading") {
            return Err(store_validation_error(
                "Proposal heading level applies only to headings",
            ));
        }
        if !level.as_i64().is_some_and(|level| (1..=6).contains(&level)) {
            return Err(store_validation_error("Proposal heading level is invalid"));
        }
    }
    if object
        .get("checked")
        .is_some_and(|checked| !checked.is_boolean())
    {
        return Err(store_validation_error(
            "Proposal checked property must be a boolean",
        ));
    }
    if object.contains_key("checked") && block_type.is_some_and(|kind| kind != "checkListItem") {
        return Err(store_validation_error(
            "Proposal checked property applies only to checklist items",
        ));
    }
    if let Some(language) = object.get("language") {
        if block_type.is_some_and(|kind| kind != "codeBlock") {
            return Err(store_validation_error(
                "Proposal language applies only to code blocks",
            ));
        }
        let language = json_string(Some(language), "code language")?;
        if language.is_empty()
            || language.chars().count() > 64
            || !language.chars().all(|character| {
                character.is_ascii_alphanumeric()
                    || matches!(character, '_' | '+' | '#' | '.' | '-')
            })
        {
            return Err(store_validation_error("Proposal code language is invalid"));
        }
    }
    Ok(())
}

fn validate_text_block_type(value: &str) -> Result<(), CommandError> {
    if ![
        "paragraph",
        "heading",
        "bulletListItem",
        "numberedListItem",
        "checkListItem",
        "toggleListItem",
        "quote",
        "codeBlock",
    ]
    .contains(&value)
    {
        return Err(store_validation_error("Proposal block type is not allowed"));
    }
    Ok(())
}

fn count_operation_text(value: &str, counters: &mut OperationCounters) -> Result<(), CommandError> {
    let chars = value.chars().count();
    if chars > MAX_DRAFT_CHARS {
        return Err(store_validation_error(
            "Proposal block text exceeds the per-block storage limit",
        ));
    }
    counters.text_chars = counters.text_chars.saturating_add(chars);
    Ok(())
}

fn json_object<'a>(
    value: &'a Value,
    context: &str,
) -> Result<&'a serde_json::Map<String, Value>, CommandError> {
    value
        .as_object()
        .ok_or_else(|| store_validation_error(format!("{context} must be an object")))
}

fn json_string<'a>(value: Option<&'a Value>, context: &str) -> Result<&'a str, CommandError> {
    value
        .and_then(Value::as_str)
        .ok_or_else(|| store_validation_error(format!("{context} must be a string")))
}

fn exact_json_keys(
    object: &serde_json::Map<String, Value>,
    allowed: &[&str],
) -> Result<(), CommandError> {
    let allowed = allowed.iter().copied().collect::<BTreeSet<_>>();
    if let Some(extra) = object.keys().find(|key| !allowed.contains(key.as_str())) {
        return Err(store_validation_error(format!(
            "Proposal JSON contains unsupported field \"{extra}\""
        )));
    }
    Ok(())
}

fn normalize_utc_timestamp(value: &str) -> Result<String, CommandError> {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|timestamp| {
            timestamp
                .with_timezone(&Utc)
                .to_rfc3339_opts(SecondsFormat::Millis, true)
        })
        .map_err(|_| store_validation_error("Timestamp must be valid RFC 3339"))
}

fn utc_now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn require_changed(changed: usize) -> rusqlite::Result<()> {
    if changed == 1 {
        Ok(())
    } else {
        Err(rusqlite::Error::QueryReturnedNoRows)
    }
}

fn is_busy_error(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(details, _)
            if details.code == ErrorCode::DatabaseBusy
                || details.code == ErrorCode::DatabaseLocked
    )
}

fn store_sql_error(context: &str, error: rusqlite::Error) -> CommandError {
    let code = if is_busy_error(&error) {
        "agent_store_busy"
    } else if matches!(error, rusqlite::Error::QueryReturnedNoRows) {
        "agent_store_not_found"
    } else {
        "agent_store_failed"
    };
    CommandError::new(code, format!("Unable to {context}: {error}"))
}

fn store_validation_error(message: impl Into<String>) -> CommandError {
    CommandError::new("agent_store_invalid", message)
}

#[tauri::command]
pub fn agent_store_adopt_project(
    store: tauri::State<'_, AgentMetadataStore>,
    path: String,
) -> Result<AgentProjectMetadata, CommandError> {
    store.adopt_project(Path::new(&path))
}

#[tauri::command]
pub fn agent_store_list_sessions(
    store: tauri::State<'_, AgentMetadataStore>,
    project_id: String,
) -> Result<Vec<AgentSessionMetadata>, CommandError> {
    store.list_sessions(&project_id)
}

#[tauri::command]
pub fn agent_store_create_session(
    store: tauri::State<'_, AgentMetadataStore>,
    input: AgentSessionCreate,
) -> Result<AgentSessionMetadata, CommandError> {
    store.create_session(&input)
}

#[tauri::command]
pub fn agent_store_update_session(
    store: tauri::State<'_, AgentMetadataStore>,
    input: AgentSessionUpdate,
) -> Result<AgentSessionMetadata, CommandError> {
    store.update_session(&input)
}

#[tauri::command]
pub fn agent_store_rename_session(
    store: tauri::State<'_, AgentMetadataStore>,
    session_id: String,
    title: String,
) -> Result<AgentSessionMetadata, CommandError> {
    store.rename_session(&session_id, &title)
}

#[tauri::command]
pub fn agent_store_delete_session(
    store: tauri::State<'_, AgentMetadataStore>,
    session_id: String,
) -> Result<(), CommandError> {
    store.delete_session(&session_id)
}

#[tauri::command]
pub fn agent_store_read_draft(
    store: tauri::State<'_, AgentMetadataStore>,
    session_id: String,
) -> Result<Option<AgentDraft>, CommandError> {
    store.read_draft(&session_id)
}

#[tauri::command]
pub fn agent_store_write_draft(
    store: tauri::State<'_, AgentMetadataStore>,
    session_id: String,
    text: String,
) -> Result<AgentDraft, CommandError> {
    store.write_draft(&session_id, &text)
}

#[tauri::command]
pub fn agent_store_create_proposal(
    store: tauri::State<'_, AgentMetadataStore>,
    input: AgentProposalCreate,
) -> Result<AgentStoredProposal, CommandError> {
    store.create_proposal(&input)
}

#[tauri::command]
pub fn agent_store_list_proposals(
    store: tauri::State<'_, AgentMetadataStore>,
    session_id: String,
    limit: u32,
) -> Result<Vec<AgentStoredProposal>, CommandError> {
    store.list_proposals(&session_id, limit)
}

#[tauri::command]
pub fn agent_store_mark_proposal_stale(
    store: tauri::State<'_, AgentMetadataStore>,
    proposal_id: String,
) -> Result<AgentStoredProposal, CommandError> {
    store.mark_proposal_stale(&proposal_id)
}

#[tauri::command]
pub fn agent_store_set_proposal_status(
    store: tauri::State<'_, AgentMetadataStore>,
    proposal_id: String,
    status: String,
) -> Result<AgentStoredProposal, CommandError> {
    store.set_proposal_status(&proposal_id, &status)
}

#[tauri::command]
pub fn agent_store_apply_proposal(
    store: tauri::State<'_, AgentMetadataStore>,
    input: AgentProposalApply,
) -> Result<AgentStoredProposal, CommandError> {
    store.apply_proposal(&input)
}

#[tauri::command]
pub fn agent_store_commit_proposal_apply(
    store: tauri::State<'_, AgentMetadataStore>,
    input: AgentProposalApplyCommit,
) -> Result<AgentStoredProposal, CommandError> {
    store.commit_proposal_apply(&input)
}

#[tauri::command]
pub fn agent_store_undo_proposal(
    store: tauri::State<'_, AgentMetadataStore>,
    proposal_id: String,
) -> Result<AgentStoredProposal, CommandError> {
    store.undo_proposal(&proposal_id)
}

#[tauri::command]
pub fn agent_store_save_checkpoint(
    store: tauri::State<'_, AgentMetadataStore>,
    input: AgentCheckpointSave,
) -> Result<(), CommandError> {
    store.save_checkpoint(&input)
}

#[tauri::command]
pub fn agent_store_read_latest_checkpoint(
    store: tauri::State<'_, AgentMetadataStore>,
    session_id: String,
) -> Result<Option<Value>, CommandError> {
    store.read_latest_checkpoint(&session_id)
}

#[tauri::command]
pub fn agent_store_begin_proposal_recovery(
    store: tauri::State<'_, AgentMetadataStore>,
    input: AgentProposalRecoveryBegin,
) -> Result<AgentProposalRecoveryOperation, CommandError> {
    store.begin_proposal_recovery(&input)
}

#[tauri::command]
pub fn agent_store_list_proposal_recovery(
    store: tauri::State<'_, AgentMetadataStore>,
    project_id: String,
) -> Result<Vec<AgentProposalRecoveryOperation>, CommandError> {
    store.list_proposal_recovery(&project_id)
}

#[tauri::command]
pub fn agent_store_finalize_proposal_recovery(
    store: tauri::State<'_, AgentMetadataStore>,
    operation_id: String,
) -> Result<(), CommandError> {
    store.finalize_proposal_recovery(&operation_id)
}

#[tauri::command]
pub fn agent_store_abort_proposal_recovery(
    store: tauri::State<'_, AgentMetadataStore>,
    operation_id: String,
) -> Result<(), CommandError> {
    store.abort_proposal_recovery(&operation_id)
}

#[tauri::command]
pub fn agent_store_mark_proposal_recovery_conflict(
    store: tauri::State<'_, AgentMetadataStore>,
    operation_id: String,
    error: String,
) -> Result<AgentProposalRecoveryOperation, CommandError> {
    store.update_proposal_recovery_error(&operation_id, &error, true)
}

#[tauri::command]
pub fn agent_store_record_proposal_recovery_error(
    store: tauri::State<'_, AgentMetadataStore>,
    operation_id: String,
    error: String,
) -> Result<AgentProposalRecoveryOperation, CommandError> {
    store.update_proposal_recovery_error(&operation_id, &error, false)
}

#[tauri::command]
pub fn agent_store_update_usage(
    store: tauri::State<'_, AgentMetadataStore>,
    input: AgentSessionUsageUpdate,
) -> Result<AgentSessionMetadata, CommandError> {
    store.update_usage(&input)
}

#[tauri::command]
pub fn agent_store_delete_project(
    store: tauri::State<'_, AgentMetadataStore>,
    project_id: String,
) -> Result<(), CommandError> {
    store.delete_project(&project_id)
}

#[tauri::command]
pub fn agent_store_add_cleanup_tombstone(
    store: tauri::State<'_, AgentMetadataStore>,
    input: AgentCleanupTombstoneCreate,
) -> Result<AgentCleanupTombstone, CommandError> {
    store.add_cleanup_tombstone(&input)
}

#[tauri::command]
pub fn agent_store_list_cleanup_tombstones(
    store: tauri::State<'_, AgentMetadataStore>,
    limit: u32,
) -> Result<Vec<AgentCleanupTombstone>, CommandError> {
    store.list_cleanup_tombstones(limit)
}

#[tauri::command]
pub fn agent_store_retry_cleanup_tombstone(
    store: tauri::State<'_, AgentMetadataStore>,
    tombstone_id: String,
    last_error: Option<String>,
) -> Result<AgentCleanupTombstone, CommandError> {
    store.retry_cleanup_tombstone(&tombstone_id, last_error.as_deref())
}

#[tauri::command]
pub fn agent_store_remove_cleanup_tombstone(
    store: tauri::State<'_, AgentMetadataStore>,
    tombstone_id: String,
) -> Result<(), CommandError> {
    store.remove_cleanup_tombstone(&tombstone_id)
}

#[cfg(test)]
mod tests {
    use std::{fs, sync::Barrier};

    use super::*;
    use crate::workspace::create_project_in;

    fn hash(character: char) -> String {
        format!("sha256:{}", character.to_string().repeat(64))
    }

    fn store_in(root: &Path) -> AgentMetadataStore {
        AgentMetadataStore::open(root.join("agent.db")).expect("open metadata store")
    }

    fn adopt_fixture(store: &AgentMetadataStore, root: &Path, name: &str) -> AgentProjectMetadata {
        let project = create_project_in(root, name).expect("create project fixture");
        store
            .adopt_project(Path::new(&project.path))
            .expect("adopt project fixture")
    }

    fn session(project_id: &str, session_id: &str, title: &str) -> AgentSessionCreate {
        AgentSessionCreate {
            session_id: session_id.to_string(),
            project_id: project_id.to_string(),
            title: title.to_string(),
            state: "idle".to_string(),
            model_id: Some("gpt-test".to_string()),
        }
    }

    fn operations() -> Value {
        serde_json::json!([{
            "op": "update",
            "blockId": "block-1",
            "expectedBlockHash": hash('a'),
            "patch": { "text": "Updated text" }
        }])
    }

    fn recovery_begin(
        operation_id: &str,
        kind: &str,
        proposal_id: &str,
        session_id: &str,
        project_id: &str,
        before_revision: i64,
        before_hash: String,
        after_revision: i64,
        after_hash: String,
        checkpoint: Value,
    ) -> AgentProposalRecoveryBegin {
        AgentProposalRecoveryBegin {
            operation_id: operation_id.to_string(),
            kind: kind.to_string(),
            proposal_id: proposal_id.to_string(),
            session_id: session_id.to_string(),
            project_id: project_id.to_string(),
            before_document_hash: before_hash,
            before_revision,
            after_document_hash: after_hash.clone(),
            after_revision,
            checkpoint,
            finalization: if kind == "apply" {
                serde_json::json!({
                    "status": "applied",
                    "finalizedAt": "2026-08-22T00:00:02.000Z",
                    "revision": after_revision,
                    "documentHash": after_hash,
                })
            } else {
                serde_json::json!({
                    "status": "undone",
                    "finalizedAt": "2026-08-22T00:00:03.000Z",
                })
            },
        }
    }

    #[test]
    fn creates_absent_database_and_reopens_existing_database() {
        let root = tempfile::tempdir().expect("temporary directory");
        let path = root.path().join("agent.db");
        assert!(!path.exists());

        let first = AgentMetadataStore::open(path.clone()).expect("create database");
        assert!(path.is_file());
        let project = adopt_fixture(&first, root.path(), "First");
        drop(first);

        let reopened = AgentMetadataStore::open(path).expect("reopen database");
        assert!(reopened
            .list_sessions(&project.project_id)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn concurrent_first_open_applies_each_migration_once() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("agent.db");
        let barrier = Arc::new(Barrier::new(2));
        let workers = (0..2)
            .map(|_| {
                let worker_path = path.clone();
                let worker_barrier = barrier.clone();
                thread::spawn(move || {
                    worker_barrier.wait();
                    AgentMetadataStore::open(worker_path)
                })
            })
            .collect::<Vec<_>>();
        for worker in workers {
            worker
                .join()
                .expect("join first-open worker")
                .expect("open concurrent store");
        }
        let connection = Connection::open(path).unwrap();
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM agent_schema_migrations", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            CURRENT_SCHEMA_VERSION
        );
    }

    #[test]
    fn upgrades_v1_and_rolls_back_a_failed_migration() {
        let root = tempfile::tempdir().expect("temporary directory");
        let path = root.path().join("agent.db");
        let mut connection = Connection::open(&path).expect("open raw database");
        connection
            .execute_batch(
                "CREATE TABLE agent_schema_migrations (
                    version INTEGER PRIMARY KEY NOT NULL,
                    name TEXT NOT NULL UNIQUE,
                    applied_at TEXT NOT NULL
                );",
            )
            .unwrap();
        apply_migration(&mut connection, 1, "core_projects_sessions", MIGRATION_1).unwrap();
        drop(connection);

        AgentMetadataStore::open(path.clone()).expect("upgrade database");
        let connection = Connection::open(&path).unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT MAX(version) FROM agent_schema_migrations",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            CURRENT_SCHEMA_VERSION
        );
        drop(connection);

        let rollback_path = root.path().join("rollback.db");
        let mut rollback = Connection::open(&rollback_path).unwrap();
        rollback
            .execute_batch(
                "CREATE TABLE agent_schema_migrations (
                    version INTEGER PRIMARY KEY NOT NULL,
                    name TEXT NOT NULL UNIQUE,
                    applied_at TEXT NOT NULL
                );",
            )
            .unwrap();
        assert!(apply_migration(
            &mut rollback,
            1,
            "broken",
            "CREATE TABLE should_rollback(id INTEGER); THIS IS INVALID;"
        )
        .is_err());
        assert_eq!(
            rollback
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE name = 'should_rollback'",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
        assert_eq!(
            rollback
                .query_row("SELECT COUNT(*) FROM agent_schema_migrations", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            0
        );
    }

    #[test]
    fn configures_wal_and_foreign_keys_for_every_connection() {
        let root = tempfile::tempdir().unwrap();
        let store = store_in(root.path());
        let connection = store.open_configured_connection().unwrap();
        let journal: String = connection
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .unwrap();
        let foreign_keys: i64 = connection
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .unwrap();
        let busy_timeout: i64 = connection
            .query_row("PRAGMA busy_timeout", [], |row| row.get(0))
            .unwrap();
        assert_eq!(journal.to_ascii_lowercase(), "wal");
        assert_eq!(foreign_keys, 1);
        assert_eq!(busy_timeout, BUSY_TIMEOUT.as_millis() as i64);
    }

    #[test]
    fn session_crud_orders_newest_and_persists_optional_usage() {
        let root = tempfile::tempdir().unwrap();
        let store = store_in(root.path());
        let project = adopt_fixture(&store, root.path(), "Sessions");
        store
            .create_session(&session(&project.project_id, "older", "Older"))
            .unwrap();
        thread::sleep(Duration::from_millis(2));
        store
            .create_session(&session(&project.project_id, "newer", "Newer"))
            .unwrap();
        let renamed = store.rename_session("older", "Renamed").unwrap();
        assert_eq!(renamed.title, "Renamed");
        assert_eq!(
            store.list_sessions(&project.project_id).unwrap()[0].session_id,
            "older"
        );

        let updated = store
            .update_session(&AgentSessionUpdate {
                session_id: "older".to_string(),
                state: "error".to_string(),
                model_id: None,
                last_error: Some(AgentStoredError {
                    code: "timeout".to_string(),
                    phase: "generation".to_string(),
                    message: "Timed out".to_string(),
                    retryable: true,
                    recovery: Some("Retry".to_string()),
                }),
                interrupted_at: Some("2026-08-22T08:00:00+08:00".to_string()),
            })
            .unwrap();
        assert_eq!(updated.state, "error");
        assert_eq!(
            updated.interrupted_at.as_deref(),
            Some("2026-08-22T00:00:00.000Z")
        );

        let with_usage = store
            .update_usage(&AgentSessionUsageUpdate {
                session_id: "older".to_string(),
                usage: AgentTokenUsage {
                    input_tokens: 10,
                    output_tokens: 4,
                    reasoning_tokens: 2,
                    cache_read_tokens: 3,
                    cache_write_tokens: 1,
                    request_count: 1,
                },
                context: Some(AgentContextUsage {
                    used_tokens: 20,
                    limit_tokens: Some(100),
                }),
                cost: Some(AgentMonetaryCost {
                    amount: 0.25,
                    currency: "USD".to_string(),
                    source: "proxy".to_string(),
                }),
            })
            .unwrap();
        assert_eq!(with_usage.usage.unwrap().input_tokens, 10);
        assert_eq!(with_usage.context.unwrap().limit_tokens, Some(100));
        assert_eq!(with_usage.cost.unwrap().currency, "USD");

        store.delete_session("newer").unwrap();
        assert_eq!(store.list_sessions(&project.project_id).unwrap().len(), 1);
    }

    #[test]
    fn drafts_and_proposal_receipts_round_trip_with_status_guards() {
        let root = tempfile::tempdir().unwrap();
        let store = store_in(root.path());
        let project = adopt_fixture(&store, root.path(), "Receipts");
        store
            .create_session(&session(&project.project_id, "session-1", "Session"))
            .unwrap();
        assert_eq!(store.read_draft("session-1").unwrap(), None);
        let draft = store.write_draft("session-1", "draft text").unwrap();
        assert_eq!(store.read_draft("session-1").unwrap(), Some(draft));

        let proposal = store
            .create_proposal(&AgentProposalCreate {
                proposal_id: "proposal-1".to_string(),
                session_id: "session-1".to_string(),
                summary: "Update text".to_string(),
                base_revision: 3,
                base_document_hash: hash('b'),
                operation_count: 1,
                operations: Some(operations()),
            })
            .unwrap();
        assert_eq!(proposal.status, "staged");
        assert_eq!(proposal.operation_count, 1);
        assert!(proposal.operations.is_some());
        assert_eq!(
            store.list_proposals("session-1", 10).unwrap()[0].proposal_id,
            "proposal-1"
        );

        let checkpoint = serde_json::json!({
            "checkpointId": "checkpoint-1",
            "proposalId": "proposal-1",
            "sessionId": "session-1",
            "projectId": project.project_id.clone(),
            "beforeRevision": 3,
            "beforeDocumentHash": hash('b'),
            "appliedRevision": 4,
            "appliedDocumentHash": hash('c'),
            "beforePlan": {
                "schemaVersion": 14,
                "title": "Receipts",
                "document": {
                    "format": "preshot-blocks",
                    "version": 2,
                    "blocks": []
                },
                "imageGroups": []
            },
            "changes": []
        });
        store
            .save_checkpoint(&AgentCheckpointSave {
                checkpoint_id: "checkpoint-1".to_string(),
                proposal_id: "proposal-1".to_string(),
                session_id: "session-1".to_string(),
                project_id: project.project_id.clone(),
                checkpoint: checkpoint.clone(),
            })
            .unwrap();
        assert_eq!(store.read_latest_checkpoint("session-1").unwrap(), None);

        let applied = store
            .apply_proposal(&AgentProposalApply {
                proposal_id: "proposal-1".to_string(),
                applied_revision: 4,
                applied_document_hash: hash('c'),
            })
            .unwrap();
        assert_eq!(applied.status, "applied");
        assert_eq!(
            store.read_latest_checkpoint("session-1").unwrap(),
            Some(checkpoint)
        );
        assert!(applied.applied_at.is_some());
        assert!(store
            .set_proposal_status("proposal-1", "discarded")
            .is_err());
        let undone = store.undo_proposal("proposal-1").unwrap();
        assert_eq!(undone.status, "undone");
        assert!(undone.undone_at.is_some());
        assert!(store.undo_proposal("proposal-1").is_err());

        let compact = store
            .create_proposal(&AgentProposalCreate {
                proposal_id: "proposal-compact".to_string(),
                session_id: "session-1".to_string(),
                summary: "Retain receipt only".to_string(),
                base_revision: 4,
                base_document_hash: hash('d'),
                operation_count: 1,
                operations: None,
            })
            .unwrap();
        assert_eq!(compact.operation_count, 1);
        assert!(compact.operations.is_none());

        store
            .create_proposal(&AgentProposalCreate {
                proposal_id: "proposal-atomic".to_string(),
                session_id: "session-1".to_string(),
                summary: "Atomic apply".to_string(),
                base_revision: 4,
                base_document_hash: hash('d'),
                operation_count: 1,
                operations: Some(operations()),
            })
            .unwrap();
        let atomic_checkpoint = serde_json::json!({
            "checkpointId": "checkpoint-atomic",
            "proposalId": "proposal-atomic",
            "sessionId": "session-1",
            "projectId": project.project_id.clone(),
            "beforeRevision": 4,
            "beforeDocumentHash": hash('d'),
            "appliedRevision": 5,
            "appliedDocumentHash": hash('e'),
            "beforePlan": {
                "schemaVersion": 14,
                "title": "Receipts",
                "document": {
                    "format": "preshot-blocks",
                    "version": 2,
                    "blocks": []
                },
                "imageGroups": []
            },
            "changes": []
        });
        let commit = AgentProposalApplyCommit {
            checkpoint: AgentCheckpointSave {
                checkpoint_id: "checkpoint-atomic".to_string(),
                proposal_id: "proposal-atomic".to_string(),
                session_id: "session-1".to_string(),
                project_id: project.project_id.clone(),
                checkpoint: atomic_checkpoint.clone(),
            },
            applied_revision: 5,
            applied_document_hash: hash('f'),
        };
        assert!(store.commit_proposal_apply(&commit).is_err());
        assert_eq!(
            store.list_proposals("session-1", 10).unwrap()[0].status,
            "staged"
        );
        assert_eq!(store.read_latest_checkpoint("session-1").unwrap(), None);

        let applied = store
            .commit_proposal_apply(&AgentProposalApplyCommit {
                applied_document_hash: hash('e'),
                ..commit
            })
            .unwrap();
        assert_eq!(applied.status, "applied");
        assert_eq!(
            store.read_latest_checkpoint("session-1").unwrap(),
            Some(atomic_checkpoint)
        );
    }

    #[test]
    fn recovery_journal_survives_reopen_and_finalizes_apply_and_undo_exactly_once() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("agent.db");
        let store = AgentMetadataStore::open(path.clone()).unwrap();
        let project = adopt_fixture(&store, root.path(), "Recovery");
        store
            .create_session(&session(&project.project_id, "session-1", "Session"))
            .unwrap();
        store
            .create_proposal(&AgentProposalCreate {
                proposal_id: "proposal-1".to_string(),
                session_id: "session-1".to_string(),
                summary: "Recover apply".to_string(),
                base_revision: 3,
                base_document_hash: hash('b'),
                operation_count: 1,
                operations: Some(operations()),
            })
            .unwrap();
        let checkpoint = serde_json::json!({
            "checkpointId": "checkpoint-1",
            "proposalId": "proposal-1",
            "sessionId": "session-1",
            "projectId": project.project_id.clone(),
            "beforeRevision": 3,
            "beforeDocumentHash": hash('b'),
            "appliedRevision": 4,
            "appliedDocumentHash": hash('c'),
            "beforePlan": {
                "schemaVersion": 14,
                "title": "Recovery",
                "document": {
                    "format": "preshot-blocks",
                    "version": 2,
                    "blocks": []
                },
                "imageGroups": []
            },
            "changes": []
        });
        let apply = recovery_begin(
            "operation-apply",
            "apply",
            "proposal-1",
            "session-1",
            &project.project_id,
            3,
            hash('b'),
            4,
            hash('c'),
            checkpoint.clone(),
        );
        let pending = store.begin_proposal_recovery(&apply).unwrap();
        assert_eq!(pending.status, "pending");
        let competing = AgentProposalRecoveryBegin {
            operation_id: "operation-competing".to_string(),
            ..apply.clone()
        };
        assert!(store.begin_proposal_recovery(&competing).is_err());
        drop(store);

        let reopened = AgentMetadataStore::open(path).unwrap();
        assert_eq!(
            reopened
                .list_proposal_recovery(&project.project_id)
                .unwrap()[0]
                .operation_id,
            "operation-apply"
        );
        reopened
            .finalize_proposal_recovery("operation-apply")
            .unwrap();
        reopened
            .finalize_proposal_recovery("operation-apply")
            .unwrap();
        assert_eq!(
            reopened.list_proposals("session-1", 10).unwrap()[0].status,
            "applied"
        );
        assert_eq!(
            reopened.read_latest_checkpoint("session-1").unwrap(),
            Some(checkpoint.clone())
        );
        assert!(reopened
            .list_proposal_recovery(&project.project_id)
            .unwrap()
            .is_empty());

        let undo = recovery_begin(
            "operation-undo",
            "undo",
            "proposal-1",
            "session-1",
            &project.project_id,
            4,
            hash('c'),
            5,
            hash('b'),
            checkpoint,
        );
        reopened.begin_proposal_recovery(&undo).unwrap();
        let with_error = reopened
            .update_proposal_recovery_error("operation-undo", "retryable failure", false)
            .unwrap();
        assert_eq!(with_error.error.as_deref(), Some("retryable failure"));
        reopened
            .finalize_proposal_recovery("operation-undo")
            .unwrap();
        let undone = &reopened.list_proposals("session-1", 10).unwrap()[0];
        assert_eq!(undone.status, "undone");
        assert_eq!(
            undone.undone_at.as_deref(),
            Some("2026-08-22T00:00:03.000Z")
        );
        assert_eq!(reopened.read_latest_checkpoint("session-1").unwrap(), None);
    }

    #[test]
    fn recovery_conflicts_and_project_deletion_preserve_evidence() {
        let root = tempfile::tempdir().unwrap();
        let store = store_in(root.path());
        let project = adopt_fixture(&store, root.path(), "Conflict");
        store
            .create_session(&session(&project.project_id, "session-1", "Session"))
            .unwrap();
        store
            .create_proposal(&AgentProposalCreate {
                proposal_id: "proposal-1".to_string(),
                session_id: "session-1".to_string(),
                summary: "Conflict".to_string(),
                base_revision: 1,
                base_document_hash: hash('a'),
                operation_count: 1,
                operations: Some(operations()),
            })
            .unwrap();
        let checkpoint = serde_json::json!({
            "checkpointId": "checkpoint-1",
            "proposalId": "proposal-1",
            "sessionId": "session-1",
            "projectId": project.project_id.clone(),
            "beforeRevision": 1,
            "beforeDocumentHash": hash('a'),
            "appliedRevision": 2,
            "appliedDocumentHash": hash('b'),
            "beforePlan": {
                "schemaVersion": 14,
                "title": "Conflict",
                "document": {
                    "format": "preshot-blocks",
                    "version": 2,
                    "blocks": []
                },
                "imageGroups": []
            },
            "changes": []
        });
        store
            .begin_proposal_recovery(&recovery_begin(
                "operation-1",
                "apply",
                "proposal-1",
                "session-1",
                &project.project_id,
                1,
                hash('a'),
                2,
                hash('b'),
                checkpoint,
            ))
            .unwrap();
        let conflict = store
            .update_proposal_recovery_error("operation-1", "hash mismatch", true)
            .unwrap();
        assert_eq!(conflict.status, "conflict");
        assert!(store.finalize_proposal_recovery("operation-1").is_err());

        store.delete_project(&project.project_id).unwrap();
        let retained = store.list_proposal_recovery(&project.project_id).unwrap();
        assert_eq!(retained.len(), 1);
        assert_eq!(retained[0].status, "conflict");
        assert_eq!(retained[0].error.as_deref(), Some("hash mismatch"));
    }

    #[test]
    fn tool_proposals_validate_session_project_and_closed_operation_schema() {
        let root = tempfile::tempdir().unwrap();
        let store = store_in(root.path());
        let project = adopt_fixture(&store, root.path(), "ToolProposal");
        store
            .create_session(&session(&project.project_id, "session-1", "Session"))
            .unwrap();

        assert!(store
            .stage_tool_proposal(
                "session-1",
                "other-project",
                "Wrong project".to_string(),
                1,
                hash('a'),
                operations().as_array().unwrap().clone(),
            )
            .is_err());
        let staged = store
            .stage_tool_proposal(
                "session-1",
                &project.project_id,
                "Valid proposal".to_string(),
                1,
                hash('a'),
                operations().as_array().unwrap().clone(),
            )
            .unwrap();
        assert_eq!(staged.status, "staged");
        assert!(staged.operations.is_some());

        assert!(store
            .stage_tool_proposal(
                "session-1",
                &project.project_id,
                "Malicious".to_string(),
                1,
                hash('a'),
                vec![serde_json::json!({
                    "op": "update",
                    "blockId": "block-1",
                    "expectedBlockHash": hash('a'),
                    "patch": {
                        "text": "Unsafe",
                        "path": r"C:\secret.txt"
                    }
                })],
            )
            .is_err());
    }

    #[test]
    fn checkpoint_store_rejects_identity_mismatch_paths_and_raw_media() {
        let root = tempfile::tempdir().unwrap();
        let store = store_in(root.path());
        let project = adopt_fixture(&store, root.path(), "CheckpointBounds");
        store
            .create_session(&session(&project.project_id, "session-1", "Session"))
            .unwrap();
        store
            .create_proposal(&AgentProposalCreate {
                proposal_id: "proposal-1".to_string(),
                session_id: "session-1".to_string(),
                summary: "Checkpoint".to_string(),
                base_revision: 1,
                base_document_hash: hash('a'),
                operation_count: 1,
                operations: Some(operations()),
            })
            .unwrap();
        let base = serde_json::json!({
            "checkpointId": "checkpoint-1",
            "proposalId": "proposal-1",
            "sessionId": "session-1",
            "projectId": project.project_id.clone(),
            "beforeRevision": 1,
            "beforeDocumentHash": hash('a'),
            "appliedRevision": 2,
            "appliedDocumentHash": hash('b'),
            "beforePlan": {
                "schemaVersion": 14,
                "title": "Checkpoint",
                "document": {
                    "format": "preshot-blocks",
                    "version": 2,
                    "blocks": []
                },
                "imageGroups": []
            },
            "changes": []
        });
        for checkpoint in [
            {
                let mut value = base.clone();
                value["sessionId"] = Value::String("other-session".to_string());
                value
            },
            {
                let mut value = base.clone();
                value["beforePlan"]["path"] =
                    Value::String(r"C:\secret\project.preshot".to_string());
                value
            },
            {
                let mut value = base.clone();
                value["beforePlan"]["raw"] =
                    Value::String("data:image/png;base64,AAAA".to_string());
                value
            },
        ] {
            assert!(store
                .save_checkpoint(&AgentCheckpointSave {
                    checkpoint_id: "checkpoint-1".to_string(),
                    proposal_id: "proposal-1".to_string(),
                    session_id: "session-1".to_string(),
                    project_id: project.project_id.clone(),
                    checkpoint,
                })
                .is_err());
        }
    }

    #[test]
    fn deleting_project_cascades_only_its_sessions_drafts_and_proposals() {
        let root = tempfile::tempdir().unwrap();
        let store = store_in(root.path());
        let first = adopt_fixture(&store, root.path(), "First");
        let second = adopt_fixture(&store, root.path(), "Second");
        store
            .create_session(&session(&first.project_id, "first-session", "First"))
            .unwrap();
        store
            .create_session(&session(&second.project_id, "second-session", "Second"))
            .unwrap();
        store.write_draft("first-session", "remove").unwrap();
        store
            .create_proposal(&AgentProposalCreate {
                proposal_id: "first-proposal".to_string(),
                session_id: "first-session".to_string(),
                summary: "Remove".to_string(),
                base_revision: 1,
                base_document_hash: hash('d'),
                operation_count: 1,
                operations: Some(operations()),
            })
            .unwrap();

        store.delete_project(&first.project_id).unwrap();
        assert!(store.list_sessions(&first.project_id).unwrap().is_empty());
        assert_eq!(store.list_sessions(&second.project_id).unwrap().len(), 1);
        let connection = store.open_configured_connection().unwrap();
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM agent_drafts", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM agent_proposals", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn canonical_project_adoption_tracks_a_rename_and_rejects_path_aliasing() {
        let root = tempfile::tempdir().unwrap();
        let store = store_in(root.path());
        let created = create_project_in(root.path(), "Original").unwrap();
        let first = store.adopt_project(Path::new(&created.path)).unwrap();
        let renamed_path = root.path().join("Renamed");
        fs::rename(&created.path, &renamed_path).unwrap();
        let adopted = store.adopt_project(&renamed_path).unwrap();
        assert_eq!(adopted.project_id, first.project_id);
        assert_eq!(
            PathBuf::from(adopted.project_path),
            renamed_path.canonicalize().unwrap()
        );

        let duplicate_manifest = root.path().join("DuplicateIdentity");
        fs::create_dir(&duplicate_manifest).unwrap();
        fs::copy(
            renamed_path.join(".preshotproj"),
            duplicate_manifest.join(".preshotproj"),
        )
        .unwrap();
        let adopted_again = store.adopt_project(&duplicate_manifest).unwrap();
        assert_eq!(adopted_again.project_id, first.project_id);
        assert_eq!(
            PathBuf::from(adopted_again.project_path),
            duplicate_manifest.canonicalize().unwrap()
        );
    }

    #[test]
    fn cleanup_tombstones_retry_survive_project_cascade_and_remove_exactly() {
        let root = tempfile::tempdir().unwrap();
        let store = store_in(root.path());
        let first = adopt_fixture(&store, root.path(), "CleanupOne");
        let second = adopt_fixture(&store, root.path(), "CleanupTwo");
        let one = store
            .add_cleanup_tombstone(&AgentCleanupTombstoneCreate {
                project_id: first.project_id.clone(),
                resource_kind: "copilot_session".to_string(),
                resource_id: "runtime-1".to_string(),
                last_error: Some("locked".to_string()),
            })
            .unwrap();
        let two = store
            .add_cleanup_tombstone(&AgentCleanupTombstoneCreate {
                project_id: second.project_id.clone(),
                resource_kind: "copilot_session".to_string(),
                resource_id: "runtime-2".to_string(),
                last_error: None,
            })
            .unwrap();
        let retried = store
            .retry_cleanup_tombstone(&one.tombstone_id, Some("still locked"))
            .unwrap();
        assert_eq!(retried.attempt_count, 1);
        assert!(retried.retry_after.is_some());

        store.delete_project(&first.project_id).unwrap();
        assert_eq!(store.list_cleanup_tombstones(10).unwrap().len(), 2);
        store.remove_cleanup_tombstone(&one.tombstone_id).unwrap();
        let remaining = store.list_cleanup_tombstones(10).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].tombstone_id, two.tombstone_id);
    }

    #[test]
    fn concurrent_store_instances_do_not_lose_sessions() {
        let root = tempfile::tempdir().unwrap();
        let store = store_in(root.path());
        let project = adopt_fixture(&store, root.path(), "Concurrent");
        let barrier = Arc::new(Barrier::new(8));
        let mut workers = Vec::new();
        for index in 0..8 {
            let worker_store = store.clone();
            let worker_project = project.project_id.clone();
            let worker_barrier = barrier.clone();
            workers.push(thread::spawn(move || {
                worker_barrier.wait();
                worker_store
                    .create_session(&session(
                        &worker_project,
                        &format!("session-{index}"),
                        &format!("Session {index}"),
                    ))
                    .unwrap();
            }));
        }
        for worker in workers {
            worker.join().unwrap();
        }
        assert_eq!(store.list_sessions(&project.project_id).unwrap().len(), 8);
    }

    #[test]
    fn malformed_and_oversized_values_are_rejected_before_sql() {
        let root = tempfile::tempdir().unwrap();
        let store = store_in(root.path());
        let project = adopt_fixture(&store, root.path(), "Bounds");
        assert!(store
            .create_session(&AgentSessionCreate {
                session_id: " bad ".to_string(),
                project_id: project.project_id.clone(),
                title: "Bad".to_string(),
                state: "idle".to_string(),
                model_id: None,
            })
            .is_err());
        store
            .create_session(&session(&project.project_id, "bounded", "Bounded"))
            .unwrap();
        assert!(store
            .write_draft("bounded", &"x".repeat(MAX_DRAFT_CHARS + 1))
            .is_err());
        assert!(store
            .create_proposal(&AgentProposalCreate {
                proposal_id: "secret-proposal".to_string(),
                session_id: "bounded".to_string(),
                summary: "Unsafe".to_string(),
                base_revision: 0,
                base_document_hash: hash('e'),
                operation_count: 1,
                operations: Some(serde_json::json!([{
                    "op": "update",
                    "blockId": "block-1",
                    "expectedBlockHash": hash('f'),
                    "patch": { "text": "ok", "imageData": "secret" }
                }])),
            })
            .is_err());
    }

    #[test]
    fn schema_has_no_transcript_image_byte_or_secret_fields() {
        let root = tempfile::tempdir().unwrap();
        let store = store_in(root.path());
        let connection = store.open_configured_connection().unwrap();
        let schema: String = connection
            .query_row(
                "SELECT group_concat(sql, ' ') FROM sqlite_master
                 WHERE type = 'table' AND name LIKE 'agent_%'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let lower = schema.to_ascii_lowercase();
        for forbidden in [
            "transcript",
            "message_content",
            "image_bytes",
            "api_key",
            "access_token",
            "secret_value",
        ] {
            assert!(!lower.contains(forbidden), "schema contains {forbidden}");
        }
    }

    #[test]
    fn disk_or_permission_path_failures_are_actionable() {
        let root = tempfile::tempdir().unwrap();
        let parent_file = root.path().join("not-a-directory");
        fs::write(&parent_file, "occupied").unwrap();
        let error = match AgentMetadataStore::open(parent_file.join("agent.db")) {
            Ok(_) => panic!("store unexpectedly opened"),
            Err(error) => error,
        };
        assert_eq!(error.code, "agent_store_open_failed");
        assert!(error.message.contains("agent metadata directory"));
    }
}
