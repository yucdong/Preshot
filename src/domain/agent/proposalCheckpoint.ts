import {
  type PreshotBlock,
  validateProjectPlanV14,
} from "../plan/canvas/blockDocument";
import { hashPreshotDocument } from "./proposal";
import type {
  AgentApplyCheckpoint,
  AgentApplyCheckpointChange,
} from "./proposalApply";

function record(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: Record<string, unknown>, key: string): string {
  const entry = value[key];
  if (typeof entry !== "string" || !entry || entry.length > 200) {
    throw new Error(`Checkpoint ${key} is invalid`);
  }
  return entry;
}

function revision(value: Record<string, unknown>, key: string): number {
  const entry = value[key];
  if (
    typeof entry !== "number" ||
    !Number.isSafeInteger(entry) ||
    entry < 0
  ) {
    throw new Error(`Checkpoint ${key} is invalid`);
  }
  return entry;
}

function findBlock(
  blocks: readonly PreshotBlock[],
  blockId: string,
): PreshotBlock | null {
  for (const block of blocks) {
    if (block.id === blockId) return block;
    const nested = findBlock(block.children, blockId);
    if (nested) return nested;
  }
  return null;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    throw new Error("Checkpoint contains unsupported fields");
  }
}

export function validateAgentApplyCheckpoint(
  raw: unknown,
): AgentApplyCheckpoint {
  const value = record(raw, "Checkpoint");
  exactKeys(value, [
    "checkpointId",
    "proposalId",
    "sessionId",
    "projectId",
    "beforeRevision",
    "beforeDocumentHash",
    "appliedRevision",
    "appliedDocumentHash",
    "beforePlan",
    "changes",
  ]);
  const beforePlan = validateProjectPlanV14(value.beforePlan);
  const beforeDocumentHash = string(value, "beforeDocumentHash");
  const appliedDocumentHash = string(value, "appliedDocumentHash");
  if (
    hashPreshotDocument(beforePlan.document) !== beforeDocumentHash ||
    !/^sha256:[0-9a-f]{64}$/.test(appliedDocumentHash) ||
    !Array.isArray(value.changes) ||
    value.changes.length > 150
  ) {
    throw new Error("Checkpoint document receipt is invalid");
  }
  const changes: AgentApplyCheckpointChange[] = value.changes.map(
    (rawChange, index) => {
      const change = record(rawChange, `Checkpoint change ${index}`);
      const blockId = string(change, "blockId");
      if (change.kind === "remove_inserted") {
        exactKeys(change, ["kind", "blockId", "appliedBlockHash"]);
        const appliedBlockHash = string(change, "appliedBlockHash");
        if (!/^sha256:[0-9a-f]{64}$/.test(appliedBlockHash)) {
          throw new Error("Inserted checkpoint hash is invalid");
        }
        return { kind: "remove_inserted", blockId, appliedBlockHash };
      }
      const beforeBlock = findBlock(beforePlan.document.blocks, blockId);
      if (
        !beforeBlock ||
        JSON.stringify(beforeBlock) !== JSON.stringify(change.beforeBlock)
      ) {
        throw new Error("Checkpoint before block is invalid");
      }
      if (change.kind === "restore") {
        exactKeys(change, [
          "kind",
          "blockId",
          "beforeBlock",
          "appliedBlockHash",
        ]);
        const appliedBlockHash = string(change, "appliedBlockHash");
        if (!/^sha256:[0-9a-f]{64}$/.test(appliedBlockHash)) {
          throw new Error("Restore checkpoint hash is invalid");
        }
        return {
          kind: "restore",
          blockId,
          beforeBlock: structuredClone(beforeBlock),
          appliedBlockHash,
        };
      }
      if (change.kind !== "restore_deleted") {
        throw new Error("Checkpoint change kind is invalid");
      }
      exactKeys(change, [
        "kind",
        "blockId",
        "beforeBlock",
        "parentBlockId",
        "beforeIndex",
        "previousBlockId",
        "nextBlockId",
      ]);
      const nullableId = (key: string): string | null =>
        change[key] === null ? null : string(change, key);
      return {
        kind: "restore_deleted",
        blockId,
        beforeBlock: structuredClone(beforeBlock),
        parentBlockId: nullableId("parentBlockId"),
        beforeIndex: revision(change, "beforeIndex"),
        previousBlockId: nullableId("previousBlockId"),
        nextBlockId: nullableId("nextBlockId"),
      };
    },
  );
  return {
    checkpointId: string(value, "checkpointId"),
    proposalId: string(value, "proposalId"),
    sessionId: string(value, "sessionId"),
    projectId: string(value, "projectId"),
    beforeRevision: revision(value, "beforeRevision"),
    beforeDocumentHash,
    appliedRevision: revision(value, "appliedRevision"),
    appliedDocumentHash,
    beforePlan,
    changes,
  };
}
