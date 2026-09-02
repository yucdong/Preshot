# Preshot Basic Agent Design

**Status:** Implemented production contract
**Runtime UI:** Simplified Chinese
**Runtime:** GitHub Copilot Rust SDK with a managed Copilot CLI process
**MVP provider:** OpenAI-compatible BYOK proxy without an API key
**Default proxy:** `http://localhost:4141`

## Purpose

Preshot's right assistant panel provides project-scoped chat that can read
explicitly disclosed plan context, stream Copilot SDK events, and propose safe
text-block edits. It never changes the plan until the user reviews and applies
an atomic proposal.

## Accepted decisions

- Assistant panel is closed by default.
- MVP edit scope is text blocks only.
- Selecting a reference image creates a visible removable attachment chip.
- Project switching during a turn offers Wait, Stop and switch, or Cancel.
- A proposal is applied or discarded as one atomic batch and one undo
  checkpoint.
- Deleting a project deletes its agent sessions after confirmation.
- Sessions remain local; no cloud sync.

## Non-goals

The MVP does not directly edit image groups, media, assets, columns, project
metadata, or files. It does not expose shell, Git, arbitrary filesystem write,
external HTTP, MCP, skills, sub-agents, or autonomous execution. It does not
display hidden chain-of-thought or support pausing an in-flight turn.

## SDK architecture

Use the Rust SDK in the Tauri backend, not the Node SDK in the WebView.

```text
React AgentPanel
  -> domain AgentController
  -> Tauri Agent adapter
  -> Rust AgentRuntimeService
  -> github_copilot_sdk::Client
  -> managed Copilot CLI over JSON-RPC/stdio
  -> configured OpenAI-compatible proxy
```

The current Rust toolchain is 1.97.1 and satisfies the SDK's 1.94 minimum.

Configure:

```text
ClientOptions.mode
  = ClientMode::Empty

ClientOptions.base_directory
  = %USERPROFILE%\.preshot\copilot

ClientOptions.bundled_cli_extract_dir
  = %USERPROFILE%\.preshot\copilot\bin\1.0.79

SessionConfig.working_directory
  = canonical current project directory
```

`ClientMode::Empty` is mandatory. The SDK's default Copilot CLI mode may
discover and expose host instructions, plugins, memory, tools, and future
ambient capabilities. Every create and resume configuration must use an
explicit, source-qualified allowlist containing only the Preshot custom tools.
Explicitly disable:

- config and instruction discovery;
- plugins and custom agents;
- memory and session store;
- Git/GitHub and host Git operations;
- remote/cloud sessions;
- MCP and MCP Apps;
- skills;
- embedding retrieval and persistent embedding cache;
- all built-in tools not required by the closed MVP contract.

The SDK client starts lazily when the assistant first needs it. One SDK client
is shared by the application; sessions are created/resumed underneath it.

Production is pinned to `github-copilot-sdk@1.0.11` with only `bundled-cli`.
The checksum-reviewed Windows x64 CLI archive is release/file version `1.0.79`,
self-reports `1.0.81-7`, is 100,644,089 bytes compressed, and contains an
unmodified 159,403,296-byte executable. Preshot uses the separate stdio child
process and does not enable `bundled-in-process`.

## Provider and settings

MVP supports one no-key OpenAI-compatible proxy.

- default display URL: `http://localhost:4141`;
- canonical inference base URL: `http://localhost:4141/v1`;
- provider type: `openai`;
- wire API: Responses;
- API key: absent.

Allow loopback HTTP and remote HTTPS. Reject remote plain HTTP, embedded
credentials, file/UNC paths, fragments, and unsupported schemes.

Model discovery:

1. normalize trailing slash;
2. derive `<base>/v1` when the URL has no API-version suffix, or retain
   `<base>` when it already ends in `/v1`;
3. probe `<candidate-api-root>/models`;
4. persist the successful candidate separately as `apiBaseUrl`;
5. pass that complete root to Copilot SDK `ProviderConfig.base_url`, so
   inference uses `<apiBaseUrl>/responses`;
6. require a valid OpenAI-compatible model-list response;
7. do not silently redirect to another origin or provider.

The standard model-list response proves model identity only. It does not prove
Responses API, streaming, custom-tool, image, reasoning, or context-window
support. Store explicit capability status:

```ts
interface AgentModelCapabilities {
  responsesApi: "verified" | "unsupported" | "unknown";
  streaming: "verified" | "unsupported" | "unknown";
  customTools: "verified" | "unsupported" | "unknown";
  imageInput: "verified" | "unsupported" | "unknown";
  reasoningSummary: boolean;
  reasoningEffort: boolean;
  contextWindowTokens: number | null;
}
```

Test connection performs a disclosed, bounded compatibility probe through the
same Copilot SDK path used by real sessions:

1. create a temporary Empty-mode session with the selected BYOK provider;
2. start a Responses streaming request containing a random nonce;
3. require the model to invoke one harmless strict-schema no-op custom tool;
4. execute that tool locally and submit its tool result;
5. require a terminal assistant response containing the nonce;
6. capture usage/context metadata when available;
7. delete the temporary session.

This full round trip verifies Responses, streaming, custom-tool invocation,
tool-result continuation, and final completion. Merely observing a tool-call
event is insufficient.

Vision verification is separate:

- prefer authoritative proxy/SDK model capability metadata when available;
- otherwise offer a disclosed Verify image support action that sends a tiny,
  bundled, non-user test PNG through the SDK attachment path and requires a
  deterministic structured answer;
- persist the result keyed by normalized proxy origin, model ID, and
  capability-probe version;
- register/override the SDK model's vision capability only after verification;
- never use a user's selected image for capability testing.

The probes may consume a small number of model tokens and state that before
they run. Text Send is enabled only when Responses, streaming, and custom tools
are verified. The selected-image chip may remain visible, but its content is
not sent and the UI explains Image input unavailable until vision is verified.
Reasoning controls are hidden when unsupported. Context percentage is omitted
when no reliable context limit is known.

Persist only non-secret settings in `.preshot/settings.json`:

```ts
interface AgentModelSettings {
  enabled: boolean;
  providerType: "openai";
  displayUrl: string;
  apiBaseUrl: string;
  modelId: string | null;
  wireApi: "responses";
  reasoningEffort: "low" | "medium" | "high" | "xhigh" | null;
  reasoningSummary: "none" | "concise" | "detailed";
}
```

The assistant composer is disabled until proxy/model validation succeeds.
React never calls the proxy directly; Rust/CLI owns networking.

If a saved proxy/model changes capabilities, mark it Requires retest and
disable Send until the compatibility probe succeeds again.

## Local data

Use one global metadata database:

```text
%USERPROFILE%\.preshot\agent.db
```

Do not put an agent database inside each project. The Copilot runtime under
`.preshot\copilot` remains authoritative for transcript events and resume
state. SQLite stores metadata/indexes, drafts, proposal receipts, and usage
summaries, not duplicate full transcripts.

Core tables:

- `agent_schema_migrations`;
- `agent_projects`;
- `agent_sessions`;
- `agent_drafts`;
- `agent_proposals`;
- `agent_proposal_checkpoints`;
- `agent_proposal_recovery`;
- optional cleanup tombstones.

Use bundled SQLite, WAL, foreign keys, busy timeout, prepared statements, UTC
timestamps, and transactional migrations.

Sessions are indexed by project ID and canonical project path. Project deletion
aborts/disconnects sessions, deletes SDK session files, and cascades SQLite
metadata. Failed SDK cleanup becomes a hidden retry tombstone and never blocks
project deletion.

## Session lifecycle

States:

```text
creating
idle
running
waiting_permission
waiting_user_input
stopping
disconnected
error
deleting
```

Only one active generation exists globally in MVP.

Create:

- validate proxy/model;
- create SDK session with streaming;
- set current project working directory;
- enable infinite-session compaction;
- use `ClientMode::Empty`;
- install a source-qualified allowlist containing only the four Preshot custom
  tools;
- explicitly disable discovery, plugins, memory, session store, remote/cloud,
  built-in tools, MCP, skills, Git, and external HTTP;
- install custom Preshot tools and permission handlers;
- subscribe before accepting Send;
- insert metadata after SDK creation succeeds.

Resume:

- load project-scoped metadata newest first;
- resume SDK session with the same Empty-mode restrictions, custom tool
  declarations, and permission handler as creation;
- reconstruct and re-supply the complete validated BYOK `ProviderConfig`:
  - provider type `openai`;
  - canonical `apiBaseUrl`;
  - Responses wire API;
  - selected model/capability registration;
  - intentional absence of API key;
- keep `continue_pending_work` disabled in MVP;
- serialize resume with Send/abort/disconnect/delete/subscription operations;
- retain the old handle and complete resume configuration until replacement
  succeeds; on replacement failure restore the old configuration;
- if replacement cleanup/restoration also fails, keep a detached recoverable
  entry addressable for retry, abort, disconnect, or delete instead of
  orphaning a CLI session;
- reload durable SDK events;
- refresh usage/context metrics and draft/proposal metadata.

Project switch while running:

- Wait queues the requested target project, keeps the current project open
  until idle, shows a persistent waiting-to-switch status with Cancel switch,
  and switches automatically after idle;
- if the active turn ends in an error, retain its error receipt and still
  perform the queued switch;
- Stop and switch calls SDK abort, waits for idle/timeout, disconnects, and
  preserves the session for a later new turn;
- Cancel closes the switch dialog.

The UI must not call this Suspend because the SDK does not pause and continue
the middle of an active model turn.

User-input and elicitation requests are ephemeral SDK events and are not
reconstructed by `get_events`. Pending-permission continuation also requires
an experimental SDK path plus `continue_pending_work`. The MVP does not restore
any pending interaction:

- persist a local pending-interaction receipt while the app remains alive;
- Stop and switch aborts the pending interaction before disconnect;
- crash or forced disconnect marks the turn Interrupted;
- resume shows the interrupted request summary and asks the user to send a new
  message;
- historical permission/tool receipts remain visible, but no stale request ID
  is resolved after resume;
- a later release may enable `continue_pending_work` only after pinning and
  testing matching SDK/CLI versions and re-registering the same custom tools
  and permission handler before resolution.

## Workspace context bridge

Add a typed bridge between AgentPanel and the BlockNote provider:

```ts
interface AgentWorkspaceSnapshot {
  projectId: string;
  projectName: string;
  documentRevision: number;
  documentHash: string;
  selectedBlockIds: readonly string[];
  selectedImage?: AgentImageReference;
  saveState: SaveState;
}
```

The bridge exposes immutable snapshots and typed commands, never the mutable
BlockNote editor.

Capture the request snapshot on Send. Later selection changes do not affect an
in-flight request. Store a visible context receipt on each user turn.

## Selected image attachment

Selecting a plan reference image creates a visible removable chip.

- only the selected image is attached;
- selecting another image replaces the automatic chip unless it was pinned;
- no bytes are sent until Send;
- React stores stable IDs, display name, and a thumbnail, but no native token;
- immediately before Send, the workspace bridge revalidates project, revision,
  image existence, and the current relative file, then issues a fresh
  single-use opaque token;
- Rust resolves the fresh token to a canonical path inside the current project;
- the absolute path is passed to the SDK attachment API, never inserted into
  prompt text;
- path, MIME, size, and project-containment validation happen in Rust.
- resolution consumes the token; automatic issuance supersedes older
  automatic tokens, pinned tokens are bounded, and revision/project/image
  changes revoke stale tokens;
- an unavailable image keeps the draft and chip visible, removes the failed
  turn receipt, and surfaces `attachment_unavailable` without sending a
  text-only fallback.

External local-file attachments are deferred.

## Tool and permission model

Never use `approve_all`.

Disable shell, process, file-write, Git/GitHub, arbitrary edit, HTTP, MCP,
skills, and sub-agent tools.

MVP custom tools:

- `get_project_summary`;
- `read_text_blocks`;
- `list_reference_images`;
- `propose_text_block_edits`.

The proposal tool validates/stages a proposal but never applies it.

Keep three independent user decisions:

1. context disclosure;
2. tool permission;
3. Apply changes.

Read of visible/disclosed document context is allowed for the request.
Outside-project read is denied. Destructive text-block deletion gets a separate
confirmation. Image/media/asset modifications are denied in MVP.

## Proposal-first editing

Closed schema:

```ts
interface AgentTextEditProposal {
  version: 1;
  proposalId: string;
  sessionId: string;
  baseRevision: number;
  baseDocumentHash: string;
  summary: string;
  operations: readonly AgentTextEditOperation[];
}

type AgentTextEditOperation =
  | {
      op: "update";
      blockId: string;
      expectedBlockHash: string;
      patch: AllowedTextBlockPatch;
    }
  | {
      op: "insertBefore" | "insertAfter";
      referenceBlockId: string;
      expectedReferenceHash: string;
      blocks: readonly AllowedTextBlockDraft[];
    }
  | {
      op: "delete";
      blockId: string;
      expectedBlockHash: string;
    };
```

Trusted code generates IDs and validates allowed text types, properties,
operation count, text size, nesting, revision, and expected hashes. Model
output cannot set paths, media URLs, image-group IDs, schema versions, or
arbitrary properties.

Review UI is stacked for the 240-420px panel:

- summary/counts;
- Before;
- After;
- Apply changes;
- Discard proposal;
- Ask for revisions.

Apply:

- revalidate revision/hash and complete projected document;
- show destructive confirmation for deletes;
- capture pre-apply checkpoint;
- transactionally stage an exact bounded recovery row in `agent.db`;
- execute one editor transaction;
- serialize through normal validator/provider/save queue;
- atomically store the checkpoint/applied receipt and consume the recovery row;
- expose persistent Undo this apply.

Stale proposals never merge automatically; user must regenerate.

### Implemented proposal-engine contract

The engine is mounted behind `AgentProposalApplicationPort` and the production
panel renders its stacked review, actions, receipts, and conflict states. The
native proposal tool stages validated
operation JSON and a trusted proposal ID in SQLite but cannot call Apply.
TypeScript revalidates the stored schema, projects the complete v14 document,
and publishes a UI-agnostic stacked diff with human labels, Before/After text,
add/edit/delete counts, and a destructive flag.

Apply and persistent Undo use the normal BlockNote provider mutation/save
queue. One Apply is one editor transaction and one immediate save. The
checkpoint stores the exact pre-apply plan plus affected hashes; restart-safe
Undo preserves unrelated edits and refuses conflicts with affected block IDs.
Both operations write a schema-v4 pending journal row before the project save
and atomically consume it while finalizing proposal/checkpoint metadata after
the save. Recovery runs before project history/session proposals are
actionable. It compares the current validated document hash with the stored
before/after boundaries: before clears without metadata changes, after
idempotently finalizes, and any other hash retains a conflict record without
mutating the project. The journal has one pending row per project across app
instances, stores no path/media/secret payload, and remains bounded by the
checkpoint and finalization validators.
Discard and Ask revisions are explicit no-apply intents, and Ask revisions
sends frozen proposal/feedback/current revision context to a new model turn.

## Streaming and event mapping

Enable SDK streaming and map:

- assistant message/delta;
- reasoning summary/delta;
- tool start/progress/partial/complete;
- permission requested;
- user-input and elicitation requests;
- assistant usage;
- session usage/context;
- compaction start/complete;
- idle/error/task completion.

Reasoning UI shows only provider/SDK user-visible reasoning summaries, collapsed
by default. It never claims to expose hidden chain-of-thought.

The transcript reducer:

- coalesces deltas by message ID;
- throttles React updates to one animation frame;
- deduplicates replayed event IDs;
- bounds tool output;
- restores transcript with SDK `get_events`;
- cleans listeners/RAF on disconnect.

## Usage and budget

Use SDK usage/context events and RPCs to show:

- selected model;
- context tokens/limit and percentage;
- warning at 75%, high at 90%, compaction state;
- per-turn and cumulative input/output/reasoning/cache tokens;
- request count;
- monetary cost only when the proxy returns reliable cost or a configured
  price table exists.

For the no-key proxy MVP, Budget means an optional token cap, not invented
currency.

## Panel UX

The assistant is closed by default and opened by a persistent toggle. Opening
the panel alone does not start a session.

Header:

- Assistant;
- session title;
- textual status;
- New conversation;
- History;
- overflow for permissions/help/delete.

Transcript:

- `role="log"`;
- user and assistant turns;
- collapsed reasoning summary;
- tool timeline;
- permissions;
- proposals;
- usage/errors;
- no focus stealing;
- stop auto-scroll when user scrolls up;
- New response control.

Composer:

- visible context summary;
- selected-image attachment strip;
- 14px multiline text;
- Enter sends, Shift+Enter newline, IME safe;
- Send becomes Stop while running;
- per-session draft persistence.

At 240-420px:

- one column;
- no panel horizontal scroll;
- stacked diff/actions;
- overflow secondary header actions;
- action buttons stack below 320px.

History:

- project-scoped;
- newest first;
- title, model, updated time, status;
- resume, rename, delete.

## Errors

Typed errors include:

- model not configured;
- proxy unreachable/invalid model list/model unavailable;
- CLI start/crash;
- session create/resume/corrupt;
- auth/rate limit/context too large/timeout/cancel/refusal/safety;
- attachment unavailable;
- tool denied/failed;
- proposal invalid/stale/apply conflict;
- SQLite failure/project deleted.

Every error identifies the failed phase and recovery. Retry connection,
timeout, 429, and 5xx at most twice with jitter and `Retry-After`. Never
automatically replay side-effecting operations.

## Security and privacy

Treat document text, image captions, model output, tool arguments/results,
proxy responses, and resumed session data as untrusted.

Controls:

- no broad tools;
- closed proposal schema;
- revision/hash validation;
- canonical Rust path checks;
- bounded context/attachment/proposal sizes;
- explicit Apply;
- no renderer networking;
- no model-supplied paths, URLs, tool names, schema versions, or block IDs for
  inserted content.

Metadata-only logs:

- hashed project/session IDs;
- model/proxy origin;
- versions;
- latency/retries/finish reason;
- token usage/context;
- tool names/status;
- proposal/apply/undo status.

Do not log prompts, document text, image bytes, or absolute paths by default.

## Suggested source structure

```text
src/domain/agent/
  models.ts
  ports.ts
  sessionService.ts
  contextSnapshot.ts
  proposal.ts
  proposalApply.ts
  eventReducer.ts
  errors.ts

src/features/agent/
  AgentPanel.tsx
  AgentProvider.tsx
  AgentHeader.tsx
  AgentHistory.tsx
  AgentTranscript.tsx
  AgentComposer.tsx
  AgentContextChips.tsx
  AgentAttachmentStrip.tsx
  AgentToolActivity.tsx
  AgentPermissionCard.tsx
  AgentProposalReview.tsx
  AgentUsageMeter.tsx

src/infrastructure/agent/
  tauriAgent.ts
  browserAgent.ts

src-tauri/src/agent/
  mod.rs
  runtime.rs
  database.rs
  model_proxy.rs
  sessions.rs
  permissions.rs
  tools.rs
  events.rs
  attachments.rs
```

## Tauri API

Narrow commands:

- model settings/test/list;
- session list/create/resume/rename/delete;
- send/abort;
- resolve permission/user input;
- get events/usage;
- delete project sessions.

Use one typed Tauri channel per active session. Capabilities are scoped to the
workspace window. No generic shell/filesystem/network capability is added.

## Testing

Domain:

- immutable context;
- proposal schema;
- revision/hash conflict;
- apply/discard/undo;
- event ordering/deduplication;
- usage percentages;
- project-switch state machine.

Rust/infrastructure:

- bundled CLI extraction/start/stop;
- `.preshot` home;
- proxy URL/model discovery;
- SQLite migrations/concurrency/cascade;
- create/resume/delete;
- crash recovery;
- attachment containment;
- permission policy;
- event channel cancellation;
- redacted logging.

Components:

- default-closed panel;
- setup/model settings;
- context/image chips;
- streaming/tool/permission/reasoning/usage;
- proposals/stale/apply/undo;
- history/delete;
- focus, IME, reduced motion, high contrast, 240-420px.

E2E uses a deterministic fake CLI/proxy:

- configure;
- create/resume/delete;
- stream all event classes;
- attach selected image;
- permission allow/deny;
- proposal apply/discard/revise/stale/undo;
- stop and switch project;
- delete project sessions;
- compaction/usage;
- offline/rate-limit/crash recovery;
- assert no mutation before Apply.

`pnpm test:agent-evals` is the canonical offline eval entry point. It does not
use a live model in CI and refreshes
`tests/artifacts/agent-mvp-eval-report.md`. The fixture set covers all 18
normalized events, all 24 typed errors, capability and no-model gates, eight
adversarial proposal payloads, every allowed text block type and nesting,
source identity, stale/conflict/Apply/Undo, Empty-mode ambient-tool exclusion,
renderer network exclusion, and metadata-only logging.

## Rollout

1. SDK/bundled CLI/proxy/session spike.
2. Read-only chat, settings, SQLite metadata, sessions, context, attachments,
   streaming, usage, cancellation.
3. Text proposal schema, diff, Apply/Discard/Ask revisions, stale checks, undo.
4. Permission/elicitation, crash recovery, compaction, deletion cleanup,
   E2E/evals, MSI update tests.
5. Later: per-block apply, image/media proposals, external attachments,
   allowlisted network/MCP/skills/local models.

## Acceptance criteria

- no-model state is actionable;
- panel closed by default;
- default proxy/model discovery works;
- managed CLI has no zombie process;
- all state is under `.preshot`;
- sessions are project-scoped/resumable/deleted with project;
- project switch uses accepted dialog;
- all relevant SDK events stream correctly;
- selected image is visible/removable and safely resolved;
- model cannot mutate plan/files;
- proposal cannot change plan before Apply;
- Apply is atomic and revision-checked;
- stale proposals cannot overwrite edits;
- Undo restores checkpoint or reports conflict;
- process termination at any Apply/Undo save/finalize boundary is reconciled by
  the durable hash journal without overwriting a third document state;
- panel works at supported widths and accessibility modes;
- logs/SQLite contain no secrets or raw image content;
- normal Preshot behavior remains unchanged.

## Deferred work

- Require Responses API; no silent Chat Completions fallback.
- Use concise collapsed reasoning summary.
- Generate session title after first completed turn; allow rename.
- Omit currency budget unless reliable cost data exists.
