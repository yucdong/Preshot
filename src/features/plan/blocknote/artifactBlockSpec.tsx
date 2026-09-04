import { createReactBlockSpec } from "@blocknote/react";
import { ArtifactBlockRenderer } from "./ArtifactBlockRenderer";

const implementation = (
  kind: "shootingLocation" | "modelCard" | "clothing" | "prop",
) => ({
  render: ({ block }: { block: { id: string; props: { artifactId: string } } }) => (
    <ArtifactBlockRenderer
      artifactId={block.props.artifactId}
      blockId={block.id}
      kind={kind}
    />
  ),
  toExternalHTML: (
    { block }: { block: { props: { artifactId: string } } },
  ) => (
    <section
      data-preshot-artifact-id={block.props.artifactId}
      data-preshot-node={kind}
    />
  ),
  parse: (element: HTMLElement) => {
    if (
      element.tagName !== "SECTION" ||
      element.getAttribute("data-preshot-node") !== kind
    ) {
      return undefined;
    }
    const artifactId = element.getAttribute("data-preshot-artifact-id");
    return artifactId ? { artifactId } : undefined;
  },
  meta: {
    defining: true,
    isolating: true,
    selectable: true,
  },
});

export const shootingLocationBlockSpec = createReactBlockSpec(
  {
    type: "shootingLocation",
    propSchema: { artifactId: { default: "" } },
    content: "none",
  },
  implementation("shootingLocation"),
);

export const modelCardBlockSpec = createReactBlockSpec(
  {
    type: "modelCard",
    propSchema: { artifactId: { default: "" } },
    content: "none",
  },
  implementation("modelCard"),
);

export const clothingBlockSpec = createReactBlockSpec(
  {
    type: "clothing",
    propSchema: { artifactId: { default: "" } },
    content: "none",
  },
  implementation("clothing"),
);

export const propBlockSpec = createReactBlockSpec(
  {
    type: "prop",
    propSchema: { artifactId: { default: "" } },
    content: "none",
  },
  implementation("prop"),
);
