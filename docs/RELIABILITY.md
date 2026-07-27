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