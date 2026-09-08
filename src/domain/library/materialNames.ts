import type { MaterialLibraryRepository } from "./ports";

export async function materialNameExists(
  repository: Pick<MaterialLibraryRepository, "search">, name: string, excludeId?: string,
): Promise<boolean> {
  const normalizedName = name.normalize("NFC").trim();
  const result = await repository.search({
    query: "", exactName: normalizedName, sort: "name", offset: 0, limit: excludeId ? 2 : 1,
  });
  return result.items.some((item) => item.id !== excludeId && item.deletedAt === null &&
    item.name.normalize("NFC").trim() === normalizedName);
}
