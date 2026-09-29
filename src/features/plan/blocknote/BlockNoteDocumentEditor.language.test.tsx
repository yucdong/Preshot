// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { getDefaultReactSlashMenuItems } from "@blocknote/react";
import { undo } from "prosemirror-history";
import { ThemeProvider } from "../../../app/theme/ThemeProvider";
import { createBrowserSettingsRepository } from "../../../infrastructure/settings/browserSettings";
import { SettingsPanel } from "../../settings/SettingsPanel";
import { validateBlockDocument } from "../../../domain/plan/canvas/blockDocument";
import { BlockNoteDocumentEditor } from "./BlockNoteDocumentEditor";
import type { PreshotBlockNoteEditor } from "./preshotBlockNoteSchema";

it("switches editor menus and placeholders without replacing the document, editor or undo history", async () => {
  const user = userEvent.setup();
  let editor!: PreshotBlockNoteEditor;
  const ready = vi.fn((value: PreshotBlockNoteEditor) => { editor = value; });
  const changed = vi.fn();
  render(<ThemeProvider repository={createBrowserSettingsRepository()}>
    <SettingsPanel open onClose={() => undefined} />
    <BlockNoteDocumentEditor ariaLabel="测试正文" document={validateBlockDocument({
      format: "preshot-blocks", version: 4,
      blocks: [{ id: "text", type: "paragraph", props: {}, content: [{ type: "text", text: "素材库", styles: {} }], children: [] }],
    })}
      onChange={changed} onEditorReady={ready}
      artifactController={{ createArtifact: () => "a", cloneArtifact: () => null, getArtifact: () => undefined,
        subscribe: () => () => undefined, updateArtifact: vi.fn() }}
      imageGroupController={{ createGroup: () => "g", cloneGroup: () => null, getGroup: () => undefined,
        subscribe: () => () => undefined, getImageSrc: () => undefined, addImages: vi.fn(),
        removeImage: vi.fn(), openImage: vi.fn(), setImageFrame: vi.fn(), moveImage: vi.fn() }}
      persistMediaUrl={(url) => url} resolveMediaUrl={(url) => url} uploadFile={vi.fn()} />
  </ThemeProvider>);
  await waitFor(() => expect(ready).toHaveBeenCalledOnce());
  const originalEditor = editor;
  act(() => { editor.insertBlocks([{ id: "added", type: "paragraph", content: "用户中文内容" }], "text", "after"); });
  const saved = JSON.stringify(editor.document);
  const updates = changed.mock.calls.length;
  await user.click(screen.getByRole("button", { name: "English" }));
  await screen.findByRole("dialog", { name: "Settings" });
  expect(editor).toBe(originalEditor);
  expect(ready).toHaveBeenCalledOnce();
  expect(JSON.stringify(editor.document)).toBe(saved);
  expect(changed).toHaveBeenCalledTimes(updates);
  expect(getDefaultReactSlashMenuItems(editor).map((item) => item.title)).toContain("Heading 1");
  expect(screen.getByRole("group", { name: "测试正文" })).toHaveAttribute("data-preshot-editor-language", "en");
  expect(screen.getByText("素材库", { selector: ".bn-inline-content" })).toBeVisible();
  act(() => { expect(undo(editor.prosemirrorState, editor.prosemirrorView.dispatch)).toBe(true); });
  expect(editor.getBlock("added")).toBeUndefined();
  await user.click(screen.getByRole("button", { name: "简体中文" }));
  expect(getDefaultReactSlashMenuItems(editor).map((item) => item.title)).toContain("一级标题");
});
