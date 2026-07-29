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
    if (child.nodeType === 3) {
      const text = child.textContent ?? "";
      if (text) {
        runs.push({
          text,
          ...(marks.bold ? { bold: true } : {}),
          ...(marks.italic ? { italic: true } : {}),
          ...(marks.link ? { link: marks.link } : {}),
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

    if (tag === "a") {
      next.link = element.getAttribute("href") ?? marks.link;
    }

    collectRuns(element, next, runs);
  }
}

function runsOf(element: Element): Run[] {
  const runs: Run[] = [];
  collectRuns(element, {}, runs);
  return runs;
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
    } else if (tag === "ul" || tag === "ol") {
      const items = Array.from(element.querySelectorAll(":scope > li")).map((item) => runsOf(item));
      blocks.push({ type: "list", ordered: tag === "ol", items });
    } else {
      pushParagraph(runsOf(element));
    }
  }

  return blocks;
}
