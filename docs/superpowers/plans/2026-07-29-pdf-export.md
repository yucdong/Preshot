# A4 PDF Export Implementation Plan (Phase 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Depends on:** Phase 1 (`docs/superpowers/plans/2026-07-29-rich-text-editing.md`) — `ProjectPlan.photographyPlan` and HTML descriptions must already exist.

**Goal:** Add an *Export PDF* action that lays the whole plan (Photography Plan + reference groups + images) onto standard A4 pages and writes a real, selectable-text PDF using `pdf-lib` + `@pdf-lib/fontkit` with a bundled CJK font.

**Architecture:** Pure domain document assembly + A4 geometry → a `PdfExporter` port implemented by a `pdf-lib` adapter (embeds Noto Sans SC, draws rich-text blocks with word/char wrapping and pagination, and draws each image contain-fit + white-letterboxed in a square slot) → save via a `PdfSaveTarget` (Tauri save dialog + a narrow Rust `save_pdf` command).

**Tech Stack:** pdf-lib 1.17 (already installed), @pdf-lib/fontkit, Noto Sans SC (OFL), DOMParser, React 19 + TS, Rust/Tauri, Vitest, pnpm.

## Global Constraints

- Package manager is **pnpm**; no npm/yarn lock files.
- `domain/` must not import React, Tauri, browser APIs, or infrastructure; `pdf-lib` lives only in `src/infrastructure` (per AGENTS.md).
- Direct `@tauri-apps/*` imports only in `src/infrastructure`.
- PDF is **A4 portrait**: `A4 = { width: 595.28, height: 841.89 }` pt; margins `48` pt.
- Image slots are **square** (`columnsPerRow` per row); images are `contain`-fit, centered, white-letterboxed; **image rows never split across pages**.
- Fonts: Noto Sans SC **Regular + Bold**, embedded with subsetting; italic maps to Regular (documented v1 limitation); links render as underlined colored text (no clickable annotation).
- TDD; co-locate `*.test.ts(x)`; validation matrix: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `cargo test --manifest-path src-tauri\Cargo.toml`, `pnpm build`.

---

### Task 1: A4 geometry helpers (pure domain)

**Files:**
- Create: `src/domain/plan/pdf/geometry.ts`
- Test: `src/domain/plan/pdf/geometry.test.ts`

**Interfaces:**
- Produces:
  - `A4 = { width: 595.28, height: 841.89 }`, `MARGIN = 48`
  - `interface Box { x: number; y: number; width: number; height: number }`
  - `contentBox(): Box` — the printable area (bottom-left origin, pdf-lib coords)
  - `squareSlotGrid(contentWidth: number, columns: number, gap: number): { slotSize: number; xOffsets: number[] }`
  - `containSize(slotSize: number, imgWidth: number, imgHeight: number): { width: number; height: number; offsetX: number; offsetY: number }`

- [ ] **Step 1: Write the failing test**

Create `src/domain/plan/pdf/geometry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { A4, containSize, contentBox, MARGIN, squareSlotGrid } from "./geometry";

describe("pdf geometry", () => {
  it("computes the A4 content box inside the margins", () => {
    const box = contentBox();
    expect(box).toEqual({
      x: MARGIN,
      y: MARGIN,
      width: A4.width - 2 * MARGIN,
      height: A4.height - 2 * MARGIN,
    });
  });

  it("splits a row into equal square slots with gaps", () => {
    const grid = squareSlotGrid(500, 3, 10);
    expect(grid.slotSize).toBeCloseTo((500 - 2 * 10) / 3, 5);
    expect(grid.xOffsets).toHaveLength(3);
    expect(grid.xOffsets[0]).toBe(0);
    expect(grid.xOffsets[1]).toBeCloseTo(grid.slotSize + 10, 5);
    expect(grid.xOffsets[2]).toBeCloseTo(2 * (grid.slotSize + 10), 5);
  });

  it("contain-fits and centers landscape, portrait, and square images", () => {
    expect(containSize(100, 200, 100)).toEqual({ width: 100, height: 50, offsetX: 0, offsetY: 25 });
    expect(containSize(100, 100, 200)).toEqual({ width: 50, height: 100, offsetX: 25, offsetY: 0 });
    expect(containSize(100, 100, 100)).toEqual({ width: 100, height: 100, offsetX: 0, offsetY: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run src/domain/plan/pdf/geometry.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/domain/plan/pdf/geometry.ts`:

```ts
export const A4 = { width: 595.28, height: 841.89 } as const;
export const MARGIN = 48;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function contentBox(): Box {
  return {
    x: MARGIN,
    y: MARGIN,
    width: A4.width - 2 * MARGIN,
    height: A4.height - 2 * MARGIN,
  };
}

export function squareSlotGrid(
  contentWidth: number,
  columns: number,
  gap: number,
): { slotSize: number; xOffsets: number[] } {
  const safeColumns = Math.max(1, Math.floor(columns));
  const slotSize = (contentWidth - gap * (safeColumns - 1)) / safeColumns;
  const xOffsets = Array.from({ length: safeColumns }, (_unused, i) => i * (slotSize + gap));
  return { slotSize, xOffsets };
}

export function containSize(
  slotSize: number,
  imgWidth: number,
  imgHeight: number,
): { width: number; height: number; offsetX: number; offsetY: number } {
  const scale = Math.min(slotSize / imgWidth, slotSize / imgHeight);
  const width = imgWidth * scale;
  const height = imgHeight * scale;
  return {
    width,
    height,
    offsetX: (slotSize - width) / 2,
    offsetY: (slotSize - height) / 2,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- --run src/domain/plan/pdf/geometry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/plan/pdf/geometry.ts src/domain/plan/pdf/geometry.test.ts
git commit -m "feat(pdf): A4 geometry and letterbox helpers"
```

---

### Task 2: Export document model (pure domain)

**Files:**
- Create: `src/domain/plan/pdf/document.ts`
- Test: `src/domain/plan/pdf/document.test.ts`

**Interfaces:**
- Consumes: `ProjectPlan` from `../models`.
- Produces:
  - `interface PdfImageGrid { columns: number; files: string[] }`
  - `interface PdfSection { heading?: string; html: string; imageGrid?: PdfImageGrid }`
  - `interface PdfExportDocument { title: string; sections: PdfSection[] }`
  - `buildExportDocument(plan: ProjectPlan, title: string): PdfExportDocument`

- [ ] **Step 1: Write the failing test**

Create `src/domain/plan/pdf/document.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ProjectPlan } from "../models";
import { buildExportDocument } from "./document";

const plan: ProjectPlan = {
  photographyPlan: "<p>Notes</p>",
  referenceGroups: [
    {
      id: "g1",
      title: "Lookbook",
      description: "<p>Warm</p>",
      columnsPerRow: 3,
      images: [{ id: "i1", file: "references/0001.png" }],
    },
  ],
};

describe("buildExportDocument", () => {
  it("puts the photography plan first, then one section per group", () => {
    const doc = buildExportDocument(plan, "Sunset Shoot");
    expect(doc.title).toBe("Sunset Shoot");
    expect(doc.sections[0]).toEqual({ html: "<p>Notes</p>" });
    expect(doc.sections[1]).toEqual({
      heading: "Lookbook",
      html: "<p>Warm</p>",
      imageGrid: { columns: 3, files: ["references/0001.png"] },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run src/domain/plan/pdf/document.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/domain/plan/pdf/document.ts`:

```ts
import type { ProjectPlan } from "../models";

export interface PdfImageGrid {
  columns: number;
  files: string[];
}

export interface PdfSection {
  heading?: string;
  html: string;
  imageGrid?: PdfImageGrid;
}

export interface PdfExportDocument {
  title: string;
  sections: PdfSection[];
}

export function buildExportDocument(plan: ProjectPlan, title: string): PdfExportDocument {
  const sections: PdfSection[] = [{ html: plan.photographyPlan }];
  for (const group of plan.referenceGroups) {
    sections.push({
      heading: group.title,
      html: group.description,
      imageGrid: { columns: group.columnsPerRow, files: group.images.map((image) => image.file) },
    });
  }
  return { title, sections };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- --run src/domain/plan/pdf/document.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/plan/pdf/document.ts src/domain/plan/pdf/document.test.ts
git commit -m "feat(pdf): pure export document assembly"
```

---

### Task 3: PDF ports and the export use case (pure domain)

**Files:**
- Create: `src/domain/plan/pdf/ports.ts`
- Create: `src/domain/plan/pdf/export.ts`
- Test: `src/domain/plan/pdf/export.test.ts`

**Interfaces:**
- Consumes: `buildExportDocument` (Task 2), `ProjectPlan`.
- Produces:
  - `interface PdfExporter { export(document: PdfExportDocument, images: Record<string, string>): Promise<Uint8Array> }`
  - `interface PdfSaveTarget { save(bytes: Uint8Array, suggestedName: string): Promise<boolean> }`
  - `exportPlanToPdf(exporter: PdfExporter, plan: ProjectPlan, title: string, images: Record<string, string>): Promise<Uint8Array>`

- [ ] **Step 1: Write the failing test**

Create `src/domain/plan/pdf/export.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { ProjectPlan } from "../models";
import { exportPlanToPdf } from "./export";
import type { PdfExporter } from "./ports";

const plan: ProjectPlan = { photographyPlan: "<p>x</p>", referenceGroups: [] };

describe("exportPlanToPdf", () => {
  it("builds the document and delegates to the exporter", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const exporter: PdfExporter = { export: vi.fn().mockResolvedValue(bytes) };

    const result = await exportPlanToPdf(exporter, plan, "Shoot", { "references/0001.png": "data:image/png;base64,AA" });

    expect(result).toBe(bytes);
    expect(exporter.export).toHaveBeenCalledWith(
      { title: "Shoot", sections: [{ html: "<p>x</p>" }] },
      { "references/0001.png": "data:image/png;base64,AA" },
    );
  });

  it("wraps exporter failures with context", async () => {
    const exporter: PdfExporter = { export: vi.fn().mockRejectedValue(new Error("boom")) };
    await expect(exportPlanToPdf(exporter, plan, "Shoot", {})).rejects.toThrow(
      /Unable to build the plan PDF: boom/,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run src/domain/plan/pdf/export.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

Create `src/domain/plan/pdf/ports.ts`:

```ts
import type { PdfExportDocument } from "./document";

export interface PdfExporter {
  export(document: PdfExportDocument, images: Record<string, string>): Promise<Uint8Array>;
}

export interface PdfSaveTarget {
  save(bytes: Uint8Array, suggestedName: string): Promise<boolean>;
}
```

Create `src/domain/plan/pdf/export.ts`:

```ts
import type { ProjectPlan } from "../models";
import { buildExportDocument } from "./document";
import type { PdfExporter } from "./ports";

export async function exportPlanToPdf(
  exporter: PdfExporter,
  plan: ProjectPlan,
  title: string,
  images: Record<string, string>,
): Promise<Uint8Array> {
  const document = buildExportDocument(plan, title);
  try {
    return await exporter.export(document, images);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to build the plan PDF: ${message}`, { cause: error });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- --run src/domain/plan/pdf/export.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/plan/pdf/ports.ts src/domain/plan/pdf/export.ts src/domain/plan/pdf/export.test.ts
git commit -m "feat(pdf): PdfExporter/PdfSaveTarget ports and export use case"
```

---

### Task 4: HTML → blocks parser (infrastructure)

**Files:**
- Create: `src/infrastructure/pdf/htmlToBlocks.ts`
- Test: `src/infrastructure/pdf/htmlToBlocks.test.ts`

**Interfaces:**
- Produces:
  - `interface Run { text: string; bold?: boolean; italic?: boolean; link?: string }`
  - `type Block = { type: "heading"; level: 1 | 2; runs: Run[] } | { type: "paragraph"; runs: Run[] } | { type: "list"; ordered: boolean; items: Run[][] }`
  - `parseHtmlToBlocks(html: string): Block[]`

- [ ] **Step 1: Write the failing test**

Create `src/infrastructure/pdf/htmlToBlocks.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseHtmlToBlocks } from "./htmlToBlocks";

describe("parseHtmlToBlocks", () => {
  it("parses headings and inline marks", () => {
    const blocks = parseHtmlToBlocks("<h1>Title</h1><p>Body <strong>bold</strong> <em>it</em></p>");
    expect(blocks[0]).toEqual({ type: "heading", level: 1, runs: [{ text: "Title" }] });
    expect(blocks[1]).toEqual({
      type: "paragraph",
      runs: [{ text: "Body " }, { text: "bold", bold: true }, { text: " " }, { text: "it", italic: true }],
    });
  });

  it("parses bullet and ordered lists and links", () => {
    expect(parseHtmlToBlocks("<ul><li>one</li><li>two</li></ul>")).toEqual([
      { type: "list", ordered: false, items: [[{ text: "one" }], [{ text: "two" }]] },
    ]);
    expect(parseHtmlToBlocks("<ol><li>a</li></ol>")).toEqual([
      { type: "list", ordered: true, items: [[{ text: "a" }]] },
    ]);
    expect(parseHtmlToBlocks('<p><a href="http://x">link</a></p>')).toEqual([
      { type: "paragraph", runs: [{ text: "link", link: "http://x" }] },
    ]);
  });

  it("treats plain text and unknown tags as a paragraph", () => {
    expect(parseHtmlToBlocks("hello")).toEqual([{ type: "paragraph", runs: [{ text: "hello" }] }]);
    expect(parseHtmlToBlocks("<div>x</div>")).toEqual([{ type: "paragraph", runs: [{ text: "x" }] }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run src/infrastructure/pdf/htmlToBlocks.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/infrastructure/pdf/htmlToBlocks.ts`:

```ts
export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  link?: string;
}

export type Block =
  | { type: "heading"; level: 1 | 2; runs: Run[] }
  | { type: "paragraph"; runs: Run[] }
  | { type: "list"; ordered: boolean; items: Run[][] };

interface Marks {
  bold?: boolean;
  italic?: boolean;
  link?: string;
}

function collectRuns(node: Node, marks: Marks, runs: Run[]): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3 /* text */) {
      const text = child.textContent ?? "";
      if (text) {
        runs.push({ text, ...(marks.bold ? { bold: true } : {}), ...(marks.italic ? { italic: true } : {}), ...(marks.link ? { link: marks.link } : {}) });
      }
      continue;
    }
    if (child.nodeType !== 1 /* element */) continue;
    const el = child as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const next: Marks = { ...marks };
    if (tag === "strong" || tag === "b") next.bold = true;
    if (tag === "em" || tag === "i") next.italic = true;
    if (tag === "a") next.link = el.getAttribute("href") ?? marks.link;
    collectRuns(el, next, runs);
  }
}

function runsOf(el: Element): Run[] {
  const runs: Run[] = [];
  collectRuns(el, {}, runs);
  return runs;
}

export function parseHtmlToBlocks(html: string): Block[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const blocks: Block[] = [];
  const pushParagraph = (runs: Run[]) => {
    if (runs.some((r) => r.text.trim() !== "")) blocks.push({ type: "paragraph", runs });
  };
  for (const node of Array.from(doc.body.childNodes)) {
    if (node.nodeType === 3) {
      const text = node.textContent ?? "";
      if (text.trim()) pushParagraph([{ text }]);
      continue;
    }
    if (node.nodeType !== 1) continue;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === "h1") blocks.push({ type: "heading", level: 1, runs: runsOf(el) });
    else if (tag === "h2" || tag === "h3") blocks.push({ type: "heading", level: 2, runs: runsOf(el) });
    else if (tag === "ul" || tag === "ol") {
      const items = Array.from(el.querySelectorAll(":scope > li")).map((li) => runsOf(li));
      blocks.push({ type: "list", ordered: tag === "ol", items });
    } else pushParagraph(runsOf(el));
  }
  return blocks;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- --run src/infrastructure/pdf/htmlToBlocks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/pdf/htmlToBlocks.ts src/infrastructure/pdf/htmlToBlocks.test.ts
git commit -m "feat(pdf): HTML to rich-text blocks parser"
```

---

### Task 5: `pdf-lib` exporter with CJK fonts

**Files:**
- Modify: `package.json` (pnpm add `@pdf-lib/fontkit`)
- Create: `src/infrastructure/pdf/fonts/NotoSansSC-Regular.otf` (OFL asset)
- Create: `src/infrastructure/pdf/fonts/NotoSansSC-Bold.otf` (OFL asset)
- Create: `src/infrastructure/pdf/fonts/OFL.txt` (license text)
- Create: `src/infrastructure/pdf/pdfLibExporter.ts`
- Test: `src/infrastructure/pdf/pdfLibExporter.test.ts`

**Interfaces:**
- Consumes: `geometry` (Task 1), `PdfExportDocument`/`PdfSection` (Task 2), `PdfExporter` (Task 3), `parseHtmlToBlocks`/`Run`/`Block` (Task 4).
- Produces: `createPdfLibExporter(loadFonts: () => Promise<{ regular: Uint8Array; bold: Uint8Array }>): PdfExporter`.

- [ ] **Step 1: Install fontkit and fetch the fonts**

Run:
```bash
pnpm add @pdf-lib/fontkit
```

Fetch Noto Sans SC (OFL 1.1) static fonts into the fonts folder (place the equivalent Regular/Bold static OTF/TTF here; the embed test in Step 4 is the acceptance gate). Primary attempt:
```bash
mkdir src/infrastructure/pdf/fonts
curl -L -o src/infrastructure/pdf/fonts/NotoSansSC-Regular.otf "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf"
curl -L -o src/infrastructure/pdf/fonts/NotoSansSC-Bold.otf    "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Bold.otf"
```
If the URLs are unavailable, download "Noto Sans SC" Regular + Bold from fonts.google.com/noto/specimen/Noto+Sans+SC and save to the same two paths. Save the license text to `src/infrastructure/pdf/fonts/OFL.txt`. Verify each file is > 1 MB (a real font, not an HTML error page): `Get-Item src/infrastructure/pdf/fonts/*.otf | Select-Object Name,Length`.

- [ ] **Step 2: Write the failing test**

Create `src/infrastructure/pdf/pdfLibExporter.test.ts`:

```ts
// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { PdfExportDocument } from "../../domain/plan/pdf/document";
import { createPdfLibExporter } from "./pdfLibExporter";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const loadFonts = async () => ({
  regular: new Uint8Array(readFileSync("src/infrastructure/pdf/fonts/NotoSansSC-Regular.otf")),
  bold: new Uint8Array(readFileSync("src/infrastructure/pdf/fonts/NotoSansSC-Bold.otf")),
});

describe("createPdfLibExporter", () => {
  it("produces a valid A4 PDF with CJK text and a letterboxed image", async () => {
    const exporter = createPdfLibExporter(loadFonts);
    const doc: PdfExportDocument = {
      title: "拍摄计划",
      sections: [
        { html: "<h1>山景</h1><p>晨雾 <strong>逆光</strong> and Latin</p><ul><li>晨曦</li></ul>" },
        { heading: "水景", html: "<p>日落倒影</p>", imageGrid: { columns: 2, files: ["references/0001.png"] } },
      ],
    };

    const bytes = await exporter.export(doc, { "references/0001.png": TINY_PNG });

    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBeGreaterThanOrEqual(1);
    const page = parsed.getPage(0);
    expect(Math.round(page.getWidth())).toBe(595);
    expect(Math.round(page.getHeight())).toBe(842);
  }, 20000);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test -- --run src/infrastructure/pdf/pdfLibExporter.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement the exporter**

Create `src/infrastructure/pdf/pdfLibExporter.ts`:

```ts
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { A4, contentBox, containSize, MARGIN, squareSlotGrid } from "../../domain/plan/pdf/geometry";
import type { PdfExportDocument, PdfSection } from "../../domain/plan/pdf/document";
import type { PdfExporter } from "../../domain/plan/pdf/ports";
import { parseHtmlToBlocks, type Block, type Run } from "./htmlToBlocks";

const TITLE_SIZE = 18;
const H1_SIZE = 18;
const H2_SIZE = 14;
const BODY_SIZE = 11;
const LINE = 1.35;
const PARA_GAP = 6;
const LIST_INDENT = 16;
const GRID_GAP = 12;
const TEXT_COLOR = rgb(0.11, 0.1, 0.09);
const LINK_COLOR = rgb(0.15, 0.39, 0.92);

interface Fonts {
  regular: Uint8Array;
  bold: Uint8Array;
}

interface Token {
  text: string;
  font: PDFFont;
  isSpace: boolean;
  link?: string;
}

function isCjk(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (c >= 0x3000 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af) || (c >= 0xff00 && c <= 0xffef) || (c >= 0x20000 && c <= 0x2ffff);
}

function tokenizeRun(run: Run, font: PDFFont): Token[] {
  const tokens: Token[] = [];
  let word = "";
  const flush = () => {
    if (word) {
      tokens.push({ text: word, font, link: run.link, isSpace: false });
      word = "";
    }
  };
  for (const ch of run.text) {
    if (ch === " " || ch === "\n" || ch === "\t") {
      flush();
      tokens.push({ text: " ", font, isSpace: true });
    } else if (isCjk(ch)) {
      flush();
      tokens.push({ text: ch, font, link: run.link, isSpace: false });
    } else {
      word += ch;
    }
  }
  flush();
  return tokens;
}

function dataUrlToBytes(dataUrl: string): { mime: string; bytes: Uint8Array } {
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!match) throw new Error("Unsupported image data URL");
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return { mime: match[1], bytes };
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

export function createPdfLibExporter(loadFonts: () => Promise<Fonts>): PdfExporter {
  return {
    async export(document: PdfExportDocument, images: Record<string, string>): Promise<Uint8Array> {
      const pdf = await PDFDocument.create();
      pdf.registerFontkit(fontkit);
      const fonts = await loadFonts();
      const regular = await pdf.embedFont(fonts.regular, { subset: true });
      const bold = await pdf.embedFont(fonts.bold, { subset: true });
      const box = contentBox();
      const embedded = new Map<string, PDFImage>();

      let page: PDFPage = pdf.addPage([A4.width, A4.height]);
      let cursorY = A4.height - MARGIN;

      const newPage = () => {
        page = pdf.addPage([A4.width, A4.height]);
        cursorY = A4.height - MARGIN;
      };
      const ensure = (height: number) => {
        if (cursorY - height < MARGIN) newPage();
      };

      const drawRuns = (runs: Run[], size: number, boldDefault: boolean, indent = 0) => {
        const maxWidth = box.width - indent;
        const tokens = runs.flatMap((run) => tokenizeRun(run, run.bold || boldDefault ? bold : regular));
        const lineHeight = size * LINE;
        let line: Token[] = [];
        let width = 0;
        const flushLine = () => {
          ensure(lineHeight);
          let x = box.x + indent;
          const baseline = cursorY - size;
          for (const t of line) {
            const w = t.font.widthOfTextAtSize(t.text, size);
            page.drawText(t.text, { x, y: baseline, size, font: t.font, color: t.link ? LINK_COLOR : TEXT_COLOR });
            if (t.link && !t.isSpace) {
              page.drawLine({ start: { x, y: baseline - 1.5 }, end: { x: x + w, y: baseline - 1.5 }, thickness: 0.5, color: LINK_COLOR });
            }
            x += w;
          }
          cursorY -= lineHeight;
          line = [];
          width = 0;
        };
        for (const t of tokens) {
          const w = t.font.widthOfTextAtSize(t.text, size);
          if (!t.isSpace && width + w > maxWidth && line.length > 0) flushLine();
          if (t.isSpace && line.length === 0) continue;
          line.push(t);
          width += w;
        }
        if (line.length > 0) flushLine();
      };

      const drawBlocks = (blocks: Block[]) => {
        for (const block of blocks) {
          if (block.type === "heading") {
            cursorY -= PARA_GAP;
            drawRuns(block.runs, block.level === 1 ? H1_SIZE : H2_SIZE, true);
            cursorY -= PARA_GAP / 2;
          } else if (block.type === "paragraph") {
            drawRuns(block.runs, BODY_SIZE, false);
            cursorY -= PARA_GAP;
          } else {
            block.items.forEach((item, index) => {
              const marker = block.ordered ? `${index + 1}. ` : "• ";
              ensure(BODY_SIZE * LINE);
              page.drawText(marker, { x: box.x, y: cursorY - BODY_SIZE, size: BODY_SIZE, font: regular, color: TEXT_COLOR });
              drawRuns(item, BODY_SIZE, false, LIST_INDENT);
            });
            cursorY -= PARA_GAP;
          }
        }
      };

      const embed = async (dataUrl: string): Promise<PDFImage> => {
        const { mime, bytes } = dataUrlToBytes(dataUrl);
        return mime.includes("png") ? pdf.embedPng(bytes) : pdf.embedJpg(bytes);
      };

      const drawGrid = async (columns: number, files: string[]) => {
        const grid = squareSlotGrid(box.width, columns, GRID_GAP);
        for (const rowFiles of chunk(files, columns)) {
          ensure(grid.slotSize + GRID_GAP);
          const rowTop = cursorY;
          for (let i = 0; i < rowFiles.length; i += 1) {
            const dataUrl = images[rowFiles[i]];
            if (!dataUrl) continue;
            let image = embedded.get(rowFiles[i]);
            if (!image) {
              image = await embed(dataUrl);
              embedded.set(rowFiles[i], image);
            }
            const fit = containSize(grid.slotSize, image.width, image.height);
            page.drawImage(image, {
              x: box.x + grid.xOffsets[i] + fit.offsetX,
              y: rowTop - grid.slotSize + fit.offsetY,
              width: fit.width,
              height: fit.height,
            });
          }
          cursorY = rowTop - grid.slotSize - GRID_GAP;
        }
      };

      // Document title.
      drawRuns([{ text: document.title }], TITLE_SIZE, true);
      cursorY -= PARA_GAP;

      for (const section of document.sections as PdfSection[]) {
        if (section.heading) {
          cursorY -= PARA_GAP;
          drawRuns([{ text: section.heading }], H2_SIZE, true);
          cursorY -= PARA_GAP / 2;
        }
        if (section.html.trim()) drawBlocks(parseHtmlToBlocks(section.html));
        if (section.imageGrid) await drawGrid(section.imageGrid.columns, section.imageGrid.files);
      }

      return pdf.save();
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- --run src/infrastructure/pdf/pdfLibExporter.test.ts`
Expected: PASS (a valid A4 PDF; CJK text does not throw).

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm typecheck`
Expected: PASS.

```bash
git add package.json pnpm-lock.yaml src/infrastructure/pdf/fonts src/infrastructure/pdf/pdfLibExporter.ts src/infrastructure/pdf/pdfLibExporter.test.ts
git commit -m "feat(pdf): pdf-lib exporter with CJK fonts and letterboxed image grid"
```

---

### Task 6: Rust `save_pdf` command

**Files:**
- Create: `src-tauri/src/pdf.rs`
- Modify: `src-tauri/src/lib.rs` (register `mod pdf;` and the command)
- Modify: `src-tauri/capabilities/default.json` (add `dialog:allow-save`)

**Interfaces:**
- Produces: Tauri command `save_pdf(path: String, contents_base64: String) -> Result<(), CommandError>` writing decoded bytes atomically.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/pdf.rs`:

```rust
use std::{fs, path::Path};

use base64::{engine::general_purpose::STANDARD, Engine as _};

use crate::error::CommandError;

pub fn save_pdf_to(path: &Path, contents_base64: &str) -> Result<(), CommandError> {
    let bytes = STANDARD.decode(contents_base64).map_err(|error| {
        CommandError::new("pdf_decode_failed", format!("Unable to decode PDF bytes: {error}"))
    })?;
    let temp = path.with_extension("pdf.tmp");
    fs::write(&temp, &bytes).map_err(|error| {
        CommandError::new("pdf_write_failed", format!("Unable to write the PDF: {error}"))
    })?;
    fs::rename(&temp, path).map_err(|error| {
        CommandError::new("pdf_write_failed", format!("Unable to finalize the PDF: {error}"))
    })?;
    Ok(())
}

#[tauri::command]
pub fn save_pdf(path: String, contents_base64: String) -> Result<(), CommandError> {
    save_pdf_to(Path::new(&path), &contents_base64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_decoded_bytes_to_the_path() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("plan.pdf");
        let encoded = STANDARD.encode(b"%PDF-1.7 test");

        save_pdf_to(&path, &encoded).unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"%PDF-1.7 test");
    }

    #[test]
    fn rejects_invalid_base64() {
        let dir = tempfile::tempdir().unwrap();
        let error = save_pdf_to(&dir.path().join("x.pdf"), "not base64!!!").unwrap_err();
        assert_eq!(error.code, "pdf_decode_failed");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri\Cargo.toml pdf::`
Expected: FAIL (module `pdf` not declared in `lib.rs`).

- [ ] **Step 3: Register the module and command**

In `src-tauri/src/lib.rs`, add `mod pdf;` next to the other `mod` lines, and add `pdf::save_pdf,` to the `tauri::generate_handler![ ... ]` list.

In `src-tauri/capabilities/default.json`, add `"dialog:allow-save"` to the `permissions` array (after `"dialog:allow-open"`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri\Cargo.toml`
Expected: PASS (all Rust tests, including the two new ones).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/pdf.rs src-tauri/src/lib.rs src-tauri/capabilities/default.json
git commit -m "feat(pdf): narrow save_pdf Rust command and dialog:allow-save"
```

---

### Task 7: PDF save targets (Tauri + browser) and font loader

**Files:**
- Create: `src/infrastructure/pdf/base64.ts`
- Create: `src/infrastructure/pdf/tauriPdfSave.ts`
- Create: `src/infrastructure/pdf/browserPdfSave.ts`
- Create: `src/infrastructure/pdf/fontAssets.ts`
- Test: `src/infrastructure/pdf/tauriPdfSave.test.ts`
- Test: `src/infrastructure/pdf/base64.test.ts`

**Interfaces:**
- Consumes: `PdfSaveTarget` (Task 3).
- Produces:
  - `bytesToBase64(bytes: Uint8Array): string`
  - `createTauriPdfSaveTarget(deps?: { saveDialog?; invokeCommand? }): PdfSaveTarget`
  - `browserPdfSaveTarget: PdfSaveTarget`
  - `loadNotoSansSc(): Promise<{ regular: Uint8Array; bold: Uint8Array }>`

- [ ] **Step 1: Write the failing tests**

Create `src/infrastructure/pdf/base64.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { bytesToBase64 } from "./base64";

describe("bytesToBase64", () => {
  it("round-trips through atob", () => {
    const bytes = new Uint8Array([37, 80, 68, 70]); // %PDF
    expect(atob(bytesToBase64(bytes))).toBe("%PDF");
  });
});
```

Create `src/infrastructure/pdf/tauriPdfSave.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createTauriPdfSaveTarget } from "./tauriPdfSave";

describe("createTauriPdfSaveTarget", () => {
  it("returns false when the dialog is cancelled", async () => {
    const saveDialog = vi.fn().mockResolvedValue(null);
    const invokeCommand = vi.fn();
    const target = createTauriPdfSaveTarget({ saveDialog, invokeCommand });

    expect(await target.save(new Uint8Array([1]), "Shoot.pdf")).toBe(false);
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("writes the chosen path via save_pdf", async () => {
    const saveDialog = vi.fn().mockResolvedValue("C:\\out\\Shoot.pdf");
    const invokeCommand = vi.fn().mockResolvedValue(undefined);
    const target = createTauriPdfSaveTarget({ saveDialog, invokeCommand });

    expect(await target.save(new Uint8Array([37, 80]), "Shoot.pdf")).toBe(true);
    expect(saveDialog).toHaveBeenCalledWith({ defaultPath: "Shoot.pdf", filters: [{ name: "PDF", extensions: ["pdf"] }] });
    expect(invokeCommand).toHaveBeenCalledWith("save_pdf", { path: "C:\\out\\Shoot.pdf", contentsBase64: expect.any(String) });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- --run src/infrastructure/pdf/base64.test.ts src/infrastructure/pdf/tauriPdfSave.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

Create `src/infrastructure/pdf/base64.ts`:

```ts
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
```

Create `src/infrastructure/pdf/tauriPdfSave.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { PdfSaveTarget } from "../../domain/plan/pdf/ports";
import { bytesToBase64 } from "./base64";

type SaveDialog = (options: { defaultPath: string; filters: { name: string; extensions: string[] }[] }) => Promise<string | null>;
type InvokeCommand = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

interface Dependencies {
  saveDialog?: SaveDialog;
  invokeCommand?: InvokeCommand;
}

export function createTauriPdfSaveTarget({ saveDialog = save as unknown as SaveDialog, invokeCommand = invoke }: Dependencies = {}): PdfSaveTarget {
  return {
    async save(bytes, suggestedName) {
      const path = await saveDialog({ defaultPath: suggestedName, filters: [{ name: "PDF", extensions: ["pdf"] }] });
      if (path === null) return false;
      try {
        await invokeCommand("save_pdf", { path, contentsBase64: bytesToBase64(bytes) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Unable to save the PDF: ${message}`, { cause: error });
      }
      return true;
    },
  };
}

export const tauriPdfSaveTarget = createTauriPdfSaveTarget();
```

Create `src/infrastructure/pdf/browserPdfSave.ts`:

```ts
import type { PdfSaveTarget } from "../../domain/plan/pdf/ports";

export const browserPdfSaveTarget: PdfSaveTarget = {
  async save() {
    // End-to-end mode has no filesystem save dialog; treat export as successful.
    return true;
  },
};
```

Create `src/infrastructure/pdf/fontAssets.ts`:

```ts
import boldUrl from "./fonts/NotoSansSC-Bold.otf?url";
import regularUrl from "./fonts/NotoSansSC-Regular.otf?url";

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  return new Uint8Array(await response.arrayBuffer());
}

export async function loadNotoSansSc(): Promise<{ regular: Uint8Array; bold: Uint8Array }> {
  const [regular, bold] = await Promise.all([fetchBytes(regularUrl), fetchBytes(boldUrl)]);
  return { regular, bold };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- --run src/infrastructure/pdf/base64.test.ts src/infrastructure/pdf/tauriPdfSave.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm typecheck`
Expected: PASS (the `?url` imports resolve via Vite's client types in `src/vite-env.d.ts`).

```bash
git add src/infrastructure/pdf/base64.ts src/infrastructure/pdf/tauriPdfSave.ts src/infrastructure/pdf/browserPdfSave.ts src/infrastructure/pdf/fontAssets.ts src/infrastructure/pdf/base64.test.ts src/infrastructure/pdf/tauriPdfSave.test.ts
git commit -m "feat(pdf): Tauri + browser save targets and font asset loader"
```

---

### Task 8: Wire Export PDF into the plan UI

**Files:**
- Modify: `src/features/plan/ProjectPlanProvider.tsx` (add `exporter`/`saver` to `PlanDependencies`, a `projectName` prop, and an `exportPdf` handler + `exporting` state)
- Modify: `src/features/plan/PlanPanel.tsx` (Export PDF button + `onExport`/`exporting` props)
- Modify: `src/app/layout/Workspace.tsx` (thread `projectName`)
- Modify: `src/app/workspace/WorkspaceProvider.tsx` (pass `view.project.name`)
- Modify: `src/app/plan/planDependencies.ts` (compose exporter + saver)
- Modify: `src/features/plan/PlanPanel.test.tsx`, `src/features/plan/ProjectPlanProvider.test.tsx`, `src/app/App.test.tsx`, `src/app/workspace/WorkspaceProvider.test.tsx` (new deps/props)

**Interfaces:**
- Consumes: `exportPlanToPdf` (Task 3), `PdfExporter`/`PdfSaveTarget` (Task 3), production adapters (Tasks 5–7).
- Produces: `PlanDependencies` gains `exporter: PdfExporter` and `saver: PdfSaveTarget`; `ProjectPlanProvider` gains a required `projectName: string` prop; `PlanPanel` gains `onExport(): void` and `exporting: boolean`.

- [ ] **Step 1: Write the failing test**

In `src/features/plan/PlanPanel.test.tsx`, add `onExport={vi.fn()}` and `exporting={false}` to each `render` and add:

```tsx
  it("invokes onExport when Export PDF is clicked", async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();
    render(
      <PlanPanel
        exporting={false}
        groups={[]}
        imageSrc={() => undefined}
        onExport={onExport}
        onSetPhotographyPlan={vi.fn()}
        photographyPlan=""
        saveState="saved"
        {...noop}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Export PDF" }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });
```

Add `import userEvent from "@testing-library/user-event";` to the test file if not present.

In `src/features/plan/ProjectPlanProvider.test.tsx`, extend `deps()` so `dependencies` includes:

```tsx
    exporter: { export: vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70])) },
    saver: { save: vi.fn().mockResolvedValue(true) },
```

and pass `projectName="Demo"` to every `<ProjectPlanProvider .../>` render. Add a test:

```tsx
  it("exports the plan to pdf and saves it", async () => {
    const user = userEvent.setup();
    const { dependencies } = deps();
    render(<ProjectPlanProvider dependencies={dependencies} projectName="Sunset" projectPath={String.raw`C:\demo`} />);

    await screen.findByRole("group", { name: "Reference group: Lookbook" });
    await user.click(screen.getByRole("button", { name: "Export PDF" }));

    await waitFor(() => expect(dependencies.exporter.export).toHaveBeenCalled());
    await waitFor(() => expect(dependencies.saver.save).toHaveBeenCalledWith(expect.any(Uint8Array), "Sunset.pdf"));
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- --run src/features/plan/PlanPanel.test.tsx src/features/plan/ProjectPlanProvider.test.tsx`
Expected: FAIL (no Export button; `projectName`/`exporter`/`saver` unknown).

- [ ] **Step 3: Implement the provider + panel**

In `src/features/plan/ProjectPlanProvider.tsx`:

- Extend the imports:

```tsx
import { exportPlanToPdf } from "../../domain/plan/pdf/export";
import type { PdfExporter, PdfSaveTarget } from "../../domain/plan/pdf/ports";
```

- Extend `PlanDependencies` and props:

```tsx
export interface PlanDependencies {
  service: PlanService;
  picker: PlanImagePicker;
  logger: WorkspaceLogger;
  exporter: PdfExporter;
  saver: PdfSaveTarget;
}

interface ProjectPlanProviderProps {
  projectPath: string;
  projectName: string;
  dependencies: PlanDependencies;
}
```

- Destructure `exporter`, `saver` from `dependencies`; accept `projectName` from props; add `const [exporting, setExporting] = useState(false);`.
- Add the handler:

```tsx
  const exportPdf = useCallback(() => {
    void guard("Unable to export the PDF", async () => {
      setExporting(true);
      try {
        const bytes = await exportPlanToPdf(exporter, planRef.current, projectName, imageSrcRef.current);
        await saver.save(bytes, `${projectName}.pdf`);
        if (mountedRef.current) setError(null);
      } finally {
        if (mountedRef.current) setExporting(false);
      }
    });
  }, [exporter, guard, projectName, saver]);
```

- Add an `imageSrcRef` that mirrors `imageSrc` so the handler reads the latest map without re-creating the callback. Near the other refs add `const imageSrcRef = useRef(imageSrc);` and, in the existing effect that syncs refs (or a new one), `useEffect(() => { imageSrcRef.current = imageSrc; }, [imageSrc]);`.
- Pass to `PlanPanel`: `exporting={exporting}` and `onExport={exportPdf}`.

In `src/features/plan/PlanPanel.tsx`, extend props and header:

```tsx
interface PlanPanelProps extends ReferenceImagesTabProps {
  error?: string | null;
  saveState: SaveState;
  photographyPlan: string;
  onSetPhotographyPlan(html: string): void;
  exporting: boolean;
  onExport(): void;
}
```

In the header row (the `flex items-center justify-end` div), place the button before the `SaveStatus`:

```tsx
      <div className="flex items-center justify-end gap-3 border-b border-black/10 px-6 py-2">
        <button
          className="rounded-full bg-stone-900 px-3 py-1 text-xs font-medium text-white hover:bg-stone-700 disabled:opacity-50"
          disabled={exporting}
          onClick={onExport}
          type="button"
        >
          {exporting ? "Exporting…" : "Export PDF"}
        </button>
        <SaveStatus state={saveState} />
      </div>
```

- [ ] **Step 4: Thread `projectName` and compose dependencies**

In `src/app/layout/Workspace.tsx`:

```tsx
interface WorkspaceProps {
  projectPath: string;
  projectName: string;
  dependencies: PlanDependencies;
}

export function Workspace({ projectPath, projectName, dependencies }: WorkspaceProps) {
  return (
    <main className="flex min-w-0 flex-1 flex-col bg-stone-100">
      <ProjectPlanProvider dependencies={dependencies} projectName={projectName} projectPath={projectPath} />
    </main>
  );
}
```

In `src/app/workspace/WorkspaceProvider.tsx`, update the `<Workspace ... />` render to add `projectName={view.project.name}`.

In `src/app/plan/planDependencies.ts`, compose the new adapters:

```ts
import { createPdfLibExporter } from "../../infrastructure/pdf/pdfLibExporter";
import { loadNotoSansSc } from "../../infrastructure/pdf/fontAssets";
import { tauriPdfSaveTarget } from "../../infrastructure/pdf/tauriPdfSave";
import { browserPdfSaveTarget } from "../../infrastructure/pdf/browserPdfSave";

const pdfExporter = createPdfLibExporter(loadNotoSansSc);
```

- In `createProductionPlanDependencies`, add `exporter: pdfExporter, saver: tauriPdfSaveTarget`.
- In the memory branch, return `{ ...browserPlanDependencies, logger: planLogger, exporter: pdfExporter, saver: browserPdfSaveTarget }`.
- In `src/infrastructure/plan/browserPlan.ts`, the `createBrowserPlanDependencies` return type only provides `service` + `picker`; leave it as-is — the exporter/saver are added in `planDependencies.ts`.

Update the mocks/props in `src/app/App.test.tsx` and `src/app/workspace/WorkspaceProvider.test.tsx`: add `exporter: { export: vi.fn() }, saver: { save: vi.fn() }` to each `planDeps()` object (these render through the provider). No `projectName` change is needed there because `WorkspaceProvider` supplies it from `view.project.name`; ensure the workspace test's project fixture has a `name` (it already does).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test -- --run src/features/plan src/app`
Expected: PASS.

- [ ] **Step 6: Full validation + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && cargo test --manifest-path src-tauri\Cargo.toml && pnpm build`
Expected: all PASS/succeed.

```bash
git add src/features/plan/ProjectPlanProvider.tsx src/features/plan/PlanPanel.tsx src/app/layout/Workspace.tsx src/app/workspace/WorkspaceProvider.tsx src/app/plan/planDependencies.ts src/features/plan/PlanPanel.test.tsx src/features/plan/ProjectPlanProvider.test.tsx src/app/App.test.tsx src/app/workspace/WorkspaceProvider.test.tsx
git commit -m "feat(pdf): Export PDF button wired through the plan provider"
```

---

### Task 9: E2E smoke test and documentation

**Files:**
- Modify: `e2e/plan.spec.ts`
- Modify: `docs/ARCHITECTURE.md`, `docs/TESTING.md`, `docs/design_docs/featurelist.json`

**Interfaces:**
- Consumes: the browser save target (Task 7) — returns `true` without a dialog.

- [ ] **Step 1: Extend the E2E flow**

Append to `e2e/plan.spec.ts` (the project auto-opens the seeded demo):

```ts
test("exports the plan to a pdf", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Export PDF" }).click();
  // The browser save target resolves successfully; the button returns to its idle label
  // and no error banner appears.
  await expect(page.getByRole("button", { name: "Export PDF" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
```

- [ ] **Step 2: Run the E2E suite**

Run: `pnpm test:e2e`
Expected: PASS (existing flows + the new export test).

- [ ] **Step 3: Update docs**

- `ARCHITECTURE.md`: add a "PDF Export" subsection under Basic Plan Editing — pure domain (`buildExportDocument`, geometry), `PdfExporter`/`PdfSaveTarget` ports, `pdf-lib` + fontkit adapter with bundled Noto Sans SC, square letterboxed slots, page-atomic image rows, and the `save_pdf` Rust command + `dialog:allow-save`.
- `TESTING.md`: add PDF coverage (geometry, `buildExportDocument`, `parseHtmlToBlocks`, exporter integration with CJK + image, `save_pdf` Rust test, Export button flow, E2E export).
- `featurelist.json` `基础方案编辑`: add a `feature_descriptions` line ("将方案与参考样图排版导出为 A4 PDF；图片按每行数量以正方形站位等比留白填充") and a `decisions` line (native `pdf-lib` + fontkit; bundled Noto Sans SC; square contain slots; save via dialog + `save_pdf`).

- [ ] **Step 4: Validate JSON + commit**

Run: `node -e "JSON.parse(require('fs').readFileSync('docs/design_docs/featurelist.json','utf8'))"`
Expected: no error.

```bash
git add e2e/plan.spec.ts docs/ARCHITECTURE.md docs/TESTING.md docs/design_docs/featurelist.json
git commit -m "test(pdf): e2e export smoke + docs"
```

---

## Self-Review Notes

- **Spec coverage:** A4 geometry + square letterbox slots (T1), document assembly with plan-first ordering (T2), ports + use case (T3), HTML→blocks incl. bold/italic/link/lists/plain-text degradation (T4), `pdf-lib` exporter with Noto Sans SC + wrapping + pagination + page-atomic image rows (T5), narrow Rust `save_pdf` + `dialog:allow-save` (T6), Tauri/browser save targets + font loader (T7), Export button wired with `projectName` title + dependency composition (T8), E2E + docs (T9).
- **Placeholder scan:** the font files are an asset-acquisition step gated by the embed test (T5 Step 4); no code placeholders. All code steps include complete code.
- **Type consistency:** `PdfExporter.export(document, images)`, `PdfSaveTarget.save(bytes, suggestedName)`, `exportPlanToPdf(exporter, plan, title, images)`, `createPdfLibExporter(loadFonts)`, `createTauriPdfSaveTarget({saveDialog, invokeCommand})`, `containSize`, `squareSlotGrid`, `buildExportDocument(plan, title)` — names/signatures match across tasks and against Phase 1's `ProjectPlan.photographyPlan`.
- **Documented v1 limitations carried into code:** italic never selects a distinct font (maps to Regular/Bold only); links draw underline + color without an annotation.
