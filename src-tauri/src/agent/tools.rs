use std::sync::Arc;

use async_trait::async_trait;
use github_copilot_sdk::tool::ToolHandler;
use github_copilot_sdk::{
    DeferMode, Error, Tool, ToolInvocation, ToolResult, ToolResultExpanded, ToolSet,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::error::CommandError;

pub const PRESHOT_TOOL_NAMES: [&str; 4] = [
    "get_project_summary",
    "read_text_blocks",
    "list_reference_images",
    "propose_text_block_edits",
];

const MAX_TOOL_ARGUMENT_BYTES: usize = 64 * 1024;
const MAX_TOOL_RESULT_BYTES: usize = 64 * 1024;
const MAX_BLOCK_IDS: usize = 64;
const MAX_OPERATIONS: usize = 50;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GetProjectSummaryArgs {
    pub disclosed_context_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadTextBlocksArgs {
    pub disclosed_context_id: String,
    pub block_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListReferenceImagesArgs {
    pub disclosed_context_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProposeTextBlockEditsArgs {
    pub disclosed_context_id: String,
    pub base_revision: u64,
    pub base_document_hash: String,
    pub summary: String,
    pub operations: Vec<Value>,
}

#[async_trait]
pub trait AgentToolBridge: Send + Sync + 'static {
    async fn get_project_summary(
        &self,
        session_id: &str,
        args: GetProjectSummaryArgs,
    ) -> Result<Value, CommandError>;

    async fn read_text_blocks(
        &self,
        session_id: &str,
        args: ReadTextBlocksArgs,
    ) -> Result<Value, CommandError>;

    async fn list_reference_images(
        &self,
        session_id: &str,
        args: ListReferenceImagesArgs,
    ) -> Result<Value, CommandError>;

    async fn propose_text_block_edits(
        &self,
        session_id: &str,
        args: ProposeTextBlockEditsArgs,
    ) -> Result<Value, CommandError>;
}

#[derive(Debug, Default)]
pub struct UnconfiguredAgentToolBridge;

fn unavailable(tool: &str) -> CommandError {
    CommandError::new(
        "workspace_bridge_unavailable",
        format!("The Preshot workspace bridge for {tool} is not available"),
    )
}

#[async_trait]
impl AgentToolBridge for UnconfiguredAgentToolBridge {
    async fn get_project_summary(
        &self,
        _session_id: &str,
        _args: GetProjectSummaryArgs,
    ) -> Result<Value, CommandError> {
        Err(unavailable("get_project_summary"))
    }

    async fn read_text_blocks(
        &self,
        _session_id: &str,
        _args: ReadTextBlocksArgs,
    ) -> Result<Value, CommandError> {
        Err(unavailable("read_text_blocks"))
    }

    async fn list_reference_images(
        &self,
        _session_id: &str,
        _args: ListReferenceImagesArgs,
    ) -> Result<Value, CommandError> {
        Err(unavailable("list_reference_images"))
    }

    async fn propose_text_block_edits(
        &self,
        _session_id: &str,
        _args: ProposeTextBlockEditsArgs,
    ) -> Result<Value, CommandError> {
        Err(unavailable("propose_text_block_edits"))
    }
}

#[derive(Clone)]
struct PreshotToolHandler {
    kind: ToolKind,
    bridge: Arc<dyn AgentToolBridge>,
}

#[derive(Clone, Copy)]
enum ToolKind {
    ProjectSummary,
    ReadTextBlocks,
    ListReferenceImages,
    ProposeTextBlockEdits,
}

#[async_trait]
impl ToolHandler for PreshotToolHandler {
    async fn call(&self, invocation: ToolInvocation) -> Result<ToolResult, Error> {
        let serialized_size = serde_json::to_vec(&invocation.arguments)
            .map(|value| value.len())
            .unwrap_or(usize::MAX);
        if serialized_size > MAX_TOOL_ARGUMENT_BYTES {
            return Ok(failed_result("Tool arguments exceeded the 64 KiB limit"));
        }

        let session_id = invocation.session_id.to_string();
        let result: Result<Value, CommandError> = match self.kind {
            ToolKind::ProjectSummary => match parse_args::<GetProjectSummaryArgs>(&invocation)
                .and_then(validate_owned_context_id)
            {
                Ok(args) => self.bridge.get_project_summary(&session_id, args).await,
                Err(error) => Err(error),
            },
            ToolKind::ReadTextBlocks => match parse_args::<ReadTextBlocksArgs>(&invocation)
                .and_then(|args| {
                    validate_context_id(&args)?;
                    if args.block_ids.len() > MAX_BLOCK_IDS {
                        return Err(CommandError::new(
                            "tool_invalid_arguments",
                            "read_text_blocks exceeded the 64 block limit",
                        ));
                    }
                    if args.block_ids.iter().any(|id| !is_safe_identifier(id)) {
                        return Err(CommandError::new(
                            "tool_invalid_arguments",
                            "read_text_blocks contains an invalid block ID",
                        ));
                    }
                    Ok(args)
                }) {
                Ok(args) => self.bridge.read_text_blocks(&session_id, args).await,
                Err(error) => Err(error),
            },
            ToolKind::ListReferenceImages => {
                match parse_args::<ListReferenceImagesArgs>(&invocation)
                    .and_then(validate_owned_context_id)
                {
                    Ok(args) => self.bridge.list_reference_images(&session_id, args).await,
                    Err(error) => Err(error),
                }
            }
            ToolKind::ProposeTextBlockEdits => {
                match parse_args::<ProposeTextBlockEditsArgs>(&invocation).and_then(|args| {
                    validate_context_id(&args)?;
                    if args.operations.len() > MAX_OPERATIONS
                        || args.summary.is_empty()
                        || args.summary.len() > 500
                        || args.base_document_hash.len() > 256
                    {
                        return Err(CommandError::new(
                            "tool_invalid_arguments",
                            "The text edit proposal exceeded its closed-schema limits",
                        ));
                    }
                    Ok(args)
                }) {
                    Ok(args) => {
                        self.bridge
                            .propose_text_block_edits(&session_id, args)
                            .await
                    }
                    Err(error) => Err(error),
                }
            }
        };

        let value = match result {
            Ok(value) => value,
            Err(error) => return Ok(failed_result(&error.to_string())),
        };
        let text = serde_json::to_string(&value)
            .unwrap_or_else(|_| r#"{"status":"serialization_failed"}"#.to_string());
        if text.len() > MAX_TOOL_RESULT_BYTES {
            return Ok(failed_result("Tool result exceeded the 64 KiB limit"));
        }
        Ok(ToolResult::Text(text))
    }
}

fn parse_args<T: for<'de> Deserialize<'de>>(
    invocation: &ToolInvocation,
) -> Result<T, CommandError> {
    serde_json::from_value(invocation.arguments.clone()).map_err(|error| {
        CommandError::new(
            "tool_invalid_arguments",
            format!("Invalid {} arguments: {error}", invocation.tool_name),
        )
    })
}

trait HasContextId {
    fn context_id(&self) -> &str;
}

impl HasContextId for GetProjectSummaryArgs {
    fn context_id(&self) -> &str {
        &self.disclosed_context_id
    }
}
impl HasContextId for ReadTextBlocksArgs {
    fn context_id(&self) -> &str {
        &self.disclosed_context_id
    }
}
impl HasContextId for ListReferenceImagesArgs {
    fn context_id(&self) -> &str {
        &self.disclosed_context_id
    }
}
impl HasContextId for ProposeTextBlockEditsArgs {
    fn context_id(&self) -> &str {
        &self.disclosed_context_id
    }
}

fn validate_context_id<T: HasContextId>(args: &T) -> Result<(), CommandError> {
    if !is_safe_identifier(args.context_id()) {
        return Err(CommandError::new(
            "tool_invalid_arguments",
            "The disclosed context receipt ID is invalid",
        ));
    }
    Ok(())
}

fn validate_owned_context_id<T: HasContextId>(args: T) -> Result<T, CommandError> {
    validate_context_id(&args)?;
    Ok(args)
}

fn is_safe_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':'))
}

fn failed_result(message: &str) -> ToolResult {
    ToolResult::Expanded(
        ToolResultExpanded::new(
            json!({
                "status": "failed",
                "error": truncate(message, 1_000),
            })
            .to_string(),
            "failure",
        )
        .with_error(truncate(message, 1_000)),
    )
}

fn truncate(value: &str, max: usize) -> String {
    value.chars().take(max).collect()
}

pub fn preshot_tools(bridge: Arc<dyn AgentToolBridge>) -> Vec<Tool> {
    vec![
        tool(
            ToolKind::ProjectSummary,
            PRESHOT_TOOL_NAMES[0],
            "Read the explicitly disclosed project summary without accessing files.",
            json!({
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "disclosedContextId": { "type": "string" }
                },
                "required": ["disclosedContextId"]
            }),
            bridge.clone(),
        ),
        tool(
            ToolKind::ReadTextBlocks,
            PRESHOT_TOOL_NAMES[1],
            "Read explicitly disclosed Preshot text blocks by stable block ID.",
            json!({
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "disclosedContextId": { "type": "string" },
                    "blockIds": {
                        "type": "array",
                        "maxItems": MAX_BLOCK_IDS,
                        "uniqueItems": true,
                        "items": {
                            "type": "string",
                            "minLength": 1,
                            "maxLength": 200,
                            "pattern": "^[A-Za-z0-9_:-]+$"
                        }
                    }
                },
                "required": ["disclosedContextId", "blockIds"]
            }),
            bridge.clone(),
        ),
        tool(
            ToolKind::ListReferenceImages,
            PRESHOT_TOOL_NAMES[2],
            "List metadata for explicitly disclosed project reference images; no bytes or paths.",
            json!({
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "disclosedContextId": { "type": "string" }
                },
                "required": ["disclosedContextId"]
            }),
            bridge.clone(),
        ),
        tool(
            ToolKind::ProposeTextBlockEdits,
            PRESHOT_TOOL_NAMES[3],
            "Stage a closed-schema text-block proposal for user review; never apply it.",
            json!({
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "disclosedContextId": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 200,
                        "pattern": "^[A-Za-z0-9_:-]+$"
                    },
                    "baseRevision": { "type": "integer", "minimum": 0 },
                    "baseDocumentHash": {
                        "type": "string",
                        "pattern": "^sha256:[0-9a-f]{64}$"
                    },
                    "summary": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 500
                    },
                    "operations": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": MAX_OPERATIONS,
                        "items": { "$ref": "#/$defs/operation" }
                    }
                },
                "$defs": {
                    "hash": {
                        "type": "string",
                        "pattern": "^sha256:[0-9a-f]{64}$"
                    },
                    "id": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 200,
                        "pattern": "^[A-Za-z0-9_:-]+$"
                    },
                    "textType": {
                        "type": "string",
                        "enum": [
                            "paragraph", "heading", "bulletListItem",
                            "numberedListItem", "checkListItem",
                            "toggleListItem", "quote", "codeBlock"
                        ]
                    },
                    "props": {
                        "type": "object",
                        "additionalProperties": false,
                        "properties": {
                            "textAlignment": {
                                "type": "string",
                                "enum": ["left", "center", "right", "justify"]
                            },
                            "textColor": { "type": "string", "maxLength": 64 },
                            "backgroundColor": { "type": "string", "maxLength": 64 },
                            "level": {
                                "type": "integer",
                                "minimum": 1,
                                "maximum": 6
                            },
                            "checked": { "type": "boolean" },
                            "language": { "type": "string", "maxLength": 64 }
                        }
                    },
                    "patch": {
                        "type": "object",
                        "additionalProperties": false,
                        "minProperties": 1,
                        "properties": {
                            "type": { "$ref": "#/$defs/textType" },
                            "text": { "type": "string", "maxLength": 20000 },
                            "props": { "$ref": "#/$defs/props" }
                        }
                    },
                    "block": {
                        "type": "object",
                        "additionalProperties": false,
                        "properties": {
                            "type": { "$ref": "#/$defs/textType" },
                            "text": { "type": "string", "maxLength": 20000 },
                            "props": { "$ref": "#/$defs/props" },
                            "children": {
                                "type": "array",
                                "maxItems": 100,
                                "items": { "$ref": "#/$defs/block" }
                            }
                        },
                        "required": ["type", "text"]
                    },
                    "operation": {
                        "oneOf": [
                            {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "op": { "const": "update" },
                                    "blockId": { "$ref": "#/$defs/id" },
                                    "expectedBlockHash": { "$ref": "#/$defs/hash" },
                                    "patch": { "$ref": "#/$defs/patch" }
                                },
                                "required": ["op", "blockId", "expectedBlockHash", "patch"]
                            },
                            {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "op": { "enum": ["insertBefore", "insertAfter"] },
                                    "referenceBlockId": { "$ref": "#/$defs/id" },
                                    "expectedReferenceHash": { "$ref": "#/$defs/hash" },
                                    "blocks": {
                                        "type": "array",
                                        "minItems": 1,
                                        "maxItems": 100,
                                        "items": { "$ref": "#/$defs/block" }
                                    }
                                },
                                "required": [
                                    "op", "referenceBlockId",
                                    "expectedReferenceHash", "blocks"
                                ]
                            },
                            {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "op": { "const": "delete" },
                                    "blockId": { "$ref": "#/$defs/id" },
                                    "expectedBlockHash": { "$ref": "#/$defs/hash" }
                                },
                                "required": ["op", "blockId", "expectedBlockHash"]
                            }
                        ]
                    }
                },
                "required": [
                    "disclosedContextId",
                    "baseRevision",
                    "baseDocumentHash",
                    "summary",
                    "operations"
                ]
            }),
            bridge,
        ),
    ]
}

fn tool(
    kind: ToolKind,
    name: &str,
    description: &str,
    parameters: Value,
    bridge: Arc<dyn AgentToolBridge>,
) -> Tool {
    Tool::new(name)
        .with_description(description)
        .with_parameters(parameters)
        .with_skip_permission(false)
        .with_defer(DeferMode::Never)
        .with_handler(Arc::new(PreshotToolHandler { kind, bridge }))
}

pub fn preshot_tool_allowlist() -> Vec<String> {
    PRESHOT_TOOL_NAMES
        .iter()
        .try_fold(ToolSet::new(), |tools, name| tools.add_custom(name))
        .expect("static Preshot tool names are valid")
        .into_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist_contains_only_source_qualified_preshot_tools() {
        assert_eq!(
            preshot_tool_allowlist(),
            PRESHOT_TOOL_NAMES
                .map(|name| format!("custom:{name}"))
                .to_vec()
        );
        assert!(preshot_tool_allowlist()
            .iter()
            .all(|name| !name.starts_with("builtin:") && !name.starts_with("mcp:")));
    }

    #[test]
    fn declarations_are_exact_non_deferred_and_permission_gated() {
        let tools = preshot_tools(Arc::new(UnconfiguredAgentToolBridge));
        assert_eq!(
            tools
                .iter()
                .map(|tool| tool.name.as_str())
                .collect::<Vec<_>>(),
            PRESHOT_TOOL_NAMES
        );
        assert!(tools.iter().all(|tool| !tool.skip_permission));
        assert!(tools
            .iter()
            .all(|tool| tool.defer == Some(DeferMode::Never)));
        let proposal = tools
            .iter()
            .find(|tool| tool.name == "propose_text_block_edits")
            .unwrap();
        let schema = &proposal.parameters;
        assert_eq!(schema.get("additionalProperties"), Some(&json!(false)));
        assert_eq!(
            schema["$defs"]["operation"]["oneOf"][0]["additionalProperties"],
            false
        );
        assert_eq!(schema["properties"]["operations"]["maxItems"], 50);
    }
}
