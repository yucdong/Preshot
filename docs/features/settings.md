# Settings and layout

[Documentation index](../README.md)

The top-right settings button offers **Simplified Chinese / English** and
**System / Light / Dark** appearance. Changes apply immediately and persist
across desktop restarts.

Changing language does not rewrite project names, document text, material
descriptions, tags, or photographs. Open editors retain their undo history.
Windows capture controls follow the operating system language.

Drag the project-rail separator to resize it; double-click to reset.
Keyboard arrows also resize the separator. The width persists. **Focus mode**
hides the rail to maximize document space; the side control can reopen it.

Preferences live in `<working directory>/settings.json`. Missing or corrupt
settings recover to defaults. See [Localization](../development/i18n.md).
Project groups and collapse states live separately in `workspace.json` within
the same working directory; invalid project metadata does not reset to defaults.

## Storage locations

On first launch, choose the **Project working directory**. It defaults to
`%USERPROFILE%\.preshot`; use the text field or folder picker to select an empty
local directory or an existing Preshot data directory. The exact chosen folder
contains settings, the project registry, default `projects` and `library`.
Existing data is retained in place; choosing another empty folder does not move it.

The first-launch page contains only this directory choice. Application and
library locations are not shown there; library subfolders are managed by Preshot.
When existing data or an older saved working directory is detected, choose
**Keep existing directory** or **Change working directory**. Switching requires
a second confirmation showing both paths: previous materials, preferences and
registered projects will not appear in the new workspace. Old files remain on
disk and are not migrated or merged. An existing destination uses its own data.

The app remembers the choice in `%USERPROFILE%\.preshot\profile.json`. Later
launches and reinstalls reuse it after confirmation. Older locators receive this
choice once; later launches do not prompt again. Settings shows the working, application and
library directories with open-folder buttons. Uninstall removes only software.
If a saved drive is missing, reconnect it and click **Check again**; the app does
not create a replacement library. Back up the locator, complete data directory,
and any projects stored elsewhere.

See [directory ownership and recovery](../development/installation-storage-design.md).
