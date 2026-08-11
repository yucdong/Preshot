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

  it("parses underline, strikethrough, color, and font-size marks", () => {
    const [block] = parseHtmlToBlocks(
      '<p><u>u</u><s>s</s><span style="color: #ff0000; font-size: 20px">c</span></p>',
    );
    expect(block.type).toBe("paragraph");
    const runs = block.type === "paragraph" ? block.runs : [];
    expect(runs[0]).toMatchObject({ text: "u", underline: true });
    expect(runs[1]).toMatchObject({ text: "s", strike: true });
    expect(runs[2]?.text).toBe("c");
    expect(runs[2]?.color).toBeTruthy();
    expect(runs[2]?.size).toBe(20);
  });

  it("keeps inline-style text color from rich-text html", () => {
    const [block] = parseHtmlToBlocks('<p><span style="color: #dd3333">warm</span></p>');
    const runs = block.type === "paragraph" ? block.runs : [];
    expect(runs[0]).toMatchObject({ text: "warm" });
    expect(runs[0]?.color).toBeTruthy();
  });

  it("keeps custom hex text color and font size for PDF layout", () => {
    const [block] = parseHtmlToBlocks(
      '<p><span style="color: #C2385C; font-size: 24px">custom</span></p>',
    );
    const runs = block.type === "paragraph" ? block.runs : [];
    expect(runs).toEqual([{ text: "custom", color: "rgb(194, 56, 92)", size: 24 }]);
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
    expect(text).toBe("line1\nline2");
  });

  it("flattens a table to one paragraph per row", () => {
    const blocks = parseHtmlToBlocks(
      "<table><tbody><tr><td>A1</td><td>B1</td></tr><tr><td>A2</td><td>B2</td></tr></tbody></table>",
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("paragraph");
    expect(blocks[1].type).toBe("paragraph");
    const text0 = blocks[0].type === "paragraph" ? blocks[0].runs.map((run) => run.text).join("") : "";
    const text1 = blocks[1].type === "paragraph" ? blocks[1].runs.map((run) => run.text).join("") : "";
    expect(text0).toContain("A1");
    expect(text0).toContain("B1");
    expect(text1).toContain("A2");
    expect(text1).toContain("B2");
  });
});
