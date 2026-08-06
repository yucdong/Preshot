import { useDroppable } from "@dnd-kit/core";

interface RowDropZoneProps {
  beforeRowId: string;
  topPx: number;
}

export function RowDropZone({ beforeRowId, topPx }: RowDropZoneProps) {
  const { setNodeRef } = useDroppable({
    id: `row-gap:${beforeRowId}`,
    data: { type: "row-gap", beforeRowId },
  });

  return (
    <div
      aria-hidden="true"
      className="absolute left-0 right-0 h-6"
      data-testid={`row-drop-zone:${beforeRowId}`}
      ref={setNodeRef}
      style={{ top: `${topPx}px` }}
    />
  );
}
