import type { zh } from "./zh";

type TranslationShape<T> = { [K in keyof T]: T[K] extends string ? string : TranslationShape<T[K]> };

export const en = {
  common: { cancel: "Cancel", delete: "Delete" },
  shell: {
    tagline: "Photography planning", projects: "Projects", openProjects: "Open projects", allProjects: "All projects",
    closeProjectNamed: "Close project {{name}}", newProject: "New project", openProject: "Open project",
    openProjectNamed: "Open project {{name}}", projectUnavailableNamed: "{{name}} (unavailable)", unavailable: "Unavailable",
    resizeProjectRail: "Resize project panel", resizePanelHint: "Drag to resize; double-click to reset",
  },
  plan: {
    exportPdf: "Export PDF", exporting: "Exporting…", loading: "Loading photography plan…",
    loadFailed: "Unable to open this plan. Editing and autosave are disabled to protect your data. Return to the project list and try again.",
    photographyPlan: "Photography plan", shotNotes: "Shoot notes", planPlaceholder: "Shot list, schedule and notes…",
  },
  canvas: {
    documentTitle: "Canvas title", documentTitleEmpty: "Canvas title cannot be empty", componentName: "Component name",
    nameError: { empty: "Component name cannot be empty", duplicate: "Component names must be unique" },
    moveComponent: "Move component", removeComponent: "Remove component", insert: "Insert component",
    insertPlan: "Text", insertReference: "Image group", moveUp: "Move up one position", moveDown: "Move down one position",
    moveUpLabel: "Move up", moveDownLabel: "Move down", resizeLeft: "Resize component left edge",
    resizeRight: "Resize component right edge", resizeTop: "Resize component top edge", resizeBottom: "Resize component bottom edge",
    resizeContentLimit: "Content has reached its minimum size", typePlan: "Text", typeReference: "Image group",
    planCharacterCount: "{{count}} characters", referenceImageCount: "{{count}} reference images",
    deleteConfirmTitle: "Delete this component?", textLeaf: "Text content",
    deleteTextLeafConfirmTitle: "Delete this text block? Adjacent text will fill the remaining space.", textLeafDeleted: "Text block deleted",
  },
  save: { saving: "Saving…", unsaved: "Unsaved changes", saved: "All changes saved" },
  reference: {
    heading: "Reference images", sampleSets: "Photo sets", addGroup: "Add reference group", groupTitleAria: "Group title",
    deleteGroup: "Delete group", groupAria: "Reference group: {{title}}", descriptionAria: "Group description",
    descriptionPlaceholder: "Describe the mood, lighting, styling or other notes…", introductionLabel: "Group introduction",
    addIntroduction: "Add group introduction", addImage: "Add reference image", importImageDescription: "Import images",
    selectImage: "Select reference image {{index}}", openImage: "Open reference image {{index}}", removeImage: "Remove reference image {{index}}",
    imageAlt: "Reference image", loading: "Loading…", importProgress: "Image import progress",
    importProgressText: "Processed {{completed}}/{{total}} ({{failed}} failed)",
    importSummary: "Image import complete: {{succeeded}} succeeded, {{failed}} failed.",
    captureImage: "Screenshot", captureImageDescription: "Screenshot", captureWaiting: "Waiting for screenshot…",
    captureImporting: "Importing screenshot…", cancelCapture: "Cancel screenshot", emptyDropTarget: "Drop images here",
    imageHeight: "Image height", groupImageHeight: "Group image height", decreaseGroupImageHeight: "Decrease group image height",
    increaseGroupImageHeight: "Increase group image height", imageSize: "Image size", cropTop: "Crop image from top",
    cropRight: "Crop image from right", cropBottom: "Crop image from bottom", cropLeft: "Crop image from left",
    resetCrop: "Restore original", resizeImageTop: "Resize image top edge", resizeImageRight: "Resize image right edge",
    resizeImageBottom: "Resize image bottom edge", resizeImageLeft: "Resize image left edge",
    decreaseImageHeight: "Decrease image height", increaseImageHeight: "Increase image height",
  },
  lightbox: { close: "Close image", closeButton: "Close" },
  workspace: {
    intro: "Continue a recent workspace, create a new plan, or open an existing project.",
    menuHint: "The File menu provides the same actions for creating and reopening workspaces.",
    newProject: "New project", openProject: "Open project", loading: "Loading recent projects",
    launcherEyebrow: "Workspace launcher", emptyTitle: "Start your next photography plan",
    emptyBody: "Create a Preshot project or open an existing project on this computer.",
  },
  rail: { recentProjects: "Recent projects", recentProjectsHint: "Continue your recent work without reopening folders.", previous: "Previous projects", next: "Next projects" },
  card: {
    recentProject: "Recent project", unavailable: "Unavailable", coverAlt: "{{name}} cover", openHint: "Open your photography workspace.",
    movedHint: "This project has been moved or is missing.", openAria: "Open project {{name}}", relocateAria: "Locate project {{name}}",
    removeAria: "Remove {{name}} from recent projects", relocate: "Locate project", remove: "Remove from recent projects",
  },
  dialog: {
    eyebrow: "New project", title: "Create a Preshot workspace", projectName: "Project name", projectPath: "Project location",
    choosePath: "Choose folder", projectPathHint: "This is the parent folder. A new folder named after your project will be created inside it.",
    finalPath: "Will create: {{path}}", cancel: "Cancel", create: "Create project", creating: "Creating…",
  },
  picker: { createParent: "Choose the parent folder for the new Preshot project", openProject: "Choose an existing Preshot project", relocate: "Choose a new folder for {{name}}" },
  content: {
    newGroupTitle: "New group", untitledGroup: "Untitled group",
    planTemplate: "<p>Shoot date:</p><p>Location:</p><p>Props and wardrobe:</p><p>Equipment:</p>", captionPlaceholder: "Add shoot notes…",
  },
  settings: {
    open: "Settings", close: "Close settings", title: "Settings", appearance: "Appearance", theme: "Theme",
    themeLight: "Light", themeDark: "Dark", themeSystem: "System", language: "Interface language",
    languageHint: "Applies immediately and is remembered next time. Project and material content is not translated.",
    saveFailed: "Unable to save settings. Your selection is active; try again to remember it next time.",
  },
  history: { undo: "Undo", redo: "Redo" },
  errors: {
    workspace: "The operation could not be completed. Please try again.", plan: "The operation could not be completed. Please try again.",
    boundaryTitle: "Preshot could not render this view", boundaryBody: "Restart the app. If the problem persists, keep your project files and report the error.",
  },
} satisfies TranslationShape<typeof zh>;
