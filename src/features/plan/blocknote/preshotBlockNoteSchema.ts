import {
  BlockNoteSchema,
  defaultBlockSpecs,
  withPageBreak,
} from "@blocknote/core";
import { withMultiColumn } from "@blocknote/xl-multi-column";
import { imageGroupBlockSpec } from "./imageGroupBlockSpec";

const preshotBaseBlockNoteSchema = BlockNoteSchema.create({
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
    file: defaultBlockSpecs.file,
    image: defaultBlockSpecs.image,
    video: defaultBlockSpecs.video,
    audio: defaultBlockSpecs.audio,
    imageGroup: imageGroupBlockSpec(),
  },
});

export const preshotBlockNoteSchema = withMultiColumn(
  withPageBreak(preshotBaseBlockNoteSchema),
);

export type PreshotBlockNoteSchema = typeof preshotBlockNoteSchema;
export type PreshotBlockNoteEditor =
  typeof preshotBlockNoteSchema.BlockNoteEditor;
export type PreshotEditorBlock = typeof preshotBlockNoteSchema.Block;
export type PreshotEditorPartialBlock =
  typeof preshotBlockNoteSchema.PartialBlock;
export type PreshotBlockSchema =
  typeof preshotBlockNoteSchema.blockSchema;
export type PreshotInlineContentSchema =
  typeof preshotBlockNoteSchema.inlineContentSchema;
export type PreshotStyleSchema =
  typeof preshotBlockNoteSchema.styleSchema;
