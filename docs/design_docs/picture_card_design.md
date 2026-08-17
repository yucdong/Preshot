# Picture card design

**Status:** New interaction implemented and validated on 2026-08-13
**Interaction review:** `docs/design_refs/preshot-picture-card-resize-v2.html`

1. Both image groups and individual images resize through transparent hit zones on all four edges and four corners; edges adjust a single axis, corners adjust width and height together.
2. Image groups and image areas do not use a text-input cursor. Images use a draggable cursor, blank gray image-group areas use a draggable cursor, and resize hit zones use the corresponding resize cursor.
3. The image-group property bar sits in the upper-right of the image group, compressed to 30px height, and keeps only type, add image, and delete image group. `− / px / +` or any other size buttons are removed.
4. Do not provide any reset-image-size or reset-original-view capability. The large-image lightbox only supports viewing and closing.
5. Image resize and drag must reuse the existing frame/button/img DOM and must not destroy/recreate image nodes during preview or commit.
6. Holding an image can reorder it within the same image group or move it to another group. Show a live insertion placeholder while dragging; cancel invalid drop targets.
7. Single-click both selects the image and opens the large image. Once drag distance exceeds the threshold, only drag executes and the large image must not open accidentally.
8. When hovering an image, show a delete button near the upper-right area. The delete button must stay clear of the upper-right resize zone and must route through the global confirmation dialog before deletion.
9. Holding the blank gray area of an image group moves the whole group up or down as a TipTap atomic block, swapping document order with text blocks, other components, or other image groups. A light tap on the gray area only selects it.

## Confirmed additions

- A single image has transparent resize hit zones on four edges and four corners; edges resize one axis and corners resize both dimensions, with no blue squares or bars.
- An image group also has transparent resize hit zones on four edges and four corners; edges resize one axis and corners resize both dimensions, and the group frame always stays inside the A4 text boundary.
- Enlarging an image group does not change image size as long as the existing images still fit; only when the group shrinks too far are all images uniformly scaled down.
- When an image size approaches the width/height of nearby images in the same group, it snaps and shows orange alignment guides.
- Clicking an image immediately opens the full original image. The close button, clicking the backdrop, and `Escape` all exit the viewer, and focus returns to the original image.
- The image delete entry appears both in hover state and in the image property bar, and both use the same delete-confirmation flow.
- The image-group property bar keeps only add and delete actions; image-group and image sizes are adjusted entirely through the eight-direction drag hit zones.
- Single-image selection and resize commit must update the existing frame/button/img DOM in place and must not destroy/recreate the entire image set, preventing flicker and image re-decoding during resize.
- Edge resize hit zones remain usable after canvas zoom, stay fully inside the image frame, and cannot be clipped by image-group overflow.
- Selecting an image group only deepens the group background; it does not change border, shadow, or size, and does not draw an outer pseudo-element frame. Selecting a single image keeps its original border and shadow and shows only the two-digit index badge at the top-left.
- Image drag-and-drop and image-group document-flow drag-and-drop both use movement thresholds, lifted original nodes, and same-size placeholders, while the same image DOM remains in use after commit.
- The image content area uses a grab cursor. Images do not need to be preselected; on hover, the four-edge and four-corner resize hit zones are immediately available, and starting a resize auto-selects the image.
- Single-image edge hit zones are 20px inner bands and corner hit zones are 24×24px. The image layer sits above the image-group resize layer to balance usability and accidental-hit prevention.
- The global text cursor of the editor must never apply to image frame/button/img elements. Images do not take pointer events directly; all hits route to the image button with the grab cursor.
- Resizing a single image from the left or top persists signed frame offsets so the dragged edge follows the pointer while the opposite edge stays fixed. For example, dragging the top edge downward moves the image top down while the bottom edge stays put.
- All four edges and four corners of an image group can resize. Dragging the top edge expands upward only into the available space between the previous document block and the image group, and persistent group offset keeps the bottom edge fixed.
- During image-group resize, the group DOM and image layout are not updated. Only a lightweight size preview frame is shown, and final geometry is committed once on pointer release to avoid flicker from repeated ResizeObserver, image layout, and pagination updates.
- Single-image resize uses standard Smart Guides: brand-magenta dashed guides express true edge/center positional alignment, while dimension brackets plus `Equal width` / `Equal height` labels express size matches, replacing the old solid yellow lines.
- At most one positional guide per axis may be shown. Size matching and positional alignment are computed independently, and equal-width matches must not be mislabeled as edge alignment.
- Snap-entry threshold is 6 screen pixels, and snap-release threshold after entry is 10 screen pixels, reducing jitter near boundaries.
- Candidate image edges, centers, and dimensions are frozen at pointerdown so flex reflow during resize does not move the target geometry.
- Resize priority is equal width / equal height first, then outer-edge alignment, then center alignment. All guides and labels clear immediately on `pointerup` / `pointercancel`.
- The `Equal width` label centers itself beneath the width bracket using its own width; the `Equal height` label sits to the right of the height bracket and is vertically centered, without fixed-pixel guesses about label width.
