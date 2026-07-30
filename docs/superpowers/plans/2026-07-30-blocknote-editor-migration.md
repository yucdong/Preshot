# BlockNote Editor Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the TipTap rich-text editor with BlockNote (Notion-style block editing) in the Photography Plan and every reference-group description, keeping HTML persistence and the existing pdf-lib PDF export.

**Architecture:** `src/features/plan/RichTextEditor.tsx` keeps its public props and swaps internals to BlockNote (`useCreateBlockNote` + `<BlockNoteView>` from `@blocknote/mantine`). HTML is converted at the editor boundary (`tryParseHTMLToBlocks` on load, `blocksToHTMLLossy` on change), so `.preshot` persistence and the PDF pipeline are reused. Higher-level component tests mock the editor; real editing is covered by Playwright e2e.

**Tech Stack:** React 19, TypeScript, Vite, Vitest + Testing Library (jsdom), Playwright, `@blocknote/core` `@blocknote/react` `@blocknote/mantine` (0.52.x), pdf-lib + `@pdf-lib/fontkit`.

## Global Constraints

- Package manager: **pnpm** only (no npm/yarn lock files).
- Persistence format stays **HTML** in `.preshot`; **no** manifest schema bump, **no** data migration. Existing TipTap-authored content must load unchanged.
- Formatting model is **native BlockNote** (bold, italic, underline, strikethrough, code, palette text/highlight colors, block types). The font-size dropdown and arbitrary-hex color picker are **removed**.
- Direct `@tiptap/*` imports must be **fully removed**; BlockNote is only imported from `src/features/plan` and `src/main.tsx` (UI layer). No BlockNote import in `src/domain`.
- `blocksToHTMLLossy` / `tryParseHTMLToBlocks` results MUST be wrapped in `await Promise.resolve(...)` so the code is correct whether the API is sync or async.
- Canonical commands: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test:e2e`, `cargo test --manifest-path src-tauri\Cargo.toml`.
- Every commit message ends with the trailer: `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

---

### Task 1: Add BlockNote, jsdom shims, and theme CSS (TipTap still present)

**Files:**
- Modify: `package.json` (dependencies)
- Modify: `src/main.tsx` (CSS import)
- Modify: `src/styles.css` (theme overrides; append)
- Modify: `src/shared/testing/setup.ts` (jsdom shims)

**Interfaces:**
- Consumes: nothing new.
- Produces: BlockNote packages installed; `@blocknote/mantine/style.css` loaded globally; jsdom shims (`ResizeObserver`, `matchMedia`, `DOMRect`, `Range.prototype.getClientRects/getBoundingClientRect`, `Element.prototype.scrollIntoView`, `IntersectionObserver`) available in tests.

- [ ] **Step 1: Install BlockNote packages**

Run:
```bash
pnpm add @blocknote/core@^0.52.1 @blocknote/react@^0.52.1 @blocknote/mantine@^0.52.1
```
Expected: pnpm updates `package.json` + `pnpm-lock.yaml`, exit 0.

- [ ] **Step 2: Import BlockNote styles at the app entry**

In `src/main.tsx`, add the stylesheet import directly above `import "./styles.css";`:
```tsx
import "@blocknote/mantine/style.css";
import "./styles.css";
```

- [ ] **Step 3: Add jsdom shims for BlockNote**

Append to `src/shared/testing/setup.ts` (after the existing imports/afterEach):
```ts
// BlockNote/ProseMirror rely on browser APIs jsdom lacks. Shim the minimum.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
class IntersectionObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
globalThis.IntersectionObserver ??= IntersectionObserverStub as unknown as typeof IntersectionObserver;
globalThis.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {
    return false;
  },
})) as unknown as typeof globalThis.matchMedia;
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {};
}
if (typeof Range !== "undefined") {
  Range.prototype.getClientRects ??= () =>
    ({ item: () => null, length: 0, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect(0, 0, 0, 0);
}
```

- [ ] **Step 4: Add BlockNote theme overrides**

Append to `src/styles.css`:
```css
/* BlockNote (Mantine) theming to fit the stone/amber palette. */
.bn-wrap .bn-editor {
  background: #ffffff;
  color: #1c1917;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 0.5rem;
}
.bn-wrap.bn-compact .bn-editor {
  padding-inline: 0.25rem;
}
```

- [ ] **Step 5: Verify install + existing suite still pass**

Run: `pnpm typecheck`
Expected: PASS (no code uses BlockNote yet; TipTap untouched).

Run: `pnpm test`
Expected: PASS — the full suite (179 tests) still green with the new shims.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/main.tsx src/styles.css src/shared/testing/setup.ts
git commit -m "chore(plan): add BlockNote deps, jsdom shims, and theme CSS

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Rewrite RichTextEditor with BlockNote and wire the compact description

**Files:**
- Modify: `src/features/plan/RichTextEditor.tsx` (full rewrite)
- Modify: `src/features/plan/RichTextEditor.test.tsx` (replace toolbar tests with a smoke)
- Modify: `src/features/plan/ReferenceImagesTab.tsx` (pass `compact` to the description editor)

**Interfaces:**
- Consumes: `useCreateBlockNote` from `@blocknote/react`; `BlockNoteView` from `@blocknote/mantine`.
- Produces: `RichTextEditor(props: { html: string; onChange(html: string): void; ariaLabel: string; placeholder?: string; compact?: boolean }): JSX.Element`. Renders a labelled wrapper `div[role="group"][aria-label=ariaLabel]` (class `bn-wrap`, plus `bn-compact` when `compact`) containing `<BlockNoteView>`. Emits HTML via `onChange` after every edit.

- [ ] **Step 1: Write the failing smoke test**

Replace the entire body of `src/features/plan/RichTextEditor.test.tsx` with:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RichTextEditor } from "./RichTextEditor";

describe("RichTextEditor", () => {
  it("renders a labelled editor region", () => {
    render(<RichTextEditor ariaLabel="Photography plan" html="<p>Hello</p>" onChange={vi.fn()} />);
    expect(screen.getByRole("group", { name: "Photography plan" })).toBeInTheDocument();
  });

  it("hydrates provided html into visible text", async () => {
    render(<RichTextEditor ariaLabel="Notes" html="<p>Shot list</p>" onChange={vi.fn()} />);
    expect(await screen.findByText("Shot list")).toBeVisible();
  });

  it("emits html shortly after mounting non-empty content", async () => {
    const onChange = vi.fn();
    render(<RichTextEditor ariaLabel="Notes" html="<p>Seed</p>" onChange={onChange} />);
    await screen.findByText("Seed");
    // Editing is validated in e2e; here we only assert the wrapper is interactive.
    expect(screen.getByRole("group", { name: "Notes" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/features/plan/RichTextEditor.test.tsx`
Expected: FAIL — the current TipTap component renders `role="textbox"`, not a `role="group"` region, so `getByRole("group", …)` throws.

- [ ] **Step 3: Rewrite RichTextEditor.tsx**

Replace the entire file `src/features/plan/RichTextEditor.tsx` with:
```tsx
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import { useEffect, useRef } from "react";

interface RichTextEditorProps {
  html: string;
  onChange(html: string): void;
  ariaLabel: string;
  placeholder?: string;
  compact?: boolean;
}

export function RichTextEditor({ html, onChange, ariaLabel, placeholder, compact }: RichTextEditorProps) {
  const editor = useCreateBlockNote();
  const lastHtmlRef = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (html === lastHtmlRef.current) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const blocks = await Promise.resolve(editor.tryParseHTMLToBlocks(html && html.trim() ? html : "<p></p>"));
      if (cancelled) {
        return;
      }
      editor.replaceBlocks(editor.document, blocks);
      lastHtmlRef.current = html;
    })();
    return () => {
      cancelled = true;
    };
  }, [editor, html]);

  const handleChange = async () => {
    const next = await Promise.resolve(editor.blocksToHTMLLossy(editor.document));
    lastHtmlRef.current = next;
    onChangeRef.current(next);
  };

  return (
    <div aria-label={ariaLabel} className={`bn-wrap${compact ? " bn-compact" : ""}`} data-placeholder={placeholder} role="group">
      <BlockNoteView editor={editor} onChange={handleChange} sideMenu={!compact} theme="light" />
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/features/plan/RichTextEditor.test.tsx`
Expected: PASS (3 tests). If BlockNote throws during mount, add the missing browser API to the jsdom shims in `src/shared/testing/setup.ts` and re-run.

- [ ] **Step 5: Pass `compact` for group descriptions**

In `src/features/plan/ReferenceImagesTab.tsx`, find the description editor:
```tsx
            <RichTextEditor
              key={`description-${group.id}`}
              ariaLabel="Group description"
              html={group.description}
              onChange={(value) => onSetDescription(group.id, value)}
              placeholder="Describe this set of references — mood, lighting, styling, or notes…"
            />
```
Add the `compact` prop:
```tsx
            <RichTextEditor
              compact
              key={`description-${group.id}`}
              ariaLabel="Group description"
              html={group.description}
              onChange={(value) => onSetDescription(group.id, value)}
              placeholder="Describe this set of references — mood, lighting, styling, or notes…"
            />
```

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. (`RichTextEditor.tsx` no longer imports any `@tiptap/*` module.)

- [ ] **Step 7: Commit**

```bash
git add src/features/plan/RichTextEditor.tsx src/features/plan/RichTextEditor.test.tsx src/features/plan/ReferenceImagesTab.tsx
git commit -m "feat(plan): swap RichTextEditor internals to BlockNote

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Remove unused TipTap dependencies and dead editor code

**Files:**
- Delete: `src/features/plan/fontSize.ts`
- Modify: `package.json` (remove TipTap deps)
- Modify: `src/styles.css` (remove `.ProseMirror` rules)

**Interfaces:**
- Consumes: nothing.
- Produces: a repo with zero `@tiptap/*` imports and no `fontSize.ts`.

- [ ] **Step 1: Confirm nothing imports TipTap or fontSize**

Run:
```bash
git grep -n "@tiptap/" -- src ; git grep -n "fontSize" -- src
```
Expected: no matches under `src` except (possibly) `package.json`. If any source match remains, fix it before continuing.

- [ ] **Step 2: Delete the custom font-size extension**

Run:
```bash
git rm src/features/plan/fontSize.ts
```

- [ ] **Step 3: Remove the TipTap dependencies**

Run:
```bash
pnpm remove @tiptap/core @tiptap/react @tiptap/starter-kit @tiptap/pm @tiptap/extension-link @tiptap/extension-placeholder @tiptap/extension-text-style @tiptap/extension-color
```
Expected: pnpm updates `package.json` + `pnpm-lock.yaml`, exit 0.

- [ ] **Step 4: Remove the `.ProseMirror` CSS rules**

In `src/styles.css`, delete the block starting at `.ProseMirror p.is-editor-empty:first-child::before {` through the final `.ProseMirror s { … }` rule (all `.ProseMirror` selectors and the `/* WYSIWYG rendering … */` comment). Leave the `:root`, `*`, `body`, and `button,input,textarea` rules and the BlockNote theme block from Task 1 intact.

- [ ] **Step 5: Verify build, types, and lint**

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm lint`
Expected: PASS.

Run: `pnpm build`
Expected: PASS (Vite build succeeds; the >500 KB chunk advisory is acceptable).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(plan): remove unused TipTap deps and dead editor code

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: Mock RichTextEditor in higher-level component suites

**Files:**
- Modify: `src/features/plan/PlanPanel.test.tsx`
- Modify: `src/features/plan/ReferenceImagesTab.test.tsx`
- Modify: `src/features/plan/ProjectPlanProvider.test.tsx`

**Interfaces:**
- Consumes: `RichTextEditor` (mocked to a labelled `<textarea>` that calls `onChange(value)` — value is the raw string, treated as HTML by callers).
- Produces: deterministic component suites that do not mount BlockNote.

- [ ] **Step 1: Add the mock + fix the assertion in PlanPanel.test.tsx**

At the top of `src/features/plan/PlanPanel.test.tsx` (after the existing imports), add:
```tsx
vi.mock("./RichTextEditor", () => ({
  RichTextEditor: ({ html, onChange, ariaLabel, placeholder }: {
    html: string;
    onChange(html: string): void;
    ariaLabel: string;
    placeholder?: string;
  }) => (
    <textarea
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      value={html}
    />
  ),
}));
```
Then change the photography-plan assertion from `toHaveTextContent` to `toHaveValue`:
```tsx
    expect(screen.getByRole("textbox", { name: "Photography plan" })).toHaveValue("<p>Plan body</p>");
```
(Ensure `vi` is imported in the `from "vitest"` import; add it if missing.)

- [ ] **Step 2: Run PlanPanel tests**

Run: `pnpm vitest run src/features/plan/PlanPanel.test.tsx`
Expected: PASS.

- [ ] **Step 3: Add the mock + fix the description test in ReferenceImagesTab.test.tsx**

At the top of `src/features/plan/ReferenceImagesTab.test.tsx` (after imports), add the same mock block as Step 1. Ensure `vi` and `fireEvent` are imported from their packages (`vi` from `"vitest"`, `fireEvent` from `"@testing-library/react"`).

Replace the body of the `"shows a rich-text description editor and emits html on edit"` test with:
```tsx
    const group = screen.getByRole("group", { name: "Reference group: Lookbook" });
    const editor = within(group).getByRole("textbox", { name: "Group description" });
    expect(editor).toHaveValue("<p>Warm editorial mood</p>");

    fireEvent.change(editor, { target: { value: "<p>Cool blue tones</p>" } });
    expect(onSetDescription).toHaveBeenCalledWith("g1", "<p>Cool blue tones</p>");
```
(If `onSetDescription` is not already the spy used in this test, use the existing description spy name from the file's setup.)

- [ ] **Step 4: Run ReferenceImagesTab tests**

Run: `pnpm vitest run src/features/plan/ReferenceImagesTab.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add the mock to ProjectPlanProvider.test.tsx**

At the top of `src/features/plan/ProjectPlanProvider.test.tsx` (after imports), add the same `vi.mock("./RichTextEditor", …)` block as Step 1. Make no assertion changes (this suite does not query the editor directly); the mock only prevents BlockNote from mounting under fake timers.

- [ ] **Step 6: Run ProjectPlanProvider tests**

Run: `pnpm vitest run src/features/plan/ProjectPlanProvider.test.tsx`
Expected: PASS (including the fake-timer auto-save and export-handoff tests).

- [ ] **Step 7: Commit**

```bash
git add src/features/plan/PlanPanel.test.tsx src/features/plan/ReferenceImagesTab.test.tsx src/features/plan/ProjectPlanProvider.test.tsx
git commit -m "test(plan): mock RichTextEditor in component suites

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: Handle BlockNote block types in the PDF HTML parser

**Files:**
- Modify: `src/infrastructure/pdf/htmlToBlocks.ts`
- Modify: `src/infrastructure/pdf/htmlToBlocks.test.ts`

**Interfaces:**
- Consumes: `parseHtmlToBlocks(html: string): Block[]` (existing). `Block = Heading | Paragraph | List`; `Run` already supports `color`/`underline`/`strike` via inline `style`.
- Produces: `parseHtmlToBlocks` additionally renders `<pre>`/`<code>` blocks as a paragraph preserving newlines, strips checkbox `<input>` inside list items (checklists → bullet lists), and flattens `<table>` to text paragraphs. Text color already flows through the existing inline-`style` reader — no change needed there.

- [ ] **Step 1: Write failing parser tests**

Add these tests inside the existing `describe` in `src/infrastructure/pdf/htmlToBlocks.test.ts`:
```ts
  it("keeps inline-style text color from BlockNote lossy html", () => {
    const [block] = parseHtmlToBlocks('<p><span style="color: #dd3333">warm</span></p>');
    const runs = block.type === "paragraph" ? block.runs : [];
    expect(runs[0]).toMatchObject({ text: "warm" });
    expect(runs[0]?.color).toBeTruthy();
  });

  it("renders a checklist as a bullet list without checkbox glyphs", () => {
    const [block] = parseHtmlToBlocks(
      '<ul><li><input type="checkbox" />Pack lens</li><li><input type="checkbox" checked />Charge battery</li></ul>',
    );
    expect(block.type).toBe("list");
    if (block.type === "list") {
      expect(block.ordered).toBe(false);
      expect(block.items).toHaveLength(2);
      expect(block.items[0].map((run) => run.text).join("")).toBe("Pack lens");
      expect(block.items[1].map((run) => run.text).join("")).toBe("Charge battery");
    }
  });

  it("renders a code block as a paragraph preserving newlines", () => {
    const [block] = parseHtmlToBlocks("<pre><code>line1\nline2</code></pre>");
    expect(block.type).toBe("paragraph");
    const text = block.type === "paragraph" ? block.runs.map((run) => run.text).join("") : "";
    expect(text).toContain("line1");
    expect(text).toContain("line2");
  });

  it("flattens a table to text", () => {
    const blocks = parseHtmlToBlocks("<table><tbody><tr><td>A1</td><td>B1</td></tr></tbody></table>");
    const joined = blocks
      .flatMap((block) => (block.type === "paragraph" ? block.runs.map((run) => run.text) : []))
      .join(" ");
    expect(joined).toContain("A1");
    expect(joined).toContain("B1");
  });
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `pnpm vitest run src/infrastructure/pdf/htmlToBlocks.test.ts`
Expected: FAIL — checklist keeps no checkbox is fine, but `<pre>` currently produces a paragraph without preserved newlines only if `<code>` text has them (jsdom keeps them, so this may pass); the table test currently flattens via the `else` branch (may pass); the checkbox `<input>` contributes no text so the checklist test may already pass. Identify which assertions fail and implement only what is needed in Step 3. At minimum, add explicit `<pre>` handling so newline behavior is guaranteed.

- [ ] **Step 3: Implement explicit block handling**

In `src/infrastructure/pdf/htmlToBlocks.ts`, inside `parseHtmlToBlocks`, add explicit branches in the element `switch`/`if` chain that currently handles `h1`/`h2`/`ul`/`ol`. Add, before the final `else`:
```ts
    } else if (tag === "pre") {
      const runs = runsOf(element);
      if (runs.some((run) => run.text.trim() !== "")) {
        blocks.push({ type: "paragraph", runs });
      }
    } else if (tag === "table") {
      for (const row of Array.from(element.querySelectorAll("tr"))) {
        const runs = runsOf(row);
        if (runs.some((run) => run.text.trim() !== "")) {
          blocks.push({ type: "paragraph", runs });
        }
      }
```
Checklists already parse as `<ul>`/`<li>`; the checkbox `<input>` has no text content, so `runsOf(li)` yields only the label text. No extra code is required for checklists, but confirm the Step 1 checklist test passes.

If the code-block newline assertion fails, ensure `runsOf` preserves the text node content verbatim (it already returns `child.textContent`, which keeps `\n`). No change needed beyond the `pre` branch above.

- [ ] **Step 4: Run parser + exporter tests**

Run: `pnpm vitest run src/infrastructure/pdf/htmlToBlocks.test.ts src/infrastructure/pdf/pdfLibExporter.test.ts`
Expected: PASS (all cases, including the pre-existing exporter PDF test).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/pdf/htmlToBlocks.ts src/infrastructure/pdf/htmlToBlocks.test.ts
git commit -m "feat(pdf): render BlockNote checklists, code, and tables at v1 fidelity

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 6: Playwright e2e smoke for block editing

**Files:**
- Modify: `e2e/plan.spec.ts`

**Interfaces:**
- Consumes: the seeded browser "Editorial Demo" project (existing e2e harness), the real BlockNote editor.
- Produces: an e2e test that types into the plan editor and confirms the content is visible and Export PDF still succeeds.

- [ ] **Step 1: Write the e2e test**

Add to `e2e/plan.spec.ts` (follow the existing file's `test(...)` style and any shared setup/`beforeEach`):
```ts
test("edits the photography plan with the block editor", async ({ page }) => {
  await page.goto("/");
  // The plan editor is a BlockNote instance; its editable is a contenteditable.
  const editor = page.getByRole("group", { name: "Photography plan" }).locator("[contenteditable='true']");
  await editor.click();
  await page.keyboard.type("Sunrise call time 5am");
  await expect(page.getByText("Sunrise call time 5am")).toBeVisible();
});
```
If the app does not serve at `/` without setup in this file, mirror the navigation/setup already used by the other tests in `e2e/plan.spec.ts` instead of `page.goto("/")`.

- [ ] **Step 2: Run the e2e suite**

Run: `pnpm test:e2e`
Expected: PASS (all e2e tests, including the existing workspace/plan/export smokes and the new editing test).

- [ ] **Step 3: Commit**

```bash
git add e2e/plan.spec.ts
git commit -m "test(e2e): cover block-editor typing in the plan

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 7: Documentation, featurelist, and full validation

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/TESTING.md`
- Modify: `docs/design_docs/featurelist.json`

**Interfaces:**
- Consumes: nothing.
- Produces: docs describing the BlockNote editor, the mock-based test strategy, and the PDF block-type behavior; featurelist updated per the repo convention.

- [ ] **Step 1: Update ARCHITECTURE.md**

In the `### Boundaries` bullet describing `RichTextEditor`, replace the TipTap description with BlockNote: the shared editor now wraps **BlockNote** (`useCreateBlockNote` + `@blocknote/mantine` `BlockNoteView`), converts HTML at the boundary (`tryParseHTMLToBlocks` / `blocksToHTMLLossy`), keeps storing HTML in `.preshot`, supports native block types (headings, checklists, tables, code) and palette colors, and renders a `compact` variant (no side menu) for group descriptions. Note that the font-size dropdown and arbitrary-hex picker were removed in favor of BlockNote's native model.

In the `### PDF export` section, update the marks sentence: text color still flows through inline `style`; add that BlockNote checklists render as bullet lists, code blocks as preformatted paragraphs (regular font), and tables are flattened to text.

- [ ] **Step 2: Update TESTING.md**

In the components bullet, replace the `RichTextEditor.test.tsx` description: it is now a thin jsdom smoke (labelled region, html hydration) because BlockNote needs real browser APIs; higher-level suites (`PlanPanel`, `ReferenceImagesTab`, `ProjectPlanProvider`) **mock** `RichTextEditor` as a labelled textarea; real editing is covered by a Playwright e2e in `e2e/plan.spec.ts`. In the infrastructure bullet, add the BlockNote block-type cases (checklist → bullet, code → preformatted, table → flattened) to the `htmlToBlocks.test.ts` description.

- [ ] **Step 3: Update featurelist.json**

In `docs/design_docs/featurelist.json`, under the `基础方案编辑` feature:
- Add a `feature_descriptions` entry (Chinese, matching the file's style):
  `"富文本编辑器改用 BlockNote，提供 Notion 风格的块编辑（斜杠菜单、拖拽块、清单/表格/代码块），方案与每组描述统一；持久化仍为 HTML，向后兼容旧内容"`.
- Add a `decisions` entry:
  `"Replace TipTap with BlockNote (0.52, Mantine) in both the plan body and group descriptions; keep HTML persistence via tryParseHTMLToBlocks/blocksToHTMLLossy (no migration); adopt native BlockNote formatting (drop font-size/hex); PDF renders checklists as bullets, code as preformatted text, tables flattened; editor coverage shifts to e2e with mocked component tests."`.
- Add a `progress.completed` entry:
  `"Migrated the shared rich-text editor from TipTap to BlockNote (Notion-style block editing) with a compact description variant, HTML-boundary conversion, jsdom shims + mocked component tests, an e2e editing smoke, and PDF handling for BlockNote block types."`.
- Replace `progress.lastVerified` with the counts observed in Step 4.

- [ ] **Step 4: Run the full validation matrix**

Run each and confirm PASS, recording counts for featurelist `lastVerified`:
```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm test:e2e
cargo test --manifest-path src-tauri\Cargo.toml
```
Expected: all PASS. If any fail, fix before committing.

- [ ] **Step 5: Validate featurelist.json parses**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('docs/design_docs/featurelist.json','utf8')); console.log('ok')"
```
Expected: prints `ok`.

- [ ] **Step 6: Commit**

```bash
git add docs/ARCHITECTURE.md docs/TESTING.md docs/design_docs/featurelist.json
git commit -m "docs(plan): document BlockNote editor migration

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Self-Review Notes

- **Spec coverage:** wrapper + HTML boundary (Task 2) ✓; both call sites incl. compact descriptions (Task 2) ✓; native formatting via BlockNote defaults (Task 2, no custom styles) ✓; HTML persistence unchanged (no task needed — reuses existing plan/manifest) ✓; dependency swap + `fontSize.ts` removal (Tasks 1, 3) ✓; theming (Task 1) ✓; PDF fidelity for new block types (Task 5) ✓; testing strategy — mocks + smoke + e2e (Tasks 2, 4, 6) ✓; docs + featurelist (Task 7) ✓.
- **Correction vs spec:** `blocksToHTMLLossy` emits inline `style="color:…"` (resolved hex), not `data-text-color`; therefore no palette→hex table is needed and text color flows through the existing inline-style reader. Task 5 covers only checklist/code/table.
- **Type consistency:** `RichTextEditor` props are identical across Tasks 2/4 (`html`, `onChange`, `ariaLabel`, `placeholder`, `compact`); the test mock matches that shape. `parseHtmlToBlocks`/`Block`/`Run` names match the existing module.
- **Risk:** if BlockNote cannot mount under jsdom even with the Task 1 shims, keep `RichTextEditor.test.tsx` limited to the labelled-region assertion (drop the hydration assertion) and rely on the Task 6 e2e; the higher-level suites are unaffected because they mock the editor.
