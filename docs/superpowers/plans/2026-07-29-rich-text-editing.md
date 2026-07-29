# Rich Text Editing Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Photography Plan body and every reference group's description rich text (headings, bold, italic, bullet/ordered lists, links) edited with a shared TipTap editor and stored as HTML in the `.preshot` manifest.

**Architecture:** Follows the existing clean layering — a new `photographyPlan` HTML field on `ProjectPlan`, a non-persisting `setPhotographyPlan` domain use case, tolerant adapters, and a reusable `RichTextEditor` React component wired through `PlanPanel`. Rich-text edits update in-memory plan state and are flushed by the existing 5s auto-save.

**Tech Stack:** React 19 + TypeScript, TipTap (ProseMirror), Tailwind, Vitest + Testing Library, Rust/Tauri, pnpm.

## Global Constraints

- Package manager is **pnpm**; do not add npm/yarn lock files.
- `domain/` must not import React, Tauri, browser APIs, or infrastructure.
- Direct `@tauri-apps/api`/plugin imports only in `src/infrastructure`.
- Co-locate Vitest files as `*.test.ts(x)`; write the failing test first.
- Descriptions/plan content are stored as **HTML strings**; `photographyPlan` and `description` both default to `""`; `#[serde(default)]` on the Rust side keeps old manifests loadable.
- Validation matrix (run the smallest relevant first): `pnpm test`, `pnpm typecheck`, `pnpm lint`, `cargo test --manifest-path src-tauri\Cargo.toml`, `pnpm build`.

---

### Task 1: Add `photographyPlan` to the plan domain model

**Files:**
- Modify: `src/domain/plan/models.ts`
- Modify: `src/domain/plan/plan.ts`
- Test: `src/domain/plan/plan.test.ts`

**Interfaces:**
- Produces: `ProjectPlan.photographyPlan: string`; `EMPTY_PLAN.photographyPlan === ""`; `setPhotographyPlan(plan: ProjectPlan, html: string): ProjectPlan`.

- [ ] **Step 1: Write the failing test**

Add to `src/domain/plan/plan.test.ts` (import `setPhotographyPlan` from `./plan` and `EMPTY_PLAN` is already imported):

```ts
  it("sets the photography plan html immutably and defaults to empty", () => {
    expect(EMPTY_PLAN.photographyPlan).toBe("");
    const next = setPhotographyPlan(EMPTY_PLAN, "<h1>Shoot</h1>");
    expect(next.photographyPlan).toBe("<h1>Shoot</h1>");
    expect(next.referenceGroups).toBe(EMPTY_PLAN.referenceGroups);
    expect(EMPTY_PLAN.photographyPlan).toBe("");
  });
```

Add `setPhotographyPlan` to the existing import from `./plan` at the top of the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run src/domain/plan/plan.test.ts`
Expected: FAIL (`setPhotographyPlan` is not exported / `photographyPlan` missing).

- [ ] **Step 3: Implement the model + reducer**

In `src/domain/plan/models.ts`, change `ProjectPlan` and `EMPTY_PLAN`:

```ts
export interface ProjectPlan {
  photographyPlan: string;
  referenceGroups: ReferenceGroup[];
}

export const EMPTY_PLAN: ProjectPlan = {
  photographyPlan: "",
  referenceGroups: [],
};
```

In `src/domain/plan/plan.ts`, add (keep existing helpers; every reducer must preserve `photographyPlan`). Update the object literals returned by `addGroup`, `renameGroup`, `setDescription`, `deleteGroup`, `setColumns`, `addImage`, `removeImage` to spread the plan first so `photographyPlan` carries through. Concretely, change each `return { referenceGroups: ... }` to `return { ...plan, referenceGroups: ... }`, and add:

```ts
export function setPhotographyPlan(plan: ProjectPlan, html: string): ProjectPlan {
  return { ...plan, photographyPlan: html };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- --run src/domain/plan/plan.test.ts`
Expected: PASS (all reducer tests still green; new test green).

- [ ] **Step 5: Commit**

```bash
git add src/domain/plan/models.ts src/domain/plan/plan.ts src/domain/plan/plan.test.ts
git commit -m "feat(plan): add photographyPlan html field and reducer"
```

---

### Task 2: Add the `setPhotographyPlan` use case to PlanService

**Files:**
- Modify: `src/domain/plan/service.ts`
- Test: `src/domain/plan/service.test.ts`

**Interfaces:**
- Consumes: `setPhotographyPlan` reducer from Task 1.
- Produces: `PlanService.setPhotographyPlan(plan: ProjectPlan, html: string): Promise<ProjectPlan>` (non-persisting, like the other pure-metadata use cases).

- [ ] **Step 1: Write the failing test**

Add to `src/domain/plan/service.test.ts`:

```ts
  it("sets the photography plan in memory without persisting", async () => {
    const d = deps();
    const service = createPlanService(d);

    const next = await service.setPhotographyPlan(EMPTY_PLAN, "<p>Notes</p>");

    expect(next.photographyPlan).toBe("<p>Notes</p>");
    expect(d.repository.savePlan).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run src/domain/plan/service.test.ts`
Expected: FAIL (`service.setPhotographyPlan` is not a function).

- [ ] **Step 3: Implement**

In `src/domain/plan/service.ts`, add `setPhotographyPlan as setPhotographyPlanInPlan` to the import from `./plan`. Add to the `PlanService` interface (next to `setDescription`):

```ts
  setPhotographyPlan(plan: ProjectPlan, html: string): Promise<ProjectPlan>;
```

Add to the returned object (next to `setDescription`):

```ts
    setPhotographyPlan(plan, html) {
      return Promise.resolve(setPhotographyPlanInPlan(plan, html));
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- --run src/domain/plan/service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/plan/service.ts src/domain/plan/service.test.ts
git commit -m "feat(plan): add setPhotographyPlan use case"
```

---

### Task 3: Persist `photographyPlan` through the adapters and mocks

**Files:**
- Modify: `src/infrastructure/plan/tauriPlan.ts`
- Modify: `src/infrastructure/plan/tauriPlan.test.ts`
- Modify: `src/infrastructure/plan/browserPlan.ts`
- Modify: `src/features/plan/ProjectPlanProvider.test.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/app/workspace/WorkspaceProvider.test.tsx`

**Interfaces:**
- Consumes: `ProjectPlan.photographyPlan` (Task 1), `PlanService.setPhotographyPlan` (Task 2).
- Produces: `validatePlan` returns `photographyPlan` (default `""`); all `PlanService` test mocks include `setPhotographyPlan: vi.fn()`.

- [ ] **Step 1: Write the failing test**

In `src/infrastructure/plan/tauriPlan.test.ts`, update the "reads and validates a plan" test to include the field, and add a defaulting test:

```ts
  it("defaults a missing photographyPlan to an empty string", async () => {
    const invokeCommand = vi.fn().mockResolvedValue({ referenceGroups: [] });
    const plan = createTauriPlan({ invokeCommand });

    await expect(plan.loadPlan("C:\\p")).resolves.toEqual({
      photographyPlan: "",
      referenceGroups: [],
    });
  });
```

Also update the existing `resolves.toEqual({ referenceGroups: [...] })` assertions in that file to `resolves.toEqual({ photographyPlan: "", referenceGroups: [...] })` (two places: "reads and validates a plan" and "defaults a missing description...").

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run src/infrastructure/plan/tauriPlan.test.ts`
Expected: FAIL (result lacks `photographyPlan`).

- [ ] **Step 3: Implement**

In `src/infrastructure/plan/tauriPlan.ts`, change `validatePlan`:

```ts
function validatePlan(value: unknown): ProjectPlan {
  if (!isRecord(value) || !Array.isArray(value.referenceGroups)) {
    throw new Error("Malformed native response");
  }
  return {
    photographyPlan: typeof value.photographyPlan === "string" ? value.photographyPlan : "",
    referenceGroups: value.referenceGroups.map(validateGroup),
  };
}
```

In `src/infrastructure/plan/browserPlan.ts`, add `photographyPlan` to `SEEDED_PLAN`:

```ts
const SEEDED_PLAN: ProjectPlan = {
  photographyPlan: "<h2>Sunset Editorial</h2><p>Golden hour on the waterfront. Bring the 85mm.</p>",
  referenceGroups: [
    // ...unchanged
  ],
};
```

In `src/features/plan/ProjectPlanProvider.test.tsx`, `src/app/App.test.tsx`, and `src/app/workspace/WorkspaceProvider.test.tsx`, add `setPhotographyPlan: vi.fn(),` to each `PlanService` mock (next to `setDescription: vi.fn(),`). In `ProjectPlanProvider.test.tsx` and `App.test.tsx`/`WorkspaceProvider.test.tsx`, also add `photographyPlan: ""` to any inline `loadPlan` mock plan objects and the `plan` fixtures that use `{ referenceGroups: [...] }` shape (search each file for `referenceGroups:` in mock return values and prepend `photographyPlan: "",`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- --run src/infrastructure/plan src/features/plan/ProjectPlanProvider.test.tsx src/app`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/plan src/features/plan/ProjectPlanProvider.test.tsx src/app/App.test.tsx src/app/workspace/WorkspaceProvider.test.tsx
git commit -m "feat(plan): carry photographyPlan through adapters and test mocks"
```

---

### Task 4: Store `photographyPlan` in the `.preshot` manifest (Rust)

**Files:**
- Modify: `src-tauri/src/workspace.rs` (the `ProjectPlan` struct)
- Modify: `src-tauri/src/plan.rs` (the `read_project_plan_in` default + a round-trip test)

**Interfaces:**
- Produces: Rust `ProjectPlan { photography_plan: String, reference_groups: Vec<ReferenceGroup> }` serialized as camelCase `photographyPlan`.

- [ ] **Step 1: Write the failing test**

In `src-tauri/src/plan.rs`, extend `save_then_read_round_trips_plan_and_bumps_updated_at`: change the constructed `ProjectPlan` to include the field and assert it round-trips:

```rust
        let plan = ProjectPlan {
            photography_plan: "<p>Golden hour</p>".into(),
            reference_groups: vec![ReferenceGroup {
                id: "g1".into(),
                title: "Lookbook".into(),
                description: "Warm editorial mood".into(),
                columns_per_row: 3,
                images: vec![ReferenceImage {
                    id: "i1".into(),
                    file: "references/0001.png".into(),
                }],
            }],
        };
```

Add an assertion after reading it back:

```rust
        assert_eq!(
            read_project_plan_in(&project_path).unwrap().photography_plan,
            "<p>Golden hour</p>"
        );
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri\Cargo.toml plan::tests::save_then_read`
Expected: FAIL (missing field `photography_plan`).

- [ ] **Step 3: Implement**

In `src-tauri/src/workspace.rs`, update the `ProjectPlan` struct:

```rust
#[derive(Debug, Clone, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPlan {
    #[serde(default)]
    pub photography_plan: String,
    #[serde(default)]
    pub reference_groups: Vec<ReferenceGroup>,
}
```

In `src-tauri/src/plan.rs`, update the default in `read_project_plan_in`:

```rust
    Ok(read_manifest(&project_path)?.plan.unwrap_or(ProjectPlan {
        photography_plan: String::new(),
        reference_groups: Vec::new(),
    }))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri\Cargo.toml`
Expected: PASS (all Rust tests green; the pre-existing `inspect_reads_a_plan_from_the_manifest` still passes because `#[serde(default)]` fills `photography_plan`).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/workspace.rs src-tauri/src/plan.rs
git commit -m "feat(plan): persist photographyPlan in the .preshot manifest"
```

---

### Task 5: Install TipTap and build the `RichTextEditor` component

**Files:**
- Modify: `package.json` (via pnpm add)
- Create: `src/features/plan/RichTextEditor.tsx`
- Test: `src/features/plan/RichTextEditor.test.tsx`

**Interfaces:**
- Produces: `RichTextEditor(props: { html: string; onChange(html: string): void; ariaLabel: string; placeholder?: string })`. The editable region has `role="textbox"`, `aria-multiline="true"`, and the given `aria-label`. Toolbar buttons: "Bold", "Italic", "Heading 1", "Heading 2", "Bullet list", "Numbered list", "Link".

- [ ] **Step 1: Install dependencies**

Run:
```bash
pnpm add @tiptap/react @tiptap/pm @tiptap/starter-kit @tiptap/extension-link
```
Expected: dependencies added to `package.json`; `pnpm-lock.yaml` updated.

- [ ] **Step 2: Write the failing test**

Create `src/features/plan/RichTextEditor.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RichTextEditor } from "./RichTextEditor";

describe("RichTextEditor", () => {
  it("renders provided html and exposes an accessible textbox", () => {
    render(<RichTextEditor ariaLabel="Photography plan" html="<p>Hello</p>" onChange={vi.fn()} />);
    const box = screen.getByRole("textbox", { name: "Photography plan" });
    expect(box).toHaveTextContent("Hello");
  });

  it("emits html when the user types", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RichTextEditor ariaLabel="Notes" html="" onChange={onChange} />);

    await user.click(screen.getByRole("textbox", { name: "Notes" }));
    await user.keyboard("Shot list");

    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)?.[0]).toContain("Shot list");
  });

  it("toggles bold via the toolbar and reflects active state", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RichTextEditor ariaLabel="Notes" html="" onChange={onChange} />);

    await user.click(screen.getByRole("textbox", { name: "Notes" }));
    await user.click(screen.getByRole("button", { name: "Bold" }));
    await user.keyboard("bold");

    expect(onChange.mock.calls.at(-1)?.[0]).toContain("<strong>bold</strong>");
    expect(screen.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test -- --run src/features/plan/RichTextEditor.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement the component**

Create `src/features/plan/RichTextEditor.tsx`:

```tsx
import Link from "@tiptap/extension-link";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect } from "react";

interface RichTextEditorProps {
  html: string;
  onChange(html: string): void;
  ariaLabel: string;
  placeholder?: string;
}

const toolbarButton =
  "rounded px-2 py-1 text-xs font-medium text-stone-600 hover:bg-stone-100 aria-pressed:bg-stone-900 aria-pressed:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500";

function ToolbarButton({
  editor,
  label,
  isActive,
  onClick,
}: {
  editor: Editor;
  label: string;
  isActive: boolean;
  onClick(): void;
}) {
  void editor;
  return (
    <button aria-label={label} aria-pressed={isActive} className={toolbarButton} onClick={onClick} type="button">
      {label}
    </button>
  );
}

export function RichTextEditor({ html, onChange, ariaLabel, placeholder }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2] } }),
      Link.configure({ openOnClick: false }),
    ],
    content: html,
    onUpdate: ({ editor: current }) => onChange(current.getHTML()),
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
        "aria-multiline": "true",
        role: "textbox",
        class:
          "prose prose-sm max-w-none min-h-[6rem] rounded-lg border border-black/10 px-3 py-2 text-sm text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500",
      },
    },
  });

  useEffect(() => {
    if (editor && html !== editor.getHTML()) {
      editor.commands.setContent(html, { emitUpdate: false });
    }
  }, [editor, html]);

  if (!editor) {
    return null;
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1" role="toolbar" aria-label={`${ariaLabel} formatting`}>
        <ToolbarButton editor={editor} isActive={editor.isActive("bold")} label="Bold" onClick={() => editor.chain().focus().toggleBold().run()} />
        <ToolbarButton editor={editor} isActive={editor.isActive("italic")} label="Italic" onClick={() => editor.chain().focus().toggleItalic().run()} />
        <ToolbarButton editor={editor} isActive={editor.isActive("heading", { level: 1 })} label="Heading 1" onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} />
        <ToolbarButton editor={editor} isActive={editor.isActive("heading", { level: 2 })} label="Heading 2" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
        <ToolbarButton editor={editor} isActive={editor.isActive("bulletList")} label="Bullet list" onClick={() => editor.chain().focus().toggleBulletList().run()} />
        <ToolbarButton editor={editor} isActive={editor.isActive("orderedList")} label="Numbered list" onClick={() => editor.chain().focus().toggleOrderedList().run()} />
        <ToolbarButton
          editor={editor}
          isActive={editor.isActive("link")}
          label="Link"
          onClick={() => {
            const previous = editor.getAttributes("link").href as string | undefined;
            const url = window.prompt("Link URL", previous ?? "https://");
            if (url === null) return;
            if (url === "") {
              editor.chain().focus().unsetLink().run();
              return;
            }
            editor.chain().focus().setLink({ href: url }).run();
          }}
        />
      </div>
      <EditorContent editor={editor} placeholder={placeholder} />
    </div>
  );
}
```

Note: the `prose` classes are optional visual sugar; if `@tailwindcss/typography` is not installed they are simply inert (do not add the plugin). Keep them — they no-op without the plugin.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test -- --run src/features/plan/RichTextEditor.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm typecheck`
Expected: PASS.

```bash
git add package.json pnpm-lock.yaml src/features/plan/RichTextEditor.tsx src/features/plan/RichTextEditor.test.tsx
git commit -m "feat(plan): add TipTap RichTextEditor component"
```

---

### Task 6: Make the Photography Plan tab a rich-text editor

**Files:**
- Modify: `src/features/plan/PhotographyPlanTab.tsx`
- Modify: `src/features/plan/PlanPanel.tsx`
- Modify: `src/features/plan/PlanPanel.test.tsx`
- Modify: `src/features/plan/ProjectPlanProvider.tsx`

**Interfaces:**
- Consumes: `RichTextEditor` (Task 5), `PlanService.setPhotographyPlan` (Task 2).
- Produces: `PhotographyPlanTab(props: { html: string; onChange(html: string): void })`; `PlanPanel` gains props `photographyPlan: string` and `onSetPhotographyPlan(html: string): void`.

- [ ] **Step 1: Write the failing test**

In `src/features/plan/PlanPanel.test.tsx`, add `photographyPlan=""` and `onSetPhotographyPlan={vi.fn()}` to each `render(<PlanPanel .../>)` call, and add:

```tsx
  it("renders the photography plan editor", () => {
    render(
      <PlanPanel
        groups={[]}
        imageSrc={() => undefined}
        onSetPhotographyPlan={vi.fn()}
        photographyPlan="<p>Plan body</p>"
        saveState="saved"
        {...noop}
      />,
    );
    expect(screen.getByRole("textbox", { name: "Photography plan" })).toHaveTextContent("Plan body");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run src/features/plan/PlanPanel.test.tsx`
Expected: FAIL (type error / no photography plan textbox).

- [ ] **Step 3: Implement**

Replace `src/features/plan/PhotographyPlanTab.tsx`:

```tsx
import { RichTextEditor } from "./RichTextEditor";

interface PhotographyPlanTabProps {
  html: string;
  onChange(html: string): void;
}

export function PhotographyPlanTab({ html, onChange }: PhotographyPlanTabProps) {
  return (
    <section aria-label="Photography Plan" className="border-b border-black/10 bg-white/60 px-6 py-5">
      <p className="text-xs font-medium uppercase tracking-[0.24em] text-amber-700">Photography Plan</p>
      <h3 className="mt-2 mb-3 text-xl font-semibold text-stone-900">Shot notes</h3>
      <RichTextEditor ariaLabel="Photography plan" html={html} onChange={onChange} placeholder="Shot list, schedule, and notes…" />
    </section>
  );
}
```

In `src/features/plan/PlanPanel.tsx`, extend the props and pass them through:

```tsx
interface PlanPanelProps extends ReferenceImagesTabProps {
  error?: string | null;
  saveState: SaveState;
  photographyPlan: string;
  onSetPhotographyPlan(html: string): void;
}

export function PlanPanel({ error, saveState, photographyPlan, onSetPhotographyPlan, ...referenceProps }: PlanPanelProps) {
  // ...header unchanged...
  // replace <PhotographyPlanTab /> with:
  //   <PhotographyPlanTab html={photographyPlan} onChange={onSetPhotographyPlan} />
}
```

In `src/features/plan/ProjectPlanProvider.tsx`, add a handler mirroring `setDescription`:

```tsx
  const setPhotographyPlan = useCallback(
    (html: string) => {
      void guard("Unable to update the photography plan", async () => {
        const next = await service.setPhotographyPlan(planRef.current, html);
        if (mountedRef.current) {
          applyPlan(next);
          setError(null);
        }
      });
    },
    [applyPlan, guard, service],
  );
```

Pass to `PlanPanel`: `photographyPlan={plan.photographyPlan}` and `onSetPhotographyPlan={setPhotographyPlan}`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- --run src/features/plan/PlanPanel.test.tsx src/features/plan/ProjectPlanProvider.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/plan/PhotographyPlanTab.tsx src/features/plan/PlanPanel.tsx src/features/plan/PlanPanel.test.tsx src/features/plan/ProjectPlanProvider.tsx
git commit -m "feat(plan): rich-text Photography Plan tab"
```

---

### Task 7: Make each group description a rich-text editor

**Files:**
- Modify: `src/features/plan/ReferenceImagesTab.tsx`
- Modify: `src/features/plan/ReferenceImagesTab.test.tsx`

**Interfaces:**
- Consumes: `RichTextEditor` (Task 5); existing `onSetDescription(groupId, html)` prop.
- Produces: group description edited via `RichTextEditor` (accessible name `Group description`).

- [ ] **Step 1: Write the failing test**

Replace the description test in `src/features/plan/ReferenceImagesTab.test.tsx` with one that targets the editor. Update the `groups` fixture `description` to `"<p>Warm editorial mood</p>"`. Replace the "shows a high-contrast description field…" test body:

```tsx
  it("shows a rich-text description editor and emits html on edit", async () => {
    const user = userEvent.setup();
    const h = handlers();
    render(<ReferenceImagesTab groups={groups} imageSrc={() => "data:image/png;base64,AA"} {...h} />);

    const group = screen.getByRole("group", { name: "Reference group: Lookbook" });
    const editor = within(group).getByRole("textbox", { name: "Group description" });
    expect(editor).toHaveTextContent("Warm editorial mood");

    await user.click(editor);
    await user.keyboard(" extra");
    expect(h.onSetDescription).toHaveBeenCalled();
    expect(h.onSetDescription.mock.calls.at(-1)?.[0]).toBe("g1");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run src/features/plan/ReferenceImagesTab.test.tsx`
Expected: FAIL (no `Group description` textbox; textarea removed).

- [ ] **Step 3: Implement**

In `src/features/plan/ReferenceImagesTab.tsx`, remove the `GroupDescriptionInput` textarea component and its usage; import `RichTextEditor` and render it in the same place:

```tsx
import { RichTextEditor } from "./RichTextEditor";
// ...delete the GroupDescriptionInput function...

// where <GroupDescriptionInput .../> was rendered, use:
          <div className="mt-3">
            <RichTextEditor
              key={`description-${group.id}`}
              ariaLabel="Group description"
              html={group.description}
              onChange={(value) => onSetDescription(group.id, value)}
              placeholder="Describe this set of references — mood, lighting, styling, or notes…"
            />
          </div>
```

Keep the `key` stable per `group.id` (not per description) so typing does not remount the editor.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- --run src/features/plan/ReferenceImagesTab.test.tsx`
Expected: PASS.

- [ ] **Step 5: Full validation + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && cargo test --manifest-path src-tauri\Cargo.toml && pnpm build`
Expected: all PASS/succeed.

```bash
git add src/features/plan/ReferenceImagesTab.tsx src/features/plan/ReferenceImagesTab.test.tsx
git commit -m "feat(plan): rich-text group descriptions"
```

---

### Task 8: Update documentation for rich text

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/TESTING.md`
- Modify: `docs/design_docs/featurelist.json`

- [ ] **Step 1: Update the docs**

- `ARCHITECTURE.md` Basic Plan Editing → note the `photographyPlan` HTML field and the shared TipTap `RichTextEditor` backing the plan body and group descriptions (content stored as HTML, edited in-memory, flushed by auto-save).
- `TESTING.md` Plan Coverage → add `RichTextEditor` toolbar/HTML-emit coverage and the `setPhotographyPlan` domain test.
- `featurelist.json` `基础方案编辑` → add a `feature_descriptions` line ("摄影计划与每组描述支持富文本编辑（HTML）") and a `decisions` line (TipTap; HTML in `.preshot`; backward-compatible with plain text).

- [ ] **Step 2: Validate JSON + commit**

Run: `node -e "JSON.parse(require('fs').readFileSync('docs/design_docs/featurelist.json','utf8'))"`
Expected: no error.

```bash
git add docs/ARCHITECTURE.md docs/TESTING.md docs/design_docs/featurelist.json
git commit -m "docs: document rich-text plan editing"
```

---

## Self-Review Notes

- **Spec coverage:** photographyPlan field (T1/T4), setPhotographyPlan use case (T2), adapters/tolerance (T3), TipTap editor with the exact toolbar set (T5), Photography Plan tab (T6), group descriptions (T7), backward-compat with plain text (T3 seed + tolerant validate + `#[serde(default)]`), docs (T8). Sanitization: TipTap schema-only output (documented in T5 note; no `innerHTML` sink added).
- **Type consistency:** `setPhotographyPlan(plan, html)` reducer/use case; `RichTextEditor` props `{ html, onChange, ariaLabel, placeholder? }`; `PlanPanel` gains `photographyPlan` + `onSetPhotographyPlan`; `PhotographyPlanTab` props `{ html, onChange }` — all consistent across tasks.
- Phase 2 (PDF export) is a separate plan: `docs/superpowers/plans/2026-07-29-pdf-export.md`, and depends on this phase's `photographyPlan` + HTML descriptions.
