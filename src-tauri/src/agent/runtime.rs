use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use async_trait::async_trait;
use chrono::{SecondsFormat, Utc};
use github_copilot_sdk::handler::{
    ElicitationHandler, PermissionHandler, PermissionResult, UserInputHandler, UserInputResponse,
};
use github_copilot_sdk::session::Session;
use github_copilot_sdk::session_events::ReasoningSummary;
use github_copilot_sdk::subscription::RecvErrorKind;
use github_copilot_sdk::tool::ToolHandler;
use github_copilot_sdk::{
    Attachment, Client, ElicitationRequest, ElicitationResult, IndexMap, InfiniteSessionConfig,
    MemoryConfiguration, MessageOptions, ResumeSessionConfig, SessionConfig, SessionEvent,
    SessionId, Tool, ToolInvocation, ToolResult, ToolSearchConfig,
};
use serde_json::json;
use tokio::sync::{broadcast, oneshot, Mutex, RwLock};
use tokio::task::JoinHandle;
use uuid::Uuid;

use crate::copilot::ManagedCopilotService;
use crate::error::CommandError;
use crate::workspace;

use super::attachments::{
    validate_attachment_token, validate_project_attachment, AttachmentTokenResolver,
    UnconfiguredAttachmentResolver,
};
use super::events::{normalize_event, usage_from_data};
use super::provider::{
    list_models, model_http_client, provider_config, validate_model_id, validate_settings,
};
use super::tools::{
    preshot_tool_allowlist, preshot_tools, AgentToolBridge, UnconfiguredAgentToolBridge,
};
use super::types::{
    AgentErrorDetails, AgentEventPayload, AgentModelCapabilities, AgentModelSettings,
    AgentWireEvent, CapabilityStatus, DiscoveredModel, ElicitationResolution, ModelProbeResult,
    PermissionDecision, ResumeSessionRequest, SendAccepted, SendRequest, SessionCreated,
    SessionRequest, TokenUsage,
};

const CLIENT_HEALTH_TIMEOUT: Duration = Duration::from_secs(3);
const CLIENT_STOP_TIMEOUT: Duration = Duration::from_secs(15);
const SESSION_STOP_TIMEOUT: Duration = Duration::from_secs(8);
const PENDING_INTERACTION_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const PROBE_TIMEOUT: Duration = Duration::from_secs(90);
const EVENT_CHANNEL_CAPACITY: usize = 512;
const MAX_REPLAY_EVENTS: usize = 2_000;
const MAX_SEND_CHARS: usize = 100_000;
const MAX_REQUEST_ID_BYTES: usize = 256;
const PROBE_TOOL_NAME: &str = "preshot_capability_probe";
const VISION_MARKER: &str = "PRESHOT_VISION_OK";
const TEST_PNG_BASE64: &str =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=";

struct SessionEventBus {
    session_id: String,
    sender: broadcast::Sender<AgentWireEvent>,
    sequence: AtomicU64,
    current_request: StdMutex<Option<String>>,
    usage: StdMutex<TokenUsage>,
}

impl SessionEventBus {
    fn new(session_id: String) -> Self {
        let (sender, _) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
        Self {
            session_id,
            sender,
            sequence: AtomicU64::new(0),
            current_request: StdMutex::new(None),
            usage: StdMutex::new(TokenUsage::default()),
        }
    }

    fn subscribe(&self) -> broadcast::Receiver<AgentWireEvent> {
        self.sender.subscribe()
    }

    fn request_id(&self) -> Option<String> {
        lock_unpoisoned(&self.current_request).clone()
    }

    fn set_request_id(&self, request_id: Option<String>) {
        *lock_unpoisoned(&self.current_request) = request_id;
    }

    fn emit(&self, payload: AgentEventPayload, request_id: Option<String>) {
        let sequence = self.sequence.fetch_add(1, Ordering::Relaxed) + 1;
        let _ = self.sender.send(AgentWireEvent {
            event_id: Uuid::new_v4().to_string(),
            session_id: self.session_id.clone(),
            request_id,
            sequence,
            occurred_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            replayed: false,
            replay_index: None,
            payload,
        });
    }

    fn emit_sdk(&self, event: &SessionEvent) {
        if event.event_type == "assistant.usage" {
            lock_unpoisoned(&self.usage).add_assign(&usage_from_data(&event.data));
        }
        let sequence = self.sequence.fetch_add(1, Ordering::Relaxed) + 1;
        if let Some(normalized) =
            normalize_event(&self.session_id, self.request_id(), sequence, event)
        {
            let _ = self.sender.send(normalized);
        }
        if event.event_type == "session.idle" || event.event_type == "session.error" {
            self.set_request_id(None);
        }
    }

    fn usage(&self) -> TokenUsage {
        lock_unpoisoned(&self.usage).clone()
    }
}

struct SessionEntry {
    sdk: Arc<Session>,
    project_id: String,
    project_root: PathBuf,
    client_epoch: u64,
    resume: SessionResumeSpec,
    connected: AtomicBool,
    cleanup_required: AtomicBool,
    bus: Arc<SessionEventBus>,
    listener: StdMutex<Option<JoinHandle<()>>>,
}

impl SessionEntry {
    fn stop_listener(&self) {
        if let Some(listener) = lock_unpoisoned(&self.listener).take() {
            listener.abort();
        }
    }

    fn start_listener(&self, active_generation: Arc<Mutex<Option<(String, String)>>>) {
        let mut listener = lock_unpoisoned(&self.listener);
        if listener.is_none() {
            *listener = Some(spawn_event_listener(
                self.sdk.clone(),
                self.bus.clone(),
                active_generation,
            ));
        }
    }

    fn is_connected(&self) -> bool {
        self.connected.load(Ordering::Acquire)
    }

    fn mark_disconnected(&self) {
        self.connected.store(false, Ordering::Release);
    }

    fn cleanup_required(&self) -> bool {
        self.cleanup_required.load(Ordering::Acquire)
    }

    fn mark_cleanup_required(&self) {
        self.cleanup_required.store(true, Ordering::Release);
    }

    fn clear_cleanup_required(&self) {
        self.cleanup_required.store(false, Ordering::Release);
    }
}

#[derive(Clone)]
struct SessionResumeSpec {
    project_id: String,
    project_root: PathBuf,
    settings: AgentModelSettings,
    model_id: String,
}

enum PendingInteraction {
    Permission {
        session_id: String,
        sender: oneshot::Sender<PermissionDecision>,
    },
    Input {
        session_id: String,
        sender: oneshot::Sender<Option<UserInputResponse>>,
    },
    Elicitation {
        session_id: String,
        sender: oneshot::Sender<ElicitationResolution>,
    },
}

impl PendingInteraction {
    fn session_id(&self) -> &str {
        match self {
            Self::Permission { session_id, .. }
            | Self::Input { session_id, .. }
            | Self::Elicitation { session_id, .. } => session_id,
        }
    }

    fn interrupt(self) {
        match self {
            Self::Permission { sender, .. } => {
                let _ = sender.send(PermissionDecision::Denied);
            }
            Self::Input { sender, .. } => {
                let _ = sender.send(None);
            }
            Self::Elicitation { sender, .. } => {
                let _ = sender.send(ElicitationResolution {
                    action: "cancel".to_string(),
                    content: None,
                });
            }
        }
    }
}

#[derive(Clone)]
struct PendingBridge {
    interactions: Arc<StdMutex<HashMap<String, PendingInteraction>>>,
    bus: Arc<SessionEventBus>,
}

#[async_trait]
impl PermissionHandler for PendingBridge {
    async fn handle(
        &self,
        session_id: SessionId,
        request_id: github_copilot_sdk::RequestId,
        _data: github_copilot_sdk::PermissionRequestData,
    ) -> PermissionResult {
        let request_id = request_id.to_string();
        let (sender, receiver) = oneshot::channel();
        lock_unpoisoned(&self.interactions).insert(
            request_id.clone(),
            PendingInteraction::Permission {
                session_id: session_id.to_string(),
                sender,
            },
        );
        let decision = tokio::time::timeout(PENDING_INTERACTION_TIMEOUT, receiver)
            .await
            .ok()
            .and_then(Result::ok)
            .unwrap_or(PermissionDecision::Denied);
        lock_unpoisoned(&self.interactions).remove(&request_id);
        match decision {
            PermissionDecision::Allowed => PermissionResult::approve_once(),
            PermissionDecision::Denied => PermissionResult::reject(Some(
                "The user denied this Preshot tool request.".to_string(),
            )),
        }
    }
}

#[async_trait]
impl UserInputHandler for PendingBridge {
    async fn handle(
        &self,
        session_id: SessionId,
        question: String,
        choices: Option<Vec<String>>,
        _allow_freeform: Option<bool>,
    ) -> Option<UserInputResponse> {
        let request_id = Uuid::new_v4().to_string();
        let (sender, receiver) = oneshot::channel();
        lock_unpoisoned(&self.interactions).insert(
            request_id.clone(),
            PendingInteraction::Input {
                session_id: session_id.to_string(),
                sender,
            },
        );
        self.bus.emit(
            AgentEventPayload::InputRequested {
                request_id: request_id.clone(),
                prompt: bounded(&question, 4_000),
                choices: choices.unwrap_or_default().into_iter().take(50).collect(),
            },
            self.bus.request_id(),
        );
        let response = tokio::time::timeout(PENDING_INTERACTION_TIMEOUT, receiver)
            .await
            .ok()
            .and_then(Result::ok)
            .flatten();
        lock_unpoisoned(&self.interactions).remove(&request_id);
        self.bus.emit(
            AgentEventPayload::InputResolved {
                request_id: request_id.clone(),
                status: if response.is_some() {
                    "submitted"
                } else {
                    "interrupted"
                }
                .to_string(),
            },
            self.bus.request_id(),
        );
        response
    }
}

#[async_trait]
impl ElicitationHandler for PendingBridge {
    async fn handle(
        &self,
        session_id: SessionId,
        request_id: github_copilot_sdk::RequestId,
        request: ElicitationRequest,
    ) -> ElicitationResult {
        let request_id = request_id.to_string();
        let (sender, receiver) = oneshot::channel();
        lock_unpoisoned(&self.interactions).insert(
            request_id.clone(),
            PendingInteraction::Elicitation {
                session_id: session_id.to_string(),
                sender,
            },
        );
        self.bus.emit(
            AgentEventPayload::InputRequested {
                request_id: request_id.clone(),
                prompt: bounded(&request.message, 4_000),
                choices: vec!["accept".to_string(), "decline".to_string()],
            },
            self.bus.request_id(),
        );
        let resolution = tokio::time::timeout(PENDING_INTERACTION_TIMEOUT, receiver)
            .await
            .ok()
            .and_then(Result::ok)
            .unwrap_or(ElicitationResolution {
                action: "cancel".to_string(),
                content: None,
            });
        lock_unpoisoned(&self.interactions).remove(&request_id);
        ElicitationResult {
            action: resolution.action,
            content: resolution.content,
        }
    }
}

pub struct AgentRuntimeService {
    preshot_root: Result<PathBuf, CommandError>,
    managed: ManagedCopilotService,
    client: Mutex<Option<Arc<Client>>>,
    client_epoch: AtomicU64,
    operations: Mutex<()>,
    sessions: RwLock<HashMap<String, Arc<SessionEntry>>>,
    active_generation: Arc<Mutex<Option<(String, String)>>>,
    pending: Arc<StdMutex<HashMap<String, PendingInteraction>>>,
    subscriptions: Arc<StdMutex<HashMap<String, oneshot::Sender<()>>>>,
    attachment_resolver: Arc<dyn AttachmentTokenResolver>,
    tool_bridge: Arc<dyn AgentToolBridge>,
    http: Result<reqwest::Client, CommandError>,
}

impl AgentRuntimeService {
    pub fn new() -> Self {
        Self::with_dependencies(
            workspace::preshot_home(),
            Arc::new(UnconfiguredAttachmentResolver),
            Arc::new(UnconfiguredAgentToolBridge),
        )
    }

    pub fn with_dependencies(
        preshot_root: Result<PathBuf, CommandError>,
        attachment_resolver: Arc<dyn AttachmentTokenResolver>,
        tool_bridge: Arc<dyn AgentToolBridge>,
    ) -> Self {
        Self {
            preshot_root,
            managed: ManagedCopilotService::new(),
            client: Mutex::new(None),
            client_epoch: AtomicU64::new(0),
            operations: Mutex::new(()),
            sessions: RwLock::new(HashMap::new()),
            active_generation: Arc::new(Mutex::new(None)),
            pending: Arc::new(StdMutex::new(HashMap::new())),
            subscriptions: Arc::new(StdMutex::new(HashMap::new())),
            attachment_resolver,
            tool_bridge,
            http: model_http_client(),
        }
    }

    pub async fn list_models(
        &self,
        settings: &AgentModelSettings,
    ) -> Result<Vec<DiscoveredModel>, CommandError> {
        list_models(self.http()?, settings).await
    }

    pub async fn probe_model(
        &self,
        settings: &AgentModelSettings,
        model_id: &str,
        verify_vision: bool,
    ) -> Result<ModelProbeResult, CommandError> {
        validate_settings(settings)?;
        validate_model_id(model_id)?;
        let models = self.list_models(settings).await?;
        if !models.iter().any(|model| model.id == model_id) {
            return Err(CommandError::new(
                "model_unavailable",
                "The selected model was not returned by the configured proxy",
            ));
        }

        let (client, _) = self.ensure_client().await?;
        let nonce = Uuid::new_v4().simple().to_string();
        let called = Arc::new(AtomicBool::new(false));
        let tool = probe_tool(nonce.clone(), called.clone());
        let session_id = format!("preshot-probe-{}", Uuid::new_v4());
        let bus = Arc::new(SessionEventBus::new(session_id.clone()));
        let config = self.secure_create_config(
            &session_id,
            self.preshot_root()?,
            settings,
            model_id,
            vec![tool],
            vec![format!("custom:{PROBE_TOOL_NAME}")],
            bus,
            false,
        )?;
        let session = Arc::new(client.create_session(config).await.map_err(|error| {
            CommandError::new(
                "session_create_failed",
                format!("Unable to create the compatibility probe session: {error}"),
            )
        })?);
        let probe_result = self
            .run_probe_roundtrip(&session, &nonce, called, verify_vision)
            .await;
        let cleanup = cleanup_temporary_session(&client, &session).await;
        if let Err(error) = cleanup {
            return Err(error);
        }
        let (streaming, usage, image_verified, context_limit) = probe_result?;

        Ok(ModelProbeResult {
            model_id: model_id.to_string(),
            capabilities: AgentModelCapabilities {
                responses_api: CapabilityStatus::Verified,
                streaming: if streaming {
                    CapabilityStatus::Verified
                } else {
                    CapabilityStatus::Unsupported
                },
                custom_tools: CapabilityStatus::Verified,
                image_input: if verify_vision {
                    if image_verified {
                        CapabilityStatus::Verified
                    } else {
                        CapabilityStatus::Unsupported
                    }
                } else {
                    CapabilityStatus::Unknown
                },
                reasoning_summary: settings.reasoning_summary != "none",
                reasoning_effort: settings.reasoning_effort.is_some(),
                context_window_tokens: context_limit,
            },
            usage,
        })
    }

    async fn run_probe_roundtrip(
        &self,
        session: &Arc<Session>,
        nonce: &str,
        called: Arc<AtomicBool>,
        verify_vision: bool,
    ) -> Result<(bool, Option<TokenUsage>, bool, Option<u64>), CommandError> {
        let mut events = session.subscribe();
        let collector = tokio::spawn(async move {
            let mut streaming = false;
            let mut usage = TokenUsage::default();
            let mut context_limit = None;
            loop {
                let event = events.recv().await.map_err(|error| error.to_string())?;
                match event.event_type.as_str() {
                    "assistant.message_delta" => streaming = true,
                    "assistant.usage" => usage.add_assign(&usage_from_data(&event.data)),
                    "session.usage_info" => {
                        context_limit = event
                            .data
                            .get("tokenLimit")
                            .and_then(serde_json::Value::as_u64)
                            .filter(|value| *value > 0);
                    }
                    "session.idle" => break,
                    "session.error" => {
                        return Err(event
                            .data
                            .get("message")
                            .and_then(serde_json::Value::as_str)
                            .unwrap_or("compatibility probe failed")
                            .to_string());
                    }
                    _ => {}
                }
            }
            Ok::<_, String>((streaming, usage, context_limit))
        });

        let prompt = format!(
            "Invoke {PROBE_TOOL_NAME} exactly once with nonce \"{nonce}\". After the tool result, reply with exactly the same nonce."
        );
        let final_message = tokio::time::timeout(
            PROBE_TIMEOUT,
            session.send_and_wait(MessageOptions::new(prompt).with_wait_timeout(PROBE_TIMEOUT)),
        )
        .await
        .map_err(|_| CommandError::new("timeout", "The model compatibility probe timed out"))?
        .map_err(|error| {
            CommandError::new(
                "model_unavailable",
                format!("The model compatibility probe failed: {error}"),
            )
        })?;
        let collected = collector.await.map_err(|error| {
            CommandError::new(
                "model_unavailable",
                format!("The model probe event collector failed: {error}"),
            )
        })?;
        let (streaming, usage, context_limit) = collected.map_err(|error| {
            CommandError::new(
                "model_unavailable",
                format!("The model compatibility probe failed: {error}"),
            )
        })?;
        let final_content = final_message
            .as_ref()
            .and_then(|event| event.data.get("content"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        if !called.load(Ordering::SeqCst) || !final_content.contains(nonce) {
            return Err(CommandError::new(
                "model_unavailable",
                "The model did not complete the required streaming custom-tool round trip",
            ));
        }

        let image_verified = if verify_vision {
            let attachment = Attachment::Blob {
                data: TEST_PNG_BASE64.to_string(),
                mime_type: "image/png".to_string(),
                display_name: Some("preshot-vision-probe.png".to_string()),
            };
            let result = tokio::time::timeout(
                PROBE_TIMEOUT,
                session.send_and_wait(
                    MessageOptions::new(format!(
                        "Inspect the bundled non-user test image. If it is readable, reply with exactly {VISION_MARKER}."
                    ))
                    .with_attachments(vec![attachment])
                    .with_wait_timeout(PROBE_TIMEOUT),
                ),
            )
            .await
            .ok()
            .and_then(Result::ok)
            .flatten();
            result
                .as_ref()
                .and_then(|event| event.data.get("content"))
                .and_then(serde_json::Value::as_str)
                .is_some_and(|content| content.contains(VISION_MARKER))
        } else {
            false
        };

        Ok((
            streaming,
            Some(usage).filter(|usage| usage.request_count > 0),
            image_verified,
            context_limit,
        ))
    }

    pub async fn create_session(
        &self,
        request: SessionRequest,
    ) -> Result<SessionCreated, CommandError> {
        self.validate_session_request(&request)?;
        let project_root = validate_project(&request.project_path, &request.project_id)?;
        let _operation = self.operations.lock().await;
        let (client, epoch) = self.ensure_client().await?;
        let session_id = Uuid::new_v4().to_string();
        let bus = Arc::new(SessionEventBus::new(session_id.clone()));
        let config = self.secure_create_config(
            &session_id,
            &project_root,
            &request.settings,
            &request.model_id,
            preshot_tools(self.tool_bridge.clone()),
            preshot_tool_allowlist(),
            bus.clone(),
            true,
        )?;
        let session = Arc::new(client.create_session(config).await.map_err(|error| {
            CommandError::new(
                "session_create_failed",
                format!("Unable to create the agent session: {error}"),
            )
        })?);
        let resume = SessionResumeSpec {
            project_id: request.project_id,
            project_root,
            settings: request.settings,
            model_id: request.model_id,
        };
        let entry = self.build_session_entry(session, epoch, bus, resume).await;
        self.sessions
            .write()
            .await
            .insert(session_id.clone(), entry);
        tracing::info!(
            session = %redacted_id(&session_id),
            event = "agent_session_created"
        );
        Ok(SessionCreated { session_id })
    }

    pub async fn resume_session(&self, request: ResumeSessionRequest) -> Result<(), CommandError> {
        validate_identifier(&request.session_id, "sessionId")?;
        self.validate_session_request(&request.config)?;
        let project_root =
            validate_project(&request.config.project_path, &request.config.project_id)?;
        let _operation = self.operations.lock().await;
        let (client, epoch) = self.ensure_client().await?;
        let existing = self.sessions.read().await.get(&request.session_id).cloned();
        let bus = existing
            .as_ref()
            .map(|entry| entry.bus.clone())
            .unwrap_or_else(|| Arc::new(SessionEventBus::new(request.session_id.clone())));
        let config = self.secure_resume_config(
            &request.session_id,
            &project_root,
            &request.config.settings,
            &request.config.model_id,
            bus.clone(),
        )?;
        let replacement_spec = SessionResumeSpec {
            project_id: request.config.project_id,
            project_root,
            settings: request.config.settings,
            model_id: request.config.model_id,
        };

        // SDK 1.0.11 routes one handle per session ID, so registering the
        // replacement first would orphan the old handle on a failed resume.
        if let Some(entry) = existing.as_ref() {
            self.quiesce_for_resume(&request.session_id, entry, epoch)
                .await?;
        }

        let session = match client.resume_session(config).await {
            Ok(session) => Arc::new(session),
            Err(error) => {
                let resume_error = CommandError::new(
                    "session_resume_failed",
                    format!("Unable to resume the agent session: {error}"),
                );
                if let Some(entry) = existing {
                    return Err(self
                        .restore_after_failed_resume(
                            &request.session_id,
                            &client,
                            epoch,
                            entry,
                            resume_error,
                        )
                        .await);
                }
                return Err(resume_error);
            }
        };
        let entry = self
            .build_session_entry(session, epoch, bus, replacement_spec)
            .await;
        self.sessions
            .write()
            .await
            .insert(request.session_id.clone(), entry);
        tracing::info!(
            session = %redacted_id(&request.session_id),
            event = "agent_session_resumed"
        );
        Ok(())
    }

    pub async fn send(&self, request: SendRequest) -> Result<SendAccepted, CommandError> {
        validate_identifier(&request.session_id, "sessionId")?;
        validate_identifier(&request.request_id, "requestId")?;
        if request.request_id.len() > MAX_REQUEST_ID_BYTES
            || request.text.trim().is_empty()
            || request.text.chars().count() > MAX_SEND_CHARS
        {
            return Err(CommandError::new(
                "send_invalid",
                "The request text or request ID is invalid",
            ));
        }
        let _operation = self.operations.lock().await;
        let entry = self.session(&request.session_id).await?;
        self.require_connected(&entry)?;
        let (_, epoch) = self.ensure_client().await?;
        if epoch != entry.client_epoch {
            return Err(CommandError::new(
                "cli_crashed",
                "The managed Copilot runtime restarted; resume this session before sending",
            ));
        }
        let mut message = MessageOptions::new(request.text);
        if let Some(token) = &request.attachment_token {
            validate_attachment_token(token)?;
            let resolved = self.attachment_resolver.resolve(&entry.project_id, token)?;
            let attachment = validate_project_attachment(&entry.project_root, &resolved)?;
            message = message.with_attachments(vec![Attachment::File {
                path: attachment.canonical_path,
                display_name: None,
                line_range: None,
            }]);
        }
        {
            let mut active = self.active_generation.lock().await;
            if let Some((session_id, _)) = active.as_ref() {
                return Err(CommandError::new(
                    "generation_busy",
                    format!(
                        "Another generation is active in session {}",
                        redacted_id(session_id)
                    ),
                ));
            }
            *active = Some((request.session_id.clone(), request.request_id.clone()));
        }
        entry.bus.set_request_id(Some(request.request_id.clone()));

        let message_id = match entry.sdk.send(message).await {
            Ok(message_id) => message_id,
            Err(error) => {
                self.clear_active(&request.session_id).await;
                entry.bus.set_request_id(None);
                return Err(CommandError::new(
                    "generation_failed",
                    format!("Unable to send the agent request: {error}"),
                ));
            }
        };
        tracing::info!(
            session = %redacted_id(&request.session_id),
            request = %redacted_id(&request.request_id),
            event = "agent_generation_started"
        );
        Ok(SendAccepted {
            request_id: request.request_id,
            message_id,
        })
    }

    pub async fn abort(&self, session_id: &str) -> Result<(), CommandError> {
        validate_identifier(session_id, "sessionId")?;
        let _operation = self.operations.lock().await;
        let entry = self.session(session_id).await?;
        let (_, epoch) = self.ensure_client().await?;
        if epoch != entry.client_epoch {
            self.interrupt_pending(session_id);
            self.clear_active(session_id).await;
            entry.stop_listener();
            entry.mark_disconnected();
            entry.clear_cleanup_required();
            return Ok(());
        }
        if !entry.is_connected() {
            self.interrupt_pending(session_id);
            self.clear_active(session_id).await;
            if entry.cleanup_required() {
                entry.sdk.abort().await.map_err(|error| {
                    CommandError::new(
                        "cancelled",
                        format!("Unable to abort the recoverable agent session: {error}"),
                    )
                })?;
            }
            return Ok(());
        }
        self.interrupt_pending(session_id);
        entry.sdk.abort().await.map_err(|error| {
            CommandError::new(
                "cancelled",
                format!("Unable to abort the agent generation: {error}"),
            )
        })?;
        self.clear_active(session_id).await;
        Ok(())
    }

    pub async fn disconnect(&self, session_id: &str) -> Result<(), CommandError> {
        validate_identifier(session_id, "sessionId")?;
        let _operation = self.operations.lock().await;
        self.disconnect_locked(session_id).await
    }

    pub async fn delete_session(&self, session_id: &str) -> Result<(), CommandError> {
        validate_identifier(session_id, "sessionId")?;
        let _operation = self.operations.lock().await;
        if self.sessions.read().await.contains_key(session_id) {
            self.disconnect_locked(session_id).await?;
        }
        let (client, _) = self.ensure_client().await?;
        client
            .delete_session(&SessionId::from(session_id))
            .await
            .map_err(|error| {
                CommandError::new(
                    "session_delete_failed",
                    format!("Unable to delete the agent session: {error}"),
                )
            })
    }

    pub async fn get_events(&self, session_id: &str) -> Result<Vec<AgentWireEvent>, CommandError> {
        let _operation = self.operations.lock().await;
        self.get_events_locked(session_id).await
    }

    async fn get_events_locked(
        &self,
        session_id: &str,
    ) -> Result<Vec<AgentWireEvent>, CommandError> {
        let entry = self.session(session_id).await?;
        self.require_connected(&entry)?;
        let (_, epoch) = self.ensure_client().await?;
        if epoch != entry.client_epoch {
            return Err(CommandError::new(
                "cli_crashed",
                "The managed Copilot runtime restarted; resume this session to load its events",
            ));
        }
        let events = entry.sdk.get_events().await.map_err(|error| {
            CommandError::new(
                "session_corrupt",
                format!("Unable to load agent session events: {error}"),
            )
        })?;
        let start = events.len().saturating_sub(MAX_REPLAY_EVENTS);
        let replay = events
            .iter()
            .skip(start)
            .enumerate()
            .filter_map(|(index, event)| {
                normalize_event(session_id, None, (index + 1) as u64, event).map(|mut event| {
                    event.replayed = true;
                    event.replay_index = Some((start + index) as u64);
                    event
                })
            })
            .collect::<Vec<_>>();
        if let Some(last) = replay.last() {
            entry
                .bus
                .sequence
                .fetch_max(last.sequence, Ordering::AcqRel);
        }
        Ok(replay)
    }

    pub async fn usage(&self, session_id: &str) -> Result<TokenUsage, CommandError> {
        Ok(self.session(session_id).await?.bus.usage())
    }

    pub async fn subscribe(
        &self,
        session_id: &str,
    ) -> Result<
        (
            String,
            Vec<AgentWireEvent>,
            broadcast::Receiver<AgentWireEvent>,
            oneshot::Receiver<()>,
        ),
        CommandError,
    > {
        let _operation = self.operations.lock().await;
        let entry = self.session(session_id).await?;
        let receiver = entry.bus.subscribe();
        let replay = self.get_events_locked(session_id).await?;
        let subscription_id = Uuid::new_v4().to_string();
        let (cancel_sender, cancel_receiver) = oneshot::channel();
        lock_unpoisoned(&self.subscriptions).insert(subscription_id.clone(), cancel_sender);
        Ok((subscription_id, replay, receiver, cancel_receiver))
    }

    pub fn unsubscribe(&self, subscription_id: &str) -> Result<(), CommandError> {
        validate_identifier(subscription_id, "subscriptionId")?;
        let sender = lock_unpoisoned(&self.subscriptions)
            .remove(subscription_id)
            .ok_or_else(|| {
                CommandError::new(
                    "subscription_missing",
                    "The agent event subscription is no longer active",
                )
            })?;
        let _ = sender.send(());
        Ok(())
    }

    pub fn forget_subscription(&self, subscription_id: &str) {
        lock_unpoisoned(&self.subscriptions).remove(subscription_id);
    }

    pub(crate) fn subscription_registry(
        &self,
    ) -> Arc<StdMutex<HashMap<String, oneshot::Sender<()>>>> {
        self.subscriptions.clone()
    }

    pub fn resolve_permission(
        &self,
        session_id: &str,
        request_id: &str,
        decision: PermissionDecision,
    ) -> Result<(), CommandError> {
        validate_identifier(session_id, "sessionId")?;
        validate_identifier(request_id, "requestId")?;
        match lock_unpoisoned(&self.pending).remove(request_id) {
            Some(PendingInteraction::Permission {
                session_id: owner,
                sender,
            }) if owner == session_id => {
                sender.send(decision).map_err(|_| stale_interaction())?;
                Ok(())
            }
            Some(interaction) => {
                lock_unpoisoned(&self.pending).insert(request_id.to_string(), interaction);
                Err(stale_interaction())
            }
            None => Err(stale_interaction()),
        }
    }

    pub fn resolve_input(
        &self,
        session_id: &str,
        request_id: &str,
        value: Option<String>,
    ) -> Result<(), CommandError> {
        validate_identifier(session_id, "sessionId")?;
        validate_identifier(request_id, "requestId")?;
        if value
            .as_ref()
            .is_some_and(|value| value.chars().count() > 10_000)
        {
            return Err(CommandError::new(
                "input_too_large",
                "Agent input exceeded the 10,000 character limit",
            ));
        }
        match lock_unpoisoned(&self.pending).remove(request_id) {
            Some(PendingInteraction::Input {
                session_id: owner,
                sender,
            }) if owner == session_id => {
                let response = value.map(|answer| UserInputResponse {
                    answer,
                    was_freeform: true,
                });
                sender.send(response).map_err(|_| stale_interaction())?;
                Ok(())
            }
            Some(interaction) => {
                lock_unpoisoned(&self.pending).insert(request_id.to_string(), interaction);
                Err(stale_interaction())
            }
            None => Err(stale_interaction()),
        }
    }

    pub fn resolve_elicitation(
        &self,
        session_id: &str,
        request_id: &str,
        resolution: ElicitationResolution,
    ) -> Result<(), CommandError> {
        validate_identifier(session_id, "sessionId")?;
        validate_identifier(request_id, "requestId")?;
        if !matches!(resolution.action.as_str(), "accept" | "decline" | "cancel") {
            return Err(CommandError::new(
                "input_invalid",
                "The elicitation action is invalid",
            ));
        }
        if resolution
            .content
            .as_ref()
            .and_then(|value| serde_json::to_vec(value).ok())
            .is_some_and(|value| value.len() > 64 * 1024)
        {
            return Err(CommandError::new(
                "input_too_large",
                "The elicitation response exceeded the 64 KiB limit",
            ));
        }
        match lock_unpoisoned(&self.pending).remove(request_id) {
            Some(PendingInteraction::Elicitation {
                session_id: owner,
                sender,
            }) if owner == session_id => {
                sender.send(resolution).map_err(|_| stale_interaction())?;
                Ok(())
            }
            Some(interaction) => {
                lock_unpoisoned(&self.pending).insert(request_id.to_string(), interaction);
                Err(stale_interaction())
            }
            None => Err(stale_interaction()),
        }
    }

    pub async fn stop(&self) -> Result<(), CommandError> {
        let _operation = self.operations.lock().await;
        let session_ids = self
            .sessions
            .read()
            .await
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        for session_id in session_ids {
            self.disconnect_locked(&session_id).await?;
        }
        *self.active_generation.lock().await = None;

        let client = self.client.lock().await.take();
        if let Some(client) = client {
            match tokio::time::timeout(CLIENT_STOP_TIMEOUT, client.stop()).await {
                Ok(Ok(())) => {}
                Ok(Err(error)) => {
                    client.force_stop();
                    return Err(CommandError::new(
                        "cli_stop_failed",
                        format!("Managed Copilot shutdown failed: {error}"),
                    ));
                }
                Err(_) => {
                    client.force_stop();
                    return Err(CommandError::new(
                        "timeout",
                        "Managed Copilot shutdown exceeded 15 seconds and was force-stopped",
                    ));
                }
            }
        }
        Ok(())
    }

    async fn ensure_client(&self) -> Result<(Arc<Client>, u64), CommandError> {
        let mut guard = self.client.lock().await;
        if let Some(client) = guard.as_ref() {
            let healthy = client.pid().is_some()
                && tokio::time::timeout(CLIENT_HEALTH_TIMEOUT, client.ping(Some("preshot-agent")))
                    .await
                    .is_ok_and(|result| result.is_ok());
            if healthy {
                return Ok((client.clone(), self.client_epoch.load(Ordering::Acquire)));
            }
            client.force_stop();
            *guard = None;
            tracing::warn!(event = "agent_cli_restart", reason = "health_check_failed");
        }

        let root = self.preshot_root()?;
        let paths = crate::copilot::ManagedCliPaths::under(root);
        std::fs::create_dir_all(&paths.base_directory).map_err(|error| {
            CommandError::new(
                "cli_start_failed",
                format!("Unable to create the managed Copilot directory: {error}"),
            )
        })?;
        std::fs::create_dir_all(&paths.extract_directory).map_err(|error| {
            CommandError::new(
                "cli_start_failed",
                format!("Unable to create the versioned Copilot CLI directory: {error}"),
            )
        })?;
        let options = self
            .managed
            .client_options(root, None)
            .map_err(|error| CommandError::new("cli_start_failed", error))?;
        let client = Arc::new(Client::start(options).await.map_err(|error| {
            CommandError::new(
                "cli_start_failed",
                format!("Unable to start the managed Copilot CLI: {error}"),
            )
        })?);
        let epoch = self.client_epoch.fetch_add(1, Ordering::AcqRel) + 1;
        *guard = Some(client.clone());
        Ok((client, epoch))
    }

    fn secure_create_config(
        &self,
        session_id: &str,
        project_root: &Path,
        settings: &AgentModelSettings,
        model_id: &str,
        tools: Vec<Tool>,
        allowlist: Vec<String>,
        bus: Arc<SessionEventBus>,
        interactive: bool,
    ) -> Result<SessionConfig, CommandError> {
        let provider = provider_config(settings, model_id)?;
        let mut config = self
            .managed
            .empty_session_config()
            .with_session_id(session_id)
            .with_model(model_id)
            .with_client_name("Preshot")
            .with_streaming(true)
            .with_tools(tools)
            .with_available_tools(allowlist)
            .with_excluded_tools(["builtin:*", "mcp:*"])
            .with_request_extensions(false)
            .with_enable_mcp_apps(false)
            .with_disabled_skills(["*"])
            .with_infinite_sessions(InfiniteSessionConfig::new().with_enabled(true))
            .with_provider(provider)
            .with_memory(MemoryConfiguration::disabled())
            .with_working_directory(project_root)
            .with_additional_directories(Vec::<PathBuf>::new())
            .with_enable_experimental_mode(false);
        apply_closed_config(&mut config);
        apply_reasoning_create(&mut config, settings);
        if interactive {
            let bridge = Arc::new(PendingBridge {
                interactions: self.pending.clone(),
                bus,
            });
            config = config
                .with_permission_handler(bridge.clone())
                .with_user_input_handler(bridge.clone())
                .with_elicitation_handler(bridge);
        }
        Ok(config)
    }

    fn secure_resume_config(
        &self,
        session_id: &str,
        project_root: &Path,
        settings: &AgentModelSettings,
        model_id: &str,
        bus: Arc<SessionEventBus>,
    ) -> Result<ResumeSessionConfig, CommandError> {
        let provider = provider_config(settings, model_id)?;
        let bridge = Arc::new(PendingBridge {
            interactions: self.pending.clone(),
            bus,
        });
        let mut config = ResumeSessionConfig::new(session_id.into())
            .with_model(model_id)
            .with_client_name("Preshot")
            .with_streaming(true)
            .with_tools(preshot_tools(self.tool_bridge.clone()))
            .with_available_tools(preshot_tool_allowlist())
            .with_excluded_tools(["builtin:*", "mcp:*"])
            .with_request_extensions(false)
            .with_enable_mcp_apps(false)
            .with_disabled_skills(["*"])
            .with_infinite_sessions(InfiniteSessionConfig::new().with_enabled(true))
            .with_provider(provider)
            .with_memory(MemoryConfiguration::disabled())
            .with_working_directory(project_root)
            .with_additional_directories(Vec::<PathBuf>::new())
            .with_continue_pending_work(false)
            .with_enable_experimental_mode(false)
            .with_permission_handler(bridge.clone())
            .with_user_input_handler(bridge.clone())
            .with_elicitation_handler(bridge);
        apply_closed_resume_config(&mut config);
        apply_reasoning_resume(&mut config, settings);
        Ok(config)
    }

    async fn build_session_entry(
        &self,
        sdk: Arc<Session>,
        client_epoch: u64,
        bus: Arc<SessionEventBus>,
        resume: SessionResumeSpec,
    ) -> Arc<SessionEntry> {
        let listener =
            spawn_event_listener(sdk.clone(), bus.clone(), self.active_generation.clone());
        Arc::new(SessionEntry {
            sdk,
            project_id: resume.project_id.clone(),
            project_root: resume.project_root.clone(),
            client_epoch,
            resume,
            connected: AtomicBool::new(true),
            cleanup_required: AtomicBool::new(false),
            bus,
            listener: StdMutex::new(Some(listener)),
        })
    }

    async fn quiesce_for_resume(
        &self,
        session_id: &str,
        entry: &Arc<SessionEntry>,
        current_epoch: u64,
    ) -> Result<(), CommandError> {
        if entry.client_epoch != current_epoch {
            self.interrupt_pending(session_id);
            self.clear_active(session_id).await;
            entry.stop_listener();
            entry.mark_disconnected();
            entry.clear_cleanup_required();
            return Ok(());
        }
        if !entry.is_connected() {
            if entry.cleanup_required() {
                disconnect_sdk(&entry.sdk).await?;
                entry.clear_cleanup_required();
            }
            return Ok(());
        }
        if self.is_active(session_id).await {
            entry.sdk.abort().await.map_err(|error| {
                CommandError::new(
                    "cancelled",
                    format!("Unable to abort the agent generation before resume: {error}"),
                )
            })?;
        }
        self.interrupt_pending(session_id);
        self.clear_active(session_id).await;
        entry.stop_listener();
        match disconnect_sdk(&entry.sdk).await {
            Ok(()) => {
                entry.mark_disconnected();
                Ok(())
            }
            Err(error) => {
                entry.start_listener(self.active_generation.clone());
                Err(error)
            }
        }
    }

    async fn restore_after_failed_resume(
        &self,
        session_id: &str,
        client: &Arc<Client>,
        epoch: u64,
        existing: Arc<SessionEntry>,
        resume_error: CommandError,
    ) -> CommandError {
        match self.resume_from_spec(session_id, client, &existing).await {
            Ok(session) => {
                self.install_restored_entry(session_id, epoch, &existing, session)
                    .await;
                resume_error
            }
            Err(first_restore_error) => {
                if let Err(cleanup_error) = disconnect_sdk(&existing.sdk).await {
                    existing.mark_cleanup_required();
                    return CommandError::new(
                        "session_resume_failed",
                        format!(
                            "{}; replacement cleanup failed ({}) and the prior session remains recoverable but disconnected ({})",
                            resume_error.message, cleanup_error.message, first_restore_error.message
                        ),
                    );
                }
                match self
                    .resume_from_spec(session_id, client, &existing)
                    .await
                {
                    Ok(session) => {
                        self.install_restored_entry(session_id, epoch, &existing, session)
                            .await;
                        resume_error
                    }
                    Err(error) => match disconnect_sdk(&existing.sdk).await {
                        Ok(()) => CommandError::new(
                            "session_resume_failed",
                            format!(
                                "{}; the prior session remains recoverable but could not be restored after replacement cleanup: {}",
                                resume_error.message, error.message
                            ),
                        ),
                        Err(cleanup_error) => {
                            existing.mark_cleanup_required();
                            CommandError::new(
                                "session_resume_failed",
                                format!(
                                    "{}; the prior session remains recoverable but disconnected after restoration and cleanup failed: {} ({})",
                                    resume_error.message, error.message, cleanup_error.message
                                ),
                            )
                        }
                    },
                }
            }
        }
    }

    async fn resume_from_spec(
        &self,
        session_id: &str,
        client: &Arc<Client>,
        existing: &SessionEntry,
    ) -> Result<Arc<Session>, CommandError> {
        let config = self.secure_resume_config(
            session_id,
            &existing.resume.project_root,
            &existing.resume.settings,
            &existing.resume.model_id,
            existing.bus.clone(),
        )?;
        client
            .resume_session(config)
            .await
            .map(Arc::new)
            .map_err(|error| {
                CommandError::new(
                    "session_resume_failed",
                    format!("Unable to restore the prior agent session: {error}"),
                )
            })
    }

    async fn install_restored_entry(
        &self,
        session_id: &str,
        epoch: u64,
        existing: &SessionEntry,
        session: Arc<Session>,
    ) {
        let restored = self
            .build_session_entry(
                session,
                epoch,
                existing.bus.clone(),
                existing.resume.clone(),
            )
            .await;
        self.sessions
            .write()
            .await
            .insert(session_id.to_string(), restored);
    }

    async fn disconnect_locked(&self, session_id: &str) -> Result<(), CommandError> {
        let entry = self.session(session_id).await?;
        let (_, epoch) = self.ensure_client().await?;
        if epoch != entry.client_epoch {
            self.interrupt_pending(session_id);
            self.clear_active(session_id).await;
            entry.stop_listener();
            entry.mark_disconnected();
            entry.clear_cleanup_required();
        }
        if entry.is_connected() {
            if self.is_active(session_id).await {
                entry.sdk.abort().await.map_err(|error| {
                    CommandError::new(
                        "cancelled",
                        format!("Unable to abort the agent generation before disconnect: {error}"),
                    )
                })?;
            }
            self.interrupt_pending(session_id);
            self.clear_active(session_id).await;
            entry.stop_listener();
            if let Err(error) = disconnect_sdk(&entry.sdk).await {
                entry.start_listener(self.active_generation.clone());
                return Err(error);
            }
            entry.mark_disconnected();
        } else {
            self.interrupt_pending(session_id);
            self.clear_active(session_id).await;
            entry.stop_listener();
            if entry.cleanup_required() {
                disconnect_sdk(&entry.sdk).await?;
                entry.clear_cleanup_required();
            }
        }

        let mut sessions = self.sessions.write().await;
        if sessions
            .get(session_id)
            .is_some_and(|current| Arc::ptr_eq(current, &entry))
        {
            sessions.remove(session_id);
        }
        Ok(())
    }

    async fn is_active(&self, session_id: &str) -> bool {
        self.active_generation
            .lock()
            .await
            .as_ref()
            .is_some_and(|(owner, _)| owner == session_id)
    }

    fn require_connected(&self, entry: &SessionEntry) -> Result<(), CommandError> {
        if entry.is_connected() {
            Ok(())
        } else {
            Err(CommandError::new(
                "session_resume_failed",
                "The agent session is disconnected but recoverable; retry resume or delete it",
            ))
        }
    }

    fn validate_session_request(&self, request: &SessionRequest) -> Result<(), CommandError> {
        validate_identifier(&request.project_id, "projectId")?;
        validate_model_id(&request.model_id)?;
        validate_settings(&request.settings)?;
        if request.settings.model_id.as_deref() != Some(request.model_id.as_str()) {
            return Err(CommandError::new(
                "model_not_configured",
                "The selected model does not match the validated model settings",
            ));
        }
        if !request.settings.enabled
            || request.capabilities.responses_api != CapabilityStatus::Verified
            || request.capabilities.streaming != CapabilityStatus::Verified
            || request.capabilities.custom_tools != CapabilityStatus::Verified
        {
            return Err(CommandError::new(
                "model_not_configured",
                "Responses, streaming, and custom tools must be verified before creating a session",
            ));
        }
        Ok(())
    }

    async fn session(&self, session_id: &str) -> Result<Arc<SessionEntry>, CommandError> {
        self.sessions
            .read()
            .await
            .get(session_id)
            .cloned()
            .ok_or_else(|| session_missing(session_id))
    }

    async fn clear_active(&self, session_id: &str) {
        let mut active = self.active_generation.lock().await;
        if active
            .as_ref()
            .is_some_and(|(owner, _)| owner == session_id)
        {
            *active = None;
        }
    }

    fn interrupt_pending(&self, session_id: &str) {
        let interrupted = {
            let mut pending = lock_unpoisoned(&self.pending);
            let ids = pending
                .iter()
                .filter(|(_, interaction)| interaction.session_id() == session_id)
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>();
            ids.into_iter()
                .filter_map(|id| pending.remove(&id).map(|interaction| (id, interaction)))
                .collect::<Vec<_>>()
        };
        for (_, interaction) in interrupted {
            interaction.interrupt();
        }
    }

    fn preshot_root(&self) -> Result<&Path, CommandError> {
        self.preshot_root.as_deref().map_err(|error| error.clone())
    }

    fn http(&self) -> Result<&reqwest::Client, CommandError> {
        self.http.as_ref().map_err(Clone::clone)
    }
}

impl Default for AgentRuntimeService {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for AgentRuntimeService {
    fn drop(&mut self) {
        if let Some(client) = self.client.get_mut().take() {
            client.force_stop();
        }
        let interactions = match self.pending.lock() {
            Ok(mut pending) => pending.drain().map(|(_, value)| value).collect::<Vec<_>>(),
            Err(poisoned) => poisoned
                .into_inner()
                .drain()
                .map(|(_, value)| value)
                .collect::<Vec<_>>(),
        };
        for interaction in interactions {
            interaction.interrupt();
        }
    }
}

fn apply_closed_config(config: &mut SessionConfig) {
    config.mcp_servers = Some(IndexMap::new());
    config.request_canvas_renderer = Some(false);
    config.canvases = Some(Vec::new());
    config.skill_directories = Some(Vec::new());
    config.instruction_directories = Some(Vec::new());
    config.plugin_directories = Some(Vec::new());
    config.disabled_mcp_servers = Some(vec!["*".to_string()]);
    config.tool_search = Some(ToolSearchConfig::new().with_enabled(false));
    config.hooks = Some(false);
    config.custom_agents = Some(Vec::new());
    config.enable_citations = Some(false);
    config.enable_file_change_tracking = Some(false);
    config.additional_directories = Some(Vec::new());
    config.github_token = None;
    config.remote_session = serde_json::from_value(json!("off")).ok();
    config.cloud = None;
    config.include_sub_agent_streaming_events = Some(false);
    config.commands = Some(Vec::new());
    config.enable_managed_settings = Some(false);
    config.enable_config_discovery = Some(false);
    config.skip_embedding_retrieval = Some(true);
    config.embedding_cache_storage = Some("in-memory".to_string());
    config.enable_on_demand_instruction_discovery = Some(false);
    config.enable_file_hooks = Some(false);
    config.enable_host_git_operations = Some(false);
    config.enable_session_store = Some(false);
    config.enable_skills = Some(false);
    config.enable_session_telemetry = Some(false);
    config.skip_custom_instructions = Some(true);
    config.custom_agents_local_only = Some(true);
    config.coauthor_enabled = Some(false);
    config.manage_schedule_enabled = Some(false);
    config.mcp_oauth_token_storage = Some("in-memory".to_string());
}

fn apply_closed_resume_config(config: &mut ResumeSessionConfig) {
    config.mcp_servers = Some(IndexMap::new());
    config.request_canvas_renderer = Some(false);
    config.canvases = Some(Vec::new());
    config.skill_directories = Some(Vec::new());
    config.instruction_directories = Some(Vec::new());
    config.plugin_directories = Some(Vec::new());
    config.disabled_mcp_servers = Some(vec!["*".to_string()]);
    config.tool_search = Some(ToolSearchConfig::new().with_enabled(false));
    config.hooks = Some(false);
    config.custom_agents = Some(Vec::new());
    config.enable_citations = Some(false);
    config.enable_file_change_tracking = Some(false);
    config.additional_directories = Some(Vec::new());
    config.github_token = None;
    config.remote_session = serde_json::from_value(json!("off")).ok();
    config.include_sub_agent_streaming_events = Some(false);
    config.commands = Some(Vec::new());
    config.enable_managed_settings = Some(false);
    config.continue_pending_work = Some(false);
    config.enable_config_discovery = Some(false);
    config.skip_embedding_retrieval = Some(true);
    config.embedding_cache_storage = Some("in-memory".to_string());
    config.enable_on_demand_instruction_discovery = Some(false);
    config.enable_file_hooks = Some(false);
    config.enable_host_git_operations = Some(false);
    config.enable_session_store = Some(false);
    config.enable_skills = Some(false);
    config.enable_session_telemetry = Some(false);
    config.skip_custom_instructions = Some(true);
    config.custom_agents_local_only = Some(true);
    config.coauthor_enabled = Some(false);
    config.manage_schedule_enabled = Some(false);
    config.mcp_oauth_token_storage = Some("in-memory".to_string());
}

fn apply_reasoning_create(config: &mut SessionConfig, settings: &AgentModelSettings) {
    if let Some(effort) = &settings.reasoning_effort {
        config.reasoning_effort = Some(effort.clone());
    }
    config.reasoning_summary = Some(reasoning_summary(&settings.reasoning_summary));
}

fn apply_reasoning_resume(config: &mut ResumeSessionConfig, settings: &AgentModelSettings) {
    if let Some(effort) = &settings.reasoning_effort {
        config.reasoning_effort = Some(effort.clone());
    }
    config.reasoning_summary = Some(reasoning_summary(&settings.reasoning_summary));
}

fn reasoning_summary(value: &str) -> ReasoningSummary {
    match value {
        "none" => ReasoningSummary::None,
        "detailed" => ReasoningSummary::Detailed,
        _ => ReasoningSummary::Concise,
    }
}

fn spawn_event_listener(
    session: Arc<Session>,
    bus: Arc<SessionEventBus>,
    active_generation: Arc<Mutex<Option<(String, String)>>>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut events = session.subscribe();
        loop {
            match events.recv().await {
                Ok(event) => {
                    let terminal =
                        event.event_type == "session.idle" || event.event_type == "session.error";
                    bus.emit_sdk(&event);
                    if terminal {
                        let mut active = active_generation.lock().await;
                        if active
                            .as_ref()
                            .is_some_and(|(session_id, _)| session_id == &bus.session_id)
                        {
                            *active = None;
                        }
                    }
                }
                Err(error) => match *error.kind() {
                    RecvErrorKind::Lagged(lagged) => {
                        bus.emit(
                            AgentEventPayload::SessionError {
                                error: AgentErrorDetails {
                                    code: "session_corrupt".to_string(),
                                    phase: "session".to_string(),
                                    message: format!(
                                        "The native event listener skipped {} bounded events",
                                        lagged.skipped()
                                    ),
                                    retryable: true,
                                    recovery: Some("Reload the durable event replay.".to_string()),
                                },
                            },
                            bus.request_id(),
                        );
                        continue;
                    }
                    RecvErrorKind::Closed => {
                        bus.emit(
                            AgentEventPayload::SessionError {
                                error: AgentErrorDetails {
                                    code: "cli_crashed".to_string(),
                                    phase: "runtime".to_string(),
                                    message: "The managed Copilot event stream closed unexpectedly"
                                        .to_string(),
                                    retryable: true,
                                    recovery: Some(
                                        "Resume the session after the runtime restarts."
                                            .to_string(),
                                    ),
                                },
                            },
                            bus.request_id(),
                        );
                        let mut active = active_generation.lock().await;
                        if active
                            .as_ref()
                            .is_some_and(|(session_id, _)| session_id == &bus.session_id)
                        {
                            *active = None;
                        }
                        break;
                    }
                    _ => continue,
                },
            }
        }
    })
}

#[derive(Clone)]
struct ProbeToolHandler {
    nonce: String,
    called: Arc<AtomicBool>,
}

#[async_trait]
impl ToolHandler for ProbeToolHandler {
    async fn call(
        &self,
        invocation: ToolInvocation,
    ) -> Result<ToolResult, github_copilot_sdk::Error> {
        let supplied = invocation
            .arguments
            .get("nonce")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        if supplied != self.nonce {
            return Ok(ToolResult::Text(
                json!({"status": "failed", "reason": "nonce_mismatch"}).to_string(),
            ));
        }
        self.called.store(true, Ordering::SeqCst);
        Ok(ToolResult::Text(
            json!({"status": "ok", "nonce": self.nonce}).to_string(),
        ))
    }
}

fn probe_tool(nonce: String, called: Arc<AtomicBool>) -> Tool {
    Tool::new(PROBE_TOOL_NAME)
        .with_description("Complete the Preshot model compatibility probe.")
        .with_parameters(json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "nonce": { "type": "string", "const": nonce }
            },
            "required": ["nonce"]
        }))
        .with_skip_permission(true)
        .with_handler(Arc::new(ProbeToolHandler { nonce, called }))
}

async fn cleanup_temporary_session(
    client: &Arc<Client>,
    session: &Arc<Session>,
) -> Result<(), CommandError> {
    let session_id = session.id().clone();
    tokio::time::timeout(SESSION_STOP_TIMEOUT, session.disconnect())
        .await
        .map_err(|_| CommandError::new("timeout", "Probe session cleanup timed out"))?
        .map_err(|error| {
            CommandError::new(
                "session_delete_failed",
                format!("Unable to disconnect the probe session: {error}"),
            )
        })?;
    client.delete_session(&session_id).await.map_err(|error| {
        CommandError::new(
            "session_delete_failed",
            format!("Unable to delete the probe session: {error}"),
        )
    })
}

async fn disconnect_sdk(session: &Arc<Session>) -> Result<(), CommandError> {
    tokio::time::timeout(SESSION_STOP_TIMEOUT, session.disconnect())
        .await
        .map_err(|_| {
            CommandError::new(
                "timeout",
                "Disconnecting the agent session exceeded 8 seconds",
            )
        })?
        .map_err(|error| {
            CommandError::new(
                "session_disconnect_failed",
                format!("Unable to disconnect the agent session: {error}"),
            )
        })
}

fn validate_project(path: &str, project_id: &str) -> Result<PathBuf, CommandError> {
    if path.is_empty() || path.len() > 32_768 {
        return Err(CommandError::new(
            "project_unavailable",
            "The project path is invalid",
        ));
    }
    let canonical = PathBuf::from(path).canonicalize().map_err(|error| {
        CommandError::new(
            "project_unavailable",
            format!("Unable to access the current project: {error}"),
        )
    })?;
    if !canonical.is_dir() {
        return Err(CommandError::new(
            "project_unavailable",
            "The current project path is not a directory",
        ));
    }
    let manifest_path = canonical.join(".preshotproj");
    let bytes = std::fs::read(&manifest_path).map_err(|error| {
        CommandError::new(
            "project_unavailable",
            format!("Unable to read the current project manifest: {error}"),
        )
    })?;
    if bytes.len() > 16 * 1024 * 1024 {
        return Err(CommandError::new(
            "project_unavailable",
            "The current project manifest exceeded 16 MiB",
        ));
    }
    let manifest: serde_json::Value = serde_json::from_slice(&bytes).map_err(|error| {
        CommandError::new(
            "project_unavailable",
            format!("The current project manifest is invalid: {error}"),
        )
    })?;
    if manifest.get("id").and_then(serde_json::Value::as_str) != Some(project_id) {
        return Err(CommandError::new(
            "project_unavailable",
            "The project identity does not match its manifest",
        ));
    }
    Ok(canonical)
}

fn validate_identifier(value: &str, field: &str) -> Result<(), CommandError> {
    if value.is_empty()
        || value.len() > 256
        || value
            .bytes()
            .any(|byte| !(byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':')))
    {
        return Err(CommandError::new(
            "identifier_invalid",
            format!("{field} is invalid"),
        ));
    }
    Ok(())
}

fn redacted_id(value: &str) -> String {
    let prefix: String = value.chars().take(8).collect();
    format!("{prefix}…")
}

fn bounded(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

fn lock_unpoisoned<T>(mutex: &StdMutex<T>) -> std::sync::MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

fn session_missing(session_id: &str) -> CommandError {
    CommandError::new(
        "session_resume_failed",
        format!("Agent session {} is not connected", redacted_id(session_id)),
    )
}

fn stale_interaction() -> CommandError {
    CommandError::new(
        "interaction_interrupted",
        "This pending interaction is no longer active; send a new message instead",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings() -> AgentModelSettings {
        AgentModelSettings {
            enabled: true,
            provider_type: "openai".to_string(),
            display_url: "http://localhost:4141".to_string(),
            api_base_url: "http://localhost:4141/v1".to_string(),
            model_id: Some("test-model".to_string()),
            wire_api: "responses".to_string(),
            reasoning_effort: Some("high".to_string()),
            reasoning_summary: "concise".to_string(),
        }
    }

    #[tokio::test(flavor = "current_thread")]
    #[ignore = "requires an OpenAI Responses-compatible proxy on http://localhost:4141"]
    async fn real_localhost_proxy_model_smoke() {
        let temp = tempfile::tempdir().unwrap();
        let service = AgentRuntimeService::with_dependencies(
            Ok(temp.path().to_path_buf()),
            Arc::new(UnconfiguredAttachmentResolver),
            Arc::new(UnconfiguredAgentToolBridge),
        );
        let mut settings = settings();
        settings.model_id = None;
        let models = service
            .list_models(&settings)
            .await
            .expect("list localhost proxy models");
        let selected = std::env::var("PRESHOT_AGENT_SMOKE_MODEL")
            .ok()
            .or_else(|| models.first().map(|model| model.id.clone()))
            .expect("localhost proxy returned at least one model");
        settings.model_id = Some(selected.clone());
        let result = service
            .probe_model(&settings, &selected, false)
            .await
            .expect("complete Responses streaming tool round trip");
        assert_eq!(
            result.capabilities.responses_api,
            CapabilityStatus::Verified
        );
        assert_eq!(result.capabilities.streaming, CapabilityStatus::Verified);
        assert_eq!(result.capabilities.custom_tools, CapabilityStatus::Verified);
        service.stop().await.expect("stop smoke runtime");
    }

    #[test]
    fn create_and_resume_configs_are_closed_and_resupply_provider_handlers() {
        let temp = tempfile::tempdir().unwrap();
        let service = AgentRuntimeService::with_dependencies(
            Ok(temp.path().to_path_buf()),
            Arc::new(UnconfiguredAttachmentResolver),
            Arc::new(UnconfiguredAgentToolBridge),
        );
        let bus = Arc::new(SessionEventBus::new("session-1".to_string()));
        let create = service
            .secure_create_config(
                "session-1",
                temp.path(),
                &settings(),
                "test-model",
                preshot_tools(Arc::new(UnconfiguredAgentToolBridge)),
                preshot_tool_allowlist(),
                bus.clone(),
                true,
            )
            .unwrap();
        let resume = service
            .secure_resume_config("session-1", temp.path(), &settings(), "test-model", bus)
            .unwrap();

        assert_eq!(create.available_tools, Some(preshot_tool_allowlist()));
        assert_eq!(resume.available_tools, Some(preshot_tool_allowlist()));
        assert!(create.provider.is_some());
        assert!(resume.provider.is_some());
        assert!(create.permission_handler.is_some());
        assert!(resume.permission_handler.is_some());
        assert_eq!(resume.continue_pending_work, Some(false));
        assert_eq!(create.enable_config_discovery, Some(false));
        assert_eq!(resume.enable_config_discovery, Some(false));
        assert_eq!(create.enable_session_store, Some(false));
        assert_eq!(resume.enable_session_store, Some(false));
        assert!(create.mcp_servers.as_ref().is_some_and(IndexMap::is_empty));
        assert!(resume.mcp_servers.as_ref().is_some_and(IndexMap::is_empty));
        assert_eq!(create.memory, Some(MemoryConfiguration::disabled()));
        assert_eq!(resume.memory, Some(MemoryConfiguration::disabled()));
    }

    #[tokio::test]
    async fn one_generation_gate_is_global_and_released_on_abort_path() {
        let gate = Mutex::new(None::<(String, String)>);
        {
            let mut active = gate.lock().await;
            *active = Some(("session-1".to_string(), "request-1".to_string()));
        }
        assert!(gate.lock().await.is_some());
        *gate.lock().await = None;
        assert!(gate.lock().await.is_none());
    }

    #[test]
    fn pending_interactions_fail_closed_when_interrupted() {
        let (sender, receiver) = oneshot::channel();
        PendingInteraction::Permission {
            session_id: "session-1".to_string(),
            sender,
        }
        .interrupt();
        assert_eq!(
            receiver.blocking_recv().unwrap(),
            PermissionDecision::Denied
        );
    }
}
