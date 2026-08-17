import {
  BlockNoteSchema,
  defaultBlockSpecs,
} from "@blocknote/core";
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
    render: ({ block }) => <ImageGroupBlockView groupId={block.props.groupId} />,
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

export const preshotBlockNoteSchema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    heading: defaultBlockSpecs.heading,
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    checkListItem: defaultBlockSpecs.checkListItem,
    toggleListItem: defaultBlockSpecs.toggleListItem,
    quote: defaultBlockSpecs.quote,
    codeBlock: defaultBlockSpecs.codeBlock,
    table: defaultBlockSpecs.table,
    divider: defaultBlockSpecs.divider,
    imageGroup: imageGroupBlockSpec(),
  },
});

export type PreshotBlockNoteSchema = typeof preshotBlockNoteSchema;
