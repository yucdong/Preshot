import { createContext, useContext, useLayoutEffect } from "react";

type PrepareCommit = () => () => void;

export class ArtifactDraftValidationError extends Error {}

export interface ArtifactDraftRegistry {
  register(prepare: PrepareCommit, reset?: () => void): () => void;
  flush(): void;
  reset(): void;
}

export function createArtifactDraftRegistry(): ArtifactDraftRegistry {
  const fields = new Map<PrepareCommit, (() => void) | undefined>();
  return {
    register(prepare, reset) {
      fields.set(prepare, reset);
      return () => { fields.delete(prepare); };
    },
    flush() {
      // Validate all fields before committing any of them. A stale valid
      // sidecar must never be saved while an invalid field remains visible.
      const commits = [...fields.keys()].map((prepare) => prepare());
      commits.forEach((commit) => commit());
    },
    reset() {
      fields.forEach((reset) => reset?.());
    },
  };
}

export const ArtifactDraftContext = createContext<ArtifactDraftRegistry | null>(null);

export function useArtifactDraftCommit(prepare: PrepareCommit, reset?: () => void): void {
  const registry = useContext(ArtifactDraftContext);
  useLayoutEffect(() => registry?.register(prepare, reset), [registry, prepare, reset]);
}
