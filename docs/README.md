# Documentation Index

This directory contains the English maintenance documentation for the current Preshot implementation.

> The shipped application UI is still Simplified Chinese. These docs describe the implementation in English without changing the product's runtime localization.

## Active release documents

- [Repository overview](../README.md)
- [Contributor guide](../AGENTS.md)
- [Release history](../CHANGELOG.md)
- [Architecture](ARCHITECTURE.md)
- [Testing](TESTING.md)
- [Reliability](RELIABILITY.md)
- [Windows installer operator guide](WINDOWS_INSTALLER.md)
- [Licensing and distribution](LICENSING.md)
- [Copilot Rust SDK spike](COPILOT_SDK_SPIKE.md)

## Active v14 specifications

These canonical files define the current BlockNote v14 behavior:

- [BlockNote v14 design](design_docs/blocknote_v14_design.md)
- [UI/UX contract](design_docs/UI_UX_CONTRACT.md)
- [Feature status tracker](design_docs/featurelist.json)
- [Basic agent design](design_docs/agent/agent_basic_design.md)
- [Deterministic agent eval report](../tests/artifacts/agent-mvp-eval-report.md)

## Historical design and reference material

- The other files in [`design_docs`](design_docs) preserve earlier
  requirements, research, TipTap-era architecture, and interaction decisions.
- The translated
  [schema-v12 UI/UX requirements ledger](design_docs/ui_ux_v12_requirements_history.md)
  preserves the superseded `UIUE-*` requirements and their test mappings.
- [`design_refs`](design_refs) contains historical interactive prototypes and
  screenshots.

This material remains available for traceability, but it is not normative.
When it conflicts with an active release document or v14 specification, use
the active document.

## Reports and verification evidence

- [0.0.1 code review](CODE_REVIEW.md) records the release-hardening review.
- [`test_reports`](test_reports) preserves historical exploratory and visual
  verification reports.

Reports are evidence snapshots rather than active specifications. Current
commands and coverage boundaries are maintained in [Testing](TESTING.md).

## What to update together

When editor behavior changes, update all of the following in the same change:

1. the implementation,
2. the relevant automated tests,
3. the [architecture](ARCHITECTURE.md) and [testing](TESTING.md) docs when behavior or coverage changes, and
4. the active design references above when the accepted interaction contract changes.
