import { AgentDomainError } from "./errors";
import type {
  AgentContextChip,
  AgentContextReceipt,
  AgentImageAttachment,
  AgentImageReference,
  AgentRequestContextDraft,
  AgentTurnContext,
  AgentWorkspaceSnapshot,
} from "./models";

export const AGENT_CONTEXT_MAX_SELECTED_BLOCKS = 64;
export const AGENT_CONTEXT_MAX_SERIALIZED_CHARS = 128_000;
export const AGENT_THUMBNAIL_MAX_CHARS = 512_000;
export const AGENT_CONTEXT_MAX_REFERENCE_IMAGES = 64;

function freezeArray<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values]);
}

function freezeImage(
  image: AgentImageReference | undefined,
): AgentImageReference | undefined {
  return image ? Object.freeze({ ...image }) : undefined;
}

function assertSnapshot(snapshot: AgentWorkspaceSnapshot): void {
  if (
    !snapshot.projectId ||
    !snapshot.projectName ||
    !snapshot.projectHandle ||
    !Number.isSafeInteger(snapshot.documentRevision) ||
    snapshot.documentRevision < 0 ||
    !snapshot.documentHash ||
    snapshot.selectedBlockIds.length > AGENT_CONTEXT_MAX_SELECTED_BLOCKS ||
    (snapshot.referenceImages?.length ?? 0) >
      AGENT_CONTEXT_MAX_REFERENCE_IMAGES ||
    new Set(snapshot.selectedBlockIds).size !== snapshot.selectedBlockIds.length
  ) {
    throw new AgentDomainError(
      "session_corrupt",
      "workspace",
      "Workspace snapshot is invalid",
    );
  }
  for (const image of snapshot.referenceImages ?? []) {
    if (
      !image.groupId ||
      !image.imageId ||
      !image.displayName ||
      !image.groupLabel ||
      /[\\/]/.test(image.displayName) ||
      /[\\/]/.test(image.groupLabel) ||
      image.displayName.length > 200 ||
      image.groupLabel.length > 200 ||
      (image.width !== null &&
        (!Number.isFinite(image.width) || image.width <= 0)) ||
      (image.height !== null &&
        (!Number.isFinite(image.height) || image.height <= 0))
    ) {
      throw new AgentDomainError(
        "tool_denied",
        "workspace",
        "Reference image metadata is invalid",
      );
    }
  }
  if (
    snapshot.selectedImage &&
    (
      snapshot.selectedImage.projectId !== snapshot.projectId ||
      !Number.isSafeInteger(snapshot.selectedImage.selectionVersion) ||
      snapshot.selectedImage.selectionVersion <= 0 ||
      !/^data:image\/[a-z0-9.+-]+;base64,/i.test(
        snapshot.selectedImage.thumbnailDataUrl,
      ) ||
      snapshot.selectedImage.thumbnailDataUrl.length >
        AGENT_THUMBNAIL_MAX_CHARS ||
      /[\\/]/.test(snapshot.selectedImage.displayName)
    )
  ) {
    throw new AgentDomainError(
      "tool_denied",
      "workspace",
      "Selected image does not belong to the snapshot project",
    );
  }
}

export function captureAgentWorkspaceSnapshot(
  snapshot: AgentWorkspaceSnapshot,
): AgentWorkspaceSnapshot {
  assertSnapshot(snapshot);
  return Object.freeze({
    ...snapshot,
    selectedBlockIds: freezeArray(snapshot.selectedBlockIds),
    referenceImages: Object.freeze(
      (snapshot.referenceImages ?? []).map((image) =>
        Object.freeze({ ...image })
      ),
    ),
    ...(snapshot.cursorBlockId
      ? { cursorBlockId: snapshot.cursorBlockId }
      : {}),
    ...(snapshot.selectedImage
      ? { selectedImage: freezeImage(snapshot.selectedImage) }
      : {}),
  });
}

export function createAgentContextReceipt(
  snapshot: AgentWorkspaceSnapshot,
  capturedAt: string,
): AgentContextReceipt {
  const captured = captureAgentWorkspaceSnapshot(snapshot);
  if (!capturedAt) {
    throw new AgentDomainError(
      "session_corrupt",
      "generation",
      "Context receipt timestamp is required",
    );
  }
  const selectedImage = captured.selectedImage
    ? Object.freeze({
        groupId: captured.selectedImage.groupId,
        imageId: captured.selectedImage.imageId,
        displayName: captured.selectedImage.displayName,
      })
    : undefined;
  return Object.freeze({
    projectId: captured.projectId,
    projectName: captured.projectName,
    documentRevision: captured.documentRevision,
    documentHash: captured.documentHash,
    selectedBlockIds: captured.selectedBlockIds,
    referenceImages: captured.referenceImages,
    ...(captured.cursorBlockId
      ? { cursorBlockId: captured.cursorBlockId }
      : {}),
    ...(selectedImage ? { selectedImage } : {}),
    capturedAt,
  });
}

export function contextChips(
  snapshot: AgentWorkspaceSnapshot,
): readonly AgentContextChip[] {
  const chips: AgentContextChip[] = [{
    id: `project:${snapshot.projectId}`,
    kind: "project",
    label: snapshot.projectName,
    removable: false,
  }, {
    id: `document:${snapshot.documentRevision}:${snapshot.documentHash}`,
    kind: "document",
    label: `Document revision ${snapshot.documentRevision}`,
    removable: false,
  }];
  if (snapshot.selectedBlockIds.length > 0) {
    chips.push({
      id: `blocks:${snapshot.selectedBlockIds.join(",")}`,
      kind: "selected_blocks",
      label: `${snapshot.selectedBlockIds.length} selected block${
        snapshot.selectedBlockIds.length === 1 ? "" : "s"
      }`,
      removable: true,
    });
  }
  if (
    snapshot.cursorBlockId &&
    !snapshot.selectedBlockIds.includes(snapshot.cursorBlockId)
  ) {
    chips.push({
      id: `cursor:${snapshot.cursorBlockId}`,
      kind: "cursor_block",
      label: "Cursor block",
      removable: true,
    });
  }
  if (snapshot.selectedImage) {
    chips.push({
      id: `image:${snapshot.selectedImage.imageId}`,
      kind: "selected_image",
      label: snapshot.selectedImage.displayName,
      removable: true,
    });
  }
  return Object.freeze(chips.map((chip) => Object.freeze(chip)));
}

function attachmentFrom(
  image: AgentImageReference,
  pinned: boolean,
): AgentImageAttachment {
  return Object.freeze({
    kind: "selected_image",
    projectId: image.projectId,
    groupId: image.groupId,
    imageId: image.imageId,
    selectionVersion: image.selectionVersion,
    displayName: image.displayName,
    thumbnailDataUrl: image.thumbnailDataUrl,
    pinned,
  });
}

export function reconcileSelectedImageAttachment(
  current: AgentImageAttachment | null,
  selectedImage: AgentImageReference | undefined,
): AgentImageAttachment | null {
  if (current?.pinned) return current;
  if (!selectedImage) return null;
  return attachmentFrom(selectedImage, false);
}

export function setImageAttachmentPinned(
  attachment: AgentImageAttachment,
  pinned: boolean,
): AgentImageAttachment {
  return attachment.pinned === pinned
    ? attachment
    : attachmentFrom(attachment, pinned);
}

export function createAgentRequestContext(
  snapshot: AgentWorkspaceSnapshot,
): AgentRequestContextDraft {
  const captured = captureAgentWorkspaceSnapshot(snapshot);
  return Object.freeze({
    projectId: captured.projectId,
    snapshot: captured,
    includeSelectedBlocks: true,
    includeCursorBlock: true,
    attachment: reconcileSelectedImageAttachment(
      null,
      captured.selectedImage,
    ),
  });
}

export function reconcileAgentRequestContext(
  current: AgentRequestContextDraft,
  snapshot: AgentWorkspaceSnapshot,
): AgentRequestContextDraft {
  const captured = captureAgentWorkspaceSnapshot(snapshot);
  if (captured.projectId !== current.projectId) {
    return createAgentRequestContext(captured);
  }
  const selectedImage = captured.selectedImage;
  const selectedImageKey = selectedImage
    ? `${selectedImage.imageId}:${selectedImage.selectionVersion}`
    : undefined;
  const shouldSuppress =
    selectedImageKey === current.dismissedAutoImageKey;
  const attachment = current.attachment?.pinned
    ? current.attachment
    : shouldSuppress
    ? null
    : reconcileSelectedImageAttachment(current.attachment, selectedImage);
  return Object.freeze({
    ...current,
    snapshot: captured,
    attachment,
    ...(shouldSuppress
      ? { dismissedAutoImageKey: current.dismissedAutoImageKey }
      : {}),
  });
}

export function removeAgentContextChip(
  current: AgentRequestContextDraft,
  chipId: string,
): AgentRequestContextDraft {
  if (chipId.startsWith("blocks:")) {
    return Object.freeze({ ...current, includeSelectedBlocks: false });
  }
  if (chipId.startsWith("cursor:")) {
    return Object.freeze({ ...current, includeCursorBlock: false });
  }
  if (chipId.startsWith("image:")) {
    return Object.freeze({
      ...current,
      attachment: null,
      ...(current.attachment ?? current.snapshot.selectedImage
        ? {
            dismissedAutoImageKey: `${
              (current.attachment ?? current.snapshot.selectedImage)!.imageId
            }:${
              (current.attachment ?? current.snapshot.selectedImage)!
                .selectionVersion
            }`,
          }
        : {}),
    });
  }
  return current;
}

export function setRequestImageAttachmentPinned(
  current: AgentRequestContextDraft,
  pinned: boolean,
): AgentRequestContextDraft {
  if (!current.attachment) return current;
  return Object.freeze({
    ...current,
    attachment: setImageAttachmentPinned(current.attachment, pinned),
    dismissedAutoImageKey: undefined,
  });
}

export function requestContextChips(
  draft: AgentRequestContextDraft,
): readonly AgentContextChip[] {
  return contextChips(draft.snapshot).filter((chip) => {
    if (chip.kind === "selected_blocks") {
      return draft.includeSelectedBlocks;
    }
    if (chip.kind === "cursor_block") return draft.includeCursorBlock;
    if (chip.kind === "selected_image") return draft.attachment !== null;
    return true;
  });
}

export function captureAgentTurnContext(
  draft: AgentRequestContextDraft,
  capturedAt: string,
): AgentTurnContext {
  const snapshot = captureAgentWorkspaceSnapshot({
    ...draft.snapshot,
    selectedBlockIds: draft.includeSelectedBlocks
      ? draft.snapshot.selectedBlockIds
      : [],
    cursorBlockId: draft.includeCursorBlock
      ? draft.snapshot.cursorBlockId
      : undefined,
    selectedImage: draft.attachment
      ? {
          projectId: draft.attachment.projectId,
          groupId: draft.attachment.groupId,
          imageId: draft.attachment.imageId,
          selectionVersion: draft.attachment.selectionVersion,
          displayName: draft.attachment.displayName,
          thumbnailDataUrl: draft.attachment.thumbnailDataUrl,
        }
      : undefined,
  });
  return Object.freeze({
    receipt: createAgentContextReceipt(snapshot, capturedAt),
    attachment: draft.attachment
      ? Object.freeze({
          kind: "selected_image" as const,
          projectId: draft.attachment.projectId,
          groupId: draft.attachment.groupId,
          imageId: draft.attachment.imageId,
          displayName: draft.attachment.displayName,
          pinned: draft.attachment.pinned,
        })
      : null,
  });
}

export function serializeAgentContextReceipt(
  receipt: AgentContextReceipt,
): string {
  const serialized = JSON.stringify(receipt);
  if (serialized.length > AGENT_CONTEXT_MAX_SERIALIZED_CHARS) {
    throw new AgentDomainError(
      "context_too_large",
      "generation",
      `Agent context exceeds ${AGENT_CONTEXT_MAX_SERIALIZED_CHARS} characters`,
    );
  }
  if (
    /data:(?:image|audio|video|application)\//i.test(serialized) ||
    /(?:[a-zA-Z]:\\|\\\\[^\\])/i.test(serialized)
  ) {
    throw new AgentDomainError(
      "tool_denied",
      "generation",
      "Agent context contains a path or raw media payload",
    );
  }
  return serialized;
}
