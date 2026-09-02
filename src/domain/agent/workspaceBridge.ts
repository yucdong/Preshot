import type {
  PreshotBlock,
  PreshotBlockDocument,
} from "../plan/canvas/blockDocument";
import {
  hashPreshotBlock,
  hashPreshotDocument,
} from "./proposal";
import { AgentDomainError } from "./errors";
import { AgentProposalTemporaryError } from "./errors";
import { captureAgentWorkspaceSnapshot } from "./contextSnapshot";
import type {
  AgentBlockCitation,
  AgentCitationNavigationResult,
  AgentImageCitation,
  AgentSaveState,
  AgentWorkspaceSnapshot,
} from "./models";
import type {
  AgentAttachmentTokenResolverPort,
  AgentProposalApplicationPort,
  AgentProposalApplicationReadiness,
  AgentProposalMutationPort,
  AgentTextBlockRead,
  AgentWorkspaceBridgePort,
} from "./ports";

const MAX_CONTEXT_BLOCKS = 64;
const MAX_BLOCK_TEXT_CHARS = 4_000;
const MAX_TOTAL_TEXT_CHARS = 64_000;
interface ProjectInput {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectPath: string;
}

interface DocumentInput {
  readonly document: PreshotBlockDocument;
  readonly revision: number;
  readonly saveState: AgentSaveState;
}

interface SelectionInput {
  readonly selectedBlockIds: readonly string[];
  readonly cursorBlockId?: string;
}

interface SelectedImageInput {
  readonly groupId: string;
  readonly imageId: string;
  readonly displayName: string;
  readonly relativeFile: string;
  readonly thumbnailDataUrl: string;
}

interface BlockNavigator {
  focusBlock(blockId: string): boolean;
}

interface ImageNavigator {
  selectImage(groupId: string, imageId: string, open: boolean): boolean;
}

export interface AgentWorkspaceReader extends AgentWorkspaceBridgePort {
  subscribe(listener: () => void): () => void;
  getSnapshot(): AgentWorkspaceSnapshot | null;
}

export interface AgentWorkspacePublisher {
  activateProject(project: ProjectInput): void;
  clearProject(): void;
  publishDocument(input: DocumentInput): void;
  publishSaveState(saveState: AgentSaveState): void;
  publishSelection(selection: SelectionInput): void;
  publishImageIndex(
    images: readonly Readonly<{
      groupId: string;
      imageId: string;
      displayName?: string;
      groupLabel?: string;
      relativeFile?: string;
      width?: number | null;
      height?: number | null;
    }>[],
  ): void;
  publishSelectedImage(image: SelectedImageInput | null): void;
  registerBlockNavigator(navigator: BlockNavigator): () => void;
  registerImageNavigator(navigator: ImageNavigator): () => void;
  registerProposalApplication(
    projectId: string,
    application: AgentProposalMutationPort,
  ): AgentProposalApplicationRegistration;
}

export interface AgentProposalApplicationRegistration {
  setReady(ready: boolean): void;
  unregister(): void;
}

export interface AgentWorkspaceStore
  extends
    AgentWorkspaceReader,
    AgentWorkspacePublisher,
    AgentProposalApplicationPort {}

type PrivateSelectedImage = SelectedImageInput & {
  readonly selectionVersion: number;
};

function blockIndex(
  document: PreshotBlockDocument,
): ReadonlyMap<string, PreshotBlock> {
  const index = new Map<string, PreshotBlock>();
  const visit = (blocks: readonly PreshotBlock[]) => {
    for (const block of blocks) {
      index.set(block.id, block);
      visit(block.children);
    }
  };
  visit(document.blocks);
  return index;
}

function displayNameOf(value: string): string {
  const name = value.trim();
  if (!name || /[\\/]/.test(name) || name.length > 200) {
    throw new AgentDomainError(
      "tool_denied",
      "workspace",
      "Selected image display name is invalid",
    );
  }
  return name;
}

function inlineText(block: PreshotBlock): string {
  if (!Array.isArray(block.content)) return "";
  return block.content
    .flatMap((entry) =>
      entry.type === "text"
        ? [entry.text]
        : entry.content.map((text) => text.text)
    )
    .join("");
}

function sanitizedContextText(text: string): string {
  return text
    .replace(
      /data:(?:image|audio|video|application)\/[^\s)]+/gi,
      "[media omitted]",
    )
    .replace(
      /(?:[a-zA-Z]:\\|\\\\[^\\\s]+\\)[^\s)]+/g,
      "[path omitted]",
    );
}

function unavailable(
  reason: "project_changed" | "source_deleted" | "navigation_unavailable",
): AgentCitationNavigationResult {
  return Object.freeze({ status: "unavailable", reason });
}

export function createAgentWorkspaceStore(
  attachmentResolver: AgentAttachmentTokenResolverPort,
): AgentWorkspaceStore {
  const listeners = new Set<() => void>();
  const readinessListeners = new Set<
    (readiness: AgentProposalApplicationReadiness) => void
  >();
  let snapshot: AgentWorkspaceSnapshot | null = null;
  let document: PreshotBlockDocument | null = null;
  let blocks: ReadonlyMap<string, PreshotBlock> = new Map();
  let selectedImageSource: PrivateSelectedImage | null = null;
  const imageSources = new Map<string, PrivateSelectedImage>();
  let imageKeys = new Set<string>();
  let blockNavigator: BlockNavigator | null = null;
  let imageNavigator: ImageNavigator | null = null;
  let proposalApplication: AgentProposalMutationPort | null = null;
  let proposalApplicationProjectId: string | null = null;
  let proposalApplicationReady = false;
  let selectedImageVersion = 0;
  let activeProjectPath: string | null = null;

  const readinessFor = (
    projectId: string,
  ): AgentProposalApplicationReadiness => {
    if (
      snapshot?.projectId === projectId &&
      snapshot.documentHash === "sha256:pending"
    ) {
      return { status: "loading", projectId };
    }
    if (
      snapshot?.projectId === projectId &&
      proposalApplication &&
      proposalApplicationProjectId === projectId &&
      proposalApplicationReady
    ) {
      return {
        status: "ready",
        projectId,
        revision: snapshot.documentRevision,
      };
    }
    return { status: "bridge_not_ready", projectId };
  };
  const emit = () => {
    listeners.forEach((listener) => listener());
    const projectId = snapshot?.projectId ?? proposalApplicationProjectId;
    if (projectId) {
      const readiness = readinessFor(projectId);
      readinessListeners.forEach((listener) => listener(readiness));
    }
  };
  const replaceSnapshot = (next: AgentWorkspaceSnapshot) => {
    snapshot = captureAgentWorkspaceSnapshot(next);
    emit();
  };
  const requiredSnapshot = () => {
    if (!snapshot) {
      throw new AgentDomainError(
        "project_deleted",
        "workspace",
        "No agent workspace is active",
      );
    }
    return snapshot;
  };
  const imageKey = (groupId: string, imageId: string) =>
    `${groupId}\u0000${imageId}`;
  const selectedImageReference = (
    current: AgentWorkspaceSnapshot,
    source: PrivateSelectedImage,
  ) => Object.freeze({
    projectId: current.projectId,
    groupId: source.groupId,
    imageId: source.imageId,
    selectionVersion: source.selectionVersion,
    displayName: displayNameOf(source.displayName),
    thumbnailDataUrl: source.thumbnailDataUrl,
  });

  return {
    activateProject(project) {
      if (
        snapshot?.projectId === project.projectId &&
        activeProjectPath === project.projectPath
      ) {
        if (snapshot.projectName !== project.projectName) {
          replaceSnapshot({ ...snapshot, projectName: project.projectName });
        }
        return;
      }
      if (snapshot?.projectId) {
        attachmentResolver.revokeProject(snapshot.projectId);
      }
      const projectHandle = attachmentResolver.registerProject({
        projectId: project.projectId,
        projectPath: project.projectPath,
      });
      document = null;
      blocks = new Map();
      selectedImageSource = null;
      selectedImageVersion = 0;
      imageSources.clear();
      imageKeys = new Set();
      proposalApplication = null;
      proposalApplicationProjectId = null;
      proposalApplicationReady = false;
      activeProjectPath = project.projectPath;
      replaceSnapshot({
        projectId: project.projectId,
        projectName: project.projectName,
        projectHandle,
        documentRevision: 0,
        documentHash: "sha256:pending",
        selectedBlockIds: [],
        referenceImages: [],
        saveState: "saved",
      });
    },
    clearProject() {
      if (snapshot?.projectId) {
        attachmentResolver.revokeProject(snapshot.projectId);
      }
      snapshot = null;
      document = null;
      blocks = new Map();
      selectedImageSource = null;
      selectedImageVersion = 0;
      imageSources.clear();
      imageKeys = new Set();
      proposalApplication = null;
      proposalApplicationProjectId = null;
      proposalApplicationReady = false;
      activeProjectPath = null;
      emit();
    },
    publishDocument(input) {
      const current = snapshot;
      if (!current) return;
      if (
        !Number.isSafeInteger(input.revision) ||
        input.revision < 0
      ) {
        throw new AgentDomainError(
          "session_corrupt",
          "workspace",
          "Document revision must be a non-negative integer",
        );
      }
      document = structuredClone(input.document);
      attachmentResolver.retainProjectRevision(
        current.projectId,
        input.revision,
      );
      blocks = blockIndex(document);
      const selectedBlockIds = current.selectedBlockIds.filter((id) =>
        blocks.has(id)
      );
      const cursorBlockId = current.cursorBlockId &&
          blocks.has(current.cursorBlockId)
        ? current.cursorBlockId
        : undefined;
      const base: AgentWorkspaceSnapshot = {
        ...current,
        documentRevision: input.revision,
        documentHash: hashPreshotDocument(document),
        saveState: input.saveState,
        selectedBlockIds,
        cursorBlockId,
        selectedImage: undefined,
      };
      replaceSnapshot({
        ...base,
        ...(selectedImageSource
          ? { selectedImage: selectedImageReference(base, selectedImageSource) }
          : {}),
      });
    },
    publishSaveState(saveState) {
      attachmentResolver.pruneExpired();
      if (!snapshot || snapshot.saveState === saveState) return;
      replaceSnapshot({ ...snapshot, saveState });
    },
    publishSelection(selection) {
      attachmentResolver.pruneExpired();
      if (!snapshot) return;
      const selectedBlockIds = [...new Set(selection.selectedBlockIds)]
        .filter((id) => blocks.has(id));
      const cursorBlockId = selection.cursorBlockId &&
          blocks.has(selection.cursorBlockId)
        ? selection.cursorBlockId
        : undefined;
      if (
        cursorBlockId === snapshot.cursorBlockId &&
        selectedBlockIds.length === snapshot.selectedBlockIds.length &&
        selectedBlockIds.every((id, index) =>
          id === snapshot!.selectedBlockIds[index]
        )
      ) {
        return;
      }
      replaceSnapshot({
        ...snapshot,
        selectedBlockIds,
        cursorBlockId,
      });
    },
    publishImageIndex(images) {
      attachmentResolver.pruneExpired();
      const previousImageKeys = imageKeys;
      imageKeys = new Set(images.map((image) =>
        imageKey(image.groupId, image.imageId)
      ));
      for (const key of previousImageKeys) {
        if (imageKeys.has(key)) continue;
        const separator = key.indexOf("\u0000");
        const groupId = key.slice(0, separator);
        const imageId = key.slice(separator + 1);
        attachmentResolver.revokeImage(
          snapshot?.projectId ?? "",
          groupId,
          imageId,
        );
        imageSources.delete(key);
      }
      for (const image of images) {
        const key = imageKey(image.groupId, image.imageId);
        const source = imageSources.get(key);
        if (!source || !image.relativeFile) continue;
        const updated = {
          ...source,
          displayName: image.displayName ?? source.displayName,
          relativeFile: image.relativeFile,
        };
        imageSources.set(key, updated);
        if (
          selectedImageSource?.groupId === image.groupId &&
          selectedImageSource.imageId === image.imageId
        ) {
          selectedImageSource = updated;
        }
      }
      if (snapshot) {
        replaceSnapshot({
          ...snapshot,
          referenceImages: images.slice(0, 64).map((image) => Object.freeze({
            groupId: image.groupId,
            imageId: image.imageId,
            displayName: image.displayName ?? image.imageId,
            groupLabel: image.groupLabel ?? image.groupId,
            width: image.width ?? null,
            height: image.height ?? null,
          })),
        });
      }
      if (
        selectedImageSource &&
        !imageKeys.has(
          imageKey(selectedImageSource.groupId, selectedImageSource.imageId),
        )
      ) {
        selectedImageSource = null;
        if (snapshot?.selectedImage) {
          replaceSnapshot({ ...snapshot, selectedImage: undefined });
        }
      }
    },
    publishSelectedImage(image) {
      if (!snapshot) return;
      attachmentResolver.pruneExpired();
      selectedImageSource = image
        ? { ...image, selectionVersion: ++selectedImageVersion }
        : null;
      if (selectedImageSource) {
        imageSources.set(
          imageKey(selectedImageSource.groupId, selectedImageSource.imageId),
          selectedImageSource,
        );
      }
      replaceSnapshot({
        ...snapshot,
        selectedImage: image
          ? selectedImageReference(snapshot, selectedImageSource!)
          : undefined,
      });
    },
    issueAttachment(
      attachment,
      expectedProjectId,
      expectedDocumentRevision,
    ) {
      const current = requiredSnapshot();
      const key = imageKey(attachment.groupId, attachment.imageId);
      const source = imageSources.get(key);
      if (
        current.projectId !== expectedProjectId ||
        attachment.projectId !== expectedProjectId ||
        current.documentRevision !== expectedDocumentRevision ||
        !imageKeys.has(key) ||
        !source
      ) {
        throw new AgentDomainError(
          "attachment_unavailable",
          "workspace",
          "The selected image is no longer available. Reselect it and try again.",
          { retryable: true },
        );
      }
      return attachmentResolver.issueAttachment({
        projectId: current.projectId,
        projectHandle: current.projectHandle,
        documentRevision: current.documentRevision,
        groupId: source.groupId,
        imageId: source.imageId,
        relativeFile: source.relativeFile,
        pinned: attachment.pinned,
      });
    },
    revokeAttachment(attachment) {
      attachmentResolver.revokeImage(
        attachment.projectId,
        attachment.groupId,
        attachment.imageId,
      );
    },
    registerBlockNavigator(navigator) {
      blockNavigator = navigator;
      return () => {
        if (blockNavigator === navigator) blockNavigator = null;
      };
    },
    registerImageNavigator(navigator) {
      imageNavigator = navigator;
      return () => {
        if (imageNavigator === navigator) imageNavigator = null;
      };
    },
    registerProposalApplication(projectId, application) {
      proposalApplication = application;
      proposalApplicationProjectId = projectId;
      proposalApplicationReady = false;
      emit();
      const registration = {
        setReady(ready: boolean) {
          if (proposalApplication !== application) return;
          if (proposalApplicationReady === ready) return;
          proposalApplicationReady = ready;
          emit();
        },
        unregister() {
        if (proposalApplication === application) {
          proposalApplication = null;
            proposalApplicationProjectId = null;
            proposalApplicationReady = false;
            emit();
        }
        },
      };
      return registration;
    },
    getReadiness(projectId) {
      return readinessFor(projectId);
    },
    subscribeReadiness(listener) {
      readinessListeners.add(listener);
      return () => readinessListeners.delete(listener);
    },
    async getCurrentPlan(projectId) {
      const current = requiredSnapshot();
      if (projectId !== current.projectId) {
        throw new AgentDomainError(
          "project_deleted",
          "workspace",
          "The active proposal application bridge is unavailable",
        );
      }
      const readiness = readinessFor(projectId);
      if (readiness.status === "loading") {
        throw new AgentProposalTemporaryError(
          "PLAN_LOADING",
          "The active project plan is still loading",
        );
      }
      if (readiness.status !== "ready" || !proposalApplication) {
        throw new AgentProposalTemporaryError(
          "PLAN_BRIDGE_NOT_READY",
          "The active BlockNote proposal bridge is not ready",
        );
      }
      return proposalApplication.getCurrentPlan(projectId);
    },
    async applyAtomically(input) {
      const current = requiredSnapshot();
      if (input.projectId !== current.projectId || !proposalApplication) {
        throw new AgentDomainError(
          "project_deleted",
          "workspace",
          "The proposal targets another project",
        );
      }
      await proposalApplication.applyAtomically(input);
    },
    async restoreCheckpointAtomically(input) {
      const current = requiredSnapshot();
      if (input.projectId !== current.projectId || !proposalApplication) {
        throw new AgentDomainError(
          "project_deleted",
          "workspace",
          "The proposal checkpoint targets another project",
        );
      }
      await proposalApplication.restoreCheckpointAtomically(input);
    },
    async rollbackAtomically(input) {
      const current = requiredSnapshot();
      if (input.projectId !== current.projectId || !proposalApplication) {
        throw new AgentDomainError(
          "project_deleted",
          "workspace",
          "The proposal rollback targets another project",
        );
      }
      await proposalApplication.rollbackAtomically(input);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return snapshot;
    },
    captureSnapshot() {
      return captureAgentWorkspaceSnapshot(requiredSnapshot());
    },
    readTextBlocks(captured, blockIds) {
      const current = requiredSnapshot();
      if (!document) {
        throw new AgentDomainError(
          "project_deleted",
          "workspace",
          "The active document is unavailable",
        );
      }
      if (
        captured.projectId !== current.projectId ||
        captured.documentRevision !== current.documentRevision ||
        captured.documentHash !== current.documentHash
      ) {
        throw new AgentDomainError(
          "proposal_stale",
          "workspace",
          "Agent workspace snapshot is stale",
        );
      }
      if (
        blockIds.length > MAX_CONTEXT_BLOCKS ||
        new Set(blockIds).size !== blockIds.length
      ) {
        throw new AgentDomainError(
          "context_too_large",
          "generation",
          `At most ${MAX_CONTEXT_BLOCKS} unique blocks may be attached`,
        );
      }
      let total = 0;
      const result: AgentTextBlockRead[] = [];
      for (const blockId of blockIds) {
        const block = blocks.get(blockId);
        if (!block) {
          throw new AgentDomainError(
            "proposal_stale",
            "workspace",
            `Block "${blockId}" is no longer available`,
          );
        }
        const text = sanitizedContextText(inlineText(block))
          .slice(0, MAX_BLOCK_TEXT_CHARS);
        total += text.length;
        if (total > MAX_TOTAL_TEXT_CHARS) {
          throw new AgentDomainError(
            "context_too_large",
            "generation",
            `Selected block text exceeds ${MAX_TOTAL_TEXT_CHARS} characters`,
          );
        }
        result.push(Object.freeze({
          blockId,
          blockHash: hashPreshotBlock(block),
          type: block.type,
          text,
        }));
      }
      return Object.freeze(result);
    },
    navigateToBlock(citation: AgentBlockCitation) {
      if (!snapshot || citation.projectId !== snapshot.projectId) {
        return unavailable("project_changed");
      }
      if (!blocks.has(citation.blockId)) return unavailable("source_deleted");
      if (!blockNavigator?.focusBlock(citation.blockId)) {
        return unavailable("navigation_unavailable");
      }
      return Object.freeze({ status: "navigated" });
    },
    navigateToImage(citation: AgentImageCitation, open: boolean) {
      if (!snapshot || citation.projectId !== snapshot.projectId) {
        return unavailable("project_changed");
      }
      if (
        !imageKeys.has(`${citation.groupId}\u0000${citation.imageId}`)
      ) {
        return unavailable("source_deleted");
      }
      if (
        !imageNavigator?.selectImage(
          citation.groupId,
          citation.imageId,
          open,
        )
      ) {
        return unavailable("navigation_unavailable");
      }
      return Object.freeze({ status: "navigated" });
    },
  };
}
