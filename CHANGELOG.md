# Changelog

## 0.1.0

- Organize projects in flat, collapsible groups with direct create/delete buttons,
  rename, drag-and-drop and a keyboard-accessible move dialog. Localize the
  protected default group while preserving custom names.
- Search project names across every group with literal, case-insensitive matching,
  Unicode highlights and Chinese IME support. Restore saved collapse states when
  clearing the search and retain search across project switches.
- Persist organization in workspace registry v2 with atomic saves, retryable
  failures and a retained v1 migration backup. Grouping preserves project files,
  mounted editors, content and undo/redo history.
- Include the PDF gallery pagination improvements from 0.0.25 and stabilize
  asynchronous image-readiness assertions in workspace/editor regressions.
- Prepare four previously recorded walkthroughs and Chinese launch copy with
  explicit recording-version provenance and media attribution.


## 0.0.24

- Keep Settings above selected-image controls and editor tooltips so modal
  actions cannot change images behind the dialog.
- Keep gallery headers and their controls readable in the dark theme.
- Use a new MSI version for the final installed-app regression run while
  preserving the earlier 0.0.23 acceptance recordings and original-file evidence.

## 0.0.23

- Preserve camera JPEG orientation for new imports, with separate display axes
  and immutable originals; legacy crops retain their original interpretation.
- Cancel unfinished image and card-divider drags safely, sample the final pointer
  position, and keep image fit changes in real editor undo/redo history.
- Recover the material browser's last page after deletion, restoration or
  unfavoriting; protect project/setup dialogs during Chinese IME composition.
- Keep Settings keyboard focus inside its dialog and handle failed folder reveals.
- Keep PDF heading space hints on their document-block wrapper so short following
  content is considered during pagination.
- Preserve foreign files on exclusive-copy collisions and regenerate corrupt
  cached previews from their unchanged originals.
- Remove crop controls from enlarged image previews while retaining canvas
  frame crop-to-fill and stretch controls.
- Expand the Nanjing sample with three location and model pictures, side-by-side
  props and detailed shooting notes; refresh the walkthrough and affected tutorials.
- Keep disposable Playwright output separate from user-authored bug reports.
- Restore image readiness immediately after undoing material-image deletion.
- Exclude generated test and recording files from the development watcher and
  Tailwind content scan to avoid unrelated editor reloads.

## 0.0.21

- Fix native validation rejecting single-image materials and galleries inserted
  as independent images when JavaScript serializes default crop values as integers.
  Preserve exact dimensions, image order, original ownership and closed properties.
- Verify the fix with a native failure regression and installed-app tutorials.
- Bound initializer test subprocess waits and keep helper windows hidden.

## 0.0.20

- Add separate bilingual video tutorials for material categories, creation entry
  points, insertion and library management, recorded from the installed app.
- Make selected text in material metadata fields as visible as selected card
  content, and update interaction regression coverage for current controls.
- Preserve the short blank-project authoring and PDF walkthrough alongside the
  focused tutorial index.

## 0.0.19

- Simplify first-launch setup to one working-directory choice, detect existing
  data, and confirm switching without deleting or migrating the previous data.
- Align block handles and illustrated cards with adjacent content in columns,
  including document zoom and first-row headings.
- Fit newly imported gallery images to available width, keep selected-image
  deletion accessible, and confirm Delete-key removal.
- Offer review, retry and cancellation for suspicious dark or transparent
  screenshots before importing them into projects or material drafts.
- Show progress while importing multiple images into a gallery.

## 0.0.18

- Add independent project copies from All projects, with parent-folder/name
  selection, progress, cancellation, exact retry and interrupted-copy recovery.
- Save open source drafts and pending media before copying; retain its live editor
  and undo history while automatically opening the independent copy.
- Stream only referenced original images, attachments and covers, without fixed
  byte caps; retain columns/layout and external URLs, and exclude exports/history.
- Accept the upstream File block's native properties when saving attachments.
- Keep short illustrated card rows together in PDF pagination so images cannot
  disappear below the page boundary.

## 0.0.17

- Version 0.0.16 was an intermediate local acceptance build.
- Remove fixed JPG/PNG original byte, batch and draft limits in projects and
  materials; stream original copying/hashing and use bounded display/export derivatives.
- Copy images between materials natively with pinned source/session identities.
  Preserve original files when preview generation fails and support preview retry.
- Add favorite controls in material details and improve insert-menu placement,
  scrolling and keyboard access near the viewport edge.
- Add adjustable text/image regions for location and prop/clothing cards, and
  eight-direction Image-block resizing with cover/stretch and single-step undo.
- Persist plan v17/document v5, material payload v2 and library database v10;
  retain earlier document/material compatibility and exact historical receipts.

## 0.0.15

- Choose the project working directory on first launch; keep settings, projects
  and the default material library together and remember the path after reinstall.
- Keep Program Files directory selection in the MSI, add matching logo artwork
  and a finish-page launch option that starts the editor as the desktop user.
- Preserve unavailable data paths with explicit recovery instead of empty replacements.

## 0.0.14

- Add persistent storage configuration and migrate the legacy project registry
  into the user configuration directory without removing its recovery source.
- Add first-launch library selection and bilingual storage settings, with
  verified library copying, interruption recovery, and retained source backups.
- Keep missing libraries/projects registered instead of silently replacing them
  with an empty library or another demonstration project.
- Introduce a new x64 machine-wide MSI family with a configurable Program Files
  destination. Installation requires elevation; the app launches normally from
  the Start Menu. Earlier installer families require uninstall first.
- Preserve user configuration, projects, and materials during uninstall.

## 0.0.13

- Add drag-created multi-column rows with adjustable widths and proportional
  image-group scaling. Preserve columns through save/reopen, undo/redo and exports.
- Bundle a complete offline Nanjing bridge portrait sample with every supported
  block type, illustrated materials, two-/three-column layouts and local media.
- Fix offline TXT/PDF attachment loading and Chinese text wrapping in PDF exports.
- Apply the supplied street-photographer artwork to the app and Windows icons.
- Replace the README walkthrough with a 58-second installed-app recording:
  create a blank project, reuse prepared materials, export/open its PDF, and
  create one pictured material. Include bilingual captions and a matching GIF.
- Versions 0.0.6 through 0.0.12 were local development and acceptance builds.

## 0.0.5

- Fix installed material previews by permitting local blob images in the image CSP.
- Rebuild outdated 0.0.3 thumbnails without changing original images or material
  content; serialize captures and reject rendered images that failed to load.
- Embed validated image data directly in thumbnail captures so the production
  fetch policy cannot drop image pixels. Version 0.0.4 was an internal test build.
- Close newly created materials after a confirmed save and draft cleanup;
  preserve retry/recovery and continued editing of existing materials.
- Add sample images to the walkthrough's model, location, and prop materials.
- Record PDF export followed by opening, paging, and zooming the actual PDF;
  refresh the README video/GIF and include the exported PDF example.
- Keep PDF card descriptions within their text column and keep short cards
  together at page boundaries, while allowing taller cards to paginate.

## 0.0.3

- Use the supplied photographer artwork for the application logo, browser
  favicon, bilingual READMEs, Windows executable, and installer shortcuts.
- Preserve the original artwork and generate native icons from one transparent
  PNG so all branding stays consistent.
- Document creating a Release through the GitHub website.

## 0.0.2

- Chinese and English interface switching, light/dark themes, and focus mode.
- Cached open-project sessions, parallel image loading, and save-on-close prompts.
- Language initialization and changes no longer repeat project startup.
- Single-dialog project creation with an explicit parent directory.
- Screenshot controls beside upload/embed, with cancellation and retry.
- Image materials and flexible image-group selection/insertion.
- Combined props/wardrobe category and library insertion into existing groups.
- On-demand full material previews and improved English category layout.
- PDF, editable DOCX, and long-image export up to the bounded 20,000px height.
- Charcoal photographer logo throughout the application and Windows EXE/MSI.
- Concise bilingual READMEs, feature-indexed documentation, and a bridge
  portrait walkthrough with attributed photographs.

## 0.0.1

Initial desktop planning workspace, local projects, BlockNote editor,
reference galleries, material library, and document export.
