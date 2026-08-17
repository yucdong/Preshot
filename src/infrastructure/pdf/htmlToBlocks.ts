export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  link?: string;
  color?: string;
  size?: number;
}

export type Block =
  | { type: "heading"; level: 1 | 2; runs: Run[] }
  | { type: "paragraph"; runs: Run[] }
  | { type: "list"; ordered: boolean; items: Run[][] }
  | {
      type: "image";
      src: string;
      alt: string;
      width?: number;
      height?: number;
    }
  | { type: "imageGroup"; groupId: string }
  | {
      type: "columns";
      columns: Array<{ weight: number; blocks: Block[] }>;
    };

interface Marks {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  link?: string;
  color?: string;
  size?: number;
}

function collectRuns(node: Node, marks: Marks, runs: Run[]): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) {
      const text = child.textContent ?? "";
      if (text) {
        runs.push({
          text,
          ...(marks.bold ? { bold: true } : {}),
          ...(marks.italic ? { italic: true } : {}),
          ...(marks.underline ? { underline: true } : {}),
          ...(marks.strike ? { strike: true } : {}),
          ...(marks.link ? { link: marks.link } : {}),
          ...(marks.color ? { color: marks.color } : {}),
          ...(marks.size ? { size: marks.size } : {}),
        });
      }
      continue;
    }

    if (child.nodeType !== 1) {
      continue;
    }

    const element = child as HTMLElement;
    const tag = element.tagName.toLowerCase();
    const next: Marks = { ...marks };

    if (tag === "strong" || tag === "b") {
      next.bold = true;
    }
    if (tag === "em" || tag === "i") {
      next.italic = true;
    }
    if (tag === "u") {
      next.underline = true;
    }
    if (tag === "s" || tag === "del" || tag === "strike") {
      next.strike = true;
    }
    if (tag === "a") {
      next.link = element.getAttribute("href") ?? marks.link;
    }

    const color = element.style?.color;
    if (color) {
      next.color = color;
    }
    const fontSize = element.style?.fontSize;
    if (fontSize) {
      const parsed = Number.parseFloat(fontSize);
      if (!Number.isNaN(parsed)) {
        next.size = parsed;
      }
    }

    collectRuns(element, next, runs);
  }
}

function runsOf(element: Element): Run[] {
  const runs: Run[] = [];
  collectRuns(element, {}, runs);
  return runs;
}

function positiveNumber(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function parseHtmlToBlocks(html: string): Block[] {
  const document = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const blocks: Block[] = [];

  const pushParagraph = (runs: Run[]) => {
    if (runs.some((run) => run.text.trim() !== "")) {
      blocks.push({ type: "paragraph", runs });
    }
  };

  for (const node of Array.from(document.body.childNodes)) {
    if (node.nodeType === 3) {
      const text = node.textContent ?? "";
      if (text.trim()) {
        pushParagraph([{ text }]);
      }
      continue;
    }

    if (node.nodeType !== 1) {
      continue;
    }

    const element = node as HTMLElement;
    const tag = element.tagName.toLowerCase();

    if (tag === "h1") {
      blocks.push({ type: "heading", level: 1, runs: runsOf(element) });
    } else if (tag === "h2" || tag === "h3") {
      blocks.push({ type: "heading", level: 2, runs: runsOf(element) });
    } else if (tag === "img") {
      const src = element.getAttribute("src");
      if (src) {
        blocks.push({
          type: "image",
          src,
          alt: element.getAttribute("alt") ?? "",
          ...(positiveNumber(element.getAttribute("width")) !== undefined
            ? { width: positiveNumber(element.getAttribute("width")) }
            : {}),
          ...(positiveNumber(element.getAttribute("height")) !== undefined
            ? { height: positiveNumber(element.getAttribute("height")) }
            : {}),
        });
      }
    } else if (
      tag === "figure" &&
      element.getAttribute("data-preshot-node") === "image-group"
    ) {
      const encodedGroupId = element.getAttribute("data-preshot-group-id");
      if (encodedGroupId) {
        blocks.push({ type: "imageGroup", groupId: decodeURIComponent(encodedGroupId) });
      }
    } else if (tag === "ul" || tag === "ol") {
      const items = Array.from(element.querySelectorAll(":scope > li")).map((item) => runsOf(item));
      blocks.push({ type: "list", ordered: tag === "ol", items });
    } else if (tag === "pre") {
      pushParagraph(runsOf(element));
    } else if (tag === "table") {
      for (const row of Array.from(element.querySelectorAll("tr"))) {
        pushParagraph(runsOf(row));
      }
    } else {
      pushParagraph(runsOf(element));
    }
  }

  return blocks;
}
