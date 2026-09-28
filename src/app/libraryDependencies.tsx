import type { PropsWithChildren } from "react";
import type { MaterialLibraryRepository } from "../domain/library/ports";
import { MaterialLibraryProvider } from "../features/library/MaterialLibraryProvider";
import { createPlatformMaterialLibrary } from "../infrastructure/library/tauriMaterialLibrary";
import { unavailableMaterialLibrary } from "../infrastructure/library/unavailableMaterialLibrary";
import {
  createMaterialPreview,
  MaterialComponentPreview,
} from "../infrastructure/library/materialPreview";

function createMaterialLibraryRepository(): MaterialLibraryRepository {
  if (
    import.meta.env.MODE === "test" ||
    import.meta.env.VITE_WORKSPACE_ADAPTER === "memory" ||
    import.meta.env.VITE_WORKSPACE_ADAPTER === "midscene"
  ) return unavailableMaterialLibrary;
  return createPlatformMaterialLibrary();
}

const defaultRepository = createMaterialLibraryRepository();

export function AppMaterialLibrary({
  children,
  repository = defaultRepository,
}: PropsWithChildren<{ repository?: MaterialLibraryRepository }>) {
  return (
    <MaterialLibraryProvider
      createPreview={(material) => createMaterialPreview(repository, material)}
      renderPreview={(material) => (
        <MaterialComponentPreview material={material} repository={repository} />
      )}
      repository={repository}
    >
      {children}
    </MaterialLibraryProvider>
  );
}
