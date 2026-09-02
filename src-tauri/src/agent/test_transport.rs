use std::collections::{HashMap, VecDeque};

use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MockTransportAction {
    StartClient,
    CreateSession(String),
    ResumeSession {
        session_id: String,
        config: String,
        continue_pending_work: bool,
        provider_resupplied: bool,
        tools_resupplied: bool,
    },
    ResumeFailed(String),
    Send(String),
    ToolResult(String),
    Abort(String),
    Crash,
    Restart,
    Disconnect(String),
    DisconnectFailed(String),
    CleanupReplacement(String),
    CleanupReplacementFailed(String),
    Delete(String),
    StopClient,
}

#[derive(Debug, Default)]
pub struct MockAgentTransport {
    running: bool,
    pid: Option<u32>,
    next_pid: u32,
    sessions: HashMap<String, bool>,
    events: VecDeque<Value>,
    actions: Vec<MockTransportAction>,
    resume_outcomes: VecDeque<bool>,
    disconnect_outcomes: VecDeque<bool>,
    cleanup_outcomes: VecDeque<bool>,
}

impl MockAgentTransport {
    pub fn start(&mut self) {
        self.next_pid = self.next_pid.saturating_add(1).max(1);
        self.pid = Some(self.next_pid);
        self.running = true;
        self.actions.push(MockTransportAction::StartClient);
    }

    pub fn create(&mut self, session_id: &str) {
        assert!(self.running);
        self.sessions.insert(session_id.to_string(), false);
        self.actions
            .push(MockTransportAction::CreateSession(session_id.to_string()));
    }

    pub fn resume(&mut self, session_id: &str, config: &str) -> Result<(), &'static str> {
        assert!(self.running);
        self.actions.push(MockTransportAction::ResumeSession {
            session_id: session_id.to_string(),
            config: config.to_string(),
            continue_pending_work: false,
            provider_resupplied: true,
            tools_resupplied: true,
        });
        if !self.resume_outcomes.pop_front().unwrap_or(true) {
            self.sessions.insert(session_id.to_string(), false);
            self.actions
                .push(MockTransportAction::ResumeFailed(session_id.to_string()));
            return Err("resume failed");
        }
        self.sessions.insert(session_id.to_string(), false);
        Ok(())
    }

    pub fn send(&mut self, session_id: &str) {
        assert_eq!(self.sessions.get(session_id), Some(&false));
        self.sessions.insert(session_id.to_string(), true);
        self.actions
            .push(MockTransportAction::Send(session_id.to_string()));
    }

    pub fn tool_result(&mut self, nonce: &str) {
        self.actions
            .push(MockTransportAction::ToolResult(nonce.to_string()));
    }

    pub fn abort(&mut self, session_id: &str) {
        if let Some(active) = self.sessions.get_mut(session_id) {
            *active = false;
        }
        self.actions
            .push(MockTransportAction::Abort(session_id.to_string()));
    }

    pub fn crash(&mut self) {
        self.running = false;
        self.pid = None;
        self.sessions.clear();
        self.actions.push(MockTransportAction::Crash);
    }

    pub fn restart(&mut self) {
        self.start();
        self.actions.push(MockTransportAction::Restart);
    }

    pub fn disconnect(&mut self, session_id: &str) -> Result<(), &'static str> {
        if !self.disconnect_outcomes.pop_front().unwrap_or(true) {
            self.actions.push(MockTransportAction::DisconnectFailed(
                session_id.to_string(),
            ));
            return Err("disconnect failed");
        }
        self.sessions.remove(session_id);
        self.actions
            .push(MockTransportAction::Disconnect(session_id.to_string()));
        Ok(())
    }

    pub fn cleanup_replacement(&mut self, session_id: &str) -> Result<(), &'static str> {
        if !self.cleanup_outcomes.pop_front().unwrap_or(true) {
            self.actions
                .push(MockTransportAction::CleanupReplacementFailed(
                    session_id.to_string(),
                ));
            return Err("replacement cleanup failed");
        }
        self.sessions.remove(session_id);
        self.actions.push(MockTransportAction::CleanupReplacement(
            session_id.to_string(),
        ));
        Ok(())
    }

    pub fn delete(&mut self, session_id: &str) {
        self.sessions.remove(session_id);
        self.actions
            .push(MockTransportAction::Delete(session_id.to_string()));
    }

    pub fn stop(&mut self) {
        self.sessions.clear();
        self.running = false;
        self.pid = None;
        self.actions.push(MockTransportAction::StopClient);
    }

    pub fn push_event(&mut self, event: Value) {
        self.events.push_back(event);
    }

    pub fn pop_event(&mut self) -> Option<Value> {
        self.events.pop_front()
    }

    pub fn has_child(&self) -> bool {
        self.pid.is_some()
    }

    pub fn actions(&self) -> &[MockTransportAction] {
        &self.actions
    }

    fn queue_resume_outcomes(&mut self, outcomes: impl IntoIterator<Item = bool>) {
        self.resume_outcomes.extend(outcomes);
    }

    fn queue_disconnect_outcomes(&mut self, outcomes: impl IntoIterator<Item = bool>) {
        self.disconnect_outcomes.extend(outcomes);
    }

    fn queue_cleanup_outcomes(&mut self, outcomes: impl IntoIterator<Item = bool>) {
        self.cleanup_outcomes.extend(outcomes);
    }

    fn epoch(&self) -> u32 {
        self.pid.expect("mock client is running")
    }

    fn is_active(&self, session_id: &str) -> bool {
        self.sessions.get(session_id).copied().unwrap_or(false)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct MockManagedEntry {
    config: String,
    client_epoch: u32,
    connected: bool,
    cleanup_required: bool,
}

#[derive(Debug, Default)]
struct MockManagedRuntime {
    transport: MockAgentTransport,
    sessions: HashMap<String, MockManagedEntry>,
}

impl MockManagedRuntime {
    fn start(&mut self) {
        self.transport.start();
    }

    fn create(&mut self, session_id: &str, config: &str) {
        self.transport.create(session_id);
        self.sessions.insert(
            session_id.to_string(),
            MockManagedEntry {
                config: config.to_string(),
                client_epoch: self.transport.epoch(),
                connected: true,
                cleanup_required: false,
            },
        );
    }

    fn resume(&mut self, session_id: &str, config: &str) -> Result<(), &'static str> {
        let old = self.sessions.get(session_id).cloned();
        if let Some(entry) = old.as_ref() {
            if entry.connected && entry.client_epoch == self.transport.epoch() {
                if self.transport.is_active(session_id) {
                    self.transport.abort(session_id);
                }
                self.transport.disconnect(session_id)?;
            } else if entry.cleanup_required {
                self.transport.cleanup_replacement(session_id)?;
            }
            let retained = self
                .sessions
                .get_mut(session_id)
                .expect("managed entry remains during resume");
            retained.connected = false;
            retained.cleanup_required = false;
        }

        if self.transport.resume(session_id, config).is_ok() {
            self.sessions.insert(
                session_id.to_string(),
                MockManagedEntry {
                    config: config.to_string(),
                    client_epoch: self.transport.epoch(),
                    connected: true,
                    cleanup_required: false,
                },
            );
            return Ok(());
        }

        let Some(old) = old else {
            return Err("resume failed");
        };
        if self.transport.resume(session_id, &old.config).is_err() {
            if self.transport.cleanup_replacement(session_id).is_err() {
                self.sessions
                    .get_mut(session_id)
                    .expect("managed entry remains after failed cleanup")
                    .cleanup_required = true;
                return Err("replacement cleanup failed");
            }
            if self.transport.resume(session_id, &old.config).is_err() {
                if self.transport.cleanup_replacement(session_id).is_err() {
                    self.sessions
                        .get_mut(session_id)
                        .expect("managed entry remains after failed cleanup")
                        .cleanup_required = true;
                    return Err("replacement cleanup failed");
                }
                return Err("restore failed");
            }
        }
        self.sessions.insert(
            session_id.to_string(),
            MockManagedEntry {
                config: old.config,
                client_epoch: self.transport.epoch(),
                connected: true,
                cleanup_required: false,
            },
        );
        Err("resume failed")
    }

    fn abort(&mut self, session_id: &str) -> Result<(), &'static str> {
        let entry = self.sessions.get(session_id).ok_or("session missing")?;
        if entry.connected {
            self.transport.abort(session_id);
        } else if entry.cleanup_required {
            self.transport.abort(session_id);
        }
        Ok(())
    }

    fn delete(&mut self, session_id: &str) -> Result<(), &'static str> {
        self.disconnect(session_id)?;
        self.transport.delete(session_id);
        Ok(())
    }

    fn disconnect(&mut self, session_id: &str) -> Result<(), &'static str> {
        let entry = self.sessions.get(session_id).ok_or("session missing")?;
        if entry.connected {
            if self.transport.is_active(session_id) {
                self.transport.abort(session_id);
            }
            self.transport.disconnect(session_id)?;
        } else if entry.cleanup_required {
            self.transport.cleanup_replacement(session_id)?;
        }
        self.sessions.remove(session_id);
        Ok(())
    }

    fn crash_and_restart(&mut self) {
        self.transport.crash();
        self.transport.restart();
    }

    fn entry(&self, session_id: &str) -> &MockManagedEntry {
        self.sessions
            .get(session_id)
            .expect("managed session entry exists")
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn deterministic_probe_requires_stream_tool_result_and_terminal_response() {
        let mut transport = MockAgentTransport::default();
        transport.start();
        transport.create("probe");
        transport.send("probe");
        transport.push_event(json!({"type": "assistant.message_delta"}));
        transport.push_event(json!({
            "type": "external_tool.requested",
            "tool": "preshot_capability_probe",
            "nonce": "abc"
        }));
        transport.tool_result("abc");
        transport.push_event(json!({
            "type": "assistant.message",
            "content": "abc"
        }));
        transport.push_event(json!({"type": "session.idle"}));

        assert_eq!(
            transport.pop_event().unwrap()["type"],
            "assistant.message_delta"
        );
        assert_eq!(
            transport.pop_event().unwrap()["type"],
            "external_tool.requested"
        );
        assert_eq!(transport.pop_event().unwrap()["content"], "abc");
        assert_eq!(transport.pop_event().unwrap()["type"], "session.idle");
        assert!(transport
            .actions()
            .contains(&MockTransportAction::ToolResult("abc".to_string())));
    }

    #[test]
    fn managed_resume_success_swaps_after_old_disconnect() {
        let mut runtime = MockManagedRuntime::default();
        runtime.start();
        runtime.create("session-1", "old");
        runtime.transport.send("session-1");

        runtime.resume("session-1", "new").unwrap();

        assert_eq!(runtime.entry("session-1").config, "new");
        assert!(runtime.entry("session-1").connected);
        assert_eq!(
            &runtime.transport.actions()[3..6],
            &[
                MockTransportAction::Abort("session-1".to_string()),
                MockTransportAction::Disconnect("session-1".to_string()),
                MockTransportAction::ResumeSession {
                    session_id: "session-1".to_string(),
                    config: "new".to_string(),
                    continue_pending_work: false,
                    provider_resupplied: true,
                    tools_resupplied: true,
                },
            ]
        );
    }

    #[test]
    fn managed_resume_failure_restores_old_entry() {
        let mut runtime = MockManagedRuntime::default();
        runtime.start();
        runtime.create("session-1", "old");
        runtime.transport.queue_resume_outcomes([false, true]);

        assert_eq!(runtime.resume("session-1", "new"), Err("resume failed"));
        assert_eq!(runtime.entry("session-1").config, "old");
        assert!(runtime.entry("session-1").connected);
    }

    #[test]
    fn old_disconnect_failure_keeps_original_handle_controllable() {
        let mut runtime = MockManagedRuntime::default();
        runtime.start();
        runtime.create("session-1", "old");
        runtime.transport.queue_disconnect_outcomes([false]);

        assert_eq!(runtime.resume("session-1", "new"), Err("disconnect failed"));
        assert_eq!(runtime.entry("session-1").config, "old");
        assert!(runtime.entry("session-1").connected);
        runtime.abort("session-1").unwrap();
    }

    #[test]
    fn replacement_cleanup_failure_leaves_recoverable_detached_entry() {
        let mut runtime = MockManagedRuntime::default();
        runtime.start();
        runtime.create("session-1", "old");
        runtime.transport.queue_resume_outcomes([false, false]);
        runtime.transport.queue_cleanup_outcomes([false]);

        assert_eq!(
            runtime.resume("session-1", "new"),
            Err("replacement cleanup failed")
        );
        assert_eq!(runtime.entry("session-1").config, "old");
        assert!(!runtime.entry("session-1").connected);
    }

    #[test]
    fn disconnect_controls_detached_entry_after_failed_resume() {
        let mut runtime = MockManagedRuntime::default();
        runtime.start();
        runtime.create("session-1", "old");
        runtime.transport.queue_resume_outcomes([false, false]);
        runtime.transport.queue_cleanup_outcomes([false, true]);
        assert!(runtime.resume("session-1", "new").is_err());

        runtime.disconnect("session-1").unwrap();

        assert!(!runtime.sessions.contains_key("session-1"));
        assert_eq!(
            runtime.transport.actions().last(),
            Some(&MockTransportAction::CleanupReplacement(
                "session-1".to_string()
            ))
        );
    }

    #[test]
    fn repeated_retry_recovers_after_failed_resume_and_restore() {
        let mut runtime = MockManagedRuntime::default();
        runtime.start();
        runtime.create("session-1", "old");
        runtime
            .transport
            .queue_resume_outcomes([false, false, false, false, true, true]);

        assert_eq!(runtime.resume("session-1", "new"), Err("restore failed"));
        assert!(!runtime.entry("session-1").connected);
        assert_eq!(runtime.resume("session-1", "new"), Err("resume failed"));
        assert!(runtime.entry("session-1").connected);
        assert_eq!(runtime.entry("session-1").config, "old");
        runtime.resume("session-1", "new").unwrap();
        assert_eq!(runtime.entry("session-1").config, "new");
    }

    #[test]
    fn abort_and_delete_control_detached_entry_after_failed_resume() {
        let mut runtime = MockManagedRuntime::default();
        runtime.start();
        runtime.create("session-1", "old");
        runtime.transport.queue_resume_outcomes([false, false]);
        runtime.transport.queue_cleanup_outcomes([false]);
        assert!(runtime.resume("session-1", "new").is_err());

        runtime.abort("session-1").unwrap();
        runtime.delete("session-1").unwrap();

        assert!(!runtime.sessions.contains_key("session-1"));
        assert_eq!(
            runtime.transport.actions().last(),
            Some(&MockTransportAction::Delete("session-1".to_string()))
        );
    }

    #[test]
    fn process_crash_skips_stale_disconnect_and_resumes_on_new_epoch() {
        let mut runtime = MockManagedRuntime::default();
        runtime.start();
        runtime.create("session-1", "old");
        runtime.crash_and_restart();

        runtime.resume("session-1", "new").unwrap();

        assert!(runtime.entry("session-1").connected);
        assert_eq!(runtime.entry("session-1").config, "new");
        let restart_index = runtime
            .transport
            .actions()
            .iter()
            .position(|action| *action == MockTransportAction::Restart)
            .unwrap();
        assert!(!runtime
            .transport
            .actions()
            .iter()
            .skip(restart_index + 1)
            .any(|action| matches!(action, MockTransportAction::Disconnect(_))));
    }

    #[test]
    fn abort_crash_restart_resume_and_cleanup_leave_no_child() {
        let mut transport = MockAgentTransport::default();
        transport.start();
        transport.create("session-1");
        transport.send("session-1");
        transport.abort("session-1");
        transport.crash();
        assert!(!transport.has_child());
        transport.restart();
        transport.resume("session-1", "restored").unwrap();
        transport.disconnect("session-1").unwrap();
        transport.delete("session-1");
        transport.stop();

        assert!(!transport.has_child());
        assert!(transport
            .actions()
            .contains(&MockTransportAction::ResumeSession {
                session_id: "session-1".to_string(),
                config: "restored".to_string(),
                continue_pending_work: false,
                provider_resupplied: true,
                tools_resupplied: true,
            }));
        assert_eq!(
            transport.actions().last(),
            Some(&MockTransportAction::StopClient)
        );
    }
}
