# Hide Project Path on Hover

## Goal

Do not expose a project's filesystem path when the user hovers or focuses a
project entry in the project rail.

## Design

Remove the path text and its native `title` tooltip from the project-entry
action overlay. Keep the existing **Open project directory** and **Remove
project** buttons in the overlay and align them to the right.

The overlay remains visible on pointer hover and keyboard focus, preserving
access to both actions. Project selection, directory reveal, registry removal,
and project persistence behavior are unchanged.

## Testing

Update the focused `AppShell` component test to assert that the project path is
not rendered while both action buttons still invoke their existing callbacks.
