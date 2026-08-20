# Code Review for Preshot 0.0.1

**Scope:** Release hardening of the current BlockNote v14 implementation
**Review date:** 2026-08-17

## Fixed in 0.0.1

| Severity | Finding | Resolution |
| --- | --- | --- |
| High | An immediate project switch or canvas unmount could retire an unsaved BlockNote snapshot without flushing it. | Unmount now queues the latest snapshot before detached image-group and media cleanup. A project load waits for an outstanding retirement of the same path. |
| High | Overlapping saves could complete out of order, allowing an older write to replace a newer write while the UI reported success. | All BlockNote saves and retirement writes are serialized through the project retirement coordinator. A completion marks the plan saved only when its serialized snapshot is still current. |
| Medium | Save failures could leave the status in `saving` and reject without visible feedback. | Save failures restore the `unsaved` state, remain eligible for retry, and display an actionable local error. Keyboard and autosave callers consume the surfaced rejection. |
| Medium | Successful Windows captures left `preshot-capture-*.png` files in the temporary directory because project import copies source files. | The screen-capture port now discards only validated Preshot-owned temporary capture files after import attempts. Native validation prevents deletion of unrelated paths. |

## Intentionally retained

- Schema 13 migration, the legacy browser-storage key fallback, and legacy
  `.preshot` workspace-manifest migration remain active compatibility paths.
- Schema 1-12 canvas migration and temporary v6 paged-export adapters remain
  covered compatibility code, but they are not mounted by the current
  BlockNote v14 application route.
- Historical TipTap design documents and HTML prototypes remain as engineering
  evidence. They are indexed as historical and do not define current behavior.
- The BlockNote packages, including `@blocknote/xl-multi-column`, remain
  aligned at `0.53.0`. A coordinated upgrade is deferred until a matching line
  can be obtained from the approved package source and validated together.

## Deferred

- Broader provider decomposition is deferred beyond the focused hydration,
  toolbar, and interaction-geometry extractions already completed. Additional
  movement in release hardening would increase lifecycle regression risk.
- Queued unmount saves and capture-file deletion protect normal lifecycle
  transitions, but an abrupt process termination can still bypass that
  best-effort cleanup.
- Native capture cleanup is covered at the TypeScript adapter and Rust command
  boundaries; a full packaged-desktop capture journey is not automated.
- The production bundle retains Vite's large-chunk advisory warning.
- Dependency upgrades and persistence schema changes are outside the 0.0.1
  stabilization scope.

## Validation evidence

The release matrix was rerun on 2026-08-17:

- `pnpm docs:check`, `pnpm lint -- --max-warnings=0`, and `pnpm typecheck`
  passed;
- `pnpm test` passed 93 files and 480 tests;
- `pnpm test:init` passed 4 PowerShell tests;
- `cargo test --manifest-path src-tauri\Cargo.toml` passed 51 Rust tests;
- `pnpm test:e2e` passed 15 journeys, and `pnpm test:e2e:blocknote` passed 8;
- `pnpm build` passed with the deferred large-chunk warning; and
- `pnpm tauri:build` produced
  `src-tauri\target\x86_64-pc-windows-msvc\release\bundle\msi\Preshot_0.0.1_x64_en-US.msi`.
