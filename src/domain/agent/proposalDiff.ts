import type {
  PreshotBlock,
  ProjectPlanV14,
} from "../plan/canvas/blockDocument";
import type { AgentTextEditProposal } from "./proposal";

export interface AgentProposalDiffItem {
  readonly key: string;
  readonly kind: "add" | "edit" | "delete";
  readonly label: string;
  readonly blockId: string;
  readonly before: string | null;
  readonly after: string | null;
}

export interface AgentProposalStackedDiff {
  readonly proposalId: string;
  readonly summary: string;
  readonly counts: Readonly<{
    add: number;
    edit: number;
    delete: number;
  }>;
  readonly destructive: boolean;
  readonly items: readonly AgentProposalDiffItem[];
}

const TYPE_LABELS: Readonly<Record<string, string>> = {
  paragraph: "Paragraph",
  heading: "Heading",
  bulletListItem: "Bulleted list item",
  numberedListItem: "Numbered list item",
  checkListItem: "Checklist item",
  toggleListItem: "Toggle item",
  quote: "Quote",
  codeBlock: "Code block",
};

function indexBlocks(
  blocks: readonly PreshotBlock[],
  target = new Map<string, PreshotBlock>(),
): ReadonlyMap<string, PreshotBlock> {
  for (const block of blocks) {
    target.set(block.id, block);
    indexBlocks(block.children, target);
  }
  return target;
}

function textOf(block: PreshotBlock): string {
  if (!Array.isArray(block.content)) return "";
  return block.content.flatMap((entry) =>
    entry.type === "text"
      ? [entry.text]
      : entry.content.map((text) => text.text)
  ).join("");
}

function labelOf(action: "Add" | "Edit" | "Delete", block: PreshotBlock) {
  return `${action} ${TYPE_LABELS[block.type] ?? "text block"}`;
}

export function createAgentProposalStackedDiff(
  proposal: AgentTextEditProposal,
  before: ProjectPlanV14,
  after: ProjectPlanV14,
): AgentProposalStackedDiff {
  const beforeBlocks = indexBlocks(before.document.blocks);
  const afterBlocks = indexBlocks(after.document.blocks);
  const items: AgentProposalDiffItem[] = [];
  const representedIds = new Set<string>();

  for (const [index, operation] of proposal.operations.entries()) {
    if (operation.op === "update") {
      const previous = beforeBlocks.get(operation.blockId);
      const next = afterBlocks.get(operation.blockId);
      if (previous && next) {
        items.push({
          key: `${index}:edit:${operation.blockId}`,
          kind: "edit",
          label: labelOf("Edit", next),
          blockId: operation.blockId,
          before: textOf(previous),
          after: textOf(next),
        });
        representedIds.add(operation.blockId);
      }
      continue;
    }
    if (operation.op === "delete") {
      const previous = beforeBlocks.get(operation.blockId);
      if (previous) {
        items.push({
          key: `${index}:delete:${operation.blockId}`,
          kind: "delete",
          label: labelOf("Delete", previous),
          blockId: operation.blockId,
          before: textOf(previous),
          after: null,
        });
        representedIds.add(operation.blockId);
      }
    }
  }

  for (const [blockId, block] of afterBlocks) {
    if (beforeBlocks.has(blockId) || representedIds.has(blockId)) continue;
    items.push({
      key: `add:${blockId}`,
      kind: "add",
      label: labelOf("Add", block),
      blockId,
      before: null,
      after: textOf(block),
    });
  }

  const counts = {
    add: items.filter((item) => item.kind === "add").length,
    edit: items.filter((item) => item.kind === "edit").length,
    delete: items.filter((item) => item.kind === "delete").length,
  };
  return Object.freeze({
    proposalId: proposal.proposalId,
    summary: proposal.summary,
    counts: Object.freeze(counts),
    destructive: counts.delete > 0,
    items: Object.freeze(items.map((item) => Object.freeze(item))),
  });
}
