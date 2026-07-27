# AGENTS.md

## Purpose

Preshot is a Windows-first desktop application for photography planning. The
current repository is an engineering foundation; image ingestion, canvas
editing, persistence, and PDF export are deferred.

## Repository Map

- `src/app`: React composition root, error boundary, and desktop layout.
- `src/features`: feature UI and orchestration, added as capabilities ship.
- `src/domain`: platform-independent models, ports, and use cases.
- `src/infrastructure`: implementations of domain ports and all Tauri calls.
- `src/shared`: reusable UI, utilities, and test setup without business rules.
- `src-tauri`: narrow Rust commands and Tauri configuration.
- `e2e`: Playwright browser-shell smoke tests.
- `docs`: architecture, testing, design specifications, and plans.
- `init.ps1`: Windows prerequisite checks and dependency setup.

## Dependency Rules

1. `app` and `features` may depend on `domain` and `shared`.
2. `infrastructure` may implement interfaces declared by `domain`.
3. `domain` must not import React, Tauri, browser APIs, or infrastructure.
4. Direct `@tauri-apps/api` imports are allowed only in `src/infrastructure`.
5. Rust commands must be serializable, narrowly scoped, and free of UI or
   business rules.
6. `shared` must not become a catch-all for feature-specific behavior.

The intended flow is:

```text
React UI -> domain use case -> domain port -> infrastructure adapter
```

## Canonical Commands

```powershell
pnpm dev
pnpm tauri:dev
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
cargo test --manifest-path src-tauri\Cargo.toml
pnpm build
pnpm tauri:build
```

Run `.\init.ps1` on a new Windows checkout.

## Development Workflow

- Use pnpm; do not add npm or Yarn lock files.
- Write a failing test before production behavior, then implement the smallest
  passing change.
- Co-locate Vitest files as `*.test.ts` or `*.test.tsx`.
- Put browser startup flows in `e2e`.
- Add Rust unit tests beside native logic in `src-tauri/src`.
- Run the smallest relevant test first, then the complete validation matrix.
- Keep files focused on one responsibility and preserve the layer boundaries.
- Do not add a monorepo until a real mobile client requires a shared package.

## Error Handling

- Preserve operation context when adapting infrastructure failures.
- Surface actionable failures; never silently return success-shaped fallback
  data.
- Let the application error boundary handle only unexpected rendering errors.
- PowerShell scripts must use non-zero exit codes and actionable messages.
- Avoid broad catch blocks unless they add context and rethrow or terminate.

## UI and Platform Notes

- Tailwind is the styling system.
- Konva/react-konva is reserved for the canvas feature.
- pdf-lib is reserved for the PDF export adapter.
- Feature UI must not pretend deferred workflows are functional.
- Tauri capabilities should remain least-privilege.
- Keep domain contracts portable so they can later move to a shared mobile
  package.

## Testing Expectations

- Domain tests cover pure behavior without browser or native mocks.
- Component tests assert accessible, user-visible behavior.
- Mock only platform boundaries such as Tauri `invoke`.
- Playwright remains a small smoke layer rather than duplicating component
  coverage.
- Avoid snapshots for dynamic canvas output.
- Add a regression test before fixing a defect.

See `docs/ARCHITECTURE.md` and `docs/TESTING.md` for detailed guidance.
