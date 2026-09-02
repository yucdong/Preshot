use github_copilot_sdk::SessionEvent;
use serde_json::Value;

use super::types::{AgentErrorDetails, AgentEventPayload, AgentWireEvent, TokenUsage};

const MAX_MESSAGE_CHUNK_CHARS: usize = 32_000;
const MAX_TOOL_OUTPUT_CHARS: usize = 16_000;
const MAX_SUMMARY_CHARS: usize = 4_000;

pub fn normalize_event(
    session_id: &str,
    request_id: Option<String>,
    sequence: u64,
    event: &SessionEvent,
) -> Option<AgentWireEvent> {
    let data = &event.data;
    let payload = match event.event_type.as_str() {
        "user.message" => AgentEventPayload::MessageCompleted {
            message_id: string(data, "messageId").unwrap_or_else(|| format!("user-{}", event.id)),
            role: "user".to_string(),
            content: string(data, "content").map(|value| bounded(&value, MAX_MESSAGE_CHUNK_CHARS)),
        },
        "assistant.message_delta" => AgentEventPayload::MessageDelta {
            message_id: string(data, "messageId")?,
            role: "assistant".to_string(),
            delta: bounded(&string(data, "deltaContent")?, MAX_MESSAGE_CHUNK_CHARS),
        },
        "assistant.message" => AgentEventPayload::MessageCompleted {
            message_id: string(data, "messageId")?,
            role: "assistant".to_string(),
            content: string(data, "content").map(|value| bounded(&value, MAX_MESSAGE_CHUNK_CHARS)),
        },
        // The runtime requests provider-generated reasoning summaries. Opaque and
        // encrypted reasoning fields on assistant.message are never forwarded.
        "assistant.reasoning_delta" => AgentEventPayload::ReasoningDelta {
            reasoning_id: string(data, "reasoningId")?,
            delta: bounded(&string(data, "deltaContent")?, MAX_SUMMARY_CHARS),
        },
        "assistant.reasoning" => AgentEventPayload::ReasoningCompleted {
            reasoning_id: string(data, "reasoningId")?,
            summary: string(data, "content").map(|value| bounded(&value, MAX_SUMMARY_CHARS)),
        },
        "tool.execution_start" => AgentEventPayload::ToolStarted {
            tool_call_id: string(data, "toolCallId")?,
            tool_name: string(data, "toolName")?,
            summary: data
                .pointer("/toolDescription/description")
                .and_then(Value::as_str)
                .map(|value| bounded(value, MAX_SUMMARY_CHARS))
                .unwrap_or_else(|| "Running an approved Preshot tool".to_string()),
        },
        "tool.execution_partial_result" => AgentEventPayload::ToolProgress {
            tool_call_id: string(data, "toolCallId")?,
            progress: bounded(
                &string(data, "partialOutput").unwrap_or_default(),
                MAX_TOOL_OUTPUT_CHARS,
            ),
        },
        "tool.execution_progress" => AgentEventPayload::ToolProgress {
            tool_call_id: string(data, "toolCallId")?,
            progress: bounded(
                &string(data, "progressMessage").unwrap_or_default(),
                MAX_TOOL_OUTPUT_CHARS,
            ),
        },
        "tool.execution_complete" => {
            let success = bool_value(data, "success").unwrap_or(false);
            let output = if success {
                data.get("result").map(Value::to_string).unwrap_or_default()
            } else {
                data.pointer("/error/message")
                    .and_then(Value::as_str)
                    .unwrap_or("Tool execution failed")
                    .to_string()
            };
            AgentEventPayload::ToolCompleted {
                tool_call_id: string(data, "toolCallId")?,
                status: if success { "succeeded" } else { "failed" }.to_string(),
                output: bounded(&output, MAX_TOOL_OUTPUT_CHARS),
            }
        }
        "permission.requested" => AgentEventPayload::PermissionRequested {
            request_id: string(data, "requestId")?,
            tool_name: permission_tool_name(data),
            summary: permission_summary(data),
        },
        "permission.completed" => AgentEventPayload::PermissionResolved {
            request_id: string(data, "requestId")?,
            decision: permission_decision(data),
        },
        // Pending callbacks are process-local and cannot be reconstructed.
        // Their bridges emit resolvable IDs while the app remains alive.
        "user_input.requested" | "elicitation.requested" => return None,
        "user_input.completed" => return None,
        "elicitation.completed" => AgentEventPayload::InputResolved {
            request_id: string(data, "requestId")?,
            status: if data.get("answer").is_some_and(|answer| !answer.is_null())
                || data.get("action").and_then(Value::as_str) == Some("accept")
            {
                "submitted"
            } else {
                "cancelled"
            }
            .to_string(),
        },
        "assistant.usage" => AgentEventPayload::Usage {
            scope: "turn".to_string(),
            usage: usage_from_data(data),
        },
        "session.usage_info" => AgentEventPayload::Context {
            used_tokens: unsigned(data, "currentTokens").unwrap_or(0),
            limit_tokens: unsigned(data, "tokenLimit").filter(|value| *value > 0),
        },
        "session.compaction_start" => AgentEventPayload::CompactionStarted,
        "session.compaction_complete" => AgentEventPayload::CompactionCompleted {
            compacted_tokens: compacted_tokens(data),
        },
        "session.idle" => AgentEventPayload::SessionIdle,
        "session.error" => AgentEventPayload::SessionError {
            error: normalized_error(data),
        },
        "session.task_complete" => AgentEventPayload::TaskCompleted {
            finish_reason: if bool_value(data, "success") == Some(false) {
                "error"
            } else {
                "stop"
            }
            .to_string(),
        },
        "abort" => AgentEventPayload::TaskCompleted {
            finish_reason: "cancelled".to_string(),
        },
        _ => return None,
    };

    Some(AgentWireEvent {
        event_id: event.id.clone(),
        session_id: session_id.to_string(),
        request_id,
        sequence,
        occurred_at: event.timestamp.clone(),
        replayed: false,
        replay_index: None,
        payload,
    })
}

pub fn usage_from_data(data: &Value) -> TokenUsage {
    TokenUsage {
        input_tokens: unsigned(data, "inputTokens").unwrap_or(0),
        output_tokens: unsigned(data, "outputTokens").unwrap_or(0),
        reasoning_tokens: unsigned(data, "reasoningTokens").unwrap_or(0),
        cache_read_tokens: unsigned(data, "cacheReadTokens").unwrap_or(0),
        cache_write_tokens: unsigned(data, "cacheWriteTokens").unwrap_or(0),
        request_count: 1,
    }
}

fn compacted_tokens(data: &Value) -> Option<u64> {
    let before = unsigned(data, "preCompactionTokens")?;
    let after = unsigned(data, "postCompactionTokens")?;
    Some(before.saturating_sub(after))
}

fn normalized_error(data: &Value) -> AgentErrorDetails {
    let error_type = string(data, "errorType").unwrap_or_else(|| "runtime".to_string());
    let status = data
        .get("statusCode")
        .and_then(Value::as_i64)
        .unwrap_or_default();
    let (code, retryable) = match (error_type.as_str(), status) {
        ("authentication", _) | ("authorization", _) => ("authentication_failed", false),
        ("rate_limit", _) | (_, 429) => ("rate_limited", true),
        ("context_limit", _) => ("context_too_large", false),
        ("safety", _) => ("safety_blocked", false),
        (_, 500..=599) => ("proxy_unreachable", true),
        _ => ("cli_crashed", true),
    };
    AgentErrorDetails {
        code: code.to_string(),
        phase: "generation".to_string(),
        message: bounded(
            &string(data, "message").unwrap_or_else(|| "The agent session failed".to_string()),
            MAX_SUMMARY_CHARS,
        ),
        retryable,
        recovery: Some("Retry the turn or reconnect the session.".to_string()),
    }
}

fn permission_tool_name(data: &Value) -> String {
    data.pointer("/permissionRequest/toolName")
        .or_else(|| data.pointer("/permissionRequest/tool_name"))
        .or_else(|| data.pointer("/promptRequest/toolName"))
        .and_then(Value::as_str)
        .map(|value| bounded(value, 200))
        .unwrap_or_else(|| "preshot_tool".to_string())
}

fn permission_summary(data: &Value) -> String {
    data.pointer("/promptRequest/description")
        .or_else(|| data.pointer("/promptRequest/message"))
        .and_then(Value::as_str)
        .map(|value| bounded(value, MAX_SUMMARY_CHARS))
        .unwrap_or_else(|| "Allow this Preshot tool for the current request?".to_string())
}

fn permission_decision(data: &Value) -> String {
    let serialized = data.get("result").map(Value::to_string).unwrap_or_default();
    if serialized.contains("approved") || serialized.contains("approve") {
        "allowed".to_string()
    } else {
        "denied".to_string()
    }
}

fn string(data: &Value, key: &str) -> Option<String> {
    data.get(key).and_then(Value::as_str).map(str::to_string)
}

fn unsigned(data: &Value, key: &str) -> Option<u64> {
    data.get(key).and_then(Value::as_u64)
}

fn bool_value(data: &Value, key: &str) -> Option<bool> {
    data.get(key).and_then(Value::as_bool)
}

fn bounded(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sdk_event(id: &str, event_type: &str, data: Value) -> SessionEvent {
        SessionEvent {
            id: id.to_string(),
            timestamp: "2026-08-22T00:00:00Z".to_string(),
            parent_id: None,
            ephemeral: None,
            agent_id: None,
            debug_cli_received_at_ms: None,
            debug_ws_forwarded_at_ms: None,
            event_type: event_type.to_string(),
            data,
        }
    }

    #[test]
    fn maps_ordered_stream_and_preserves_ids() {
        let delta = normalize_event(
            "session-1",
            Some("request-1".to_string()),
            7,
            &sdk_event(
                "event-1",
                "assistant.message_delta",
                json!({"messageId": "message-1", "deltaContent": "hello"}),
            ),
        )
        .unwrap();
        assert_eq!(delta.event_id, "event-1");
        assert_eq!(delta.sequence, 7);
        assert_eq!(delta.request_id.as_deref(), Some("request-1"));
        assert!(matches!(
            delta.payload,
            AgentEventPayload::MessageDelta { ref delta, .. } if delta == "hello"
        ));
    }

    #[test]
    fn never_forwards_opaque_reasoning_fields() {
        let message = normalize_event(
            "session-1",
            None,
            1,
            &sdk_event(
                "event-1",
                "assistant.message",
                json!({
                    "messageId": "message-1",
                    "content": "visible",
                    "encryptedContent": "secret",
                    "reasoningOpaque": "secret",
                    "reasoningText": "hidden"
                }),
            ),
        )
        .unwrap();
        let serialized = serde_json::to_string(&message).unwrap();
        assert!(!serialized.contains("secret"));
        assert!(!serialized.contains("hidden"));
        assert!(serialized.contains("\"messageId\""));
        assert!(!serialized.contains("\"message_id\""));
    }

    #[test]
    fn maps_every_supported_sdk_event_and_ignores_ephemeral_callbacks() {
        let cases = [
            (
                "user.message",
                json!({"messageId": "user-1", "content": "user"}),
            ),
            (
                "assistant.message_delta",
                json!({"messageId": "assistant-1", "deltaContent": "delta"}),
            ),
            (
                "assistant.message",
                json!({"messageId": "assistant-1", "content": "complete"}),
            ),
            (
                "assistant.reasoning_delta",
                json!({"reasoningId": "reasoning-1", "deltaContent": "summary"}),
            ),
            (
                "assistant.reasoning",
                json!({"reasoningId": "reasoning-1", "content": "summary"}),
            ),
            (
                "tool.execution_start",
                json!({"toolCallId": "tool-1", "toolName": "read_text_blocks"}),
            ),
            (
                "tool.execution_partial_result",
                json!({"toolCallId": "tool-1", "partialOutput": "partial"}),
            ),
            (
                "tool.execution_progress",
                json!({"toolCallId": "tool-1", "progressMessage": "progress"}),
            ),
            (
                "tool.execution_complete",
                json!({"toolCallId": "tool-1", "success": true, "result": {"ok": true}}),
            ),
            (
                "permission.requested",
                json!({
                    "requestId": "permission-1",
                    "permissionRequest": {"toolName": "read_text_blocks"}
                }),
            ),
            (
                "permission.completed",
                json!({"requestId": "permission-1", "result": "approved"}),
            ),
            (
                "elicitation.completed",
                json!({"requestId": "input-1", "action": "accept"}),
            ),
            (
                "assistant.usage",
                json!({"inputTokens": 1, "outputTokens": 2}),
            ),
            (
                "session.usage_info",
                json!({"currentTokens": 10, "tokenLimit": 100}),
            ),
            ("session.compaction_start", json!({})),
            (
                "session.compaction_complete",
                json!({"preCompactionTokens": 100, "postCompactionTokens": 40}),
            ),
            ("session.idle", json!({})),
            (
                "session.error",
                json!({"errorType": "rate_limit", "message": "retry"}),
            ),
            ("session.task_complete", json!({"success": true})),
            ("abort", json!({})),
        ];

        for (index, (event_type, data)) in cases.into_iter().enumerate() {
            assert!(
                normalize_event(
                    "session-1",
                    Some("request-1".to_string()),
                    index as u64,
                    &sdk_event(&format!("event-{index}"), event_type, data),
                )
                .is_some(),
                "{event_type} should map to a wire event",
            );
        }

        for event_type in [
            "user_input.requested",
            "user_input.completed",
            "elicitation.requested",
            "unknown.future_event",
        ] {
            assert!(
                normalize_event(
                    "session-1",
                    None,
                    0,
                    &sdk_event("ephemeral", event_type, json!({})),
                )
                .is_none(),
                "{event_type} must not create a replayable wire event",
            );
        }
    }

    #[test]
    fn maps_every_native_error_class_without_forwarding_provider_payloads() {
        let cases = [
            ("authentication", 401, "authentication_failed", false),
            ("authorization", 403, "authentication_failed", false),
            ("rate_limit", 0, "rate_limited", true),
            ("runtime", 429, "rate_limited", true),
            ("context_limit", 400, "context_too_large", false),
            ("safety", 400, "safety_blocked", false),
            ("runtime", 503, "proxy_unreachable", true),
            ("runtime", 400, "cli_crashed", true),
        ];

        for (index, (error_type, status, expected_code, expected_retryable)) in
            cases.into_iter().enumerate()
        {
            let event = normalize_event(
                "session-1",
                None,
                index as u64,
                &sdk_event(
                    &format!("error-{index}"),
                    "session.error",
                    json!({
                        "errorType": error_type,
                        "statusCode": status,
                        "message": "bounded public error",
                        "rawResponse": "must-not-pass-through"
                    }),
                ),
            )
            .expect("error should map");
            match event.payload {
                AgentEventPayload::SessionError { error } => {
                    assert_eq!(error.code, expected_code);
                    assert_eq!(error.retryable, expected_retryable);
                    assert_eq!(error.message, "bounded public error");
                    assert!(!serde_json::to_string(&error)
                        .unwrap()
                        .contains("must-not-pass-through"));
                }
                payload => panic!("unexpected payload: {payload:?}"),
            }
        }
    }
}
