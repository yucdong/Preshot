# Projects

[Documentation index](../README.md)

## Create and open

Choose **New project**, enter a parent folder and a project name, and create.
The folder field names the directory containing the new project folder:
`D:\Shoots` plus `Bridge portraits` creates `D:\Shoots\Bridge portraits`.
The default parent is `%USERPROFILE%\.preshot\projects`. The dialog previews
the result; browsing for another parent is optional.

Use **Open project** to register an existing project directory. First startup
provides an editable starter project. A project contains `.preshotproj`, copied
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
overflow menu reveals the directory or removes the project from the list.
Removing a list entry does not delete project files. The global
[material library](material-library.md) is stored separately.
