// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../../app/theme/ThemeProvider";
import type { SettingsRepository } from "../../../domain/settings/ports";
import type { PreshotBlockDocument } from "../../../domain/plan/canvas/blockDocument";
import { BlockNoteDocumentEditor } from "./BlockNoteDocumentEditor";
import {
  preshotBlockNoteSchema,
  type PreshotBlockNoteEditor,
} from "./preshotBlockNoteSchema";

const settings: SettingsRepository = {
  read: vi.fn().mockResolvedValue({ theme: "light" }),
  write: vi.fn().mockResolvedValue(undefined),
};

const document: PreshotBlockDocument = {
  format: "preshot-blocks",
  version: 2,
  blocks: [
    {
      id: "paragraph",
      type: "paragraph",
      props: {},
      content: [{ type: "text", text: "BlockNote canvas", styles: {} }],
      children: [],
    },
    {
      id: "image-group-block",
      type: "imageGroup",
      props: { groupId: "group-1" },
      content: undefined,
      children: [],
    },
  ],
};

describe("BlockNoteDocumentEditor", () => {
  it("renders portable JSON blocks and the custom image-group block", async () => {
    let editor: PreshotBlockNoteEditor | undefined;
    const cloneGroup = vi.fn().mockReturnValue("group-copy");
    const imageGroup = {
      id: "group-1",
      name: "References",
      type: "reference" as const,
      x: 0,
      width: 400,
      height: 220,
      description: "",
      images: [],
    };
    render(
      <ThemeProvider repository={settings}>
        <BlockNoteDocumentEditor
          ariaLabel="BlockNote 方案正文"
          document={document}
          imageGroupController={{
            createGroup: () => "group-new",
            subscribe: () => () => undefined,
            cloneGroup,
            getGroup: (groupId) => groupId === "group-1" ? imageGroup : undefined,
            getImageSrc: () => undefined,
            addImages: vi.fn(),
            captureImage: vi.fn(),
            removeImage: vi.fn(),
            openImage: vi.fn(),
            setImageFrame: vi.fn(),
            resizeGroup: vi.fn(),
            moveImage: vi.fn(),
          }}
          onChange={vi.fn()}
          onEditorReady={(instance) => {
            editor = instance;
          }}
          persistMediaUrl={(url) => url}
          resolveMediaUrl={(url) => url}
          uploadFile={vi.fn()}
        />
      </ThemeProvider>,
    );

    expect(screen.getByRole("group", { name: "BlockNote 方案正文" }))
      .toHaveAttribute("data-editor-engine", "blocknote");
    expect(await screen.findByText("BlockNote canvas")).toBeVisible();
    expect(screen.getByText("添加图片")).toBeVisible();

    await waitFor(() => expect(editor).toBeDefined());
    expect(editor!.schema).toBe(preshotBlockNoteSchema);
    const imageGroupBlock = editor!.document.find((block) => block.type === "imageGroup")!;
    editor!.insertBlocks(
      [{ type: "imageGroup", props: { groupId: "group-1" } }],
      imageGroupBlock,
      "after",
    );
    await waitFor(() => {
      expect(cloneGroup).toHaveBeenCalledWith("group-1");
      expect(
        editor!.document
          .filter((block) => block.type === "imageGroup")
          .map((block) => block.props.groupId),
      ).toEqual(["group-1", "group-copy"]);
    });

    const copy = editor!.document.find(
      (block) => block.type === "imageGroup" && block.props.groupId === "group-copy",
    )!;
    editor!.removeBlocks([copy]);
    expect(editor!.document.filter((block) => block.type === "imageGroup"))
      .toHaveLength(1);
    expect(editor!.undo()).toBe(true);
    expect(editor!.document.filter((block) => block.type === "imageGroup"))
      .toHaveLength(2);

    const originalGroup = editor!.document.find(
      (block) => block.type === "imageGroup" && block.props.groupId === "group-1",
    )!;
    editor!.setTextCursorPosition(originalGroup);
    editor!.nestBlock();
    await waitFor(() => {
      expect(
        editor!.document.some((block) =>
          block.children.some((child) => child.type === "imageGroup"),
        ),
      ).toBe(false);
    });
  });
});
