import { describe, expect, it, vi } from "vitest";
import { materialNameExists } from "./materialNames";
import { MATERIAL_KINDS, type MaterialSummary } from "./models";
import type { MaterialLibraryRepository } from "./ports";

const material: MaterialSummary = {
  id: "existing", kind: "imageGroup", name: "Caf\u00e9", description: "", tags: [], favorite: false,
  revision: 1, metadataVersion: 1, createdAt: 1, updatedAt: 1, deletedAt: null,
  imageCount: 0, byteLength: 0, previewState: "pending",
};

describe("material name lookup", () => {
  it.each(MATERIAL_KINDS)("matches %s names without type or favorite filters", async (kind) => {
    const search = vi.fn<MaterialLibraryRepository["search"]>(async () => ({
      items: [{ ...material, kind }], total: 1, indexState: "ready",
    }));
    expect(await materialNameExists({ search }, "  Cafe\u0301 ")).toBe(true);
    expect(search).toHaveBeenCalledExactlyOnceWith({
      query: "", exactName: "Caf\u00e9", sort: "name", offset: 0, limit: 1,
    });
  });

  it("checks two exact matches when excluding the material being renamed", async () => {
    const search = vi.fn<MaterialLibraryRepository["search"]>(async () => ({
      items: [material, { ...material, id: "other" }], total: 2, indexState: "ready",
    }));
    expect(await materialNameExists({ search }, material.name, material.id)).toBe(true);
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ limit: 2 }));
    search.mockResolvedValue({ items: [material], total: 1, indexState: "ready" });
    expect(await materialNameExists({ search }, material.name, material.id)).toBe(false);
  });

  it("does not confuse text-search matches or deleted entries with active identical names", async () => {
    const search = vi.fn<MaterialLibraryRepository["search"]>(async () => ({
      items: [{ ...material, name: "Caf\u00e9 extra" }, { ...material, deletedAt: 2 }],
      total: 2, indexState: "ready",
    }));
    expect(await materialNameExists({ search }, material.name)).toBe(false);
  });

  it("propagates lookup failure instead of allowing an unchecked save", async () => {
    const search = vi.fn<MaterialLibraryRepository["search"]>().mockRejectedValue(new Error("Unavailable"));
    await expect(materialNameExists({ search }, material.name)).rejects.toThrow("Unavailable");
  });
});
