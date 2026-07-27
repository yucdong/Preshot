# Architecture

## Goals

Preshot targets Windows desktop first, keeps project work local and
offline-capable, isolates native APIs, and preserves a path to future Android
and iOS clients.

This foundation intentionally avoids choosing persistence and global state
management before the first real workflow needs them.

## System Shape

```text
React application
  |
  +-- app -------- startup, providers, layout, failure boundary
  +-- features --- canvas, assets, copywriting, export
  +-- domain ----- models, use cases, platform ports
  +-- shared ----- reusable UI and general utilities
  |
  +-- infrastructure -- browser and Tauri adapters
                               |
                               v
                         Tauri commands
                               |
                               v
                      Windows native services
```

The dependency direction is:

```text
app/features -> domain <- infrastructure
      |                       |
      +--------> shared <-----+
```

`domain` does not depend on React, Tauri, a browser, or a storage engine.

## Frontend Areas

### `src/app`

Owns application startup and composition. It wires feature UI to use cases and
adapters. The error boundary is a final guard for unexpected render failures,
not a replacement for normal error states.

### `src/features`

Each capability owns its UI, local orchestration, and feature-specific tests.
Planned capabilities are canvas, asset ingestion, copywriting, and export.
Create a feature directory only when that capability is implemented.

### `src/domain`

Contains pure TypeScript models and ports. `Project`, `Board`, `Asset`, and
`TextBlock` define the initial planning vocabulary. `ProjectRepository`,
`PdfExporter`, and `DesktopFileSystem` define future integration boundaries.

### `src/infrastructure`

Implements domain ports. This is the only frontend area allowed to import
`@tauri-apps/api`. Adapters add operation context to native or browser errors
before returning them to callers.

### `src/shared`

Contains reusable UI primitives, testing setup, and general utilities. It must
not contain feature rules or platform integration.

## Native Boundary

`src-tauri` owns the application window, capabilities, and narrow Rust
commands. Command arguments and results must serialize cleanly. Native code
should handle operating-system concerns, while business decisions remain in
the domain layer.

The current `platform_info` command and its TypeScript adapter demonstrate the
boundary. Add permissions only when a command requires them; keep Tauri
capabilities least-privilege.

## Future Capabilities

- Canvas UI belongs in `src/features/canvas`; Konva-specific code stays behind
  feature-facing interfaces.
- Asset selection and native file reads use a domain port implemented in
  `src/infrastructure/desktop`.
- Copywriting remains a platform-independent domain capability.
- Project persistence implements `ProjectRepository` without changing feature
  consumers.
- PDF generation implements `PdfExporter` with pdf-lib and receives a domain
  project rather than reading UI state directly.

## Mobile Evolution

Do not create a monorepo preemptively. When the first mobile client starts,
extract platform-independent domain models and use cases into a workspace
package. React UI and platform adapters remain client-specific.

## Error Flow

Expected failures travel from adapters to use cases and then to explicit UI
states. Adapters retain the failed operation and original cause. Unexpected
render failures reach `ErrorBoundary`, which displays a recovery message and
logs the diagnostic context.
