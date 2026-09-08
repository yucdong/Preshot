import { validateMaterialMetadata, type MaterialMetadata } from "../../domain/library";

export interface MaterialMetadataDraft {
  name: string;
  description: string;
  tags: string;
  favorite: boolean;
}

export function createMetadataDraft(metadata: MaterialMetadata): MaterialMetadataDraft {
  return { name: metadata.name, description: metadata.description, tags: metadata.tags.join("，"), favorite: metadata.favorite };
}

export function readMetadataDraft(draft: MaterialMetadataDraft): MaterialMetadata {
  return validateMaterialMetadata({
    ...draft, tags: draft.tags.split(/[,，\n]/u).map((tag) => tag.trim()).filter(Boolean),
  });
}
