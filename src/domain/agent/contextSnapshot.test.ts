import { describe, expect, it } from "vitest";
import {
  captureAgentTurnContext,
  captureAgentWorkspaceSnapshot,
  contextChips,
  createAgentRequestContext,
  createAgentContextReceipt,
  reconcileAgentRequestContext,
  removeAgentContextChip,
  requestContextChips,
  serializeAgentContextReceipt,
  setRequestImageAttachmentPinned,
  reconcileSelectedImageAttachment,
  setImageAttachmentPinned,
} from "./contextSnapshot";
import type { AgentImageReference } from "./models";

function image(imageId: string): AgentImageReference {
  return {
    projectId: "project-1",
    groupId: "group-1",
    imageId,
    selectionVersion: Number(imageId.replace(/\D/g, "")) || 1,
    displayName: `${imageId}.png`,
    thumbnailDataUrl: `data:image/png;base64,${imageId}`,
  };
}

describe("agent context snapshots and selected-image attachments", () => {
  it("captures an immutable request snapshot and receipt", () => {
    const selectedBlockIds = ["block-1"];
    const selectedImage = { ...image("image-1") };
    const snapshot = captureAgentWorkspaceSnapshot({
      projectId: "project-1",
      projectName: "Editorial",
      projectHandle: "project_opaque",
      documentRevision: 4,
      documentHash: "sha256:document",
      selectedBlockIds,
      selectedImage,
      saveState: "saved",
    });
    selectedBlockIds.push("later-selection");
    selectedImage.displayName = "changed.png";

    expect(snapshot.selectedBlockIds).toEqual(["block-1"]);
    expect(snapshot.selectedImage?.displayName).toBe("image-1.png");
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.selectedBlockIds)).toBe(true);
    expect(Object.isFrozen(snapshot.selectedImage)).toBe(true);

    const receipt = createAgentContextReceipt(
      snapshot,
      "2026-08-22T00:00:00Z",
    );
    expect(receipt).toMatchObject({
      projectId: "project-1",
      documentRevision: 4,
      selectedImage: {
        imageId: "image-1",
      },
    });
    expect(Object.isFrozen(receipt)).toBe(true);
  });

  it("creates visible project, block, and image context chips", () => {
    const chips = contextChips(captureAgentWorkspaceSnapshot({
      projectId: "project-1",
      projectName: "Editorial",
      projectHandle: "project_opaque",
      documentRevision: 1,
      documentHash: "sha256:document",
      selectedBlockIds: ["a", "b"],
      selectedImage: image("image-1"),
      saveState: "unsaved",
    }));
    expect(chips.map((chip) => chip.kind)).toEqual([
      "project",
      "document",
      "selected_blocks",
      "selected_image",
    ]);
    expect(chips[0].removable).toBe(false);
    expect(chips[1].removable).toBe(false);
    expect(chips.slice(2).every((chip) => chip.removable)).toBe(true);
  });

  it("replaces automatic images, preserves pinned images, and supports removal", () => {
    const first = reconcileSelectedImageAttachment(null, image("image-1"));
    const replaced = reconcileSelectedImageAttachment(first, image("image-2"));
    expect(replaced?.imageId).toBe("image-2");
    expect(replaced?.pinned).toBe(false);

    const pinned = setImageAttachmentPinned(replaced!, true);
    expect(reconcileSelectedImageAttachment(pinned, image("image-3"))).toBe(
      pinned,
    );
    expect(reconcileSelectedImageAttachment(
      setImageAttachmentPinned(pinned, false),
      undefined,
    )).toBeNull();
  });

  it("rejects cross-project selected-image tokens", () => {
    expect(() => captureAgentWorkspaceSnapshot({
      projectId: "project-1",
      projectName: "Editorial",
      projectHandle: "project_opaque",
      documentRevision: 1,
      documentHash: "hash",
      selectedBlockIds: [],
      selectedImage: { ...image("image-1"), projectId: "project-2" },
      saveState: "saved",
    })).toThrow(/does not belong/i);
  });

  it("builds removable request chips and freezes a path-free turn receipt", () => {
    const initial = captureAgentWorkspaceSnapshot({
      projectId: "project-1",
      projectName: "Editorial",
      projectHandle: "project_opaque",
      documentRevision: 3,
      documentHash: "sha256:document",
      selectedBlockIds: ["block-1"],
      cursorBlockId: "block-2",
      selectedImage: image("image-1"),
      saveState: "saved",
    });
    let draft = createAgentRequestContext(initial);
    expect(requestContextChips(draft).map((chip) => chip.kind)).toEqual([
      "project",
      "document",
      "selected_blocks",
      "cursor_block",
      "selected_image",
    ]);
    draft = removeAgentContextChip(draft, "blocks:block-1");
    draft = removeAgentContextChip(draft, "cursor:block-2");
    const turn = captureAgentTurnContext(draft, "2026-08-22T00:00:00Z");
    expect(turn.receipt.selectedBlockIds).toEqual([]);
    expect(turn.receipt.cursorBlockId).toBeUndefined();
    expect(serializeAgentContextReceipt(turn.receipt)).not.toContain("data:image");
    expect(serializeAgentContextReceipt(turn.receipt)).not.toContain("\\shoots\\");
    expect(JSON.stringify(turn.attachment)).not.toContain("thumbnailDataUrl");
    expect(JSON.stringify(turn.attachment)).not.toContain("data:image");
    expect(JSON.stringify(turn)).not.toContain("data:image");
    expect(JSON.stringify(turn)).not.toContain("thumbnailDataUrl");
    expect(JSON.stringify(turn)).not.toContain("attachmentToken");
    expect(Object.isFrozen(turn)).toBe(true);
  });

  it("keeps one auto image, honors pin/remove, replaces on selection change, and clears on project switch", () => {
    const snapshot = (projectId: string, imageId?: string, revision = 1) =>
      captureAgentWorkspaceSnapshot({
        projectId,
        projectName: projectId,
        projectHandle: `handle_${projectId}`,
        documentRevision: revision,
        documentHash: `hash:${revision}`,
        selectedBlockIds: [],
        selectedImage: imageId
          ? { ...image(imageId), projectId }
          : undefined,
        saveState: "saved",
      });
    let draft = createAgentRequestContext(snapshot("project-1", "image-1"));
    draft = reconcileAgentRequestContext(
      draft,
      snapshot("project-1", "image-2"),
    );
    expect(draft.attachment?.imageId).toBe("image-2");
    draft = setRequestImageAttachmentPinned(draft, true);
    draft = reconcileAgentRequestContext(
      draft,
      snapshot("project-1", "image-3", 2),
    );
    expect(draft.attachment?.imageId).toBe("image-2");
    draft = removeAgentContextChip(draft, "image:image-2");
    expect(draft.attachment).toBeNull();
    draft = reconcileAgentRequestContext(
      draft,
      snapshot("project-1", "image-3"),
    );
    expect(draft.attachment?.imageId).toBe("image-3");
    draft = reconcileAgentRequestContext(
      draft,
      snapshot("project-2", undefined),
    );
    expect(draft.projectId).toBe("project-2");
    expect(draft.attachment).toBeNull();
  });

  it("rejects raw media and absolute paths during receipt serialization", () => {
    expect(() => serializeAgentContextReceipt({
      projectId: "project-1",
      projectName: "C:\\shoots\\Editorial",
      documentRevision: 1,
      documentHash: "hash",
      selectedBlockIds: [],
      capturedAt: "now",
    })).toThrow(/path or raw media/i);
  });

  it("enforces the selected-block context bound", () => {
    expect(() => captureAgentWorkspaceSnapshot({
      projectId: "project-1",
      projectName: "Editorial",
      projectHandle: "project_opaque",
      documentRevision: 1,
      documentHash: "hash",
      selectedBlockIds: Array.from(
        { length: 65 },
        (_, index) => `block-${index}`,
      ),
      saveState: "saved",
    })).toThrow(/snapshot is invalid/i);
  });
});
