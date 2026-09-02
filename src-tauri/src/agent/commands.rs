use chrono::{SecondsFormat, Utc};
use tauri::ipc::Channel;
use tauri::State;
use uuid::Uuid;

use crate::error::CommandError;

use super::types::{
    AgentErrorDetails, AgentEventPayload, AgentModelSettings, AgentWireEvent,
    ElicitationResolution, ModelProbeResult, PermissionDecision, ResumeSessionRequest,
    SendAccepted, SendRequest, SessionCreated, SessionRequest, TokenUsage,
};
use super::{
    AgentRuntimeService, DiscoveredModel, RegisterAgentRequestContext, RendererAgentBridge,
};

#[tauri::command]
pub fn agent_register_request_context(
    bridge: State<'_, std::sync::Arc<RendererAgentBridge>>,
    input: RegisterAgentRequestContext,
) -> Result<(), CommandError> {
    bridge.register(input)
}

#[tauri::command]
pub async fn agent_list_models(
    service: State<'_, AgentRuntimeService>,
    settings: AgentModelSettings,
) -> Result<Vec<DiscoveredModel>, CommandError> {
    service.list_models(&settings).await
}

#[tauri::command]
pub async fn agent_probe_model(
    service: State<'_, AgentRuntimeService>,
    settings: AgentModelSettings,
    model_id: String,
    verify_vision: bool,
) -> Result<ModelProbeResult, CommandError> {
    service
        .probe_model(&settings, &model_id, verify_vision)
        .await
}

#[tauri::command]
pub async fn agent_create_session(
    service: State<'_, AgentRuntimeService>,
    request: SessionRequest,
) -> Result<SessionCreated, CommandError> {
    service.create_session(request).await
}

#[tauri::command]
pub async fn agent_resume_session(
    service: State<'_, AgentRuntimeService>,
    request: ResumeSessionRequest,
) -> Result<(), CommandError> {
    service.resume_session(request).await
}

#[tauri::command]
pub async fn agent_send(
    service: State<'_, AgentRuntimeService>,
    request: SendRequest,
) -> Result<SendAccepted, CommandError> {
    service.send(request).await
}

#[tauri::command]
pub async fn agent_abort(
    service: State<'_, AgentRuntimeService>,
    session_id: String,
) -> Result<(), CommandError> {
    service.abort(&session_id).await
}

#[tauri::command]
pub async fn agent_disconnect_session(
    service: State<'_, AgentRuntimeService>,
    session_id: String,
) -> Result<(), CommandError> {
    service.disconnect(&session_id).await
}

#[tauri::command]
pub async fn agent_delete_session(
    service: State<'_, AgentRuntimeService>,
    session_id: String,
) -> Result<(), CommandError> {
    service.delete_session(&session_id).await
}

#[tauri::command]
pub async fn agent_get_events(
    service: State<'_, AgentRuntimeService>,
    session_id: String,
) -> Result<Vec<AgentWireEvent>, CommandError> {
    service.get_events(&session_id).await
}

#[tauri::command]
pub async fn agent_get_usage(
    service: State<'_, AgentRuntimeService>,
    session_id: String,
) -> Result<TokenUsage, CommandError> {
    service.usage(&session_id).await
}

#[tauri::command]
pub async fn agent_subscribe_events(
    service: State<'_, AgentRuntimeService>,
    session_id: String,
    channel: Channel<AgentWireEvent>,
) -> Result<String, CommandError> {
    let (subscription_id, replay, mut receiver, mut cancel) =
        service.subscribe(&session_id).await?;
    let cleanup = service.subscription_registry();
    let subscription_for_task = subscription_id.clone();
    tauri::async_runtime::spawn(async move {
        let mut last_sequence = replay.last().map(|event| event.sequence).unwrap_or(0);
        for event in replay {
            last_sequence = last_sequence.max(event.sequence);
            if channel.send(event).is_err() {
                cleanup_subscription(&cleanup, &subscription_for_task);
                return;
            }
        }
        loop {
            tokio::select! {
                _ = &mut cancel => break,
                received = receiver.recv() => {
                    match received {
                        Ok(event) => {
                            last_sequence = last_sequence.max(event.sequence);
                            if channel.send(event).is_err() {
                                break;
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                            last_sequence = last_sequence.saturating_add(1);
                            if channel.send(lagged_event(&session_id, skipped, last_sequence)).is_err() {
                                break;
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    }
                }
            }
        }
        cleanup_subscription(&cleanup, &subscription_for_task);
    });
    Ok(subscription_id)
}

#[tauri::command]
pub fn agent_unsubscribe_events(
    service: State<'_, AgentRuntimeService>,
    subscription_id: String,
) -> Result<(), CommandError> {
    service.unsubscribe(&subscription_id)
}

#[tauri::command]
pub fn agent_resolve_permission(
    service: State<'_, AgentRuntimeService>,
    session_id: String,
    request_id: String,
    decision: PermissionDecision,
) -> Result<(), CommandError> {
    service.resolve_permission(&session_id, &request_id, decision)
}

#[tauri::command]
pub fn agent_resolve_input(
    service: State<'_, AgentRuntimeService>,
    session_id: String,
    request_id: String,
    value: Option<String>,
) -> Result<(), CommandError> {
    service.resolve_input(&session_id, &request_id, value)
}

#[tauri::command]
pub fn agent_resolve_elicitation(
    service: State<'_, AgentRuntimeService>,
    session_id: String,
    request_id: String,
    resolution: ElicitationResolution,
) -> Result<(), CommandError> {
    service.resolve_elicitation(&session_id, &request_id, resolution)
}

#[tauri::command]
pub async fn agent_stop_runtime(
    service: State<'_, AgentRuntimeService>,
) -> Result<(), CommandError> {
    service.stop().await
}

fn lagged_event(session_id: &str, skipped: u64, sequence: u64) -> AgentWireEvent {
    AgentWireEvent {
        event_id: Uuid::new_v4().to_string(),
        session_id: session_id.to_string(),
        request_id: None,
        sequence,
        occurred_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        replayed: false,
        replay_index: None,
        payload: AgentEventPayload::SessionError {
            error: AgentErrorDetails {
                code: "session_corrupt".to_string(),
                phase: "session".to_string(),
                message: format!(
                    "The renderer fell behind and skipped {skipped} bounded agent events"
                ),
                retryable: true,
                recovery: Some("Reload the session event replay.".to_string()),
            },
        },
    }
}

fn cleanup_subscription(
    registry: &std::sync::Arc<
        std::sync::Mutex<std::collections::HashMap<String, tokio::sync::oneshot::Sender<()>>>,
    >,
    subscription_id: &str,
) {
    match registry.lock() {
        Ok(mut subscriptions) => {
            subscriptions.remove(subscription_id);
        }
        Err(poisoned) => {
            poisoned.into_inner().remove(subscription_id);
        }
    }
}
