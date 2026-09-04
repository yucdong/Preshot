import { describe, expect, it, vi } from "vitest";
import type { PreshotBlockDocument } from "../plan/canvas/blockDocument";
import { MemoryAttachmentTokenResolver } from "../../infrastructure/agent/memoryAttachmentTokenResolver";
import { createAgentWorkspaceStore } from "./workspaceBridge";

const document = (text = "Shot list"): PreshotBlockDocument => ({
  format: "preshot-blocks",
  version: 3,
  blocks: [{
    id: "block-1",
    type: "paragraph",
    props: {},
    content: [{ type: "text", text, styles: {} }],
    children: [],
  }, {
    id: "group-block",
    type: "imageGroup",
    props: { groupId: "group-1" },
    content: undefined,
    children: [],
  }],
});

function setup() {
  let id = 0;
  const resolver = new MemoryAttachmentTokenResolver({
    makeId: () => `id-${++id}`,
  });
  const store = createAgentWorkspaceStore(resolver);
  store.activateProject({
    projectId: "project-1",
    projectName: "Editorial",
    projectPath: "C:\\shoots\\Editorial",
  });
  store.publishDocument({
    document: document(),
    revision: 4,
    saveState: "saved",
  });
  store.publishImageIndex([{ groupId: "group-1", imageId: "image-1" }]);
  return { resolver, store };
}

describe("agent workspace external store", () => {
  it("reports loading and bridge readiness without polling", async () => {
    const resolver = new MemoryAttachmentTokenResolver();
    const store = createAgentWorkspaceStore(resolver);
    store.activateProject({
      projectId: "project-1",
      projectName: "Editorial",
      projectPath: "C:\\shoots\\Editorial",
    });
    expect(store.getReadiness("project-1")).toEqual({
      status: "loading",
      projectId: "project-1",
    });
    await expect(store.getCurrentPlan("project-1")).rejects.toMatchObject({
      code: "PLAN_LOADING",
    });

    const plan = {
      schemaVersion: 15 as const,
      title: "Editorial",
      document: document(),
      imageGroups: [],
      artifacts: [],
    };
    store.publishDocument({
      document: plan.document,
      revision: 4,
      saveState: "saved",
    });
    expect(store.getReadiness("project-1")).toEqual({
      status: "bridge_not_ready",
      projectId: "project-1",
    });
    const registration = store.registerProposalApplication("project-1", {
      getCurrentPlan: async () => ({ plan, revision: 4 }),
      applyAtomically: vi.fn(),
      restoreCheckpointAtomically: vi.fn(),
      rollbackAtomically: vi.fn(),
    });
    await expect(store.getCurrentPlan("project-1")).rejects.toMatchObject({
      code: "PLAN_BRIDGE_NOT_READY",
    });

    registration.setReady(true);
    expect(store.getReadiness("project-1")).toEqual({
      status: "ready",
      projectId: "project-1",
      revision: 4,
    });
    await expect(store.getCurrentPlan("project-1")).resolves.toEqual({
      plan,
      revision: 4,
    });
    registration.unregister();
    expect(store.getReadiness("project-1").status).toBe("bridge_not_ready");
  });

  it("publishes immutable revisions and hashes without leaking project paths", () => {
    const { store } = setup();
    const first = store.captureSnapshot();
    expect(first.documentRevision).toBe(4);
    expect(first.documentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.projectHandle).toMatch(/^project_/);
    expect(JSON.stringify(first)).not.toContain("C:\\\\shoots");
    expect(Object.isFrozen(first)).toBe(true);

    store.publishDocument({
      document: document("Updated shot list"),
      revision: 5,
      saveState: "unsaved",
    });
    const second = store.captureSnapshot();
    expect(second.documentRevision).toBe(5);
    expect(second.documentHash).not.toBe(first.documentHash);
    expect(first.documentRevision).toBe(4);
  });

  it("notifies only real selection changes and never exposes the editor", () => {
    const { store } = setup();
    const listener = vi.fn();
    store.subscribe(listener);
    store.publishSelection({
      selectedBlockIds: ["block-1"],
      cursorBlockId: "block-1",
    });
    expect(store.captureSnapshot()).toMatchObject({
      selectedBlockIds: ["block-1"],
      cursorBlockId: "block-1",
    });
    store.publishSelection({
      selectedBlockIds: ["block-1"],
      cursorBlockId: "block-1",
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(store.captureSnapshot())).not.toContain("editor");
  });

  it("reads bounded text from the captured revision and rejects stale snapshots", () => {
    const { store } = setup();
    const snapshot = store.captureSnapshot();
    expect(store.readTextBlocks(snapshot, ["block-1"])).toMatchObject([{
      blockId: "block-1",
      type: "paragraph",
      text: "Shot list",
    }]);
    store.publishDocument({
      document: document("Changed"),
      revision: 5,
      saveState: "unsaved",
    });
    expect(() => store.readTextBlocks(snapshot, ["block-1"]))
      .toThrow(/stale/i);
  });

  it("keeps the proposal application registered across identical activation", async () => {
    const { store } = setup();
    const plan = {
      schemaVersion: 15 as const,
      title: "Editorial",
      document: document(),
      imageGroups: [],
      artifacts: [],
    };
    const getCurrentPlan = vi.fn(async () => ({ plan, revision: 4 }));
    const registration = store.registerProposalApplication("project-1", {
      getCurrentPlan,
      applyAtomically: vi.fn(),
      restoreCheckpointAtomically: vi.fn(),
      rollbackAtomically: vi.fn(),
    });
    registration.setReady(true);

    store.activateProject({
      projectId: "project-1",
      projectName: "Editorial renamed",
      projectPath: "C:\\shoots\\Editorial",
    });

    await expect(store.getCurrentPlan("project-1")).resolves.toEqual({
      plan,
      revision: 4,
    });
    expect(getCurrentPlan).toHaveBeenCalledTimes(1);
    expect(store.captureSnapshot().projectName).toBe("Editorial renamed");
  });

  it("sanitizes paths and inline media from serialized block context", () => {
    const { store } = setup();
    store.publishDocument({
      document: document(
        "Use C:\\Users\\me\\private.png and data:image/png;base64,AAAA",
      ),
      revision: 5,
      saveState: "unsaved",
    });
    const [block] = store.readTextBlocks(
      store.captureSnapshot(),
      ["block-1"],
    );
    expect(block.text).toContain("[path omitted]");
    expect(block.text).toContain("[media omitted]");
    expect(block.text).not.toContain("C:\\Users");
    expect(block.text).not.toContain("base64");
  });

  it("keeps stable chip metadata and issues a fresh token only at send time", async () => {
    let now = 0;
    let id = 0;
    const resolver = new MemoryAttachmentTokenResolver({
      now: () => now,
      makeId: () => `id-${++id}`,
      ttlMs: 10 * 60 * 1_000,
    });
    const store = createAgentWorkspaceStore(resolver);
    store.activateProject({
      projectId: "project-1",
      projectName: "Editorial",
      projectPath: "C:\\shoots\\Editorial",
    });
    store.publishDocument({
      document: document(),
      revision: 4,
      saveState: "saved",
    });
    store.publishImageIndex([{ groupId: "group-1", imageId: "image-1" }]);
    store.publishSelectedImage({
      groupId: "group-1",
      imageId: "image-1",
      displayName: "0001.png",
      relativeFile: "references/0001.png",
      thumbnailDataUrl: "data:image/png;base64,AAAA",
    });
    const selected = store.captureSnapshot().selectedImage!;
    expect(JSON.stringify(selected)).not.toContain("attachment");
    expect(JSON.stringify(selected)).not.toContain("references/");
    expect(resolver.activeTokenCount()).toBe(0);

    now += 11 * 60 * 1_000;
    const attachment = {
      kind: "selected_image" as const,
      projectId: "project-1",
      groupId: "group-1",
      imageId: "image-1",
      displayName: "0001.png",
      pinned: false,
    };
    const token = store.issueAttachment(attachment, "project-1", 4);
    expect(token).toMatch(/^attachment_/);
    await expect(resolver.resolveAttachment({
      token,
      expectedProjectId: "project-1",
      expectedDocumentRevision: 4,
    })).resolves.toMatchObject({ imageId: "image-1" });

    store.activateProject({
      projectId: "project-2",
      projectName: "Second",
      projectPath: "D:\\projects\\Second",
    });
    expect(store.captureSnapshot()).toMatchObject({
      projectId: "project-2",
      selectedBlockIds: [],
      documentRevision: 0,
    });
    expect(store.captureSnapshot().selectedImage).toBeUndefined();
  });

  it("revalidates moved, revised, and deleted images before issuing", async () => {
    const { resolver, store } = setup();
    store.publishSelectedImage({
      groupId: "group-1",
      imageId: "image-1",
      displayName: "0001.png",
      relativeFile: "references/0001.png",
      thumbnailDataUrl: "data:image/png;base64,AAAA",
    });
    const attachment = {
      kind: "selected_image" as const,
      projectId: "project-1",
      groupId: "group-1",
      imageId: "image-1",
      displayName: "0001.png",
      pinned: true,
    };
    store.publishSelectedImage({
      groupId: "group-1",
      imageId: "image-1",
      displayName: "0002.png",
      relativeFile: "references/0002.png",
      thumbnailDataUrl: "data:image/png;base64,BBBB",
    });
    const moved = store.issueAttachment(attachment, "project-1", 4);
    await expect(resolver.resolveAttachment({
      token: moved,
      expectedProjectId: "project-1",
      expectedDocumentRevision: 4,
    })).resolves.toMatchObject({
      absolutePath: "C:\\shoots\\Editorial\\references\\0002.png",
    });

    store.publishDocument({
      document: document("revision"),
      revision: 5,
      saveState: "unsaved",
    });
    expect(() => store.issueAttachment(attachment, "project-1", 4))
      .toThrow(/no longer available/i);
    store.publishImageIndex([]);
    expect(() => store.issueAttachment(attachment, "project-1", 5))
      .toThrow(/no longer available/i);
  });

  it("navigates citations and reports deleted sources", () => {
    const { store } = setup();
    const focusBlock = vi.fn().mockReturnValue(true);
    const selectImage = vi.fn().mockReturnValue(true);
    store.registerBlockNavigator({ focusBlock });
    store.registerImageNavigator({ selectImage });
    expect(store.navigateToBlock({
      kind: "block",
      projectId: "project-1",
      blockId: "block-1",
    })).toEqual({ status: "navigated" });
    expect(store.navigateToImage({
      kind: "image",
      projectId: "project-1",
      groupId: "group-1",
      imageId: "image-1",
    }, true)).toEqual({ status: "navigated" });
    expect(selectImage).toHaveBeenCalledWith("group-1", "image-1", true);

    store.publishDocument({
      document: { ...document(), blocks: [] },
      revision: 5,
      saveState: "unsaved",
    });
    store.publishImageIndex([]);
    expect(store.navigateToBlock({
      kind: "block",
      projectId: "project-1",
      blockId: "block-1",
    })).toEqual({ status: "unavailable", reason: "source_deleted" });
    expect(store.navigateToImage({
      kind: "image",
      projectId: "project-1",
      groupId: "group-1",
      imageId: "image-1",
    }, false)).toEqual({
      status: "unavailable",
      reason: "source_deleted",
    });
  });
});
