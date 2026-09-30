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
| Watch separate material creation and management tutorials | [Material videos](demo/material-tutorials.md) |
| Open the complete offline example project | [Bundled sample](../samples/README.md) |

## Development and distribution

| Topic | Guide |
| --- | --- |
| Prerequisites, commands, and test coverage | [Build and test](development/build-and-test.md) |
| 0.0.24 code review, user stories, regression fixes and fresh recordings | [Release review](test_reports/release-0.0.24-review.md) |
| Modules, boundaries, and persisted data | [Architecture](development/architecture.md) |
| Saves, ownership, recovery, and undo | [Reliability](development/reliability.md) |
| Chinese/English interface rules | [Localization](development/i18n.md) |
| Proposed multi-column layout, image sizing and interactive prototype | [Multi-column feasibility](development/multi-column-feasibility.md) |
| MSI build, signing, and installation | [Windows installer](release/windows-installer.md) |
| Configurable installation, retained data, and reinstall recovery | [Installation and storage design](development/installation-storage-design.md) |
| Storage migration, recovery, and machine-wide MSI verification | [Storage and installer acceptance](test_reports/storage-installation-acceptance.md) |
| Simplified first-launch directory choice and existing-data confirmation | [First-launch setup acceptance](test_reports/first-launch-setup-acceptance.md) |
| Source commit, tag, and downloadable assets | [GitHub release](release/github.md) |
| Installed 0.0.3 material-library image and dialog findings | [MSI regression report](test_reports/msi-0.0.3-material-library.md) |
| Material-library repair and installed 0.0.5 verification | [MSI repair verification](test_reports/msi-0.0.5-material-library.md) |
| Installed-app user stories and full workflow acceptance | [Full journey matrix](test_reports/msi-full-journey.md) |
| Large originals, menus, favorites, card regions and image resizing | [Buglist1 acceptance](test_reports/buglist1-acceptance.md) |
| Wide screenshot frames, image deletion and suspicious capture review | [Buglist2 acceptance](test_reports/buglist2-acceptance.md) |
| Mixed block top edges and six-dot handle alignment in columns | [Block alignment acceptance](test_reports/block-alignment-acceptance.md) |
| Independent project copies, cancellation, recovery and large originals | [Project copy acceptance](test_reports/project-copy-acceptance.md) |
| Multi-column implementation, test evidence, and remaining constraints | [Multi-column acceptance](test_reports/multi-column-acceptance.md) |
| Bundled Nanjing sample, installed recording and export verification | [Installed demo acceptance](test_reports/installed-demo-acceptance.md) |
| Under-one-minute blank-project recording with prepared materials | [Short demo acceptance](test_reports/short-demo-acceptance.md) |
| Expanded walkthrough: three-picture cards, two-column props and shooting notes | [Expanded demo acceptance](test_reports/demo-rich-acceptance.md) |
| Historical 0.0.19 installed recording, fresh document and opened PDF | [0.0.19 demo acceptance](test_reports/demo-0.0.19-acceptance.md) |
| Installed 0.0.20 material tutorials and regression results | [Material tutorial acceptance](test_reports/material-tutorials-acceptance.md) |
| Application and dependency licenses | [Licensing](release/licensing.md) |
| Contributor rules | [AGENTS.md](../AGENTS.md) |
| Release changes | [Changelog](../CHANGELOG.md) |

Update the relevant feature guide when behavior changes, and the architecture
or reliability guide when contracts change. Run `pnpm docs:check` for links
and required documents.
