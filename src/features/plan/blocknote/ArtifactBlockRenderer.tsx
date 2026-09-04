import { ArtifactBlockView } from "./ArtifactBlockView";

export function ArtifactBlockRenderer({
  artifactId,
  blockId,
  kind,
}: {
  artifactId: string;
  blockId: string;
  kind: "shootingLocation" | "modelCard" | "clothing" | "prop";
}) {
  return (
    <ArtifactBlockView
      artifactId={artifactId}
      blockId={blockId}
      expectedKind={kind}
    />
  );
}
