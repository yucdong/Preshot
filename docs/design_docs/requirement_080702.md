# Component card design

## Cards can be freely dragged vertically and horizontally, image aspect ratios can be changed, and later images should be able to backfill gaps conveniently; aspect ratios are unrestricted.
## The outer card border must contain the internal image area, text area, and other elements, with appropriate padding. It should not show a separate gray header bar like the current version. Instead, the whole unit should behave as a single card. When long-pressed and selected, its color changes. Image areas, buttons, and text all sit one layer above the card itself, and all of them must remain inside the image frame.
## Remove the Hide button from the text box above the reference image card. When rendering, if there is no text, simply do not render it.
## Place image size and +/- buttons on the left as well, to make it easier to adjust the size of a whole image set consistently.
## Remove the per-image caption feature from the reference image card. We only need a leading description label called "Group introduction" in the text section of the reference image card, and then users can fill it in freely.
## If a reference image card does not have enough room to display on the current page, move the entire card directly to the next page and leave blank space on the current page.
## When changing image size, if an edge aligns with a neighboring element, show a hint to help alignment. The same applies when changing card size.
## When moving a card component, do not scale proportionally. Card width and height can be dragged independently, but internal elements such as text and images should not be resized directly; they can be reflowed in response to card changes.
## When the card size changes, the internal text boxes, images, and buttons should also move accordingly inside the card.
