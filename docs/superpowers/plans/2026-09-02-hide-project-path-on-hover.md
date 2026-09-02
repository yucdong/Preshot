# Hide Project Path on Hover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove filesystem paths from project-rail hover and focus overlays while preserving project directory and removal actions.

**Architecture:** Keep the existing `AppShell` project-entry overlay and its hover/focus visibility behavior. Remove only the path node and align the two existing action buttons to the overlay's right edge, with a focused component regression test covering privacy and callbacks.

**Tech Stack:** React 19, TypeScript, Vitest, React Testing Library, Tailwind CSS

---

### Task 1: Hide the Project Path

**Files:**
- Modify: `src/app/layout/AppShell.test.tsx:178-199`
- Modify: `src/app/layout/AppShell.tsx:367-371`

- [ ] **Step 1: Write the failing regression assertion**

Replace the path visibility assertion in the existing
`reveals a project directory and confirms registry-only removal` test:

```tsx
expect(screen.queryByText(project.path)).not.toBeInTheDocument();
```

Keep the existing clicks and callback assertions for the **Open project
directory** and **Remove project** buttons.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
pnpm test -- src/app/layout/AppShell.test.tsx
```

Expected: the test fails because `C:\shoots\Editorial` is still rendered in
the project action overlay.

- [ ] **Step 3: Remove the path and right-align the actions**

Change the overlay in `AppShell.tsx` to:

```tsx
<div className="absolute inset-x-1 bottom-1 flex items-center justify-end gap-1 rounded bg-app-panel-strong/95 px-1 py-0.5 opacity-0 shadow-sm transition-opacity group-hover/project:opacity-100 group-focus-within/project:opacity-100">
  <button aria-label={`打开项目目录 ${project.name}`} className="grid h-5 w-5 place-items-center rounded text-app-muted hover:bg-app-primary-soft hover:text-app-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional" onClick={() => onRevealProject(project)} type="button"><FolderOpen aria-hidden className="h-3 w-3" /></button>
  <button aria-label={`移除项目 ${project.name}`} className="grid h-5 w-5 place-items-center rounded text-app-danger hover:bg-app-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-danger" onClick={() => requestProjectRemoval(project)} type="button"><Trash2 aria-hidden className="h-3 w-3" /></button>
</div>
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```powershell
pnpm test -- src/app/layout/AppShell.test.tsx
```

Expected: all tests in `AppShell.test.tsx` pass.

- [ ] **Step 5: Run type checking**

Run:

```powershell
pnpm typecheck
```

Expected: TypeScript exits successfully with no errors.

- [ ] **Step 6: Commit the implementation**

```powershell
git add -- src\app\layout\AppShell.tsx src\app\layout\AppShell.test.tsx
git commit -m "Hide project paths from rail actions" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
