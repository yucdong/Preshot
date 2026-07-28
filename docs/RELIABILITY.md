# Reliability -- Observability, Clean State, and Benchmarking

## Structured Logging

### Overview

All services in the application emit structured JSON log entries. This enables runtime debugging, post-hoc analysis, and automated monitoring of application behavior.

### Log Format

Every log entry is a single-line JSON object:

```json
{
  "timestamp": "2026-03-30T12:00:00.000Z",
  "level": "INFO",
  "service": "document-service",
  "message": "Document imported successfully",
  "data": {
    "documentId": "abc-123",
    "filename": "design-notes.md",
    "sizeBytes": 2048
  }
}
```

### Log Levels

| Level | When to Use | Example |
|-------|-------------|---------|
| DEBUG | Routine data access, file reads | "Retrieved chunks for document" |
| INFO | Significant events | "Document imported", "Batch indexing complete" |
| WARN | Missing but non-critical data | "Content not found for document" |
| ERROR | Failures | "File not found during import" |

### Service Logging Points

**PersistenceService:**
- Directory initialization
- File read/write operations (DEBUG)
- Clean state reset (WARN)

**DocumentService:**
- Document import with size and metadata
- Document deletion with remaining count
- Document metadata updates
- File not found errors
- Size limit violations

**IndexingService:**
- Single and batch indexing start
- Per-document indexing progress
- Batch completion with throughput metrics
- Content not found warnings

**QaService:**
- Question processing start
- Answer generation with confidence and duration
- Feedback submission
- History clear

**IPC Handlers:**
- Every channel invocation (INFO for mutations, DEBUG for reads)
- All registered channels at startup

### Configuring Log Level

Set the `LOG_LEVEL` environment variable:
```bash
LOG_LEVEL=INFO npm run dev  # Only INFO, WARN, ERROR
LOG_LEVEL=WARN npm run dev  # Only WARN and ERROR
LOG_LEVEL=ERROR npm run dev # Only ERROR
```

Default: `DEBUG` (all messages).

## Workspace Service Logging

The Workspace Setup feature emits the structured single-line JSON described above
under the `workspace-service` service name. The logger
(`src/shared/logging/logger.ts`) sanitizes every payload before writing: it drops
sensitive keys (any `*token`, `coverDataUrl`, `stack`, `password`, `secret`,
`authorization`) and bounds string, array, and nesting size, so logs never leak
cover data URLs, rollback tokens, or unbounded values.

### Logging points

| Level | Event | Data |
|-------|-------|------|
| INFO | `Workspace project created` / `opened` / `relocated` / `removed` | `projectId` |
| WARN | `Workspace project unavailable` | `projectId`, `reason` (missing manifest, decode failure, or a manifest ID that does not match the stored record) |
| ERROR | `Workspace project rollback failed` | `projectId`, `reason` |
| ERROR | `Workspace project rollback token forget failed` | `projectId`, `reason` |

The application layer (`WorkspaceProvider`) logs at ERROR when a guarded action or
startup step fails -- for example `Unable to load workspace projects`, `Unable to
open workspace project`, or `Unable to listen for workspace menu actions` -- with
the original error attached as `cause`. Registry reads and writes never fail
silently: the Store adapter and domain service wrap failures with operation
context (`Unable to load workspace metadata`, `Unable to save workspace
metadata`) so they surface as actionable ERROR entries rather than success-shaped
fallback data.

### Native menu logging

The Rust menu layer (`src-tauri/src/menu.rs`) writes the same JSON shape to
stderr under the `workspace-menu` service name. It logs WARN when it ignores an
unknown menu ID or when no focused webview is available to receive an action, and
ERROR when handling a menu route fails.