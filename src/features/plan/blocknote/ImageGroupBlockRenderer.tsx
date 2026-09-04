import { ImageGroupBlockView } from "./ImageGroupBlockView";
import { ExportImageGroupBlockView } from "./export/ExportImageGroupBlockView";
import { useOptionalImageGroupExportController } from "./export/ImageGroupExportContext";

export function ImageGroupBlockRenderer({
  blockId,
  autoCompact = false,
  groupId,
  label,
  variant = "block",
}: {
  blockId: string;
  autoCompact?: boolean;
  groupId: string;
  label?: string;
  variant?: "block" | "embedded";
}) {
  const exportController = useOptionalImageGroupExportController();
  return exportController ? (
    <ExportImageGroupBlockView
      blockId={blockId}
      autoCompact={autoCompact}
      controller={exportController}
      groupId={groupId}
      variant={variant}
    />
  ) : (
    <ImageGroupBlockView
      blockId={blockId}
      autoCompact={autoCompact}
      groupId={groupId}
      label={label}
      variant={variant}
    />
  );
}
