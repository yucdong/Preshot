# Remove Project Rail Actions

## Goal

Keep project-rail entries visually stable on hover and keyboard focus by
removing the project action overlay entirely.

## Design

Project entries continue to show their cover, name, update date or unavailable
state, and remain selectable. They no longer render **Open project directory**
or **Remove project** controls on hover or focus.

Remove the overlay rather than hiding it with CSS so no invisible controls
remain in the keyboard tab order. Clean up `AppShell` props, state, icons, and
confirmation-dialog logic that existed only for these controls. Remove the
corresponding callback wiring from `WorkspaceProvider`.

The workspace launcher's existing project removal flow remains unchanged.
Project persistence, project selection, and assistant project-switch behavior
are outside this change.

## Testing

Update the focused `AppShell` component test to assert that neither project
action is rendered while project selection remains covered by the existing
test. Run the focused component suite and TypeScript type checking.
