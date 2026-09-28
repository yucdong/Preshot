import { ui, useUiLanguage } from "../../../shared/i18n/ui";
import {
  FormattingToolbar,
  getFormattingToolbarItems,
  useBlockNoteEditor,
  useComponentsContext,
  useSelectedBlocks,
  type FormattingToolbarProps,
} from "@blocknote/react";
import { Library } from "lucide-react";
import { useContext } from "react";
import { ImageGroupBlockContext } from "./ImageGroupBlockContext";
import type {
  PreshotBlockSchema, PreshotInlineContentSchema, PreshotStyleSchema,
} from "./preshotBlockNoteSchema";

export function PreshotFormattingToolbar(props: FormattingToolbarProps) {
  useUiLanguage();
  const editor = useBlockNoteEditor<PreshotBlockSchema, PreshotInlineContentSchema, PreshotStyleSchema>();
  const selected = useSelectedBlocks(editor);
  const controller = useContext(ImageGroupBlockContext);
  const Components = useComponentsContext();
  const block = selected.length === 1 ? selected[0] : undefined;
  const canSave = editor.isEditable && block?.type === "image" && block.props.url && controller?.saveBlock;

  return <FormattingToolbar {...props}>
    {canSave && Components ? (
      <Components.FormattingToolbar.Button
        className="bn-button"
        label={ui("添加到素材库")}
        mainTooltip={ui("将选中的图片添加到素材库")}
        onClick={() => controller.saveBlock?.(block.id)}
      >
        <Library aria-hidden size={15} />
        <span className="ml-1">{ui("添加到素材库")}</span>
      </Components.FormattingToolbar.Button>
    ) : null}
    {getFormattingToolbarItems(props.blockTypeSelectItems)}
  </FormattingToolbar>;
}
