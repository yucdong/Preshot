import { ui } from "../../shared/i18n/ui";
import { useEffect, useRef } from "react";
import type { MaterialKind } from "../../domain/library/models";

export const materialKindLabels: Record<MaterialKind, string> = {
  get image() { return ui("图片"); }, get imageGroup() { return ui("图片组"); }, get shootingLocation() { return ui("场地"); }, get modelCard() { return ui("模特"); }, get prop() { return ui("道具与服装"); }, get clothing() { return ui("道具与服装"); },
};
export const materialArtifactLabels = { get prop() { return ui("道具与服装"); }, get clothing() { return ui("道具与服装"); } } as const;
export const unavailableMessage = "素材库仅在本机桌面版可用。请使用 Preshot 桌面版打开项目；当前文档仍可继续编辑。";

export function formatMaterialBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function libraryError(error: unknown, context: string): string {
  return ui("{{v0}}：{{v1}} 请重试；若持续失败，请检查素材库或从备份恢复。", { v0: context, v1: error instanceof Error ? error.message : ui("操作未完成，请重试。") });
}

export function metadataValidationError(error: unknown): { field: "name" | "tags" | "description"; message: string } {
  const message = error instanceof Error ? error.message : "";
  if (/tag/iu.test(message)) return { field: "tags", message: ui("标签最多 12 个，每个为 1–24 字，不能包含控制字符。") };
  if (/description/iu.test(message)) return { field: "description", message: ui("素材说明最多 1000 字，不能包含无效控制字符。") };
  return { field: "name", message: ui("请填写素材名称：1–80 字，不能包含控制字符。") };
}

export function useLibraryLifetime() {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  return alive;
}
