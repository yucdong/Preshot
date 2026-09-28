import { describe, expect, it, vi } from "vitest";
import { MaterialContentSaveError, type MaterialDetail, type MaterialEditSession, type MaterialPayload } from "../../domain/library/models";
import type { MaterialContentEditorRepository } from "../../domain/library/ports";
import { MaterialEditLease } from "./materialEditLease";

const material: MaterialDetail = {
  id: "material", kind: "prop", name: "道具", description: "", tags: [], favorite: false,
  revision: 1, metadataVersion: 1, createdAt: 1, updatedAt: 1, deletedAt: null,
  imageCount: 0, byteLength: 0, previewState: "pending", images: [],
  payload: { format: "preshot-material", version: 1, kind: "prop", component: { kind: "prop", title: "杯子", source: "", gallery: { images: [] } } },
};
const session: MaterialEditSession = { sessionId: "draft", material };
function repository(): MaterialContentEditorRepository {
  return {
    beginCreate: vi.fn(),
    beginEdit: vi.fn(), loadEditImage: vi.fn(async () => "data:image/png;base64,YWJj"),
    importEditImages: vi.fn(async () => []), captureEditImage: vi.fn(), cropEditImage: vi.fn(),
    commitEdit: vi.fn(async () => ({ ...material, revision: 2 })),
    discardEdit: vi.fn(async () => undefined),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("material edit draft ownership", () => {
  it("does not submit an empty image material", async () => {
    const repo = repository();
    const payload: MaterialPayload = { format: "preshot-material", version: 1, kind: "image",
      component: { kind: "image", name: "图片", description: "", images: [] } };
    const lease = new MaterialEditLease(repo, { ...session, material: { ...material, kind: "image", payload } });
    await expect(lease.save(payload)).rejects.toThrow("请先添加一张图片");
    expect(repo.commitEdit).not.toHaveBeenCalled();
  });
  it("does not advertise clipboard import for old injected repositories", () => {
    const lease = new MaterialEditLease(repository(), session);
    expect(lease.repository.importEditImageData).toBeUndefined();
  });

  it("drains clipboard image imports and rejects cross-session or retired work", async () => {
    const repo = repository();
    const pending = deferred<never>();
    repo.importEditImageData = vi.fn(() => pending.promise);
    const lease = new MaterialEditLease(repo, session);
    const input = { name: "clipboard.png", mimeType: "image/png", bytes: [1] };
    await expect(lease.repository.importEditImageData!("other", input)).rejects.toThrow("其他素材");
    const importing = lease.repository.importEditImageData!("draft", input);
    const rejected = expect(importing).rejects.toThrow("write failed");
    const retiring = lease.retire();
    expect(repo.discardEdit).not.toHaveBeenCalled();
    pending.reject(new Error("write failed"));
    await rejected;
    expect(await retiring).toBe("discarded");
    expect(repo.importEditImageData).toHaveBeenCalledExactlyOnceWith("draft", input);
    await expect(lease.repository.importEditImageData!("draft", input)).rejects.toThrow("素材编辑已结束");
  });

  it("requires metadata to create, then pins the first canonical versions and UUID", async () => {
    const repo = repository();
    const draft: MaterialEditSession = {
      sessionId: "new-draft", isNew: true,
      material: { ...material, name: "", revision: 0, metadataVersion: 0 },
    };
    const metadata = { name: "新道具", description: "", tags: [], favorite: false };
    repo.commitEdit = vi.fn(async () => ({ ...material, ...metadata }));
    const lease = new MaterialEditLease(repo, draft);
    await expect(lease.save(material.payload)).rejects.toMatchObject({ outcome: "rejected" });
    expect(repo.commitEdit).not.toHaveBeenCalled();
    expect(await lease.save(material.payload, metadata)).toMatchObject({ id: material.id, revision: 1, metadataVersion: 1 });
    expect(repo.commitEdit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      sessionId: "new-draft", metadataUpdate: { expectedVersion: 0, metadata },
    }));
  });

  it("keeps the single-component canvas unable to begin another creation draft", async () => {
    const repo = repository();
    const lease = new MaterialEditLease(repo, session);
    await expect(lease.repository.beginCreate(material.payload)).rejects.toThrow("不能创建其他素材");
    expect(repo.beginCreate).not.toHaveBeenCalled();
  });

  it("freezes metadata with content and the pinned metadata version for an exact retry", async () => {
    const repo = repository();
    const metadata = { name: "新的素材名", description: "说明", tags: ["窗光"], favorite: true };
    repo.commitEdit = vi.fn().mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValue({ ...material, ...structuredClone(metadata), revision: 2, metadataVersion: 2 });
    const lease = new MaterialEditLease(repo, session);
    await expect(lease.save(material.payload, metadata)).rejects.toThrow("connection lost");
    metadata.name = "不能混入重试";
    metadata.tags.push("不能混入重试");
    await lease.retrySave();
    const calls = vi.mocked(repo.commitEdit).mock.calls;
    expect(calls[0][0]).toEqual(calls[1][0]);
    expect(calls[0][0].metadataUpdate).toEqual({
      expectedVersion: 1, metadata: { name: "新的素材名", description: "说明", tags: ["窗光"], favorite: true },
    });
  });

  it("rejects invalid metadata before freezing or submitting any content", async () => {
    const repo = repository();
    const lease = new MaterialEditLease(repo, session);
    await expect(lease.save(material.payload, { name: "", description: "", tags: [], favorite: false })).rejects.toThrow();
    expect(repo.commitEdit).not.toHaveBeenCalled();
    expect(lease.isUncertain).toBe(false);
  });

  it("does not accept a content-only receipt for a combined save", async () => {
    const repo = repository();
    const lease = new MaterialEditLease(repo, session);
    await expect(lease.save(material.payload, {
      name: "新的素材名", description: "", tags: [], favorite: false,
    })).rejects.toThrow("回执");
    expect(lease.isUncertain).toBe(true);
  });

  it("does not open a native overlay when its owner retires before capture starts", async () => {
    const repo = repository();
    repo.captureEditImage = vi.fn(async () => null);
    const lease = new MaterialEditLease(repo, session);
    const capture = lease.repository.captureEditImage("draft", new Promise(() => undefined));
    const retiring = lease.retire();
    expect(await capture).toBeNull();
    expect(await retiring).toBe("discarded");
    expect(repo.captureEditImage).not.toHaveBeenCalled();
  });

  it("cancels and drains a capture before retiring its owned staging", async () => {
    const repo = repository();
    const finished = deferred<null>();
    let cancelled = false;
    repo.captureEditImage = vi.fn(async (_id, cancellation) => {
      await cancellation;
      cancelled = true;
      return finished.promise;
    });
    const lease = new MaterialEditLease(repo, session);
    const capture = lease.repository.captureEditImage("draft", new Promise(() => undefined));
    await vi.waitFor(() => expect(repo.captureEditImage).toHaveBeenCalledOnce());
    const retiring = lease.retire();
    await vi.waitFor(() => expect(cancelled).toBe(true));
    expect(repo.discardEdit).not.toHaveBeenCalled();
    finished.resolve(null);
    expect(await capture).toBeNull();
    expect(await retiring).toBe("discarded");
    await expect(lease.repository.captureEditImage("draft", Promise.resolve())).rejects.toThrow("素材编辑已结束");
  });

  it("discards a cancelled draft once without writing canonical content", async () => {
    const repo = repository();
    const lease = new MaterialEditLease(repo, session);
    expect(await lease.retire()).toBe("discarded");
    expect(await lease.retire()).toBe("discarded");
    expect(repo.discardEdit).toHaveBeenCalledExactlyOnceWith("draft");
    expect(repo.commitEdit).not.toHaveBeenCalled();
    await expect(lease.repository.importEditImages("draft")).rejects.toThrow();
  });

  it("waits for an active import before retiring its owned files", async () => {
    const repo = repository();
    const pending = deferred<[]>();
    repo.importEditImages = vi.fn(() => pending.promise);
    const lease = new MaterialEditLease(repo, session);
    const importing = lease.repository.importEditImages("draft");
    const retiring = lease.retire();
    expect(repo.discardEdit).not.toHaveBeenCalled();
    pending.resolve([]);
    await importing;
    expect(await retiring).toBe("discarded");
    expect(repo.discardEdit).toHaveBeenCalledOnce();
  });

  it("retries the exact frozen receipt after an ambiguous response and never saves twice", async () => {
    const repo = repository();
    repo.commitEdit = vi.fn().mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValue({ ...material, revision: 2 });
    const lease = new MaterialEditLease(repo, session);
    const payload = structuredClone(material.payload);
    await expect(lease.save(payload)).rejects.toThrow("connection lost");
    expect(lease.isUncertain).toBe(true);
    payload.component = { kind: "prop", title: "不应提交", source: "", gallery: { images: [] } };
    expect((await lease.retrySave()).revision).toBe(2);
    expect(repo.commitEdit).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(repo.commitEdit).mock.calls;
    expect(calls[0][0]).toEqual(calls[1][0]);
    expect(calls[0][0].payload).toEqual(material.payload);
    expect(lease.isUncertain).toBe(false);
    await lease.save(material.payload);
    expect(repo.commitEdit).toHaveBeenCalledTimes(2);
  });

  it("keeps uncertain native work recoverable after the owner disappears", async () => {
    const repo = repository();
    const pending = deferred<MaterialDetail>();
    repo.commitEdit = vi.fn(() => pending.promise);
    const lease = new MaterialEditLease(repo, session);
    const saving = lease.save(material.payload);
    const rejected = expect(saving).rejects.toThrow("unknown");
    const retiring = lease.retire();
    pending.reject(new Error("unknown"));
    await rejected;
    expect(await retiring).toBe("retained");
    expect(repo.discardEdit).not.toHaveBeenCalled();
  });

  it("allows editing and cancellation after a definite conflict rather than guessing an overwrite", async () => {
    const repo = repository();
    repo.commitEdit = vi.fn().mockRejectedValue(new MaterialContentSaveError("素材已变化", "rejected"));
    const lease = new MaterialEditLease(repo, session);
    await expect(lease.save(material.payload)).rejects.toThrow("素材已变化");
    expect(lease.isUncertain).toBe(false);
    expect(await lease.retire()).toBe("discarded");
  });

  it("waits for a successful save before cleaning the session without undoing saved content", async () => {
    const repo = repository();
    const pending = deferred<MaterialDetail>();
    repo.commitEdit = vi.fn(() => pending.promise);
    const lease = new MaterialEditLease(repo, session);
    const saving = lease.save(material.payload);
    const retiring = lease.retire();
    expect(repo.discardEdit).not.toHaveBeenCalled();
    pending.resolve({ ...material, revision: 2 });
    await saving;
    expect(await retiring).toBe("discarded");
    expect(lease.savedMaterial?.revision).toBe(2);
  });

  it("retries cleanup failures without re-saving the material", async () => {
    const repo = repository();
    repo.discardEdit = vi.fn().mockRejectedValueOnce(new Error("locked")).mockResolvedValue(undefined);
    const lease = new MaterialEditLease(repo, session);
    await lease.save(material.payload);
    await expect(lease.retire()).rejects.toThrow("locked");
    expect(await lease.retire()).toBe("discarded");
    expect(repo.commitEdit).toHaveBeenCalledOnce();
  });
});
