# Material library

[Documentation index](../README.md)

Open **Material library** from the header or launcher. It is shared across
projects for the current Windows user.

## Create, search, and edit

Five categories are available: **Image**, **Image group**, **Location**,
**Model**, and **Props and wardrobe**. Props and clothing share one category.

Choose **Create material**, choose a category, and fill in the content, name,
description, and keyword tags. The editor uses the same component controls as
the project. Saving creates the material and keeps the editor open. Duplicate
names prompt for confirmation without overwriting another item.

Components can also be saved from document actions; selected images have an
**Add to material library** action. For the portrait demo, create a bridge
location, fictional Model A, a transparent umbrella, and a bubble machine.

Filter by category, names, descriptions, keywords, or favorites. Selecting an
item shows details; full preview starts only after **Preview** is clicked.
Editing owns a separate one-component draft and does not rewrite previously
inserted project copies. Discard removes only edits since the last save.

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
