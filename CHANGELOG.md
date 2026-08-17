# Changelog

All notable changes to Preshot are documented in this file.

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
- JSON-native PDF export with A4 pagination, weighted columns, native images,
  and video/audio fallback labels.
- Deterministic Vitest, Playwright, PowerShell initializer, Rust, and Windows
  installer validation.

### Licensing

- Preshot-authored source is available under the MIT License.
- Builds containing `@blocknote/xl-multi-column` are distributed under
  GPL-3.0 as documented in `THIRD_PARTY_NOTICES.md`.
