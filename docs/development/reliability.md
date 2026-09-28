# Reliability and ownership

[Documentation index](../README.md)

Preserve operation context in failures. Workspace/media actions must not
return success-shaped fallback data. Only settings use default recovery.

Loaded projects own separate editors, images, history, scroll, and autosave.
Closing pauses autosave during the save/discard/cancel prompt; failed saves
keep the session open.

Every image import/paste owns a new file and identity. Equal pixels do not
merge ownership. Clipboard commands accept bounded bytes and metadata, never
source paths. The isolated decoder starts before application initialization.
Project image paste uses prepare/commit/status/abort receipts. Publish only
after native manifest commit. Undo retains required files; retained-image
crops are copy-on-write. Serialize media with its owning block identity.

Image dragging is an immutable preview excluded from autosave/history/export.
Resolve the latest physical target at release. A valid drop commits once;
release outside cancels. Preserve keyboard focus and cancellation.

Library originals are independent. Insertion allocates fresh IDs, copies only
selected originals, commits the complete manifest, then publishes one undo
action. Pin selected IDs, mode, target group, and versions in exact receipts.
Editing owns a structurally locked draft; metadata/content save atomically
with both pinned versions. Unknown outcomes retain frozen retry intent and
sources. Post-commit preview/cleanup failures must not repeat the save.

Capture cancellation drains the operation and removes its temporary PNG;
late cancelled results cannot enter a document. Permanent material deletion
requires recycle-bin membership and matching versions. Durable purge receipts
preserve shared assets, live drafts, history, and inserted project copies.

Exports validate/decode local assets and retain crop/fit/frame/order. Long
images obey canvas, memory, byte, and part-count bounds. Native multipart saves
roll back together. Never silently replace the independent PDF/DOCX renderers.

The MSI owns app files and HKCU registration; startup owns user data. Install,
repair, upgrade, and uninstall preserve projects and libraries. Destructive
installer tests run only in disposable VMs. See
[Windows installer](../release/windows-installer.md).
