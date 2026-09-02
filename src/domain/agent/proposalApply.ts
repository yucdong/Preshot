import {
  type PreshotBlock,
  type ProjectPlanV14,
  validateProjectPlanV14,
} from "../plan/canvas/blockDocument";
import {
  applyAllowedTextBlockPatch,
  type AgentTextEditProposal,
  type AllowedTextBlockDraft,
  hashPreshotBlock,
  hashPreshotDocument,
  isAgentTextBlockType,
  textBlockFromDraft,
} from "./proposal";

export interface AgentProposalConflict {
  readonly operationIndex: number;
  readonly blockId: string;
  readonly reason: "missing" | "hash_mismatch" | "not_text" | "duplicate_id";
}

export type AgentProposalProjection =
  | {
      readonly status: "projected";
      readonly plan: ProjectPlanV14;
      readonly documentHash: string;
    }
  | {
      readonly status: "stale";
      readonly reason: "revision" | "document_hash";
      readonly currentRevision: number;
      readonly currentDocumentHash: string;
    }
  | {
      readonly status: "conflict";
      readonly conflict: AgentProposalConflict;
    }
  | {
      readonly status: "invalid";
      readonly message: string;
    };

export interface AgentAppliedProposalReceipt {
  readonly proposalId: string;
  readonly sessionId: string;
  readonly status: "applied";
  readonly appliedAt: string;
  readonly baseRevision: number;
  readonly appliedRevision: number;
  readonly baseDocumentHash: string;
  readonly appliedDocumentHash: string;
  readonly operationCount: number;
}

export interface AgentDiscardedProposalReceipt {
  readonly proposalId: string;
  readonly sessionId: string;
  readonly status: "discarded";
  readonly discardedAt: string;
  readonly operationCount: number;
}

export interface AgentApplyCheckpoint {
  readonly checkpointId: string;
  readonly proposalId: string;
  readonly sessionId: string;
  readonly projectId: string;
  readonly beforeRevision: number;
  readonly beforeDocumentHash: string;
  readonly appliedRevision: number;
  readonly appliedDocumentHash: string;
  readonly beforePlan: ProjectPlanV14;
  readonly changes: readonly AgentApplyCheckpointChange[];
}

export type AgentApplyCheckpointChange =
  | {
      readonly kind: "restore";
      readonly blockId: string;
      readonly beforeBlock: PreshotBlock;
      readonly appliedBlockHash: string;
    }
  | {
      readonly kind: "restore_deleted";
      readonly blockId: string;
      readonly beforeBlock: PreshotBlock;
      readonly parentBlockId: string | null;
      readonly beforeIndex: number;
      readonly previousBlockId: string | null;
      readonly nextBlockId: string | null;
    }
  | {
      readonly kind: "remove_inserted";
      readonly blockId: string;
      readonly appliedBlockHash: string;
    };

export type AgentProposalApplyResult =
  | {
      readonly status: "applied";
      readonly plan: ProjectPlanV14;
      readonly revision: number;
      readonly documentHash: string;
      readonly receipt: AgentAppliedProposalReceipt;
      readonly checkpoint: AgentApplyCheckpoint;
    }
  | Exclude<AgentProposalProjection, { readonly status: "projected" }>;

export type AgentUndoResult =
  | {
      readonly status: "undone";
      readonly plan: ProjectPlanV14;
      readonly revision: number;
      readonly documentHash: string;
      readonly checkpointId: string;
    }
  | {
      readonly status: "conflict";
      readonly reason: "affected_blocks";
      readonly currentRevision: number;
      readonly currentDocumentHash: string;
      readonly affectedBlockIds: readonly string[];
    };

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry)) as T;
  }
  if (typeof value === "object" && value !== null) {
    const clone: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      clone[key] = cloneValue(entry);
    }
    return clone as T;
  }
  return value;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}

function immutablePlan(plan: ProjectPlanV14): ProjectPlanV14 {
  return deepFreeze(cloneValue(plan));
}

interface LocatedBlock {
  readonly block: PreshotBlock;
  readonly siblings: readonly PreshotBlock[];
  readonly index: number;
  readonly parentBlockId: string | null;
}

function locateBlock(
  blocks: readonly PreshotBlock[],
  blockId: string,
  parentBlockId: string | null = null,
): LocatedBlock | null {
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.id === blockId) {
      return { block, siblings: blocks, index, parentBlockId };
    }
    const nested = locateBlock(block.children, blockId, block.id);
    if (nested) return nested;
  }
  return null;
}

function replaceSiblings(
  blocks: readonly PreshotBlock[],
  target: readonly PreshotBlock[],
  replacement: readonly PreshotBlock[],
): PreshotBlock[] {
  if (blocks === target) return [...replacement];
  let changed = false;
  const next = blocks.map((block) => {
    const children = replaceSiblings(block.children, target, replacement);
    if (children === block.children) return block;
    changed = true;
    return { ...block, children };
  });
  return changed ? next : blocks as PreshotBlock[];
}

function replaceSiblingsOrSame(
  blocks: readonly PreshotBlock[],
  target: readonly PreshotBlock[],
  replacement: readonly PreshotBlock[],
): PreshotBlock[] {
  if (blocks === target) return [...replacement];
  let changed = false;
  const next = blocks.map((block) => {
    const children = replaceSiblingsOrSame(
      block.children,
      target,
      replacement,
    );
    if (children === block.children) return block;
    changed = true;
    return { ...block, children };
  });
  return changed ? next : blocks as PreshotBlock[];
}

function collectIds(blocks: readonly PreshotBlock[], ids = new Set<string>()): Set<string> {
  for (const block of blocks) {
    ids.add(block.id);
    collectIds(block.children, ids);
  }
  return ids;
}

function blocksFromDrafts(
  drafts: readonly AllowedTextBlockDraft[],
  makeId: () => string,
  ids: Set<string>,
): PreshotBlock[] | AgentProposalConflict {
  const blocks: PreshotBlock[] = [];
  for (const draft of drafts) {
    const id = makeId();
    if (!id || ids.has(id)) {
      return {
        operationIndex: -1,
        blockId: id,
        reason: "duplicate_id",
      };
    }
    ids.add(id);
    const children = blocksFromDrafts(draft.children ?? [], makeId, ids);
    if (!Array.isArray(children)) return children;
    blocks.push(textBlockFromDraft(draft, id, children));
  }
  return blocks;
}

function expectedHashConflict(
  operationIndex: number,
  blockId: string,
  located: LocatedBlock | null,
  expectedHash: string,
  requireText: boolean,
): AgentProposalConflict | null {
  if (!located) {
    return { operationIndex, blockId, reason: "missing" };
  }
  if (requireText && !isAgentTextBlockType(located.block.type)) {
    return { operationIndex, blockId, reason: "not_text" };
  }
  if (hashPreshotBlock(located.block) !== expectedHash) {
    return { operationIndex, blockId, reason: "hash_mismatch" };
  }
  return null;
}

export function projectAgentTextEditProposal(
  plan: ProjectPlanV14,
  currentRevision: number,
  proposal: AgentTextEditProposal,
  makeId: () => string,
): AgentProposalProjection {
  const currentDocumentHash = hashPreshotDocument(plan.document);
  if (proposal.baseRevision !== currentRevision) {
    return {
      status: "stale",
      reason: "revision",
      currentRevision,
      currentDocumentHash,
    };
  }
  if (proposal.baseDocumentHash !== currentDocumentHash) {
    return {
      status: "stale",
      reason: "document_hash",
      currentRevision,
      currentDocumentHash,
    };
  }

  let blocks = plan.document.blocks;
  const ids = collectIds(blocks);
  for (
    let operationIndex = 0;
    operationIndex < proposal.operations.length;
    operationIndex += 1
  ) {
    const operation = proposal.operations[operationIndex];
    if (operation.op === "update") {
      const located = locateBlock(blocks, operation.blockId);
      const conflict = expectedHashConflict(
        operationIndex,
        operation.blockId,
        located,
        operation.expectedBlockHash,
        true,
      );
      if (conflict || !located) {
        return { status: "conflict", conflict: conflict! };
      }
      const siblings = [...located.siblings];
      try {
        siblings[located.index] = applyAllowedTextBlockPatch(
          located.block,
          operation.patch,
        );
      } catch (error) {
        return {
          status: "invalid",
          message: error instanceof Error ? error.message : String(error),
        };
      }
      blocks = replaceSiblingsOrSame(blocks, located.siblings, siblings);
      continue;
    }
    if (operation.op === "delete") {
      const located = locateBlock(blocks, operation.blockId);
      const conflict = expectedHashConflict(
        operationIndex,
        operation.blockId,
        located,
        operation.expectedBlockHash,
        true,
      );
      if (conflict || !located) {
        return { status: "conflict", conflict: conflict! };
      }
      const siblings = located.siblings.filter(
        (_, index) => index !== located.index,
      );
      blocks = replaceSiblingsOrSame(blocks, located.siblings, siblings);
      continue;
    }

    const located = locateBlock(blocks, operation.referenceBlockId);
    const conflict = expectedHashConflict(
      operationIndex,
      operation.referenceBlockId,
      located,
      operation.expectedReferenceHash,
      false,
    );
    if (conflict || !located) {
      return { status: "conflict", conflict: conflict! };
    }
    const inserted = blocksFromDrafts(operation.blocks, makeId, ids);
    if (!Array.isArray(inserted)) {
      return {
        status: "conflict",
        conflict: { ...inserted, operationIndex },
      };
    }
    const insertionIndex = operation.op === "insertBefore"
      ? located.index
      : located.index + 1;
    const siblings = [
      ...located.siblings.slice(0, insertionIndex),
      ...inserted,
      ...located.siblings.slice(insertionIndex),
    ];
    blocks = replaceSiblings(blocks, located.siblings, siblings);
  }

  try {
    const projected = validateProjectPlanV14({
      ...plan,
      document: {
        ...plan.document,
        blocks,
      },
    });
    return {
      status: "projected",
      plan: projected,
      documentHash: hashPreshotDocument(projected.document),
    };
  } catch (error) {
    return {
      status: "invalid",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function checkpointChanges(
  before: ProjectPlanV14,
  applied: ProjectPlanV14,
  proposal: AgentTextEditProposal,
): AgentApplyCheckpointChange[] {
  const changes: AgentApplyCheckpointChange[] = [];
  const beforeIds = collectIds(before.document.blocks);
  const appliedIds = collectIds(applied.document.blocks);
  for (const operation of proposal.operations) {
    if (operation.op === "update") {
      const previous = locateBlock(before.document.blocks, operation.blockId);
      const next = locateBlock(applied.document.blocks, operation.blockId);
      if (previous && next) {
        changes.push({
          kind: "restore",
          blockId: operation.blockId,
          beforeBlock: deepFreeze(cloneValue(previous.block)),
          appliedBlockHash: hashPreshotBlock(next.block),
        });
      }
      continue;
    }
    if (operation.op === "delete") {
      const previous = locateBlock(before.document.blocks, operation.blockId);
      if (previous) {
        changes.push({
          kind: "restore_deleted",
          blockId: operation.blockId,
          beforeBlock: cloneValue(previous.block),
          parentBlockId: previous.parentBlockId,
          beforeIndex: previous.index,
          previousBlockId: previous.siblings[previous.index - 1]?.id ?? null,
          nextBlockId: previous.siblings[previous.index + 1]?.id ?? null,
        });
      }
    }
  }
  const insertedRoots = new Set<string>();
  const visit = (
    blocks: readonly PreshotBlock[],
    parentInserted: boolean,
  ) => {
    for (const block of blocks) {
      const inserted = !beforeIds.has(block.id);
      if (inserted && !parentInserted) insertedRoots.add(block.id);
      visit(block.children, parentInserted || inserted);
    }
  };
  visit(applied.document.blocks, false);
  for (const blockId of insertedRoots) {
    if (!appliedIds.has(blockId)) continue;
    const located = locateBlock(applied.document.blocks, blockId);
    if (located) {
      changes.push({
        kind: "remove_inserted",
        blockId,
        appliedBlockHash: hashPreshotBlock(located.block),
      });
    }
  }
  return changes;
}

export function applyAgentTextEditProposal(
  plan: ProjectPlanV14,
  currentRevision: number,
  proposal: AgentTextEditProposal,
  context: {
    readonly projectId?: string;
    readonly makeId: () => string;
    readonly makeCheckpointId: () => string;
    readonly appliedAt: string;
  },
): AgentProposalApplyResult {
  const projection = projectAgentTextEditProposal(
    plan,
    currentRevision,
    proposal,
    context.makeId,
  );
  if (projection.status !== "projected") return projection;
  const revision = currentRevision + 1;
  const checkpoint: AgentApplyCheckpoint = {
    checkpointId: context.makeCheckpointId(),
    proposalId: proposal.proposalId,
    sessionId: proposal.sessionId,
    projectId: context.projectId ?? "unknown-project",
    beforeRevision: currentRevision,
    beforeDocumentHash: proposal.baseDocumentHash,
    appliedRevision: revision,
    appliedDocumentHash: projection.documentHash,
    beforePlan: immutablePlan(plan),
    changes: deepFreeze(
      checkpointChanges(plan, projection.plan, proposal),
    ),
  };
  const receipt: AgentAppliedProposalReceipt = {
    proposalId: proposal.proposalId,
    sessionId: proposal.sessionId,
    status: "applied",
    appliedAt: context.appliedAt,
    baseRevision: currentRevision,
    appliedRevision: revision,
    baseDocumentHash: proposal.baseDocumentHash,
    appliedDocumentHash: projection.documentHash,
    operationCount: proposal.operations.length,
  };
  return {
    status: "applied",
    plan: projection.plan,
    revision,
    documentHash: projection.documentHash,
    receipt,
    checkpoint,
  };
}

export function discardAgentTextEditProposal(
  proposal: AgentTextEditProposal,
  discardedAt: string,
): AgentDiscardedProposalReceipt {
  return {
    proposalId: proposal.proposalId,
    sessionId: proposal.sessionId,
    status: "discarded",
    discardedAt,
    operationCount: proposal.operations.length,
  };
}

export function undoAgentProposalApply(
  checkpoint: AgentApplyCheckpoint,
  currentPlan: ProjectPlanV14,
  currentRevision: number,
): AgentUndoResult {
  const currentDocumentHash = hashPreshotDocument(currentPlan.document);
  const conflicts: string[] = [];
  for (const change of checkpoint.changes) {
    const current = locateBlock(currentPlan.document.blocks, change.blockId);
    if (change.kind === "restore_deleted") {
      if (current) conflicts.push(change.blockId);
      continue;
    }

    if (
      !current ||
      hashPreshotBlock(current.block) !== change.appliedBlockHash
    ) {
      conflicts.push(change.blockId);
    }
  }
  if (conflicts.length > 0) {
    return {
      status: "conflict",
      reason: "affected_blocks",
      currentRevision,
      currentDocumentHash,
      affectedBlockIds: conflicts,
    };
  }

  let blocks = currentPlan.document.blocks;
  for (const change of [...checkpoint.changes].reverse()) {
    if (change.kind === "restore") {
      const located = locateBlock(blocks, change.blockId);
      if (!located) continue;
      const siblings = [...located.siblings];
      siblings[located.index] = cloneValue(change.beforeBlock);
      blocks = replaceSiblingsOrSame(blocks, located.siblings, siblings);
      continue;
    }
    if (change.kind === "remove_inserted") {
      const located = locateBlock(blocks, change.blockId);
      if (!located) continue;
      const siblings = located.siblings.filter(
        (_, index) => index !== located.index,
      );
      blocks = replaceSiblingsOrSame(blocks, located.siblings, siblings);
      continue;
    }
    const parentSiblings = change.parentBlockId === null
      ? blocks
      : locateBlock(blocks, change.parentBlockId)?.block.children;
    if (!parentSiblings) {
      return {
        status: "conflict",
        reason: "affected_blocks",
        currentRevision,
        currentDocumentHash,
        affectedBlockIds: [change.blockId],
      };
    }
    const nextIndex = change.nextBlockId
      ? parentSiblings.findIndex((block) => block.id === change.nextBlockId)
      : -1;
    const previousIndex = change.previousBlockId
      ? parentSiblings.findIndex((block) => block.id === change.previousBlockId)
      : -1;
    const insertionIndex = nextIndex >= 0
      ? nextIndex
      : previousIndex >= 0
        ? previousIndex + 1
        : Math.min(change.beforeIndex, parentSiblings.length);
    const siblings = [
      ...parentSiblings.slice(0, insertionIndex),
      cloneValue(change.beforeBlock),
      ...parentSiblings.slice(insertionIndex),
    ];
    blocks = replaceSiblingsOrSame(blocks, parentSiblings, siblings);
  }
  let plan: ProjectPlanV14;
  try {
    plan = validateProjectPlanV14({
      ...currentPlan,
      document: {
        ...currentPlan.document,
        blocks,
      },
    });
  } catch {
    return {
      status: "conflict",
      reason: "affected_blocks",
      currentRevision,
      currentDocumentHash,
      affectedBlockIds: checkpoint.changes.map((change) => change.blockId),
    };
  }
  return {
    status: "undone",
    plan,
    revision: currentRevision + 1,
    documentHash: hashPreshotDocument(plan.document),
    checkpointId: checkpoint.checkpointId,
  };
}
