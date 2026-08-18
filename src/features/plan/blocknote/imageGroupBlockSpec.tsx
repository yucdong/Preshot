import { createReactBlockSpec } from "@blocknote/react";
import { ImageGroupBlockView } from "./ImageGroupBlockView";

export const imageGroupBlockSpec = createReactBlockSpec(
  {
    type: "imageGroup",
    propSchema: {
      groupId: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block }) => (
      <ImageGroupBlockView blockId={block.id} groupId={block.props.groupId} />
    ),
    toExternalHTML: ({ block }) => (
      <figure
        data-preshot-group-id={block.props.groupId}
        data-preshot-node="image-group"
      />
    ),
    parse: (element) => {
      if (
        element.tagName !== "FIGURE" ||
        element.getAttribute("data-preshot-node") !== "image-group"
      ) {
        return undefined;
      }
      const groupId = element.getAttribute("data-preshot-group-id");
      return groupId ? { groupId } : undefined;
    },
    meta: {
      defining: true,
      isolating: true,
      selectable: true,
    },
  },
);
