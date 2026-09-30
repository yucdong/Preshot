# Images and screenshots

[Documentation index](../README.md)

## Add an image

Insert an **Image** block from `/`. Its file panel presents **Upload**,
**Embed**, and **Screenshot** on one row.

- **Upload** imports a local file into the project.
- **Embed** uses an image URL. Local imports are the dependable choice for
  offline work and export; unavailable external URLs cannot be exported.
- **Screenshot** starts Windows region capture. Drag around a screen area;
  the result returns to the image block and is saved with the project.
  **Esc** cancels and releases the operation, allowing an immediate retry.

Nearly uniform black or fully transparent captures open a **Check screenshot**
preview before insertion. Choose **Retake screenshot**, **Cancel**, or **Keep
screenshot** for an intentional dark image. Retaking cleans the previous
temporary PNG before starting another capture. Ordinary photos are not changed.

On Windows, **Win+Shift+S**, then **Ctrl+V** is another way to insert a clipping.
Focus the document or intended gallery before pasting. Text fields retain
normal text selection, IME, and clipboard behavior.

## Groups and editing

Image-group toolbars support local imports, capture, and **Insert from material
library**. The library picker accepts individual images and selected images
from an image-group material.

Batch file imports show a loading bar in the destination group, with the number
of completed images. It stays visible through preview preparation and the final
document update. Repeated imports into that group are disabled until completion;
cancelling the file picker or an import failure releases the controls for retry.
Material content editing also shows a loading bar outside its locked canvas.
Its native batch import reports the selected count, so that bar is indeterminate
until the batch finishes. Loading state is transient and is never saved or exported.

Select an image for crop, fit, resize, remove, and library actions. Corners
preserve the frame ratio; side edges change width and top/bottom edges change
height. Default fit fills the frame by cropping; stretch is explicit.

New gallery imports and captures fit their initial frame to the available width
without changing the original pixels or resolution. Existing saved frames keep
their layout. With an image selected, **Delete selected image** remains available
in the gallery toolbar, including for previously oversized frames. Pressing
**Delete** while the selected image or its controls have focus opens the same
confirmation. Cancel keeps the image; confirmed removal can be undone. Delete
inside a text field continues to edit text.

Drag images to reorder them, including between groups. A valid drop is one
undo action; previews never modify saves or exports. Opening an image displays
a larger preview. Previews and lightboxes support copying; editable galleries
receive pasted images after you select the target.

## Save to the library

Select a document image or an image inside a group and choose **Add to material
library**. Enter a name, description, and searchable keyword tags. Library saves
own independent originals. Imports and pastes also own their project files;
source photos are not moved or edited. Cropping and undo retain required
history files. See [Reliability](../development/reliability.md).

## Original storage and large photos

JPG/PNG file imports have no fixed original byte limit. Native reference imports
stream files; browser-selected desktop Image-block uploads use 1 MiB IPC chunks
and durable owned staging. Only complete originals publish. An uncertain finish
retries the same receipt; cancellation cleans unpublished staging. Originals are
never replaced by display/export derivatives. Preview failure preserves the
original and offers a separate retry.

Single Image blocks use the same eight resize directions and cover/stretch modes
as galleries. A pointer drag previews only and commits one undo step. Escape
restores the frame; Ctrl+Z/Ctrl+Y also work with the image frame focused.
