use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::agent_store::AgentMetadataStore;
use crate::error::CommandError;

use super::attachments::AttachmentTokenResolver;
use super::tools::{
    AgentToolBridge, GetProjectSummaryArgs, ListReferenceImagesArgs, ProposeTextBlockEditsArgs,
    ReadTextBlocksArgs,
};

const MAX_CONTEXT_BLOCKS: usize = 64;
const MAX_CONTEXT_TEXT_BYTES: usize = 64 * 1024;
const MAX_BLOCK_TEXT_CHARS: usize = 4_000;
const MAX_REFERENCE_IMAGES: usize = 64;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentContextReceipt {
    pub project_id: String,
    pub project_name: String,
    pub document_revision: u64,
    pub document_hash: String,
    pub selected_block_ids: Vec<String>,
    #[serde(default)]
    pub reference_images: Vec<AgentReferenceImageMetadata>,
    pub cursor_block_id: Option<String>,
    pub selected_image: Option<AgentSelectedImageReceipt>,
    pub captured_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentReferenceImageMetadata {
    pub group_id: String,
    pub image_id: String,
    pub display_name: String,
    pub group_label: String,
    pub width: Option<f64>,
    pub height: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentSelectedImageReceipt {
    pub group_id: String,
    pub image_id: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentContextTextBlock {
    pub block_id: String,
    pub block_hash: String,
    #[serde(rename = "type")]
    pub block_type: String,
    pub text: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentContextAttachment {
    pub token: String,
    pub group_id: String,
    pub image_id: String,
    pub absolute_path: PathBuf,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegisterAgentRequestContext {
    pub session_id: String,
    pub request_id: String,
    pub context_id: String,
    pub receipt: AgentContextReceipt,
    pub text_blocks: Vec<AgentContextTextBlock>,
    pub attachment: Option<AgentContextAttachment>,
}

#[derive(Debug, Clone)]
struct RegisteredContext {
    request_id: String,
    context_id: String,
    receipt: AgentContextReceipt,
    text_blocks: HashMap<String, AgentContextTextBlock>,
    attachment: Option<AgentContextAttachment>,
}

pub struct RendererAgentBridge {
    contexts: Mutex<HashMap<String, RegisteredContext>>,
    store: Mutex<Option<AgentMetadataStore>>,
}

impl Default for RendererAgentBridge {
    fn default() -> Self {
        Self {
            contexts: Mutex::new(HashMap::new()),
            store: Mutex::new(None),
        }
    }
}

impl RendererAgentBridge {
    pub fn configure_store(&self, store: AgentMetadataStore) {
        *match self.store.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        } = Some(store);
    }

    pub fn register(&self, input: RegisterAgentRequestContext) -> Result<(), CommandError> {
        validate_identifier(&input.session_id, "sessionId")?;
        validate_identifier(&input.request_id, "requestId")?;
        validate_identifier(&input.context_id, "contextId")?;
        validate_identifier(&input.receipt.project_id, "projectId")?;
        if input.context_id != input.request_id
            || input.receipt.project_name.trim().is_empty()
            || input.receipt.document_hash.trim().is_empty()
            || input.receipt.captured_at.trim().is_empty()
            || input.receipt.selected_block_ids.len() > MAX_CONTEXT_BLOCKS
            || input.receipt.reference_images.len() > MAX_REFERENCE_IMAGES
            || input.text_blocks.len() > MAX_CONTEXT_BLOCKS
        {
            return Err(CommandError::new(
                "context_invalid",
                "The renderer agent context receipt is invalid",
            ));
        }
        validate_hash(&input.receipt.document_hash, "documentHash")?;
        for image in &input.receipt.reference_images {
            validate_identifier(&image.group_id, "groupId")?;
            validate_identifier(&image.image_id, "imageId")?;
            validate_display_text(&image.display_name, "displayName")?;
            validate_display_text(&image.group_label, "groupLabel")?;
            if image
                .width
                .is_some_and(|value| !value.is_finite() || value <= 0.0)
                || image
                    .height
                    .is_some_and(|value| !value.is_finite() || value <= 0.0)
            {
                return Err(CommandError::new(
                    "context_invalid",
                    "Reference image dimensions are invalid",
                ));
            }
        }
        let disclosed = input
            .receipt
            .selected_block_ids
            .iter()
            .chain(input.receipt.cursor_block_id.iter())
            .collect::<std::collections::HashSet<_>>();
        let mut total_text = 0usize;
        let mut text_blocks = HashMap::new();
        for block in input.text_blocks {
            validate_identifier(&block.block_id, "blockId")?;
            if block.text.chars().count() > MAX_BLOCK_TEXT_CHARS {
                return Err(CommandError::new(
                    "context_too_large",
                    "A disclosed text block exceeded the 4000 character limit",
                ));
            }
            if !disclosed.contains(&block.block_id) {
                return Err(CommandError::new(
                    "tool_denied",
                    "The context contains a block that was not disclosed",
                ));
            }
            total_text = total_text.saturating_add(block.text.len());
            if total_text > MAX_CONTEXT_TEXT_BYTES
                || text_blocks.insert(block.block_id.clone(), block).is_some()
            {
                return Err(CommandError::new(
                    "context_too_large",
                    "The disclosed text context exceeded its closed limits",
                ));
            }
        }
        if let Some(attachment) = &input.attachment {
            if attachment.token.trim() != attachment.token
                || attachment.token.is_empty()
                || attachment.absolute_path.as_os_str().is_empty()
                || input.receipt.selected_image.as_ref().is_none_or(|image| {
                    image.group_id != attachment.group_id || image.image_id != attachment.image_id
                })
            {
                return Err(CommandError::new(
                    "attachment_token_invalid",
                    "The renderer attachment registration is invalid",
                ));
            }
        }
        self.lock_contexts().insert(
            input.session_id,
            RegisteredContext {
                request_id: input.request_id,
                context_id: input.context_id,
                receipt: input.receipt,
                text_blocks,
                attachment: input.attachment,
            },
        );
        Ok(())
    }

    fn context(
        &self,
        session_id: &str,
        context_id: &str,
    ) -> Result<RegisteredContext, CommandError> {
        let context = self
            .lock_contexts()
            .get(session_id)
            .cloned()
            .ok_or_else(|| {
                CommandError::new(
                    "workspace_bridge_unavailable",
                    "No immutable Preshot request context is registered",
                )
            })?;
        if context.context_id != context_id || context.request_id != context_id {
            return Err(CommandError::new(
                "tool_denied",
                "The tool request does not match the disclosed context receipt",
            ));
        }
        Ok(context)
    }

    fn lock_contexts(&self) -> std::sync::MutexGuard<'_, HashMap<String, RegisteredContext>> {
        match self.contexts.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }
}

impl AttachmentTokenResolver for RendererAgentBridge {
    fn resolve(&self, project_id: &str, attachment_token: &str) -> Result<PathBuf, CommandError> {
        for context in self.lock_contexts().values_mut() {
            if context.receipt.project_id != project_id
                || context
                    .attachment
                    .as_ref()
                    .is_none_or(|attachment| attachment.token != attachment_token)
            {
                continue;
            }
            return Ok(context
                .attachment
                .take()
                .expect("checked attachment")
                .absolute_path);
        }
        Err(CommandError::new(
            "attachment_token_invalid",
            "The attachment token is not registered for this project request",
        ))
    }
}

#[async_trait]
impl AgentToolBridge for RendererAgentBridge {
    async fn get_project_summary(
        &self,
        session_id: &str,
        args: GetProjectSummaryArgs,
    ) -> Result<Value, CommandError> {
        let context = self.context(session_id, &args.disclosed_context_id)?;
        Ok(json!({
            "status": "ok",
            "projectId": context.receipt.project_id,
            "projectName": context.receipt.project_name,
            "documentRevision": context.receipt.document_revision,
            "documentHash": context.receipt.document_hash,
            "selectedBlockIds": context.receipt.selected_block_ids,
            "cursorBlockId": context.receipt.cursor_block_id,
            "selectedImage": context.receipt.selected_image.as_ref().map(|image| json!({
                "groupId": image.group_id,
                "imageId": image.image_id,
                "displayName": image.display_name,
            })),
            "capturedAt": context.receipt.captured_at,
        }))
    }

    async fn read_text_blocks(
        &self,
        session_id: &str,
        args: ReadTextBlocksArgs,
    ) -> Result<Value, CommandError> {
        let context = self.context(session_id, &args.disclosed_context_id)?;
        let mut blocks = Vec::with_capacity(args.block_ids.len());
        for block_id in args.block_ids {
            let block = context.text_blocks.get(&block_id).ok_or_else(|| {
                CommandError::new(
                    "tool_denied",
                    "The requested block was not included in disclosed context",
                )
            })?;
            blocks.push(json!({
                "blockId": block.block_id,
                "blockHash": block.block_hash,
                "type": block.block_type,
                "text": block.text,
            }));
        }
        Ok(json!({ "status": "ok", "blocks": blocks }))
    }

    async fn list_reference_images(
        &self,
        session_id: &str,
        args: ListReferenceImagesArgs,
    ) -> Result<Value, CommandError> {
        let context = self.context(session_id, &args.disclosed_context_id)?;
        let images = context
            .receipt
            .reference_images
            .iter()
            .map(|image| {
                json!({
                    "groupId": image.group_id,
                    "imageId": image.image_id,
                    "displayName": image.display_name,
                    "groupLabel": image.group_label,
                    "width": image.width,
                    "height": image.height,
                    "selected": context.receipt.selected_image.as_ref().is_some_and(|selected|
                        selected.group_id == image.group_id && selected.image_id == image.image_id
                    ),
                })
            })
            .collect::<Vec<_>>();
        Ok(json!({ "status": "ok", "images": images }))
    }

    async fn propose_text_block_edits(
        &self,
        session_id: &str,
        args: ProposeTextBlockEditsArgs,
    ) -> Result<Value, CommandError> {
        let context = self.context(session_id, &args.disclosed_context_id)?;
        if args.base_revision != context.receipt.document_revision
            || args.base_document_hash != context.receipt.document_hash
        {
            return Err(CommandError::new(
                "proposal_stale",
                "The proposal base does not match the immutable request snapshot",
            ));
        }
        for operation in &args.operations {
            validate_operation_snapshot(operation, &context.text_blocks)?;
        }
        let store = match self.store.lock() {
            Ok(guard) => guard.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
        .ok_or_else(|| {
            CommandError::new(
                "proposal_engine_unavailable",
                "The proposal metadata store is unavailable",
            )
        })?;
        let proposal = store.stage_tool_proposal(
            session_id,
            &context.receipt.project_id,
            args.summary,
            i64::try_from(args.base_revision).map_err(|_| {
                CommandError::new("proposal_invalid", "Proposal revision is too large")
            })?,
            args.base_document_hash,
            args.operations,
        )?;
        let mut receipt = serde_json::to_value(proposal).map_err(|error| {
            CommandError::new(
                "proposal_store_failed",
                format!("Unable to encode proposal receipt: {error}"),
            )
        })?;
        if let Some(object) = receipt.as_object_mut() {
            object.remove("operations");
        }
        Ok(json!({
            "status": "staged",
            "proposal": receipt,
        }))
    }
}

fn validate_identifier(value: &str, field: &str) -> Result<(), CommandError> {
    if value.is_empty()
        || value.len() > 256
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':'))
    {
        return Err(CommandError::new(
            "context_invalid",
            format!("{field} is invalid"),
        ));
    }
    Ok(())
}

fn validate_display_text(value: &str, field: &str) -> Result<(), CommandError> {
    if value.is_empty()
        || value.trim() != value
        || value.chars().count() > 200
        || value.contains('\\')
        || value.contains('/')
    {
        return Err(CommandError::new(
            "context_invalid",
            format!("{field} is invalid"),
        ));
    }
    Ok(())
}

fn validate_hash(value: &str, field: &str) -> Result<(), CommandError> {
    if value.len() != 71
        || !value.starts_with("sha256:")
        || !value[7..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(CommandError::new(
            "context_invalid",
            format!("{field} is not a canonical hash"),
        ));
    }
    Ok(())
}

fn validate_operation_snapshot(
    operation: &Value,
    blocks: &HashMap<String, AgentContextTextBlock>,
) -> Result<(), CommandError> {
    let object = operation.as_object().ok_or_else(|| {
        CommandError::new("proposal_invalid", "Proposal operation must be an object")
    })?;
    let op = object.get("op").and_then(Value::as_str).ok_or_else(|| {
        CommandError::new("proposal_invalid", "Proposal operation type is missing")
    })?;
    let (id_key, hash_key) = match op {
        "update" | "delete" => ("blockId", "expectedBlockHash"),
        "insertBefore" | "insertAfter" => ("referenceBlockId", "expectedReferenceHash"),
        _ => {
            return Err(CommandError::new(
                "proposal_invalid",
                "Proposal operation type is not allowed",
            ))
        }
    };
    let block_id = object.get(id_key).and_then(Value::as_str).ok_or_else(|| {
        CommandError::new("proposal_invalid", "Proposal target block ID is missing")
    })?;
    let expected_hash = object
        .get(hash_key)
        .and_then(Value::as_str)
        .ok_or_else(|| CommandError::new("proposal_invalid", "Proposal target hash is missing"))?;
    let block = blocks.get(block_id).ok_or_else(|| {
        CommandError::new(
            "tool_denied",
            "Proposal target was not disclosed in the immutable request",
        )
    })?;
    if block.block_hash != expected_hash
        || ![
            "paragraph",
            "heading",
            "bulletListItem",
            "numberedListItem",
            "checkListItem",
            "toggleListItem",
            "quote",
            "codeBlock",
        ]
        .contains(&block.block_type.as_str())
    {
        return Err(CommandError::new(
            "proposal_stale",
            "Proposal target does not match the disclosed text block",
        ));
    }
    if op == "update" {
        let patch = object
            .get("patch")
            .and_then(Value::as_object)
            .ok_or_else(|| {
                CommandError::new("proposal_invalid", "Proposal update patch is missing")
            })?;
        let effective_type = patch
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or(&block.block_type);
        if let Some(props) = patch.get("props").and_then(Value::as_object) {
            if props.keys().any(|key| {
                ![
                    "textAlignment",
                    "textColor",
                    "backgroundColor",
                    "level",
                    "checked",
                    "language",
                ]
                .contains(&key.as_str())
            }) {
                return Err(CommandError::new(
                    "proposal_invalid",
                    "Proposal contains an unsupported text property",
                ));
            }
            if (props.contains_key("level") && effective_type != "heading")
                || (props.contains_key("checked") && effective_type != "checkListItem")
                || (props.contains_key("language") && effective_type != "codeBlock")
            {
                return Err(CommandError::new(
                    "proposal_invalid",
                    "Proposal properties do not apply to the target text block type",
                ));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registration(path: PathBuf) -> RegisterAgentRequestContext {
        RegisterAgentRequestContext {
            session_id: "session-1".to_string(),
            request_id: "request-1".to_string(),
            context_id: "request-1".to_string(),
            receipt: AgentContextReceipt {
                project_id: "project-1".to_string(),
                project_name: "Project".to_string(),
                document_revision: 3,
                document_hash: format!("sha256:{}", "a".repeat(64)),
                selected_block_ids: vec!["block-1".to_string()],
                reference_images: vec![AgentReferenceImageMetadata {
                    group_id: "group-1".to_string(),
                    image_id: "image-1".to_string(),
                    display_name: "reference.png".to_string(),
                    group_label: "References".to_string(),
                    width: Some(100.0),
                    height: Some(80.0),
                }],
                cursor_block_id: None,
                selected_image: Some(AgentSelectedImageReceipt {
                    group_id: "group-1".to_string(),
                    image_id: "image-1".to_string(),
                    display_name: "reference.png".to_string(),
                }),
                captured_at: "2026-08-22T00:00:00Z".to_string(),
            },
            text_blocks: vec![AgentContextTextBlock {
                block_id: "block-1".to_string(),
                block_hash: format!("sha256:{}", "b".repeat(64)),
                block_type: "paragraph".to_string(),
                text: "Read-only text".to_string(),
            }],
            attachment: Some(AgentContextAttachment {
                token: "attachment-1".to_string(),
                group_id: "group-1".to_string(),
                image_id: "image-1".to_string(),
                absolute_path: path,
            }),
        }
    }

    #[tokio::test]
    async fn serves_only_registered_context_and_keeps_paths_out_of_tool_results() {
        let bridge = RendererAgentBridge::default();
        let path = PathBuf::from(r"C:\Project\references\0001.png");
        bridge.register(registration(path.clone())).unwrap();

        let blocks = bridge
            .read_text_blocks(
                "session-1",
                ReadTextBlocksArgs {
                    disclosed_context_id: "request-1".to_string(),
                    block_ids: vec!["block-1".to_string()],
                },
            )
            .await
            .unwrap();
        assert_eq!(blocks["blocks"][0]["text"], "Read-only text");
        assert!(!blocks.to_string().contains(r"C:\Project"));
        assert_eq!(bridge.resolve("project-1", "attachment-1").unwrap(), path);
        assert!(bridge.resolve("project-1", "attachment-1").is_err());
        assert!(bridge
            .read_text_blocks(
                "session-1",
                ReadTextBlocksArgs {
                    disclosed_context_id: "wrong-request".to_string(),
                    block_ids: vec!["block-1".to_string()],
                },
            )
            .await
            .is_err());
    }

    #[test]
    fn rejects_undisclosed_blocks_and_mismatched_attachment_tokens() {
        let bridge = RendererAgentBridge::default();
        let mut input = registration(PathBuf::from(r"C:\Project\references\0001.png"));
        input.text_blocks[0].block_id = "hidden-block".to_string();
        assert!(bridge.register(input).is_err());

        let mut input = registration(PathBuf::from(r"C:\Project\references\0001.png"));
        input.attachment.as_mut().unwrap().image_id = "wrong-image".to_string();
        assert!(bridge.register(input).is_err());
    }

    #[test]
    fn proposal_snapshot_rejects_model_ids_hashes_and_non_text_targets() {
        let blocks = HashMap::from([(
            "block-1".to_string(),
            AgentContextTextBlock {
                block_id: "block-1".to_string(),
                block_hash: format!("sha256:{}", "a".repeat(64)),
                block_type: "paragraph".to_string(),
                text: "Text".to_string(),
            },
        )]);
        let valid = json!({
            "op": "update",
            "blockId": "block-1",
            "expectedBlockHash": format!("sha256:{}", "a".repeat(64)),
            "patch": { "text": "Updated" }
        });
        assert!(validate_operation_snapshot(&valid, &blocks).is_ok());
        for invalid in [
            json!({
                "op": "update",
                "blockId": "model-invented",
                "expectedBlockHash": format!("sha256:{}", "a".repeat(64)),
                "patch": { "text": "Updated" }
            }),
            json!({
                "op": "delete",
                "blockId": "block-1",
                "expectedBlockHash": format!("sha256:{}", "b".repeat(64))
            }),
            json!({
                "op": "update",
                "blockId": "block-1",
                "expectedBlockHash": format!("sha256:{}", "a".repeat(64)),
                "patch": { "props": { "groupId": "group-1" } }
            }),
        ] {
            assert!(validate_operation_snapshot(&invalid, &blocks).is_err());
        }
        let media_blocks = HashMap::from([(
            "media".to_string(),
            AgentContextTextBlock {
                block_id: "media".to_string(),
                block_hash: format!("sha256:{}", "c".repeat(64)),
                block_type: "imageGroup".to_string(),
                text: String::new(),
            },
        )]);
        assert!(validate_operation_snapshot(
            &json!({
                "op": "delete",
                "blockId": "media",
                "expectedBlockHash": format!("sha256:{}", "c".repeat(64))
            }),
            &media_blocks,
        )
        .is_err());
    }
}
