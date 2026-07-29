# Rich Text Editing and A4 PDF Export Design

## Goal

Extend `基础方案编辑` (Basic Plan Editing) with two related capabilities, built in
two phases within one cohesive design:

1. **Rich text editing** — the Photography Plan body and every reference group's
   description become rich text (headings, bold, italic, bullet/ordered lists,
   links), edited with a shared TipTap editor and stored as **HTML** in the
   `.preshot` manifest.
2. **A4 PDF export** — an *Export PDF* action lays the whole plan (Photography
   Plan + reference groups + their images) out onto standard **A4** pages and
   writes a real, selectable-text PDF using `pdf-lib` + `@pdf-lib/fontkit` with a
   bundled CJK font (Noto Sans SC). Images keep the configured per-row count in
   equal **square slots**, each showing the complete image with white
   letterboxing when the aspect ratio differs.

## Scope

In scope:

- `ProjectPlan.photographyPlan` HTML field; `ReferenceGroup.description` becomes
  HTML (same `string` type).
- A shared `RichTextEditor` (TipTap) with a small, accessible toolbar, used by
  the Photography Plan tab and each reference group.
- Pure domain assembly of an export document + A4 geometry helpers.
- A `pdf-lib` exporter adapter that renders rich-text blocks and letterboxed
  image grids across paginated A4 pages, embedding Noto Sans SC (Regular + Bold).
- Saving the PDF through a native save dialog and a narrow Rust `save_pdf`
  command.
- An *Export PDF* control in the Plan panel header.

Out of scope (deferred):

- Drag-and-drop reordering; tables, images, colors, or alignment inside rich
  text; footnotes.
- CJK italic (does not exist); clickable link annotations in the PDF (may be a
  later add-on — v1 renders links as underlined colored text).
- Print-dialog / rasterized export paths (Options A/B were rejected in favor of
  native `pdf-lib`).
- Canvas, assets, and copywriting features.

## Decisions (from brainstorming)

- **Phasing:** one combined design, delivered as rich text first, then PDF.
- **Editor:** TipTap (headless, React-first, schema-safe HTML).
- **PDF engine:** native `pdf-lib` with a bounded rich-text renderer (true file
  export, selectable text, small files) — not print-to-PDF or rasterization.
- **CJK:** bundle Noto Sans SC (Regular + Bold); output PDFs are subset so they
  stay small.
- **Image slots:** square 1:1, `contain` + white letterbox, per-row =
  `columnsPerRow`.

## Data Model

TypeScript (`src/domain/plan/models.ts`):

```ts
interface ProjectPlan {
  photographyPlan: string;      // HTML, defaults to ""
  referenceGroups: ReferenceGroup[];
}
// ReferenceGroup.description: string  // now HTML (was plain text)
export const EMPTY_PLAN: ProjectPlan = { photographyPlan: "", referenceGroups: [] };
```

Rust (`src-tauri/src/workspace.rs`):

```rust
pub struct ProjectPlan {
    #[serde(default)]
    pub photography_plan: String,
    #[serde(default)]
    pub reference_groups: Vec<ReferenceGroup>,
}
```

- `#[serde(default)]` and the TS adapter tolerate a missing `photographyPlan`, so
  manifests written before this change (including the `Scenery Samples` demo)
  load unchanged.
- Descriptions that are plain text (no tags) are valid HTML and render as a
  single paragraph everywhere.
- No manifest schema-version bump is required; the field is additive and
  optional.

## Phase 1 — Rich Text Editing

### Domain

- `plan.ts`: add pure reducer `setPhotographyPlan(plan, html)`. `setDescription`
  is unchanged (it already sets a string; the string is now HTML).
- `service.ts`: add non-persisting `setPhotographyPlan(plan, html)` use case
  (pure-metadata edit, deferred to the existing 5s auto-save). No projectPath.

### UI (`src/features/plan`)

- `RichTextEditor.tsx`: wraps TipTap `useEditor` with `StarterKit` restricted to
  paragraph, heading (levels 1–2), bold, italic, bulletList, orderedList,
  listItem, hardBreak, plus the `Link` extension. Props:
  `{ html, onChange(html), ariaLabel, placeholder? }`. A toolbar exposes Bold,
  Italic, H1, H2, Bullet list, Numbered list, and Link, each an accessible
  `button` reflecting active state (`aria-pressed`). The editor content region
  has `role="textbox"`, `aria-multiline="true"`, and the provided `aria-label`.
- Change flow: `editor.onUpdate` → `onChange(editor.getHTML())`. External HTML
  changes reconcile via `editor.commands.setContent` guarded against echoing the
  editor's own output. Content is applied in-memory (`applyPlan`); the 5s
  auto-save persists it — no per-keystroke disk writes.
- `PhotographyPlanTab.tsx`: replaces the "Coming soon" placeholder with a
  labeled section containing the editor bound to `plan.photographyPlan`.
- `ReferenceImagesTab.tsx`: replaces the description `<textarea>`
  (`GroupDescriptionInput`) with the editor bound to `group.description`; the
  high-contrast styling requirement carries over (dark body text).

### Persistence & safety

- HTML is produced only by TipTap's schema (a known-safe subset), and consumed
  only by TipTap (re-parsed through the schema) and the PDF parser (which handles
  only known tags). No path renders untrusted raw HTML via `innerHTML`, so there
  is no injection sink. If a read-only HTML render is ever added, it must go
  through DOMPurify.

## Phase 2 — A4 PDF Export

### Layering

```text
React UI (Export PDF button)
  -> domain use case: exportPlanToPdf(plan, imageData, exporter) -> Uint8Array
       - buildExportDocument(plan): pure plan -> ordered PdfExportDocument
       - pure geometry: a4ContentBox(), squareSlotGrid(), containRect()
  -> domain port: PdfExporter.export(document, imageData) -> Uint8Array
  -> infrastructure: pdfLibExporter (pdf-lib + fontkit + Noto Sans SC),
                     htmlToBlocks (DOMParser)
  -> save: Tauri dialog.save + Rust save_pdf(path, contents)
```

### Domain (pure, tested)

- `pdf/document.ts`:
  - Types: `RichHtml = string`; `PdfSection = { heading?: string; html: RichHtml;
    imageGrid?: { columns: number; files: string[] } }`;
    `PdfExportDocument = { title: string; sections: PdfSection[] }`.
  - `buildExportDocument(plan, title)`: section 1 = Photography Plan (`html =
    plan.photographyPlan`, no grid); then one section per reference group
    (`heading = title`, `html = description`, `imageGrid = { columns:
    columnsPerRow, files }`). Empty photographyPlan still yields the section
    heading only; groups with no images yield text only.
- `pdf/geometry.ts` (all in PDF points, 72 dpi):
  - `A4 = { width: 595.28, height: 841.89 }`, `MARGIN = 48`.
  - `contentBox()` → `{ x, y, width, height }` inside margins.
  - `squareSlotGrid(contentWidth, columns, gap)` → `{ slotSize, positions[] }`
    for one row (x offsets); slot height = slot width (square).
  - `containRect(slotX, slotY, slotSize, imgW, imgH)` → centered fitted
    `{ x, y, width, height }` (letterbox math; equal white margins on the short
    axis).

### Infrastructure

- `pdf/htmlToBlocks.ts`: `parseHtmlToBlocks(html): Block[]` using `DOMParser`.
  `Block = Heading{level, runs} | Paragraph{runs} | List{ordered, items: runs[][]}`;
  `Run = { text, bold, italic, link? }`. Unknown tags degrade to their text
  content. Testable under jsdom.
- `pdf/pdfLibExporter.ts`: implements `PdfExporter`.
  - Loads and registers Noto Sans SC Regular + Bold via `fontkit`; italic maps to
    Regular (documented limitation). The TTFs live under
    `src/infrastructure/pdf/fonts/` and are loaded in the webview via a Vite
    `?url` import + `fetch(...).arrayBuffer()`, then `embedFont` with subsetting.
  - Draws a y-cursor layout: document title, then each section's optional heading
    (H1/H2 sizes), rich-text blocks with **word-wrapping for spaced text and
    per-character wrapping for CJK**, list markers (`•` / `1.`) with indent, and
    the image grid.
  - Image grid: `columns = section.imageGrid.columns`; square slots from
    `squareSlotGrid`; each image embedded with `embedPng`/`embedJpg` (chosen by
    the data-URL mime), drawn via `containRect`, centered, on the white page —
    producing the letterbox. **A row is never split across a page**; if it does
    not fit, a new page starts first.
  - Pagination: new page whenever the next line or image row would cross the
    bottom margin.
  - Returns `Uint8Array` (`PDFDocument.save()`).
- Save adapter: `dialog.save({ defaultPath: "<project name>.pdf", filters: [pdf]
  })` → path; the frontend base64-encodes the `Uint8Array` and calls Rust
  `save_pdf(path: String, contents_base64: String)`, which decodes and writes the
  bytes atomically (temp file + rename), mirroring how images are already moved
  base64 across the boundary. The browser adapter stubs the save (E2E) or
  triggers a Blob download.

### UI & flow

- `PlanPanel` header gains an **Export PDF** button beside the save-status pill.
- `ProjectPlanProvider.exportPdf()`: builds the document from the current plan and
  the already-loaded `imageSrc` data URLs, calls the exporter, opens the save
  dialog, writes via the save adapter. Guarded busy state ("Exporting…"),
  errors surfaced through the existing alert path.
- Dependencies: the exporter + saver are injected through the existing
  `PlanDependencies`/composition root, with production (Tauri) and browser (E2E)
  implementations, mirroring the workspace/plan adapter split.

### Layout specifics

- A4 portrait, 48pt margins, project name as the top title (H1).
- H1 18pt bold, H2 14pt bold; body 11pt, line height ≈ 1.35; paragraph spacing
  ≈ 6pt; list indent ≈ 16pt.
- Image grid gap ≈ 12pt; slot is square; complete image centered with white
  letterbox.
- Group heading + its description flow together; only image **rows** are kept
  atomic across page breaks.

## Testing

- **Domain:** `setPhotographyPlan` reducer/service; `buildExportDocument`
  ordering and mapping; `geometry` (`containRect` letterbox for landscape,
  portrait, square; `squareSlotGrid` sizing; content box).
- **Infrastructure:** `parseHtmlToBlocks` (headings, bold/italic/link runs,
  bullet & ordered lists, unknown-tag degradation) under jsdom; `pdfLibExporter`
  produces a valid PDF from a sample plan containing CJK text and a tiny PNG —
  parse it back with `pdf-lib` and assert ≥1 page and A4 page size, and that CJK
  text does not throw (font embedded).
- **Rust:** `save_pdf` writes given bytes to a path inside `tempfile::tempdir`.
- **Components:** `RichTextEditor` toolbar toggles bold/heading and emits the
  expected HTML; `PhotographyPlanTab` / `ReferenceImagesTab` render the editor
  bound to their content; the Export button invokes a mocked exporter + saver.
- **Browser E2E:** clicking *Export PDF* runs the exporter and invokes the
  stubbed saver (kept light — no assertion on binary output).

## Risks & Mitigations

- **CJK font size in the app bundle:** bundle only Regular + Bold; rely on
  `pdf-lib` subsetting for small output PDFs.
- **Rich-text layout engine complexity:** bounded by TipTap's restricted schema;
  the parser and renderer only handle the supported block/run set, everything
  else degrades to text.
- **Large images inflating the PDF:** images are embedded as-is (already ≤16 MB,
  and the demo assets are tens of KB); downscaling is a possible later
  optimization, out of scope for v1.

## Documented v1 Limitations

- Italic renders as regular weight in the PDF (no CJK italic); the editor still
  shows italic.
- Links render as underlined colored text without a clickable annotation.
- One level of list nesting is rendered with indentation; deeper nesting is
  flattened to that indent.
