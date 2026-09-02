import { cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type {
  AgentPreparedProposal,
  AgentStoredProposal,
} from "../../domain/agent";
import { AgentProposalReview } from "./AgentProposalReview";

type ReviewProps = ComponentProps<typeof AgentProposalReview>;

const HASH = `sha256:${"a".repeat(64)}`;

function stored(
  status: AgentStoredProposal["status"] = "staged",
): AgentStoredProposal {
  return {
    proposalId: "proposal-1",
    sessionId: "session-1",
    status,
    summary: "调整拍摄时间说明",
    baseRevision: 1,
    baseDocumentHash: HASH,
    operationCount: 1,
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
  };
}

const prepared: AgentPreparedProposal = {
  proposal: {
    version: 1,
    proposalId: "proposal-1",
    sessionId: "session-1",
    baseRevision: 1,
    baseDocumentHash: HASH,
    summary: "调整拍摄时间说明",
    operations: [{
      op: "delete",
      blockId: "block-1",
      expectedBlockHash: HASH,
    }],
  },
  requiresDeleteConfirmation: true,
  diff: {
    proposalId: "proposal-1",
    summary: "调整拍摄时间说明",
    counts: { add: 0, edit: 0, delete: 1 },
    destructive: true,
    items: [{
      key: "delete:block-1",
      kind: "delete",
      label: "Delete paragraph",
      blockId: "block-1",
      before: "旧的拍摄时间",
      after: null,
    }],
  },
};

function renderReview(options: {
  readonly proposals?: readonly AgentStoredProposal[];
  readonly prepared?: AgentPreparedProposal | null;
  readonly onPrepare?: ReviewProps["onPrepare"];
  readonly onApply?: ReviewProps["onApply"];
  readonly onUndo?: ReviewProps["onUndo"];
} = {}) {
  const handlers = {
    onPrepare: vi.fn<ReviewProps["onPrepare"]>(
      options.onPrepare ?? (async () => ({
        status: "ready" as const,
        prepared,
      })),
    ),
    onApply: vi.fn<ReviewProps["onApply"]>(
      options.onApply ?? (async () => ({
        status: "applied" as const,
        proposalId: "proposal-1",
        revision: 2,
        documentHash: HASH,
        checkpointId: "checkpoint-1",
      })),
    ),
    onDiscard: vi.fn<ReviewProps["onDiscard"]>(async () => {}),
    onAskRevision: vi.fn<ReviewProps["onAskRevision"]>(async () => {}),
    onUndo: vi.fn<ReviewProps["onUndo"]>(
      options.onUndo ?? (async () => ({ status: "unavailable" as const })),
    ),
    onLocateBlock: vi.fn<ReviewProps["onLocateBlock"]>(),
  };
  render(
    <AgentProposalReview
      {...handlers}
      prepared={options.prepared ?? null}
      proposals={options.proposals ?? [stored()]}
    />,
  );
  return handlers;
}

describe("AgentProposalReview", () => {
  it("prepares a stacked before/after review and supports discard and revision feedback", async () => {
    const user = userEvent.setup();
    const handlers = renderReview();

    await user.click(screen.getByRole("button", { name: "审阅更改" }));
    expect(handlers.onPrepare).toHaveBeenCalledWith("proposal-1");

    cleanup();
    const rerendered = renderReview({ prepared });
    expect(screen.getByText("旧的拍摄时间")).toBeVisible();
    expect(screen.getByText("修改前")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "要求调整" }));
    await user.type(screen.getByLabelText("说明需要如何调整"), "保留日期，只改时间");
    await user.click(screen.getByRole("button", { name: "发送调整要求" }));
    expect(rerendered.onAskRevision).toHaveBeenCalledWith(
      "proposal-1",
      "保留日期，只改时间",
    );

    cleanup();
    renderReview({ prepared });
    await user.click(screen.getByRole("button", { name: "放弃提案" }));
    expect(await screen.findByText("提案已放弃")).toBeVisible();
  });

  it("requires a destructive confirmation before applying", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn()
      .mockResolvedValueOnce({
        status: "delete_confirmation_required",
        proposalId: "proposal-1",
        deleteCount: 1,
      })
      .mockResolvedValueOnce({
        status: "applied",
        proposalId: "proposal-1",
        revision: 2,
        documentHash: HASH,
        checkpointId: "checkpoint-1",
      });
    renderReview({ prepared, onApply });

    await user.click(screen.getByRole("button", { name: "应用更改" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("提案将删除 1 个文案区块");
    await user.click(within(dialog).getByRole("button", { name: "应用更改" }));
    expect(onApply).toHaveBeenNthCalledWith(1, "proposal-1", false);
    expect(onApply).toHaveBeenNthCalledWith(2, "proposal-1", true);
    expect(await screen.findByText("更改已应用")).toBeVisible();
  });

  it("shows stale/invalid results and conflict-aware undo navigation", async () => {
    const user = userEvent.setup();
    const onPrepare = vi.fn(async () => ({
      status: "stale" as const,
      proposalId: "proposal-1",
      currentRevision: 2,
      currentDocumentHash: HASH,
    }));
    renderReview({ onPrepare });
    await user.click(screen.getByRole("button", { name: "审阅更改" }));
    expect(await screen.findByText(/此提案已过期/)).toBeVisible();

    cleanup();
    renderReview({
      onPrepare: vi.fn(async () => ({
        status: "invalid" as const,
        proposalId: "proposal-1",
        message: "invalid",
      })),
    });
    await user.click(screen.getByRole("button", { name: "审阅更改" }));
    expect(await screen.findByText("提案无效，无法安全预览或应用。"))
      .toBeVisible();

    cleanup();
    const onUndo = vi.fn(async () => ({
      status: "conflict" as const,
      proposalId: "proposal-1",
      affectedBlockIds: ["block-1"],
    }));
    const handlers = renderReview({
      proposals: [stored("applied")],
      onUndo,
    });
    await user.click(screen.getByRole("button", { name: "撤销本次应用" }));
    expect(await screen.findByText(/无法自动撤销/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "定位文案区块" }));
    expect(handlers.onLocateBlock).toHaveBeenCalledWith("block-1");
  });
});
