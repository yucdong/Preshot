1. Place the Settings button on the Preshot Photography Plan header, in the top-right corner of the outermost layer.
2. Do not show undo/redo buttons.
3. Rename the Photography Plan and Reference Image Group components to "Text" and "Image Group".
4. When inserting Text and Image Group components, the gray area should have a default editable name. Use defaults such as Text 1, Text 2, Image Group 1, Image Group 2, and so on, to avoid duplicate names within the same project.
5. Remove the currently editable-name section from the image group.
6. Show each image's shooting notes by default. They can be hidden, but the note text must still appear when exporting PDF.
7. Rename image height to image size. It can be increased or decreased, but the minimum reduced size becomes half of the current height.
8. Images can be cropped by dragging any side. After cropping, their height should remain consistent with the image group. Record the crop information in JSON. When the pointer hovers over the image, show a button to restore the original size. Clicking an image should display the full image at full size, and after clicking, the top-right control should show × instead of a Close label.
9. After a component width changes, it does not automatically merge into the previous row; the user must move it manually. A component can be dragged into another row only if its width can fit there. Otherwise, the user must resize it first and then move it.
10. Place Export PDF at the top-right of the canvas. Use a relatively prominent color, but keep it in the same palette and compatible with both light and dark themes.
11. The outer border of cards is not visible enough in dark mode, and the same issue exists in light mode. Make it more prominent. Every card should have an outer border, possibly dashed. Internal images and text can use slight elevation or shadow styles. Keep spacing between components and between components and the canvas border, and keep those distances relatively consistent.
12. The whole canvas should have a title area. Put it at the top-left by default, keep it modest in size, default it to the project name, but allow it to be edited independently from the project name.
