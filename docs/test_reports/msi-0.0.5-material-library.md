# MSI 0.0.5 material-library verification

[Documentation index](../README.md) · [Original 0.0.3 failures](msi-0.0.3-material-library.md)

Tested on 2026-09-28 on the Windows development workstation. The installed
0.0.5 application passes all three reported scenarios: project images saved
to the library display correctly, directly created image materials display
correctly, and the first confirmed creation save closes the editor.

## Repair

- Permit local `blob:` images in `img-src` for full previews. Other CSP
  directives remain unchanged.
- Thumbnail capture uses the already validated offline image data directly.
  Allowing image display alone was insufficient: screenshot capture also
  fetched blob URLs, then produced gray frames under the production policy.
  A real-browser pixel regression reproduced zero image pixels before the
  correction and passes afterward.
- Reject failed rendered images before capture; serialize thumbnail jobs and
  invalidate old renderer keys. Opening library results rebuilds old caches
  without editing material content or original image instances.
- Close a new material after confirmed commit and draft cleanup. Existing
  material saves keep the editor open. Failed or uncertain saves remain
  recoverable; cleanup and thumbnail retries do not resubmit content saves.

0.0.4 was an internal verification build. It exposed the additional thumbnail
capture issue and was not published. The final package is 0.0.5.

## Package and installation

- Source commit: `d95ba2d9ba6cef55d3f6f90ee7ef1fb7fe50d46a`.
- Package: `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/Preshot_0.0.5_x64_en-US.msi`.
- MSI SHA-256: `f30e619011926761c4561c04c4bc515097da6d8e033c1d14dc3cca2f72f002e7`.
- Installed EXE SHA-256: `5cbd14aedf5935e61a0372483cc0908f84d238a02148cb4bf0250e718565193f`.
- Windows Installer exit code: `0`. Installed version: `0.0.5` at
  `%LOCALAPPDATA%\Programs\Preshot\preshot.exe`.
- Installed executable matches the build executable except for Tauri's
  expected `UNK` to `MSI` bundle marker.
- Per-user x64 installer; unsigned local verification artifact. No GitHub
  release or remote push was performed. Publication still requires signing
  and the repository's release checks.

The workstation installation followed 0.0.3, internal 0.0.4, then 0.0.5.
The old-data test restored the isolated reproduction's exact 0.0.3 v4 preview
cache records before launching 0.0.5. Original images and material content
were unchanged. A separate initially empty profile tested first creation.

Both profiles and their WebView2 folders reside under
`.preshot-build-cache/msi-library-regression`. The real user library and
projects were not used. Native mouse input, Unicode keyboard input, and
Windows file dialogs exercised the installed application without mocked
persistence or image loading. The system clipboard was not used. Test app
windows were closed after verification; the installed 0.0.5 application remains.

## Installed application results

| Scenario | Result |
| --- | --- |
| Open two existing 0.0.3 image materials | Both gray thumbnails automatically rebuild with visible images |
| Open each old material's full preview | Model and umbrella images display correctly |
| Select a project image and save it as a new library material | Save dialog closes; thumbnail and full preview display correctly |
| Restart with the upgraded profile | All three thumbnails persist and display correctly |
| Start with an empty library; create Image and import `model-a.png` through the native picker | Image displays in the creation editor |
| Save the new image material | Editor closes automatically; the new material is selected; thumbnail displays correctly |
| Open the newly created material's full preview | Model image displays correctly |
| Reopen the material, edit its description, and save | Editor stays open with saved status and the image visible |
| Close the editor and restart with the fresh profile | Updated thumbnail and material remain available |
| Check both SQLite databases | `PRAGMA integrity_check` returns `ok` |
| Compare the two old materials before and after upgrade | IDs, payloads, metadata, content revisions, storage IDs, and original SHA-256 hashes unchanged |
| Check the new project-image copy | Independent storage instance; content and metadata versions are 1 |
| Check first creation followed by one edit | Exactly one material; content and metadata versions are 2 |

Evidence:

- [Old thumbnails repaired automatically](media/msi-0.0.5/upgraded-thumbnails.png)
- [Newly saved project image in full preview](media/msi-0.0.5/project-material-preview.png)
- [New material before Save](media/msi-0.0.5/before-create-save.png)
- [After Save: editor closed and thumbnail visible](media/msi-0.0.5/created-thumbnail.png)
- [New material full preview](media/msi-0.0.5/created-preview.png)
- [Existing material remains editable after Save](media/msi-0.0.5/edit-stays-open.png)
- [Upgraded library after restart](media/msi-0.0.5/restarted-library.png)
- [Fresh library after edit and restart](media/msi-0.0.5/fresh-restarted.png)

## Automated validation and scope

- `pnpm production:build`: passes documentation, lint, typecheck, all 1,527
  Vitest tests in 174 files, initializer tests, production-script tests, and
  the explicit x64 locked Rust matrix: 312 passed, 5 private subprocess
  fixtures ignored as standalone entries. It then builds and checks the MSI.
- `pnpm i18n:check`: passes.
- `e2e/material-preview-csp.spec.ts`: 2 real Edge tests pass, including actual
  colored pixels in the production thumbnail pipeline under the exact CSP.
- Material creation/image/content-editor Playwright suites: all 17 pass on
  the final source. They cover all five
  categories, duplicate names, cancellation, interrupted-save confirmation,
  editing, imports, simulated capture, and preview flows. Native boundaries
  are injected only in these browser integration tests.

Native UI evidence here covers PNG image materials, old-cache recovery,
project-image saves, creation, editing, and restart. Other categories and
failure/recovery branches have automated coverage; they were not all repeated
manually in the installed app. This is not a clean-VM install/upgrade/repair/
uninstall matrix or a signed-publication certification.

Detailed build, installer and test logs, cache snapshots, data-integrity
checks, and uncropped screenshots remain in the ignored regression directory.
