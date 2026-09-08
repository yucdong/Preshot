import { LibraryDialog } from "./LibraryDialog";

export function MaterialDuplicateNameDialog({
  name, creating, onCancel, onConfirm,
}: {
  name: string;
  creating: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  return <LibraryDialog title="保存同名素材？" className="ml-confirm-dialog" onClose={onCancel}>
    <div className="ml-confirm-body">
      <p>素材库中已存在名为“{name}”的素材，是否仍要保存？</p>
      <p>{creating ? "确认后将新增一份独立素材，不会覆盖已有素材。" :
        "确认后只更新当前素材，不会覆盖其他同名素材。"}</p>
    </div>
    <footer className="ml-footer"><p /><div className="ml-actions">
      <button type="button" data-library-autofocus="" onClick={onCancel}>取消</button>
      <button type="button" className="ml-primary" onClick={onConfirm}>仍然保存</button>
    </div></footer>
  </LibraryDialog>;
}
