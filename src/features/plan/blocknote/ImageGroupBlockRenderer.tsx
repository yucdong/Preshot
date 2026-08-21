import { ImageGroupBlockView } from "./ImageGroupBlockView";
import { ExportImageGroupBlockView } from "./export/ExportImageGroupBlockView";
import { useOptionalImageGroupExportController } from "./export/ImageGroupExportContext";

export function ImageGroupBlockRenderer({
  blockId,
  groupId,
}: {
  blockId: string;
  groupId: string;
}) {
  const exportController = useOptionalImageGroupExportController();
  return exportController ? (
    <ExportImageGroupBlockView
      blockId={blockId}
      controller={exportController}
      groupId={groupId}
    />
  ) : (
    <ImageGroupBlockView blockId={blockId} groupId={groupId} />
  );
}
