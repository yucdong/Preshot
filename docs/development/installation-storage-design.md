# Installation and persistent working directory

[Documentation index](../README.md)

Implemented in 0.0.15. The MSI installs application files; the application chooses
and initializes user data on first launch. See the
[installer guide](../release/windows-installer.md) and
[acceptance report](../test_reports/storage-installation-acceptance.md).

## Directory ownership

| Purpose | Default | Choice | Uninstall |
| --- | --- | --- | --- |
| Application, icons, fonts, bundled demo | `%ProgramFiles%\Preshot` | MSI directory page | Remove installer-owned files |
| Small per-user locator | `%USERPROFILE%\.preshot\profile.json` | Fixed discovery path | Preserve |
| Working directory | `%USERPROFILE%\.preshot` | First-launch text field or folder picker | Preserve |
| Preferences and registered project paths | `<working directory>/settings.json`, `workspace.json` | Follow working directory | Preserve |
| Material library and original images | `<working directory>/library` | Follow working directory by default | Preserve |
| Default project parent | `<working directory>/projects` | Each new project can choose another parent | Preserve |

Choosing `D:\Photography` uses that exact directory, without adding another
`.preshot` level. Setup asks only for the working directory; other directories
are managed automatically. Settings later displays the resolved locations and
provides open-folder actions. There is no ordinary library relocation control.

## Startup and recovery

1. Resolve the current user's fixed locator location. Until confirmation, do not
   mount preferences, the project workspace, bootstrap the demo or open a library.
2. Validate the selected local directory. Reject protected system/application
   paths, network paths, links, project directories, nested default-profile
   directories and unrelated nonempty directories. Accept the default profile or
   an existing data directory carrying a valid Preshot identity marker.
3. Initialize or validate the library, preserving existing materials and identity.
   Record `.preshot-data-id` before initialization so an interrupted attempt is
   safely retryable. Publish `profile.json` atomically only after successful setup.
4. Mount preferences and workspace using the same root. The default project
   location and copied offline starter demo follow that root.
5. On later starts, verify both the saved path and identity. Missing drives,
   changed identities or corrupt locators stop startup with recovery guidance;
   they never silently create replacement data. Reconnect/restore and retry.

The locator holds schema version, canonical data path, a UUID and an optional
`setupConfirmed` boolean. Older locators without that flag receive one keep/switch
review before mounting the workspace; successful confirmation sets it to true.
Subsequent launches and reinstalls reuse the saved choice without prompting.
It survives
uninstall because it is created by the app and is absent from the MSI tables.
A per-user `.profile.lock` serializes first-run confirmation. Library operations
retain the existing profile/library locks and exact recovery receipt contracts.

## Existing data

Setup detects the saved working directory or legacy data indicators in the default
profile without initializing a replacement library. The dedicated page offers
keeping the detected path or choosing a different one. Switching presents both
paths and explains that previous materials, preferences and the project list
will no longer appear in the new workspace; original files are not deleted,
copied or merged. Native configuration requires explicit switch confirmation,
rejects overlapping source/destination directories and pending library moves,
and publishes the locator only after the destination validates successfully.
Confirmed live profiles cannot switch beneath already mounted editors.

Confirming the default directory reuses settings, projects and materials in
`.preshot`. The old Tauri project registry is imported once without deleting its
source. Choosing a fresh custom directory starts a separate workspace, does not
import the default profile's project registry, and leaves the old data intact.
Existing custom library locations in `storage.json` remain authoritative to avoid
reverting to a stale backup. Legacy interrupted transfers retain their explicit
resume/end recovery; the existing transfer implementation is not deleted.
Automatic whole-profile migration and database merging are outside this change.

## MSI and launch identity

The x64 machine-wide MSI defaults to Program Files and permits directory changes.
Its finish page offers a checked **Launch Preshot** checkbox. The icon, banner and
welcome graphic all derive from `public/preshot-mark.png`; regenerate with
`pnpm icons:generate`.

The finish action invokes `preshot.exe --from-installer`, which exits before Tauri
or profile initialization. A non-elevated client starts normally. An elevated
client obtains the desktop shell user's token and environment and launches the
editor through `CreateProcessWithTokenW`. Failure shows an actionable message;
there is no elevated-editor fallback. Quiet install/uninstall/repair do not
schedule the finish-page action. The MSI never runs data initialization.

The current UpgradeCode remains stable. Earlier installer families retain their
uninstall-first transition; uninstall preserves personal data. Local acceptance
uses a dedicated temporary user-data environment. A broader clean-VM matrix,
including alternate administrator accounts and machines without WebView2, remains
separate from that evidence.
