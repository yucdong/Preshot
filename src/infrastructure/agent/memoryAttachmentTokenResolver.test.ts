import { describe, expect, it } from "vitest";
import { MemoryAttachmentTokenResolver } from "./memoryAttachmentTokenResolver";

describe("MemoryAttachmentTokenResolver", () => {
  it("resolves opaque, single-use, project/revision-bound tokens without retaining media", async () => {
    let now = 1_000;
    let id = 0;
    const resolver = new MemoryAttachmentTokenResolver({
      now: () => now,
      makeId: () => `opaque-${++id}`,
      ttlMs: 100,
    });
    const handle = resolver.registerProject({
      projectId: "project-1",
      projectPath: "C:\\shoots\\Editorial",
    });
    const token = resolver.issueAttachment({
      projectId: "project-1",
      projectHandle: handle,
      documentRevision: 7,
      groupId: "group-1",
      imageId: "image-1",
      relativeFile: "references/0001.png",
      pinned: false,
    });
    expect(token).not.toContain("project-1");
    expect(token).not.toContain("0001.png");
    await expect(resolver.resolveAttachment({
      token,
      expectedProjectId: "project-1",
      expectedDocumentRevision: 7,
    })).resolves.toMatchObject({
      absolutePath: "C:\\shoots\\Editorial\\references\\0001.png",
      imageId: "image-1",
    });
    expect(resolver.activeTokenCount()).toBe(0);
    await expect(resolver.resolveAttachment({
      token,
      expectedProjectId: "project-1",
      expectedDocumentRevision: 7,
    })).rejects.toThrow(/expired/i);

    const mismatch = resolver.issueAttachment({
      projectId: "project-1",
      projectHandle: handle,
      documentRevision: 7,
      groupId: "group-1",
      imageId: "image-1",
      relativeFile: "references/0001.png",
      pinned: false,
    });
    await expect(resolver.resolveAttachment({
      token: mismatch,
      expectedProjectId: "project-2",
      expectedDocumentRevision: 7,
    })).rejects.toThrow(/expired or does not match/i);

    const expiring = resolver.issueAttachment({
      projectId: "project-1",
      projectHandle: handle,
      documentRevision: 8,
      groupId: "group-1",
      imageId: "image-1",
      relativeFile: "references/0001.png",
      pinned: false,
    });
    now += 101;
    await expect(resolver.resolveAttachment({
      token: expiring,
      expectedProjectId: "project-1",
      expectedDocumentRevision: 8,
    })).rejects.toThrow(/expired/i);
  });

  it("evicts expired, superseded, stale-revision, removed-image, and excess pinned tokens", () => {
    let now = 0;
    let id = 0;
    const resolver = new MemoryAttachmentTokenResolver({
      now: () => now,
      makeId: () => `id-${++id}`,
      ttlMs: 100,
    });
    const handle = resolver.registerProject({
      projectId: "project-1",
      projectPath: "C:\\shoots\\Editorial",
    });
    const issue = (
      imageId: string,
      pinned: boolean,
      documentRevision = 1,
    ) =>
      resolver.issueAttachment({
        projectId: "project-1",
        projectHandle: handle,
        documentRevision,
        groupId: "group-1",
        imageId,
        relativeFile: `references/${imageId}.png`,
        pinned,
      });

    issue("auto-1", false);
    issue("auto-2", false);
    expect(resolver.activeTokenCount("project-1")).toBe(1);

    for (let index = 0; index < 12; index += 1) {
      issue(`pinned-${index}`, true);
    }
    expect(resolver.activeTokenCount("project-1")).toBe(9);
    resolver.revokeImage("project-1", "group-1", "pinned-11");
    expect(resolver.activeTokenCount("project-1")).toBe(8);

    resolver.retainProjectRevision("project-1", 2);
    expect(resolver.activeTokenCount("project-1")).toBe(0);
    issue("expiring", false, 2);
    now = 101;
    resolver.pruneExpired();
    expect(resolver.activeTokenCount()).toBe(0);
  });

  it("rejects traversal and non-project files", () => {
    const resolver = new MemoryAttachmentTokenResolver({
      makeId: () => "id",
    });
    const handle = resolver.registerProject({
      projectId: "project-1",
      projectPath: "C:\\shoots\\Editorial",
    });
    expect(() => resolver.issueAttachment({
      projectId: "project-1",
      projectHandle: handle,
      documentRevision: 1,
      groupId: "group-1",
      imageId: "image-1",
      relativeFile: "../secret.png",
      pinned: false,
    })).toThrow(/no longer available/i);
  });
});
