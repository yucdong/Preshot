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

On Windows, **Win+Shift+S**, then **Ctrl+V** is another way to insert a clipping.
Focus the document or intended gallery before pasting. Text fields retain
normal text selection, IME, and clipboard behavior.

## Groups and editing

Image-group toolbars support local imports, capture, and **Insert from material
library**. The library picker accepts individual images and selected images
from an image-group material.

Select an image for crop, fit, resize, remove, and library actions. Corners
preserve the frame ratio; side edges change width and top/bottom edges change
height. Default fit fills the frame by cropping; stretch is explicit.

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
