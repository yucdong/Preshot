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
});
