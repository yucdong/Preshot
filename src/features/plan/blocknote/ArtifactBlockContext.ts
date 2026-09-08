import { createContext, useContext } from "react";
import type {
  ArtifactKind,
  ArtifactRecord,
} from "../../../domain/plan/canvas/blockDocument";

export interface ArtifactBlockReader {
  getArtifact(artifactId: string): ArtifactRecord | undefined;
  subscribe(listener: () => void): () => void;
}

export interface ArtifactBlockController extends ArtifactBlockReader {
  /** Omitted in the normal editor; false hides all document-structure actions. */
  structureEditable?: boolean;
  createArtifact(kind: ArtifactKind): string;
  discardPendingArtifact?(artifactId: string): void;
  cloneArtifact(artifactId: string): string | null;
  updateArtifact(
    artifactId: string,
    update: (artifact: ArtifactRecord) => ArtifactRecord,
  ): void;
  duplicateArtifactBlock?(blockId: string): void;
  removeArtifactBlock?(blockId: string): void;
  saveArtifactBlock?(blockId: string): void;
}

export const ArtifactBlockContext =
  createContext<ArtifactBlockReader | null>(null);

export function useArtifactBlockReader(): ArtifactBlockReader {
  const controller = useContext(ArtifactBlockContext);
  if (!controller) {
    throw new Error("Artifact block controller is unavailable");
  }
  return controller;
}

export function useOptionalArtifactBlockController():
  | ArtifactBlockController
  | null {
  return useContext(ArtifactBlockContext) as ArtifactBlockController | null;
}
