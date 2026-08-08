# Reference Group Image Scaling

## Goal

Add a compact whole-group image-height control after the import and capture buttons. It scales all image frames proportionally, lets the card border converge to the new packed rows, and allows the A4 document flow to move the card to another page or back into an earlier page.

## Control

- Location: reference title toolbar, after Add Image and Scissors.
- Visual: minus button, current average frame height in points, plus button. No slider is rendered.
- Minimum: 24pt. Every click changes the target average by exactly 4pt.
- Maximum: the largest 4pt-stepped average frame height whose complete title/introduction/image layout fits one printable A4 content page.
- Accessible names: `减小整体图片高度` and `增大整体图片高度`.
- Empty groups or missing mutation callbacks disable both buttons; the minus button disables at 24pt and the plus button disables at the calculated maximum.

The slider value is the arithmetic mean of current `frameHeight` values. On commit:

`scale = target average height / current average height`

Every image receives:

- `frameHeight = round(frameHeight * scale, 0.001pt)`
- `frameWidth = round(frameWidth * scale, 0.001pt)`

This preserves each image's current frame ratio and relative size compared with other images.

## Commit

- Each click commits one group mutation and immediately repacks slots.
- One click creates one coalesced history entry and uses the normal auto-save pipeline.
- Invalid, zero, or 1x scales preserve object identity.

## Card And Page Flow

After commit, `normalizeReferenceContinuations` recalculates exact natural card height from title controls, introduction, and final packed image-row bottom. `layoutDocumentFlow` then recomputes page placement. Shrinking may pull the component onto an earlier page; enlarging may move it to the next page or invoke existing continuation behavior.

## Verification

- Pure reducer tests prove all frame dimensions receive one factor and ratios are unchanged.
- Component tests prove toolbar order, live slot reflow, and one-shot commit.
- Provider tests prove whole-group undo/redo and persistence.
- Domain flow tests prove scaling can reduce a two-page layout to one page.
- Playwright proves slider scaling shrinks the card and survives reload.
