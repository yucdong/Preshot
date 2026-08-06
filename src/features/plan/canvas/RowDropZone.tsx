import { useDroppable } from "@dnd-kit/core";

interface RowDropZoneProps {
  toRowIndex: number;
  topPx: number;
  heightPx: number;
}

export function RowDropZone({ toRowIndex, topPx, heightPx }: RowDropZoneProps) {
  const { setNodeRef } = useDroppable({
    id: `row-gap:${toRowIndex}`,
    data: { type: "row-gap", toRowIndex },
  });

  return (
    <div
      aria-hidden="true"
      className="absolute left-0 right-0"
      data-testid={`row-drop-zone:${toRowIndex}`}
      ref={setNodeRef}
      style={{ top: `${topPx}px`, height: `${heightPx}px` }}
    />
  );
}
