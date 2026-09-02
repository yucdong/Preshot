// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../../app/theme/ThemeProvider";
import type { SettingsRepository } from "../../../domain/settings/ports";
import type { PreshotBlockDocument } from "../../../domain/plan/canvas/blockDocument";
import { BlockNoteDocumentEditor } from "./BlockNoteDocumentEditor";
import { ImageDragPreviewProvider } from "./ImageDragPreviewContext";
import {
  preshotBlockNoteSchema,
  type PreshotBlockNoteEditor,
} from "./preshotBlockNoteSchema";
import { createAgentWorkspaceStore } from "../../../domain/agent/workspaceBridge";
import { MemoryAttachmentTokenResolver } from "../../../infrastructure/agent/memoryAttachmentTokenResolver";

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
    let applyDocument:
      | ((document: PreshotBlockDocument) => void)
      | undefined;
    const onChange = vi.fn();
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
    const imageGroupController = {
      createGroup: () => "group-new",
      subscribe: () => () => undefined,
      cloneGroup,
      getGroup: (groupId: string) =>
        groupId === "group-1" ? imageGroup : undefined,
      getImageSrc: () => undefined,
      addImages: vi.fn(),
      captureImage: vi.fn(),
      removeImage: vi.fn(),
      openImage: vi.fn(),
      setImageFrame: vi.fn(),
      resizeGroup: vi.fn(),
      moveImage: vi.fn(),
    };
    const agentWorkspace = createAgentWorkspaceStore(
      new MemoryAttachmentTokenResolver({ makeId: () => "editor-test" }),
    );
    agentWorkspace.activateProject({
      projectId: "project-1",
      projectName: "Editorial",
      projectPath: "C:\\shoots\\Editorial",
    });
    agentWorkspace.publishDocument({
      document,
      revision: 1,
      saveState: "saved",
    });
    render(
      <ThemeProvider repository={settings}>
        <ImageDragPreviewProvider
          imageGroups={[imageGroup]}
          imageSources={{}}
          onMoveImage={imageGroupController.moveImage}
          planRevision={1}
          projectKey="document-editor-test"
        >
          <BlockNoteDocumentEditor
            agentWorkspace={agentWorkspace}
            ariaLabel="BlockNote 方案正文"
            document={document}
            imageGroupController={imageGroupController}
            onChange={onChange}
            onDocumentTransactionReady={(transaction) => {
              applyDocument = transaction;
              return () => {
                applyDocument = undefined;
              };
            }}
            onEditorReady={(instance) => {
              editor = instance;
            }}
            persistMediaUrl={(url) => url}
            resolveMediaUrl={(url) => url}
            uploadFile={vi.fn()}
          />
        </ImageDragPreviewProvider>
      </ThemeProvider>,
    );

    expect(screen.getByRole("group", { name: "BlockNote 方案正文" }))
      .toHaveAttribute("data-editor-engine", "blocknote");
    expect(await screen.findByText("BlockNote canvas")).toBeVisible();
    expect(screen.getByText("添加图片")).toBeVisible();

    await waitFor(() => expect(editor).toBeDefined());
    expect(editor!.schema).toBe(preshotBlockNoteSchema);
    await waitFor(() =>
      expect(agentWorkspace.captureSnapshot().cursorBlockId).toBe("paragraph")
    );
    expect(agentWorkspace.navigateToBlock({
      kind: "block",
      projectId: "project-1",
      blockId: "paragraph",
    })).toEqual({ status: "navigated" });
    const imageGroupBlock = editor!.document.find((block) => block.type === "imageGroup")!;
    editor!.setTextCursorPosition(imageGroupBlock);
    await waitFor(() =>
      expect(agentWorkspace.captureSnapshot().cursorBlockId)
        .toBe("image-group-block")
    );
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

    await waitFor(() => expect(applyDocument).toBeDefined());
    const beforeTransaction = structuredClone(editor!.document);
    const changeCount = onChange.mock.calls.length;
    vi.spyOn(editor!, "replaceBlocks").mockImplementationOnce(() => {
      throw new Error("editor transaction failed");
    });
    expect(() => applyDocument!(document)).toThrow(
      "editor transaction failed",
    );
    expect(editor!.document).toEqual(beforeTransaction);
    expect(onChange).toHaveBeenCalledTimes(changeCount);
  });
});
