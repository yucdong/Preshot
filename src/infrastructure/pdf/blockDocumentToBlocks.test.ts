import { describe, expect, it } from "vitest";
import type { PreshotBlockDocument } from "../../domain/plan/canvas/blockDocument";
import { blockDocumentToPdfBlocks } from "./blockDocumentToBlocks";

describe("blockDocumentToPdfBlocks", () => {
  it("maps native BlockNote JSON and image groups without HTML", () => {
    const document: PreshotBlockDocument = {
      format: "preshot-blocks",
      version: 3,
      blocks: [
        {
          id: "heading",
          type: "heading",
          props: { level: 1 },
          content: [{ type: "text", text: "Title", styles: { bold: true } }],
          children: [],
        },
        {
          id: "group",
          type: "imageGroup",
          props: { groupId: "group-1" },
          content: undefined,
          children: [],
        },
      ],
    };

    expect(blockDocumentToPdfBlocks(document)).toEqual([
      {
        type: "heading",
        level: 1,
        runs: [{ text: "Title", bold: true }],
      },
      { type: "imageGroup", groupId: "group-1" },
    ]);
  });

  it("preserves column weights and side-by-side child blocks", () => {
    const document: PreshotBlockDocument = {
      format: "preshot-blocks",
      version: 3,
      blocks: [{
        id: "columns",
        type: "columnList",
        props: {},
        content: undefined,
        children: [
          {
            id: "left",
            type: "column",
            props: { width: 0.75 },
            content: undefined,
            children: [{
              id: "copy",
              type: "paragraph",
              props: {},
              content: [{ type: "text", text: "Copy", styles: {} }],
              children: [],
            }],
          },
          {
            id: "right",
            type: "column",
            props: { width: 1.25 },
            content: undefined,
            children: [{
              id: "group",
              type: "imageGroup",
              props: { groupId: "group-1" },
              content: undefined,
              children: [],
            }],
          },
        ],
      }],
    };

    expect(blockDocumentToPdfBlocks(document)).toEqual([{
      type: "columns",
      columns: [
        {
          weight: 0.75,
          blocks: [{ type: "paragraph", runs: [{ text: "Copy" }] }],
        },
        {
          weight: 1.25,
          blocks: [{ type: "imageGroup", groupId: "group-1" }],
        },
      ],
    }]);
  });

  it("maps native media blocks to PDF images and fallback labels", () => {
    const document: PreshotBlockDocument = {
      format: "preshot-blocks",
      version: 3,
      blocks: [
        {
          id: "image",
          type: "image",
          props: {
            name: "look.png",
            url: "media/0001.png",
            caption: "Look",
            showPreview: true,
            previewWidth: 240,
          },
          content: undefined,
          children: [],
        },
        {
          id: "video",
          type: "video",
          props: {
            name: "clip.mp4",
            url: "media/0002.mp4",
            caption: "Motion",
            showPreview: true,
          },
          content: undefined,
          children: [],
        },
        {
          id: "audio",
          type: "audio",
          props: {
            name: "track.mp3",
            url: "https://example.com/track.mp3",
            caption: "",
            showPreview: true,
          },
          content: undefined,
          children: [],
        },
      ],
    };

    expect(blockDocumentToPdfBlocks(document)).toEqual([
      {
        type: "image",
        src: "media/0001.png",
        alt: "Look",
        width: 240,
      },
      {
        type: "paragraph",
        runs: [{ text: "[视频] Motion" }],
      },
      {
        type: "paragraph",
        runs: [{
          text: "[音频] track.mp3",
          link: "https://example.com/track.mp3",
        }],
      },
    ]);
  });
});
