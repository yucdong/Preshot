# Projects

[Documentation index](../README.md)

## Create and open

Choose **New project**, enter a parent folder and a project name, and create.
The folder field names the directory containing the new project folder:
`D:\Shoots` plus `Bridge portraits` creates `D:\Shoots\Bridge portraits`.
The default parent is `%USERPROFILE%\.preshot\projects`. The dialog previews
the result; browsing for another parent is optional.

Use **Open project** to register an existing project directory. First startup
on an empty profile copies the complete offline Nanjing bridge
[demo project](../../samples/README.md), including every supported block type,
columns, photographs and media attachments. Existing projects take precedence;
an upgrade never replaces edited content. A project contains `.preshotproj`, copied
reference images in `references/`, and document media in `media/`. Transfer or
back up the whole directory, not just the manifest.

## Switch, save, and close

The sidebar has **Open projects** above **All projects**. Loaded sessions retain
their editors, images, undo history, and scroll position in memory. Switching
does not reload them. Initial image loading uses up to four concurrent jobs;
the editor appears as soon as it is ready.

Edits save automatically; **Ctrl+S** saves explicitly. Closing a project prompts
**Save and close**, **Close without saving**, or **Cancel**. Save failures keep
the session open. Discarding pending edits does not undo already saved work.

All-projects icons display the first two characters of the project name. The
overflow menu offers **Open project directory**, **Copy project**, and **Delete
project**. Deletion has two choices:

- **Remove from list** saves/closes the open session and unregisters the project.
  Files remain on disk and can be opened again.
- **Delete from disk** shows the full folder path and requires a second, explicit
  confirmation. It deletes the entire folder, including images, exports and other
  files, and removes its list entry. This is permanent. Open sessions finish pending
  work and save before closing; retirement cannot recreate deleted files.

Deletion failures remain visible and retryable; a failed deletion does not remove
the list entry. Native deletion validates the manifest identity, refuses linked
project roots and never follows links into other directories. The global
[material library](material-library.md) is stored separately.

## Copy a project

In **All projects**, choose **⋯ → Copy project**. The dialog shows the source
name and full path. Choose the **parent directory** that will contain the new
project folder, then enter its name; the final path updates as you type. The
default is a sibling named `<source> - Copy` (localized), with numbered suffixes
when necessary. Existing destination folders are never overwritten.

An open source first commits text/card drafts, waits for media imports and saves.
Its editor is held read-only during copying, then resumes with its history intact.
The copy opens automatically alongside the source. Closed and background projects
can also be copied. Save failures stop the operation and preserve dialog inputs.

The independent copy retains blocks, columns, component identities, layouts,
crops, image order, referenced original images, media attachments and the cover.
It gets a fresh project identity, name, timestamps and document title; ordinary
headings and text are untouched. Local files are streamed without decoding or a
fixed byte cap. Equal-content files with distinct paths remain distinct, and a
shared reference to one file stays shared within the copy. HTTP(S) media URLs and
ordinary hyperlinks remain unchanged and still depend on their original hosts.

Exports, caches, undo history, recovery logs, unused files and the global material
library are excluded. Inserted material content already belongs to the project
and is included. Moving or deleting the source does not break copied local assets.

Progress and cancellation stay in the same dialog. Cancellation removes only
owned staging files and does not undo a successful source save. Missing originals,
changed sources, invalid names, linked paths and destinations inside the source
are rejected. Publication happens only after the complete manifest and referenced
files are written and checked. Durable operation receipts recover interrupted or
uncertain results. If list registration fails, retry registers the existing copy;
if opening fails, the completed folder and list entry remain available.

See the [copy acceptance report](../test_reports/project-copy-acceptance.md).
