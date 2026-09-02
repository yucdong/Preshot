import { describe, expect, it, vi } from "vitest";
import type {
  AgentAttachmentTokenResolverPort,
  AgentRuntimeSessionConfig,
  AgentWorkspaceBridgePort,
  AgentWorkspaceSnapshot,
} from "../../domain/agent";
import {
  DEFAULT_AGENT_MODEL_CAPABILITIES,
  DEFAULT_AGENT_MODEL_SETTINGS,
} from "../../domain/agent";
import { createTauriAgentRuntime } from "./tauriAgentRuntime";

const snapshot: AgentWorkspaceSnapshot = {
  projectId: "project-1",
  projectName: "Project",
  projectHandle: "opaque-project",
  documentRevision: 3,
  documentHash: `sha256:${"a".repeat(64)}`,
  selectedBlockIds: ["block-1"],
  saveState: "saved",
};

const config: AgentRuntimeSessionConfig = {
  projectId: "project-1",
  projectPath: "C:\\Project",
  modelId: "model",
  settings: {
    ...DEFAULT_AGENT_MODEL_SETTINGS,
    enabled: true,
    modelId: "model",
  },
  capabilities: {
    ...DEFAULT_AGENT_MODEL_CAPABILITIES,
    responsesApi: "verified",
    streaming: "verified",
    customTools: "verified",
  },
  toolPolicy: {
    allowedTools: [
      "get_project_summary",
      "read_text_blocks",
      "list_reference_images",
      "propose_text_block_edits",
    ],
    permissionMode: "request",
  },
  continuePendingWork: false,
};

describe("createTauriAgentRuntime", () => {
  it("hands off immutable context and a native-resolved attachment without mutating the plan", async () => {
    const invokeCommand = vi.fn(async (command: string) => {
      if (command === "agent_create_session") {
        return { sessionId: "session-1" };
      }
      return null;
    });
    const workspace: AgentWorkspaceBridgePort = {
      captureSnapshot: vi.fn(() => snapshot),
      issueAttachment: vi.fn(() => "fresh-attachment"),
      revokeAttachment: vi.fn(),
      readTextBlocks: vi.fn((_captured, ids) =>
        ids.map((blockId: string) => ({
          blockId,
          blockHash: `sha256:${"b".repeat(64)}`,
          type: "paragraph",
          text: "Read-only text",
        }))
      ),
      navigateToBlock: vi.fn(() => ({ status: "navigated" as const })),
      navigateToImage: vi.fn(() => ({ status: "navigated" as const })),
    };
    const attachments: AgentAttachmentTokenResolverPort = {
      registerProject: vi.fn(),
      issueAttachment: vi.fn(),
      resolveAttachment: vi.fn(async () => ({
        projectId: "project-1",
        documentRevision: 3,
        groupId: "group-1",
        imageId: "image-1",
        absolutePath: "C:\\Project\\references\\0001.png",
      })),
      revokeAttachment: vi.fn(),
      revokeImage: vi.fn(),
      retainProjectRevision: vi.fn(),
      pruneExpired: vi.fn(),
      revokeProject: vi.fn(),
    };
    const runtime = createTauriAgentRuntime({
      invokeCommand,
      createChannel: () => ({ onmessage: null }),
      makeId: () => "request-1",
      workspace,
      attachments,
    });
    await runtime.createSession(config);
    await runtime.send({
      sessionId: "session-1",
      text: "Describe this",
      context: {
        projectId: "project-1",
        projectName: "Project",
        documentRevision: 3,
        documentHash: snapshot.documentHash,
        selectedBlockIds: ["block-1"],
        capturedAt: "2026-08-22T00:00:00Z",
      },
      attachment: {
        kind: "selected_image",
        projectId: "project-1",
        groupId: "group-1",
        imageId: "image-1",
        displayName: "0001.png",
        pinned: false,
      },
    });

    expect(invokeCommand).toHaveBeenCalledWith(
      "agent_register_request_context",
      {
        input: expect.objectContaining({
          contextId: "request-1",
          receipt: expect.objectContaining({ documentRevision: 3 }),
          textBlocks: [
            expect.objectContaining({
              blockId: "block-1",
              text: "Read-only text",
            }),
          ],
          attachment: {
            token: "fresh-attachment",
            groupId: "group-1",
            imageId: "image-1",
            absolutePath: "C:\\Project\\references\\0001.png",
          },
        }),
      },
    );
    expect(workspace.issueAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ imageId: "image-1" }),
      "project-1",
      3,
    );
    expect(attachments.resolveAttachment).toHaveBeenCalledWith({
      token: "fresh-attachment",
      expectedProjectId: "project-1",
      expectedDocumentRevision: 3,
    });
    expect(attachments.revokeAttachment).toHaveBeenCalledWith(
      "fresh-attachment",
    );
    expect(workspace.readTextBlocks).toHaveBeenCalled();
    expect("applyAtomically" in workspace).toBe(false);
  });

  it("rejects stale context before invoking native Send", async () => {
    const invokeCommand = vi.fn();
    const workspace: AgentWorkspaceBridgePort = {
      captureSnapshot: () => ({ ...snapshot, documentRevision: 4 }),
      issueAttachment: vi.fn(),
      revokeAttachment: vi.fn(),
      readTextBlocks: vi.fn(),
      navigateToBlock: vi.fn(() => ({ status: "navigated" as const })),
      navigateToImage: vi.fn(() => ({ status: "navigated" as const })),
    };
    const runtime = createTauriAgentRuntime({
      invokeCommand,
      createChannel: () => ({ onmessage: null }),
      workspace,
      attachments: {} as AgentAttachmentTokenResolverPort,
    });

    await expect(runtime.send({
      sessionId: "session-1",
      text: "stale",
      context: {
        projectId: "project-1",
        projectName: "Project",
        documentRevision: 3,
        documentHash: snapshot.documentHash,
        selectedBlockIds: [],
        capturedAt: "now",
      },
      attachment: null,
    })).rejects.toThrow(/stale/i);
    expect(invokeCommand).not.toHaveBeenCalledWith(
      "agent_send",
      expect.anything(),
    );
  });
});
