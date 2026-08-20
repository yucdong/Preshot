# Changelog

All notable changes to Preshot are documented in this file.

## [Unreleased]

### Added

- Production first-run workspace bootstrap that idempotently creates the
  user-owned Preshot roots, adopts a valid default-root project, or atomically
  creates and opens one localized schema-14 starter with contention-safe,
  token-authorized rollback.
- A source-controlled Tauri 2.11.4 WiX template for one limited per-user x64
  MSI under LocalAppData, with HKCU registration, fixed major-upgrade family,
  Start Menu default, Desktop opt-in, WebView2 bootstrap, and explicit
  exclusion of project/profile data.
- Production release commands for version synchronization, full validation,
  explicit MSVC x64 MSI builds, signing enforcement, checksums, deterministic
  release manifests, and non-destructive existing-artifact verification.
- Canonical Windows installer operator documentation and packaging,
  bootstrap, documentation, and PowerShell contract coverage.
- Production DOCX export through the exact shared BlockNote schema, official
  ordinary mappings, offline project assets, weighted columns, and the custom
  composited image-group mapping.
- Adjacent PDF/DOCX toolbar actions with independent progress, a cross-format
  concurrency guard, dedicated native `save_docx` atomic writes, default
  `<project>\output.docx`, post-save Explorer reveal, and browser/Midscene
  `output.docx` downloads.

### Licensing

- Open-source distributions that include the BlockNote XL DOCX exporter use
  its `GPL-3.0 OR PROPRIETARY` license through the GPL-3.0 option, matching the
  existing XL package obligations. The underlying `docx@9.6.1` library is MIT.

## [0.0.1] - 2026-08-17

### Added

- Windows-first Tauri workspace with project creation, discovery, recovery,
  settings, and MSI packaging.
- Continuous BlockNote schema 14 document editor with native text blocks,
  tables, columns, image, video, and audio blocks.
- Custom photography image groups with project-managed assets, natural aspect
  ratios, image reordering, resizing, Smart Guides, lightbox viewing, capture,
  deletion, and undo-safe cleanup.
- Pointer-driven block movement, nesting controls, same-row column creation,
  adjustable column widths, and block operation menus.
- Project-local `references/` and `media/` storage that copies source files
  without modifying the originals.
- Autosave, schema 13 to 14 migration, strict schema validation, and explicit
  rejection of schema 1 to 12 projects.
- Production PDF export through the official
  `@blocknote/xl-pdf-exporter@0.53.0` mappings and
  `@react-pdf/renderer@4.3.0`, with A4/24pt geometry, bundled Noto Sans SC,
  weighted columns, native images, real links, tables, and video/audio
  fallback labels.
- Offline project-local preflight, crop-aware image caching, native tall-image
  fitting, and WYSIWYG custom image-group geometry. Groups move intact to the
  next page when possible and scale uniformly only when taller than one usable
  page.
- Explicit rollback-only `pdf-lib` adapter with no silent production fallback,
  plus least-privilege Tauri CSP coverage for React-PDF WASM and self-hosted
  fonts.
- Deterministic Vitest, Playwright, PowerShell initializer, Rust, and Windows
  installer validation.

### Licensing

- Preshot-authored source is available under the MIT License.
- Builds containing `@blocknote/xl-multi-column` or
  `@blocknote/xl-pdf-exporter` are distributed under GPL-3.0 as documented in
  `THIRD_PARTY_NOTICES.md`.
