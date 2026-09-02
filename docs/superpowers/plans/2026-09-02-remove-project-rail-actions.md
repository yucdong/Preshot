# Remove Project Rail Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the project-rail hover/focus action bar and its Open directory and Remove project controls.

**Architecture:** Delete the action overlay from `AppShell` rather than visually hiding it, ensuring no invisible controls remain focusable. Remove the now-unused component contract, confirmation state, and workspace callback wiring while preserving the independent launcher removal flow.

**Tech Stack:** React 19, TypeScript, Vitest, React Testing Library, Tailwind CSS

---

### Task 1: Specify the Removed Project Actions

**Files:**
- Modify: `src/app/layout/AppShell.test.tsx:38-47`
- Modify: `src/app/layout/AppShell.test.tsx:178-201`

- [ ] **Step 1: Remove obsolete test handlers**

Change `handlers()` to:

```tsx
function handlers() {
  return {
    onSelectProject: vi.fn(),
    onNewProject: vi.fn(),
    onOpenProject: vi.fn(),
  };
}
```

- [ ] **Step 2: Replace the old action-flow test**

Replace `reveals a project directory and confirms registry-only removal` with:

```tsx
it("does not render project management actions in the project rail", () => {
  const project = makeProject({ name: "Editorial", path: "C:\\shoots\\Editorial" });
  renderShell(
    <AppShell currentProjectId={project.projectId} projects={[project]} {...handlers()}>
      <p>Plan content</p>
    </AppShell>,
  );

  expect(screen.queryByRole("button", { name: "打开项目目录 Editorial" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "移除项目 Editorial" })).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run the focused test and verify it fails**

Run:

```powershell
pnpm test -- src/app/layout/AppShell.test.tsx
```

Expected: the new test fails because both project management buttons are still
rendered.

### Task 2: Remove the Overlay and Dead Wiring

**Files:**
- Modify: `src/app/layout/AppShell.tsx:1-80`
- Modify: `src/app/layout/AppShell.tsx:340-372`
- Modify: `src/app/layout/AppShell.tsx:440-470`
- Modify: `src/app/workspace/WorkspaceProvider.tsx:360-375`
- Modify: `src/app/workspace/WorkspaceProvider.tsx:470-492`

- [ ] **Step 1: Remove overlay-only imports and props**

In `AppShell.tsx`, remove `FolderOpen` and `Trash2` from the `lucide-react`
import and remove the `ConfirmDialog` import. Remove these properties from
`AppShellProps` and the component parameter destructuring:

```tsx
onRevealProject(project: WorkspaceProjectView): void;
onRemoveProject(project: WorkspaceProjectView): void;
getProjectSessionCount?(projectId: string): Promise<number>;
```

- [ ] **Step 2: Remove overlay-only state and request logic**

Delete:

```tsx
const [projectToRemove, setProjectToRemove] = useState<WorkspaceProjectView | null>(null);
const [projectSessionCount, setProjectSessionCount] = useState<
  number | "loading" | "error" | null
>(null);
const requestProjectRemoval = (project: WorkspaceProjectView) => {
  setProjectToRemove(project);
  if (!getProjectSessionCount) {
    setProjectSessionCount(0);
    return;
  }
  setProjectSessionCount("loading");
  void getProjectSessionCount(project.projectId).then(
    (count) => setProjectSessionCount(count),
    () => setProjectSessionCount("error"),
  );
};
```

- [ ] **Step 3: Remove the project-entry action overlay**

Delete the complete overlay after the project-selection button:

```tsx
<div className="absolute inset-x-1 bottom-1 flex items-center justify-end gap-1 rounded bg-app-panel-strong/95 px-1 py-0.5 opacity-0 shadow-sm transition-opacity group-hover/project:opacity-100 group-focus-within/project:opacity-100">
  <button aria-label={`打开项目目录 ${project.name}`} className="grid h-5 w-5 place-items-center rounded text-app-muted hover:bg-app-primary-soft hover:text-app-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional" onClick={() => onRevealProject(project)} type="button"><FolderOpen aria-hidden className="h-3 w-3" /></button>
  <button aria-label={`移除项目 ${project.name}`} className="grid h-5 w-5 place-items-center rounded text-app-danger hover:bg-app-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-danger" onClick={() => requestProjectRemoval(project)} type="button"><Trash2 aria-hidden className="h-3 w-3" /></button>
</div>
```

Remove the now-unneeded `group/project` class from the containing `<article>`.
Keep its `hover:bg-app-panel-strong` and `focus-within:bg-app-panel-strong`
styling.

- [ ] **Step 4: Remove the confirmation dialog**

Delete the `ConfirmDialog` rendered after the main shell content. Do not alter
the surrounding shell or agent panel markup.

- [ ] **Step 5: Remove unused workspace callback wiring**

In `WorkspaceProvider.tsx`, delete the `revealProjectDirectory` callback because
it has no remaining caller. Remove `getProjectSessionCount`, `onRemoveProject`,
and `onRevealProject` from the project-view `<AppShell>` props.

Keep `removeProject`; `WorkspaceLauncher` still uses it through:

```tsx
onRemove={removeProject}
```

- [ ] **Step 6: Run the focused tests**

Run:

```powershell
pnpm test -- src/app/layout/AppShell.test.tsx src/app/workspace/WorkspaceProvider.test.tsx
```

Expected: both test files pass.

- [ ] **Step 7: Run type checking**

Run:

```powershell
pnpm typecheck
```

Expected: TypeScript exits successfully with no errors.

- [ ] **Step 8: Commit the implementation**

```powershell
git add -- src\app\layout\AppShell.tsx src\app\layout\AppShell.test.tsx src\app\workspace\WorkspaceProvider.tsx
git commit -m "Remove project rail action overlay" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
