# Material library

[Documentation index](../README.md)

Open **Material library** from the header or launcher. It is shared across
projects for the current Windows user.

## Create, search, and edit

Five categories are available: **Image**, **Image group**, **Location**,
**Model**, and **Props and wardrobe**. Props and clothing share one category.

Choose **Create material**, choose a category, and fill in the content, name,
description, and keyword tags. Image and image-group materials use only these
shared metadata fields; their image canvas has no separate name or description
inputs. Use the canvas to add, capture, crop, resize, and arrange images.
The first successful save creates the material, closes its editor,
and selects it in the library. Editing an existing material supports repeated
saves without closing. Duplicate names prompt for confirmation without
overwriting another item. Failed or unconfirmed saves retain the draft for retry.

Components can also be saved from document actions; selected images have an
**Add to material library** action. For the portrait demo, create a bridge
location, fictional Model A, a transparent umbrella, and a bubble machine.

Filter by category, names, descriptions, keywords, or favorites. Selecting an
item shows details; full preview starts only after **Preview** is clicked.
Editing owns a separate one-component draft and does not rewrite previously
inserted project copies. Discard removes only edits since the last save.

Local preview images work offline in installed builds. On upgrading from 0.0.3,
outdated thumbnails rebuild automatically as their library results are shown,
one at a time. Original images, content revisions, and metadata stay unchanged.
Full previews still open only when requested.

For an image-group material, **Show original image in folder** is available in
its library details, editor, and full preview. It opens the whole originals
directory without selecting an image. New saves place independent originals in
`%USERPROFILE%\.preshot\library\groups\<material-id>\originals`; renaming a
material keeps that directory stable. Editor access shows saved originals;
save new imports first. A new material must be saved before opening its folder.

Existing image instances are moved into the group directory on first access,
with a resumable journal that preserves identities and receipts. Older shared
hash objects retain their compatibility resolver and gain independent owned
copies in each group's directory. History originals remain available for recovery.
Permanent material deletion cleans only its owned files, including these copies.
Single-image materials also offer this action in details, editor, and full
preview, selecting their sole original in File Explorer without requiring image
selection first. Other material categories keep their selected-image action in
the editor and preview. The original import location is not retained; missing originals report
an error instead of falling back to another copy with identical content.

JPG/PNG originals have **no fixed file-size, batch-byte, draft-byte, width, height,
or total-pixel cap**. Originals are copied and hashed with fixed-size buffers;
source files and resolution remain unchanged. Reusing material images in another
material passes pinned version/image/session identities to native copying, never
original Base64 through the renderer.

Editor and library display use disposable native derivatives (normally up to
2048px; library previews request 1600px). Export requests use frame/crop/output
size, up to 4096px. Background decoding is serialized and cancellable, with a
content-keyed temporary cache. Available system memory and codec support still
determine whether a particular original can be decoded. Preview failure keeps
saved originals and exposes **Retry preview**; it does not resubmit a save.
Clipboard transport, image counts and exported-file limits remain independent.

Libraries migrate transactionally to database v10, retaining positive metadata,
foreign keys, immutable instances and exact historical receipts. New material
payloads use v2; unchanged v1 material content remains readable and insertable.

The detail actions include **Favorite / Unfavorite** with visible state. Updates
pin the metadata version and refresh the current list/filter, preventing a stale
favorite action from overwriting a concurrent metadata edit.

## Insert

Click a document row before opening the library. Insertion occurs after that
row, or at the beginning if no user-positioned cursor exists.

- Image materials insert independent Image blocks.
- Image groups support all images or a selected subset, inserted either as
  one group or as separate Image blocks.
- Opening the picker from a group's toolbar appends to that group.
- Location, model, and prop materials insert complete component cards.

Insertion copies originals into new project files with fresh identities and
forms one undo action. Changes to a material do not change its inserted copies.

## Recycle bin and backup

Deletion first moves items to the recycle bin. Permanent deletion is available
only there and requires confirmation. It preserves existing project copies.
With the application closed, back up `%USERPROFILE%\.preshot\library` in full;
the SQLite database alone does not contain all original images.
