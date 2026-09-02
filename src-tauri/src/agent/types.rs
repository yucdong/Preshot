use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentModelSettings {
    pub enabled: bool,
    pub provider_type: String,
    pub display_url: String,
    pub api_base_url: String,
    pub model_id: Option<String>,
    pub wire_api: String,
    pub reasoning_effort: Option<String>,
    pub reasoning_summary: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentModelCapabilities {
    pub responses_api: CapabilityStatus,
    pub streaming: CapabilityStatus,
    pub custom_tools: CapabilityStatus,
    pub image_input: CapabilityStatus,
    pub reasoning_summary: bool,
    pub reasoning_effort: bool,
    pub context_window_tokens: Option<u64>,
}

impl Default for AgentModelCapabilities {
    fn default() -> Self {
        Self {
            responses_api: CapabilityStatus::Unknown,
            streaming: CapabilityStatus::Unknown,
            custom_tools: CapabilityStatus::Unknown,
            image_input: CapabilityStatus::Unknown,
            reasoning_summary: false,
            reasoning_effort: false,
            context_window_tokens: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CapabilityStatus {
    Verified,
    Unsupported,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredModel {
    pub id: String,
    pub display_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub reasoning_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub request_count: u64,
}

impl TokenUsage {
    pub fn add_assign(&mut self, other: &Self) {
        self.input_tokens = self.input_tokens.saturating_add(other.input_tokens);
        self.output_tokens = self.output_tokens.saturating_add(other.output_tokens);
        self.reasoning_tokens = self.reasoning_tokens.saturating_add(other.reasoning_tokens);
        self.cache_read_tokens = self
            .cache_read_tokens
            .saturating_add(other.cache_read_tokens);
        self.cache_write_tokens = self
            .cache_write_tokens
            .saturating_add(other.cache_write_tokens);
        self.request_count = self.request_count.saturating_add(other.request_count);
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProbeResult {
    pub model_id: String,
    pub capabilities: AgentModelCapabilities,
    pub usage: Option<TokenUsage>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionRequest {
    pub project_id: String,
    pub project_path: String,
    pub model_id: String,
    pub settings: AgentModelSettings,
    pub capabilities: AgentModelCapabilities,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResumeSessionRequest {
    pub session_id: String,
    #[serde(flatten)]
    pub config: SessionRequest,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCreated {
    pub session_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SendRequest {
    pub session_id: String,
    pub request_id: String,
    pub text: String,
    pub attachment_token: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendAccepted {
    pub request_id: String,
    pub message_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentErrorDetails {
    pub code: String,
    pub phase: String,
    pub message: String,
    pub retryable: bool,
    pub recovery: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentWireEvent {
    pub event_id: String,
    pub session_id: String,
    pub request_id: Option<String>,
    pub sequence: u64,
    pub occurred_at: String,
    pub replayed: bool,
    pub replay_index: Option<u64>,
    #[serde(flatten)]
    pub payload: AgentEventPayload,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum AgentEventPayload {
    MessageDelta {
        message_id: String,
        role: String,
        delta: String,
    },
    MessageCompleted {
        message_id: String,
        role: String,
        content: Option<String>,
    },
    ReasoningDelta {
        reasoning_id: String,
        delta: String,
    },
    ReasoningCompleted {
        reasoning_id: String,
        summary: Option<String>,
    },
    ToolStarted {
        tool_call_id: String,
        tool_name: String,
        summary: String,
    },
    ToolProgress {
        tool_call_id: String,
        progress: String,
    },
    ToolCompleted {
        tool_call_id: String,
        status: String,
        output: String,
    },
    PermissionRequested {
        request_id: String,
        tool_name: String,
        summary: String,
    },
    PermissionResolved {
        request_id: String,
        decision: String,
    },
    InputRequested {
        request_id: String,
        prompt: String,
        choices: Vec<String>,
    },
    InputResolved {
        request_id: String,
        status: String,
    },
    Usage {
        scope: String,
        usage: TokenUsage,
    },
    Context {
        used_tokens: u64,
        limit_tokens: Option<u64>,
    },
    CompactionStarted,
    CompactionCompleted {
        compacted_tokens: Option<u64>,
    },
    SessionIdle,
    SessionError {
        error: AgentErrorDetails,
    },
    TaskCompleted {
        finish_reason: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PermissionDecision {
    Allowed,
    Denied,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ElicitationResolution {
    pub action: String,
    pub content: Option<serde_json::Value>,
}
