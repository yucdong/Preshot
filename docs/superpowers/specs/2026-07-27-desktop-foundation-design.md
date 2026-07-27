# Preshot Desktop Foundation Design

## Goal

Create a Windows-first desktop application foundation for planning photography
projects. This iteration establishes the architecture, tooling, documentation,
tests, and onboarding workflow without implementing image import, canvas
editing, persistence, or PDF export.

## Technology

- React and TypeScript on Vite for the UI.
- Tauri v2 for the Windows desktop shell and native capabilities.
- Tailwind CSS for styling.
- Konva.js and react-konva as the selected future canvas engine.
- pdf-lib as the selected future PDF generation engine.
- pnpm for JavaScript package management.
- Rust and Cargo for the Tauri backend.

The repository remains a single application package. A monorepo is deferred
until shared mobile packages are needed.

## Architecture

The frontend uses capability-oriented modules with explicit dependency
direction:

1. `src/app` owns application startup, providers, routing, and the shell.
2. `src/features` owns feature-facing UI for canvas, assets, copywriting, and
   export.
3. `src/domain` owns platform-independent models, interfaces, and use cases.
4. `src/infrastructure` implements persistence, PDF, and platform adapters.
5. `src/shared` owns reusable UI primitives and general utilities.

Feature UI calls domain use cases. Domain code depends only on TypeScript
interfaces. Infrastructure implements those interfaces and is the only
frontend layer allowed to call Tauri APIs. Rust commands expose narrowly scoped
file-system and desktop capabilities rather than business logic.

This boundary allows domain code to move into a shared package when mobile
clients are introduced.

## Initial Application Shell

The runnable application contains a top bar, a left feature navigation area,
and an empty workspace. These elements prove that React, Tailwind, and Tauri
are integrated. Navigation items may identify future capabilities but must not
simulate completed workflows.

The foundation defines platform-independent project concepts such as
`Project`, `Board`, `Asset`, and `TextBlock`, together with interfaces such as
`ProjectRepository`, `PdfExporter`, and `DesktopFileSystem`. No database or
state-management dependency is introduced in this iteration.

## Data Flow

Future interactions follow this path:

`React UI -> domain use case -> domain interface -> infrastructure adapter`

Adapters either perform browser-safe work or invoke a typed Tauri command.
Tauri commands return serializable data and contextual errors. UI code does not
access native commands directly.

## Error Handling

Infrastructure failures must retain operation context and surface as explicit
domain or adapter errors. The application shell includes an error boundary for
unexpected rendering failures. Invalid setup and build prerequisites fail with
actionable messages; no operation silently reports success or substitutes
placeholder data after a failure.

## Testing

- Vitest runs unit and component tests.
- React Testing Library and jsdom test user-visible component behavior.
- Playwright runs a browser-shell smoke test for the critical startup path.
- Cargo runs Rust unit tests.
- ESLint and TypeScript provide static validation.

The standard commands are `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm test:e2e`, and `pnpm build`. Tests should favor domain logic and public
component behavior over implementation details.

## Windows Initialization

The repository provides a root PowerShell script named `init.ps1`. It checks
for Node.js, pnpm, Rust, Cargo, and the Microsoft Edge WebView2 runtime before
installing dependencies. Missing prerequisites produce an actionable error and
a non-zero exit code. A successful run leaves the project ready for the
documented development command.

## Documentation

- `README.md` explains the product, prerequisites, initialization, development,
  tests, and desktop builds.
- `AGENTS.md` documents repository structure and contribution constraints in
  no more than 200 lines.
- `docs/ARCHITECTURE.md` defines dependency boundaries and extension points.
- `docs/TESTING.md` defines test scope, commands, and conventions.

## Acceptance Criteria

1. A clean Windows checkout can be initialized with `init.ps1`.
2. The React UI runs in both Vite and Tauri development modes.
3. The production frontend and Tauri application build successfully.
4. Linting, type checking, Vitest, Playwright, and Cargo tests are configured
   and pass.
5. Architecture and testing guidance match the implemented repository.
6. `AGENTS.md` is no longer than 200 lines.

## Deferred Scope

Image ingestion, freeform canvas manipulation, project persistence, PDF
generation, undo/redo, autosave, cloud synchronization, and mobile clients are
explicitly deferred to later feature specifications.
