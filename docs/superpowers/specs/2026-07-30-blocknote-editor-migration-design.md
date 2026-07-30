# BlockNote Editor Migration Design

## Goal

Replace the TipTap-based rich-text editor with **BlockNote**
(https://www.blocknotejs.org/) to give the Photography Plan body and every
reference-group description a **Notion-style block editing experience** (slash
`/` menu, drag-to-reorder blocks, block types such as headings, checklists,
tables, and code). The stored/interchange format stays **HTML**, so persistence,
the `.preshot` manifest, and the existing pdf-lib PDF export are reused with only
targeted parser changes. The migration is backward-compatible with existing
TipTap-authored content — no data migration.

## Scope

In scope:

- Swap the internals of the shared `src/features/plan/RichTextEditor.tsx` from
  TipTap to BlockNote, preserving its public props (`html`, `onChange(html)`,
  `ariaLabel`, `placeholder`) and adding one optional `compact?: boolean`.
- Use BlockNote in **both** call sites: `PhotographyPlanTab` (full block UI) and
  each reference group's description in `ReferenceImagesTab` (`compact` — no
  drag-handle side menu).
- Adopt BlockNote's **native formatting model**: bold, italic, underline,
  strikethrough, inline code, palette **text color** and **highlight
  (background) color**, plus default block types (paragraph, headings 1–3,
  bullet/numbered/check lists, code block, table).
- Keep persisting **HTML** in `.preshot` via BlockNote's HTML conversion
  (`tryParseHTMLToBlocks` / `blocksToHTMLLossy`).
- Extend the PDF path (`htmlToBlocks.ts`) to understand BlockNote's lossy HTML at
  **today's fidelity** (see PDF section).
- Theme BlockNote (Mantine light theme) to fit the stone/amber palette.
- Remove now-unused direct TipTap dependencies and delete `fontSize.ts`.

Out of scope (deferred / dropped):

- The font-size dropdown and arbitrary-hex color picker added on 2026-07-30 are
  **removed** in favor of BlockNote's native palette colors (no inline font
  size). This is an intentional formatting-model change.
- Full PDF layout for tables (flattened to text), true monospace font embedding
  for code blocks, and multi-level nested block layout beyond one indent.
- Collaboration/real-time, image blocks uploaded through BlockNote's own
  uploader, comments, and AI features.
- Storing BlockNote JSON blocks as the persistence format (rejected — see
  Alternatives).

## Decisions (from brainstorming)

- **Motivation:** a Notion-style block editing experience.
- **Reach:** BlockNote in both the plan body and all group descriptions (one
  library, one component). Descriptions use a `compact` variant.
- **Formatting model:** native BlockNote (palette colors + block types); drop the
  custom font-size and arbitrary-hex controls.
- **Persistence:** keep **HTML** in `.preshot`; convert HTML ↔ blocks at the
  editor boundary. No manifest schema bump; no migration.
- **PDF fidelity:** today's fidelity — headings, paragraphs, lists, inline
  styles (palette colors mapped to hex). Checklists → bullet lists, code blocks →
  preformatted paragraphs (regular font), tables → flattened text.
- **UI kit:** BlockNote's **Mantine** variant (`@blocknote/mantine`).

## Architecture & Data Flow

The layering is unchanged; only the `RichTextEditor` internals change. Call sites
(`PhotographyPlanTab`, `ReferenceImagesTab`) and everything downstream (plan
reducers, `ProjectPlanProvider` auto-save, `.preshot` persistence, PDF export)
keep operating on **HTML strings**.

```text
PhotographyPlanTab / ReferenceImagesTab
  -> RichTextEditor({ html, onChange(html), ariaLabel, placeholder, compact? })
       (BlockNote: useCreateBlockNote + <BlockNoteView />)
       html string  <->  BlockNote blocks   (async conversion at the boundary)
  -> onChange(html) -> ProjectPlanProvider.applyPlan (in-memory)
  -> 5s change-detected auto-save -> .preshot (HTML, unchanged)
  -> Export PDF -> htmlToBlocks (BlockNote-aware) -> pdfLibExporter (unchanged core)
```

### `RichTextEditor` (BlockNote wrapper)

Props: `{ html: string; onChange(html: string): void; ariaLabel: string;
placeholder?: string; compact?: boolean }` — same as today plus `compact`.

- **Editor creation:** `const editor = useCreateBlockNote({ ... })`. Because
  HTML→blocks is **async**, the editor is created empty and hydrated in an
  effect.
- **Load (external → editor):** an effect watches `html`. When
  `html !== lastHtmlRef.current`, run
  `const blocks = await editor.tryParseHTMLToBlocks(html || "<p></p>")` then
  `editor.replaceBlocks(editor.document, blocks)` and set
  `lastHtmlRef.current = html`. This reconciles programmatic changes (e.g.
  switching projects) without echoing the editor's own output.
- **Emit (editor → external):** on `onChange`, compute
  `const html = await editor.blocksToHTMLLossy(editor.document)`; set
  `lastHtmlRef.current = html`; call `onChange(html)`. Emission is debounced
  (microtask/short timeout) to coalesce rapid edits; the existing 5s auto-save
  still governs disk writes.
- **Empty handling:** an empty document serializes to a benign empty string /
  single empty paragraph; loading `""` yields an empty editable doc so the
  placeholder shows.
- **Accessibility & label:** set the editable region's accessible name to
  `ariaLabel` (via `aria-label` on the `BlockNoteView`/editable host). Confirm
  the editable exposes `role="textbox"`; if BlockNote does not, wrap with an
  appropriately labelled region so call sites and tests can find it by an
  accessible name. (Verified during the first implementation task.)
- **Placeholder:** map `placeholder` to BlockNote's empty-block placeholder (via
  the editor `dictionary`/placeholder option or a scoped CSS
  `::before`). Descriptions pass their existing copy.
- **`compact`:** render `<BlockNoteView editor sideMenu={false} ... />` (hide the
  drag-handle/side menu) and apply denser padding; the formatting toolbar and
  slash menu remain. The plan body renders the full UI.

### Persistence & safety

HTML is produced only by BlockNote's lossy exporter (a bounded, known tag set)
and consumed only by BlockNote (re-parsed through its schema) and the PDF parser
(known tags only). No path renders untrusted HTML via `innerHTML`, so there is no
new injection sink. A future read-only HTML preview must go through DOMPurify.

## Dependencies & Theming

- **Add:** `@blocknote/core`, `@blocknote/react`, `@blocknote/mantine`
  (BlockNote 0.52.x; peer-compatible with React 19). BlockNote bundles its own
  ProseMirror/TipTap and pulls in Mantine + floating-ui transitively.
- **Remove (direct):** `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/pm`,
  `@tiptap/core`, `@tiptap/extension-link`, `@tiptap/extension-placeholder`,
  `@tiptap/extension-text-style`, `@tiptap/extension-color`. Delete
  `src/features/plan/fontSize.ts`.
- **CSS:** import `@blocknote/mantine/style.css` once at the app entry; add a
  scoped stylesheet overriding BlockNote CSS variables to the stone/amber
  palette (light theme). Remove the now-unused `.ProseMirror` rules from
  `styles.css`.
- **Bundle:** grows (Mantine + BlockNote). The existing Vite >500 KB chunk
  advisory remains acceptable; optional `manualChunks` split is a later
  optimization, out of scope.

## PDF Export (today's fidelity)

The exporter core (`pdfLibExporter.ts`, geometry, image slots, Noto Sans SC
embedding, per-run underline/strike/color rendering, light-gray image frame) is
**unchanged**. Only `src/infrastructure/pdf/htmlToBlocks.ts` is extended to map
BlockNote's lossy HTML into the existing `Block`/`Run` model:

- **Palette colors:** BlockNote's `blocksToHTMLLossy` emits inline styles with
  resolved values (e.g. `<span style="color: #dd3333">`), not `data-*`
  attributes. The exporter's existing inline-`style` reader already turns this
  into `Run.color`, so **text color needs no parser change**. Highlight
  (background) color is emitted as `background-color` and is ignored at today's
  fidelity (documented).
- **Checklists:** rendered as **bullet lists** (checkbox `<input>` carries no
  text, so list-item labels parse cleanly).
- **Code blocks (`<pre>`/`<code>`):** rendered as a **preformatted paragraph**
  preserving line breaks, using the regular font (no true monospace face is
  embedded — documented).
- **Tables (`<table>`):** **flattened to text**, one paragraph per row; full
  table geometry is deferred.
- Headings (`h1`/`h2`/`h3`), paragraphs, and bullet/numbered lists keep their
  current handling (`h3` → level 2).

The exact lossy-HTML shapes are pinned by unit tests in
`htmlToBlocks.test.ts`.

## Testing

BlockNote's floating formatting toolbar and slash menu require real browser APIs
(selection ranges, `ResizeObserver`, positioning), which jsdom does not reliably
provide. The strategy:

- **Incidental-editor component tests** (`ProjectPlanProvider`, `PlanPanel`,
  `ReferenceImagesTab`) **mock `RichTextEditor`** to a minimal labelled textarea
  that calls `onChange` with HTML. These suites verify their own
  orchestration (auto-save, export handoff, group actions), not the editor
  internals, so the mock keeps them fast and deterministic.
- **`RichTextEditor.test.tsx`** becomes a thin jsdom smoke: renders without
  throwing, exposes a region with the accessible `ariaLabel`, shows the
  placeholder for empty content, and round-trips provided `html` to visible
  text. Add jsdom shims as needed (`ResizeObserver`, `matchMedia`,
  `Range#getClientRects`, `DOMRect`) in the shared test setup. If BlockNote
  cannot mount under jsdom even with shims, this file falls back to asserting the
  wrapper's labelled region while the editing behavior is covered only by e2e
  (decided in the first task).
- **`htmlToBlocks.test.ts`** gains BlockNote-shape cases: palette-colored text,
  checklist → bullet, code block → preformatted paragraph, table → flattened
  text, plus a regression case for legacy TipTap HTML.
- **Playwright e2e** (`e2e/plan.spec.ts`): a small smoke that types into the plan
  editor, applies a formatting action, and verifies the content persists and the
  existing Export-PDF flow still succeeds. No binary assertions.
- Existing PDF/geometry/domain tests are unaffected.

## Risks & Mitigations

- **jsdom cannot mount BlockNote:** mitigated by mocking `RichTextEditor` in
  higher-level component suites and moving real editing coverage to e2e; the
  wrapper keeps a narrow, mockable surface.
- **Async HTML conversion loops:** mitigated by the `lastHtmlRef` guard and
  debounced emission; the load effect only replaces content when the external
  HTML differs from the last value the editor produced.
- **Lossy HTML shape differs from assumptions (colors/blocks):** pinned by unit
  tests generated from real `blocksToHTMLLossy` output before wiring the parser.
- **Accessible-name / role wiring:** verified in the first task; a labelled
  wrapper region is the fallback so call sites and tests remain stable.
- **Bundle growth (Mantine):** accepted for v1; `manualChunks` split deferred.
- **Theme clash with the dark app shell:** the editors live in the light middle
  panel; BlockNote uses its light theme with palette overrides.

## Documented Limitations

- No inline font size; text/highlight colors are BlockNote's fixed palette (not
  arbitrary hex).
- In the PDF: checklists render as bullets, code blocks as regular-font
  preformatted text, tables as flattened text; highlight/background color may be
  omitted.
- Real editing behavior (slash menu, drag reorder, formatting toolbar) is
  validated via e2e rather than jsdom component tests.

## Rejected Alternatives

- **Store BlockNote JSON blocks** instead of HTML — requires a `.preshot` schema
  bump + migration of existing content and a rewrite of the PDF parser to consume
  block JSON, with no user-facing benefit here. Keeping HTML preserves
  backward compatibility and reuses the whole export pipeline.
- **BlockNote only for the plan body**, a lighter editor for descriptions — two
  editor stacks to maintain and a larger bundle; rejected in favor of one
  consistent editor with a `compact` variant.
- **BlockNote's own PDF exporter** (`@blocknote/xl-pdf-exporter`, React-PDF) —
  would lose the custom A4 image-grid layout, square slots, CJK subset embedding,
  and light-gray frames already built; rejected.
