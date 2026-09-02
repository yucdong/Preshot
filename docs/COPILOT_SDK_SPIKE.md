# Copilot Rust SDK Dependency Spike

## Decision and provenance

Preshot pins the released crate `github-copilot-sdk@1.0.11` exactly. The
review compared that published package with the local authoritative
`github/copilot-sdk` checkout at commit
`72de60fc0fcc203b7ab918ed1ec1bd66e1b59e77`. The published crate has:

- crates.io checksum
  `68e64592681b206e19d9bcd5b96e7cac2851fa5144df224a990b1158735d1a63`;
- minimum Rust version `1.94.0`, compatible with Preshot's reviewed Rust
  `1.97.1`;
- MIT license;
- bundled GitHub Copilot CLI release/archive and Windows file version
  `1.0.79`;
- CLI `--version` output `GitHub Copilot CLI 1.0.81-7`;
- Windows x64 CLI archive SHA-256
  `ae87705442b502853374a58938ca48309b44ad1aef201e3de56b9ff89fe3b6bd`.

The stable release is used instead of the newer `1.0.12-preview.0` available
at the time of review. No absolute checkout path or Git dependency is present
in `Cargo.toml` or `Cargo.lock`.

The CLI version strings differ inside the upstream artifact. The downloaded
archive matches the SDK's pinned SHA-256, its Authenticode signature is valid
for `GitHub, Inc.`, and its Windows file/product version is `1.0.79`, while
executing that same unchanged file with `--version` prints `1.0.81-7`. The
release/archive pin remains the dependency identity; both values are recorded
as provenance.

## Runtime boundary

Only the `bundled-cli` feature is enabled. `bundled-in-process` is explicitly
disabled, and `ManagedCopilotService` always selects `Transport::Stdio`.
The dependency spike is now the foundation for the production native runtime
in `src-tauri/src/agent`. The runtime exposes only typed model/session/event
commands; it does not expose generic HTTP, filesystem, process, Git, MCP,
plugin, skill, or remote-session commands to the renderer.

The service starts the SDK with `ClientMode::Empty`, disables ambient login,
and removes inherited token variables from the child. It places state and the
versioned extracted executable under the caller-supplied `.preshot` root:

```text
.preshot\copilot\
.preshot\copilot\bin\1.0.79\copilot.exe
```

The health path starts the managed child, verifies the SDK protocol during
startup, sends a `ping`, and calls the SDK's cooperative `stop`. It reports
success only after the SDK has reaped the child handle; timeout or shutdown
errors trigger `force_stop` and are surfaced.

`ManagedCopilotService::empty_session_config` is the production session baseline.
It supplies an empty tool allowlist and empty MCP map, disables config and
instruction discovery, skills, hooks, host Git operations, session storage,
telemetry, coauthoring, and scheduling, and enables no custom agents,
directories, plugins, or tools. The SDK additionally applies Empty-mode
defaults that strip environment context, disable memory and experimental mode,
use in-memory credential/cache storage, clear installed plugins, and disable
the process-wide keychain.

`AgentRuntimeService` starts the shared client lazily, health-checks it before
SDK operations, restarts a crashed child, and requires affected sessions to be
resumed with their complete provider/tool/handler configuration. Application
shutdown uses bounded cooperative session/client cleanup and force-stops the
child if the client exceeds its deadline.

Every production create and resume uses `ClientMode::Empty`, a source-qualified
allowlist containing only:

- `custom:get_project_summary`;
- `custom:read_text_blocks`;
- `custom:list_reference_images`;
- `custom:propose_text_block_edits`.

Configuration discovery, custom instructions, built-ins, built-in agents,
tool search, MCP/MCP Apps, plugins, skills, memory, session store, hooks, Git,
remote/cloud sessions, telemetry, extensions, canvases, and additional
directories are disabled. Resume always sets `continue_pending_work` to
`false` and re-supplies the keyless OpenAI Responses provider, custom tools,
and interaction handlers.

Model discovery is a bounded native `GET <apiBaseUrl>/models` with redirects
disabled. Provider URLs accept loopback HTTP or remote HTTPS only and require
the canonical `/v1` root derived from the display URL. Compatibility testing
uses a temporary SDK session and requires streaming, a strict no-op custom
tool round trip, a terminal nonce response, and cleanup. The optional image
probe uses the bundled one-pixel test PNG rather than project or user content.

Session events stream through a bounded Tauri `Channel` with stable SDK event
IDs, request/session correlation, sequence numbers, and replay metadata.
Payloads are normalized to messages, user-visible reasoning summaries, tools,
permissions/input, usage/context, compaction, idle, errors, and task
completion. Opaque/encrypted reasoning fields are never forwarded.

## Build cache and verification

The SDK downloads and checksum-verifies the pinned CLI archive while compiling.
Repository Cargo configuration sets `BUNDLED_CLI_CACHE_DIR` to the ignored
`.preshot-build-cache\copilot-cli` directory so normal Cargo, Tauri, and
production builds share the verified download. CI may override
`BUNDLED_CLI_CACHE_DIR` with an external persistent cache; the key must include
the target OS/architecture and CLI version. Do not set
`COPILOT_SKIP_CLI_DOWNLOAD` for distributed builds.

Run the no-model/no-proxy Rust coverage with:

```powershell
cargo test --manifest-path src-tauri\Cargo.toml copilot::tests
```

The lifecycle test extracts the bundled executable into a temporary
`.preshot`, starts it without ambient authentication, pings it, and confirms
the managed process was stopped. To include local replay-proxy readiness at
`http://localhost:4141`, start that proxy and run:

```powershell
cargo test --manifest-path src-tauri\Cargo.toml managed_cli_local_proxy_smoke -- --ignored --nocapture
```

The ignored test fails before starting the CLI unless the endpoint accepts an
HTTP request.

## MSI size and signing

The CLI archive is linked into `preshot.exe`; it is not a separate WiX file or
sidecar. The CLI license, SDK license, and third-party notice are ordinary MSI
resource files. Against the immediately preceding local x64 release artifacts,
the spike changed:

| Artifact | Before | After | Delta |
| --- | ---: | ---: | ---: |
| `preshot.exe` | 23,920,640 bytes | 124,749,312 bytes | +100,828,672 bytes (+96.16 MiB) |
| `Preshot_0.0.1_x64_en-US.msi` | 16,629,760 bytes | 117,280,768 bytes | +100,651,008 bytes (+95.99 MiB) |

The MSI `File` table contains all three notice resources. These local
artifacts are unsigned and remain non-publishable under the existing release
policy. Record a new exact before/after comparison when either dependency is
updated because the upstream payload can change.

The existing production order remains required: sign the final
`preshot.exe`, build the MSI from that signed executable, then sign the MSI.
The extracted `copilot.exe` is the unmodified, checksum-verified payload
embedded by the SDK; Preshot does not modify or separately re-sign it. Any
future switch to a sidecar would require an explicit WiX component, independent
signature verification, and installer contract updates.
