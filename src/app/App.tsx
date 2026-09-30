import { ThemeProvider } from "./theme/ThemeProvider";
import { createSettingsRepository } from "./settingsDependencies";
import { WorkspaceProvider } from "./workspace/WorkspaceProvider";
import {
  createWorkspaceDependencies,
  type WorkspaceDependencies,
} from "./workspace/dependencies";
import { createPlanDependencies } from "./plan/planDependencies";
import type { PlanDependencies } from "../features/plan/blocknote/dependencies";
import { AppMaterialLibrary } from "./libraryDependencies";
import type { MaterialLibraryRepository } from "../domain/library/ports";
import { ImageClipboardContext } from "../features/plan/ImageClipboardContext";
import { createPlatformImageClipboard } from "../infrastructure/clipboard/tauriImageClipboard";
import { unavailableImageClipboard } from "../domain/clipboard/imageClipboard";
import { StorageProvider } from "./storage/StorageProvider";
import { createStorageRepository } from "../infrastructure/storage/tauriStorage";

const defaultWorkspaceDependencies = createWorkspaceDependencies();
const defaultPlanDependencies = createPlanDependencies();
const settingsRepository = createSettingsRepository();
const storageRepository = createStorageRepository();
const defaultImageClipboard =
  import.meta.env.MODE === "test" ||
  import.meta.env.VITE_WORKSPACE_ADAPTER === "memory" ||
  import.meta.env.VITE_WORKSPACE_ADAPTER === "midscene"
    ? unavailableImageClipboard : createPlatformImageClipboard();

interface AppProps {
  dependencies?: WorkspaceDependencies;
  planDependencies?: PlanDependencies;
  materialLibraryRepository?: MaterialLibraryRepository;
}

export function App({
  dependencies = defaultWorkspaceDependencies,
  planDependencies = defaultPlanDependencies,
  materialLibraryRepository,
}: AppProps) {
  return (
    <StorageProvider repository={storageRepository}>
      <ThemeProvider repository={settingsRepository}>
      <ImageClipboardContext.Provider value={planDependencies.imageClipboard ?? defaultImageClipboard}>
        <AppMaterialLibrary repository={materialLibraryRepository}>
          <WorkspaceProvider
            dependencies={dependencies}
            planDependencies={planDependencies}
          />
        </AppMaterialLibrary>
      </ImageClipboardContext.Provider>
      </ThemeProvider>
    </StorageProvider>
  );
}
