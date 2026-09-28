# Preshot documentation

Start with the [Chinese overview](../README.md) or [English overview](../README.en.md).
These guides describe the current Windows application. Superseded design
proposals and prototypes remain available through Git history.

## Features

| Task | Guide |
| --- | --- |
| Create, open, switch, save, and organize projects | [Projects](features/projects.md) |
| Write a plan and arrange location, model, and prop cards | [Document editor](features/editor.md) |
| Import, paste, capture, crop, and arrange images | [Images and screenshots](features/images.md) |
| Create, search, edit, and reuse materials | [Material library](features/material-library.md) |
| Produce PDF, Word documents, or long images | [Export](features/exports.md) |
| Change language, appearance, and workspace layout | [Settings](features/settings.md) |
| Follow the Nanjing bridge portrait workflow | [Demo and credits](demo/README.md) |

## Development and distribution

| Topic | Guide |
| --- | --- |
| Prerequisites, commands, and test coverage | [Build and test](development/build-and-test.md) |
| Modules, boundaries, and persisted data | [Architecture](development/architecture.md) |
| Saves, ownership, recovery, and undo | [Reliability](development/reliability.md) |
| Chinese/English interface rules | [Localization](development/i18n.md) |
| MSI build, signing, and installation | [Windows installer](release/windows-installer.md) |
| Source commit, tag, and downloadable assets | [GitHub release](release/github.md) |
| Installed 0.0.3 material-library image and dialog findings | [MSI regression report](test_reports/msi-0.0.3-material-library.md) |
| Material-library repair and installed 0.0.5 verification | [MSI repair verification](test_reports/msi-0.0.5-material-library.md) |
| Application and dependency licenses | [Licensing](release/licensing.md) |
| Contributor rules | [AGENTS.md](../AGENTS.md) |
| Release changes | [Changelog](../CHANGELOG.md) |

Update the relevant feature guide when behavior changes, and the architecture
or reliability guide when contracts change. Run `pnpm docs:check` for links
and required documents.
