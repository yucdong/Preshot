import { ui, useUiLanguage } from "../../shared/i18n/ui";
import { LibraryDialog } from "./LibraryDialog";

export function MaterialDuplicateNameDialog({
  name, creating, onCancel, onConfirm,
}: {
  name: string;
  creating: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  useUiLanguage();
  return <LibraryDialog title={ui("保存同名素材？")} className="ml-confirm-dialog" onClose={onCancel}>
    <div className="ml-confirm-body">
      <p>{ui("素材库中已存在名为“")}{name}{ui("”的素材，是否仍要保存？")}</p>
      <p>{creating ? ui("确认后将新增一份独立素材，不会覆盖已有素材。") :
        ui("确认后只更新当前素材，不会覆盖其他同名素材。")}</p>
    </div>
    <footer className="ml-footer"><p /><div className="ml-actions">
      <button type="button" data-library-autofocus="" onClick={onCancel}>{ui("取消")}</button>
      <button type="button" className="ml-primary" onClick={onConfirm}>{ui("仍然保存")}</button>
    </div></footer>
  </LibraryDialog>;
}
