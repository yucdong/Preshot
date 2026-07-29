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
