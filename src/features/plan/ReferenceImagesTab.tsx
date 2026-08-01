import { useRef, useState } from "react";
import {
  closestCorners,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragOverEvent,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { MAX_COLUMNS, MIN_COLUMNS, type MoveImageParams, type ProjectPlan, type ReferenceGroup } from "../../domain/plan/models";
import { GroupImageGrid } from "./GroupImageGrid";
import { dropTargetFromEvent } from "./dropTarget";
import { moveImage } from "../../domain/plan/plan";
import { RichTextEditor } from "./RichTextEditor";

function GroupTitleInput({ title, onRename }: { title: string; onRename(value: string): void }) {
  const [value, setValue] = useState(title);

  return (
    <input
      aria-label="Group title"
      className="flex-1 rounded-lg border border-black/10 px-3 py-2 text-lg font-medium text-stone-900"
      onBlur={() => {
        if (value !== title) {
          onRename(value);
        }
      }}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      value={value}
    />
  );
}

export interface ReferenceImagesTabProps {
  groups: ReferenceGroup[];
  imageSrc(file: string): string | undefined;
  onAddGroup(): void;
  onRenameGroup(groupId: string, title: string): void;
  onSetDescription(groupId: string, description: string): void;
  onDeleteGroup(groupId: string): void;
  onSetColumns(groupId: string, columns: number): void;
  onAddImage(groupId: string): void;
  onRemoveImage(groupId: string, imageId: string): void;
  onOpenImage(file: string): void;
  onMoveImage(params: MoveImageParams): void;
}

const columnOptions = Array.from(
  { length: MAX_COLUMNS - MIN_COLUMNS + 1 },
  (_unused, index) => MIN_COLUMNS + index,
);

export function ReferenceImagesTab({
  groups,
  imageSrc,
  onAddGroup,
  onRenameGroup,
  onSetDescription,
  onDeleteGroup,
  onSetColumns,
  onAddImage,
  onRemoveImage,
  onOpenImage,
  onMoveImage,
}: ReferenceImagesTabProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ReferenceGroup[] | null>(null);
  const lastParamsRef = useRef<MoveImageParams | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const view = preview ?? groups;
  const activeImage = activeId
    ? groups.flatMap((group) => group.images).find((image) => image.id === activeId)
    : undefined;

  const planOf = (source: ReferenceGroup[]): ProjectPlan => ({ photographyPlan: "", referenceGroups: source });

  const paramsFor = (event: DragOverEvent | DragEndEvent): MoveImageParams | null => {
    const id = String(event.active.id);
    const from = groups.find((group) => group.images.some((image) => image.id === id));
    const target = dropTargetFromEvent(groups, event);
    if (!from || !target) {
      return null;
    }
    return { fromGroupId: from.id, imageId: id, toGroupId: target.toGroupId, toIndex: target.toIndex };
  };

  const onDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
    lastParamsRef.current = null;
    setPreview(groups);
  };
  const onDragOver = (event: DragOverEvent) => {
    const params = paramsFor(event);
    // No valid new target (over nothing, or over the dragged tile's own previewed
    // slot): keep the current preview. Reverting here would snap the tile back and,
    // over an empty group, cause an infinite measuring flip.
    if (!params) {
      return;
    }
    const last = lastParamsRef.current;
    // Unchanged target: do not setState, or dnd-kit's measuring re-fires onDragOver
    // on the resulting layout change and loops.
    if (last && last.toGroupId === params.toGroupId && last.toIndex === params.toIndex) {
      return;
    }
    lastParamsRef.current = params;
    setPreview(moveImage(planOf(groups), params).referenceGroups);
  };
  const onDragEnd = (event: DragEndEvent) => {
    // Prefer the release-moment geometry: only at release is the dragged tile's
    // translated center guaranteed to be past the target tile's center, so the
    // insert-before/after decision (and thus within-group reordering) is correct.
    // But when the pointer is released over the dragged tile's own previewed slot
    // (over === activeId, e.g. dropping into an empty/other group where the preview
    // already relocated the tile), the recompute is null — fall back to the last
    // previewed target so the WYSIWYG move still commits.
    const params = paramsFor(event) ?? lastParamsRef.current;
    setActiveId(null);
    setPreview(null);
    lastParamsRef.current = null;
    if (params) {
      onMoveImage(params);
    }
  };
  const onDragCancel = () => {
    setActiveId(null);
    setPreview(null);
    lastParamsRef.current = null;
  };

  return (
    <div className="space-y-8 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.24em] text-amber-700">
            Reference Images
          </p>
          <h3 className="mt-1 text-xl font-semibold text-stone-900">Sample sets</h3>
        </div>
        <button
          className="rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700"
          onClick={onAddGroup}
          type="button"
        >
          Add reference group
        </button>
      </div>

      <DndContext
        collisionDetection={closestCorners}
        onDragCancel={onDragCancel}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDragStart={onDragStart}
        sensors={sensors}
      >
        {view.map((group) => (
        <section
          aria-label={`Reference group: ${group.title || "Untitled"}`}
          className="rounded-2xl border border-black/10 bg-white p-5"
          key={group.id}
          role="group"
        >
          <div className="flex flex-wrap items-center gap-3">
            <GroupTitleInput
              key={group.title}
              title={group.title}
              onRename={(value) => onRenameGroup(group.id, value)}
            />
            <label className="flex items-center gap-2 text-sm text-stone-600">
              Images per row
              <select
                aria-label="Images per row"
                className="rounded-lg border border-black/10 px-2 py-1"
                onChange={(event) => onSetColumns(group.id, Number(event.target.value))}
                value={group.columnsPerRow}
              >
                {columnOptions.map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </label>
            <button
              aria-label="Delete group"
              className="rounded-lg border border-black/10 px-3 py-2 text-sm text-stone-600 hover:bg-stone-100"
              onClick={() => onDeleteGroup(group.id)}
              type="button"
            >
              Delete group
            </button>
          </div>

          <div className="mt-3">
            <RichTextEditor
              compact
              key={`description-${group.id}`}
              ariaLabel="Group description"
              html={group.description}
              onChange={(value) => onSetDescription(group.id, value)}
              placeholder="Describe this set of references — mood, lighting, styling, or notes…"
            />
          </div>

          <GroupImageGrid
            group={group}
            imageSrc={imageSrc}
            onAddImage={onAddImage}
            onOpenImage={onOpenImage}
            onRemoveImage={onRemoveImage}
          />
        </section>
        ))}
        <DragOverlay>
          {activeImage ? (
            <div className="aspect-square w-40 overflow-hidden rounded-xl border border-black/10 bg-stone-200">
              {imageSrc(activeImage.file) ? (
                <img alt="" className="h-full w-full object-cover" src={imageSrc(activeImage.file)} />
              ) : null}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
