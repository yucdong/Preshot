// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createAgentWorkspaceStore } from "../../domain/agent/workspaceBridge";
import { MemoryAttachmentTokenResolver } from "../../infrastructure/agent/memoryAttachmentTokenResolver";
import {
  AgentWorkspaceProvider,
} from "./AgentWorkspaceContext";
import { useAgentWorkspaceSnapshot } from "./useAgentWorkspace";

const snapshotRendered = vi.fn();
const siblingRendered = vi.fn();

function SnapshotConsumer() {
  snapshotRendered();
  const snapshot = useAgentWorkspaceSnapshot();
  return (
    <output data-testid="snapshot">
      {snapshot && snapshot.selectedBlockIds.length > 0
        ? snapshot.selectedBlockIds.join(",")
        : "none"}
    </output>
  );
}

function UnsubscribedSibling() {
  siblingRendered();
  return <output data-testid="sibling">sibling</output>;
}

describe("AgentWorkspaceProvider", () => {
  it("rerenders only external-store subscribers when selection changes", () => {
    snapshotRendered.mockClear();
    siblingRendered.mockClear();
    const store = createAgentWorkspaceStore(
      new MemoryAttachmentTokenResolver({ makeId: () => "id" }),
    );
    store.activateProject({
      projectId: "project-1",
      projectName: "Editorial",
      projectPath: "C:\\shoots\\Editorial",
    });
    store.publishDocument({
      revision: 1,
      saveState: "saved",
      document: {
        format: "preshot-blocks",
        version: 3,
        blocks: [{
          id: "block-1",
          type: "paragraph",
          props: {},
          content: [{ type: "text", text: "Text", styles: {} }],
          children: [],
        }],
      },
    });

    render(
      <AgentWorkspaceProvider store={store}>
        <SnapshotConsumer />
        <UnsubscribedSibling />
      </AgentWorkspaceProvider>,
    );
    expect(screen.getByTestId("snapshot")).toHaveTextContent("none");
    expect(screen.getByTestId("sibling")).toHaveTextContent("sibling");
    expect(snapshotRendered).toHaveBeenCalledTimes(1);
    expect(siblingRendered).toHaveBeenCalledTimes(1);

    act(() => {
      store.publishSelection({
        selectedBlockIds: ["block-1"],
        cursorBlockId: "block-1",
      });
    });

    expect(screen.getByTestId("snapshot")).toHaveTextContent("block-1");
    expect(snapshotRendered).toHaveBeenCalledTimes(2);
    expect(siblingRendered).toHaveBeenCalledTimes(1);
  });
});
