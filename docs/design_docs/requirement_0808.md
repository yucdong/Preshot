# Project management

When creating a project, tell the user in Chinese to choose a directory where the project should be placed; the project itself will be created as a folder.
If another project with the same name already exists under that parent directory, automatically append suffixes such as (2) and (3) to distinguish the new project.

The default project folder is `.preshot` under the current system user's home directory. When creating a project, open the `projects` directory under that folder by default. All Preshot system-related configuration files are stored under `.preshot`, and all project files are named `.preshotproj`.

## Installation management
Build a Windows installer and produce an `.msi` package. The implemented
installer configures only application files, shortcuts, and HKCU registration
under LocalAppData. The application creates `%USERPROFILE%\.preshot` and its
starter project at startup; the installer never owns or removes that user
data.

# Canvas management

Call the editable center area the canvas.

## Data-driven components

All content on the canvas should be managed through one unified JSON document. This JSON describes component content, placement, referenced images and text, and so on. Define a JSON schema and manage it by version so that loading a project directly loads this JSON plus its underlying assets. This JSON can be stored inside the `.preshotproj` file.

## Component features

1. For the reference image + insertion workflow, support multi-select so multiple images can be inserted in one batch and then laid out automatically.
2. When creating a new project, include one Photography Plan component and one Reference Image Group component by default, and both components should display their component-type names in a relatively small, low-emphasis font.

## Component movement

1. Canvas components can be selected and moved by long-pressing a blank area of their border, not just the small icon in the top-left corner. On hover, indicate that the component can be dragged to move and swap positions with other components, similar to how images are moved inside a reference image group.
2. Images in reference image groups should be larger, with height doubled from the current fixed value. Width is determined by each image itself; landscape and portrait images should all be scaled into a row using that fixed height. If the computed row does not fit, automatically wrap to the next row.
3. Newly inserted components should be placed at the very top by default, and can then be dragged as needed.
4. Do not leave overly large gaps between components. Keep the spacing consistent with the left canvas margin. As component content is added and widened, component layout should update automatically.
5. Before deleting a component by clicking the top-right x, show a confirmation dialog.
6. Components should occupy the full canvas width by default, but users must be able to drag the left/right and top/bottom borders to change size and coordinates, and the result must also be reflected in JSON. Components can also be dragged into the same row, but spacing between them must stay fixed, and that spacing must match the gap between components and the page edge to keep the layout visually balanced.
7. After exporting a PDF, automatically open File Explorer to the folder containing the exported PDF so it is easy to inspect.

## Undo and redo management

We need an undo/redo mechanism. The system should record an appropriate amount of history information to support undo and redo management. Research the available approaches and logic and provide a proposal.

# Style management

Keep the UI styling consistent. Support both dark mode and light mode. Add a Settings entry to the menu bar, and allow selection there. Light mode can use a gray background with dark text; dark mode can use a black background with light text (such as white). Ensure that all text throughout the interface always maintains sufficient contrast against its background.
