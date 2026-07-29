import { useState } from "react";
import { MAX_COLUMNS, MIN_COLUMNS, type ReferenceGroup } from "../../domain/plan/models";

function GroupTitleInput({ title, onRename }: { title: string; onRename(value: string): void }) {
  const [value, setValue] = useState(title);

  return (
    <input
      aria-label="Group title"
      className="flex-1 rounded-lg border border-black/10 px-3 py-2 text-lg font-medium"
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
  onDeleteGroup(groupId: string): void;
  onSetColumns(groupId: string, columns: number): void;
  onAddImage(groupId: string): void;
  onRemoveImage(groupId: string, imageId: string): void;
  onOpenImage(file: string): void;
}

const columnOptions = Array.from(
  { length: MAX_COLUMNS - MIN_COLUMNS + 1 },
  (_unused, index) => MIN_COLUMNS + index,
);

const squareButton =
  "group relative block aspect-square w-full overflow-hidden rounded-xl border border-black/10 bg-stone-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500";

export function ReferenceImagesTab({
  groups,
  imageSrc,
  onAddGroup,
  onRenameGroup,
  onDeleteGroup,
  onSetColumns,
  onAddImage,
  onRemoveImage,
  onOpenImage,
}: ReferenceImagesTabProps) {
  return (
    <div className="space-y-8 p-6">
      <div className="flex justify-end">
        <button
          className="rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700"
          onClick={onAddGroup}
          type="button"
        >
          Add reference group
        </button>
      </div>

      {groups.map((group) => (
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

          <div
            className="mt-4 grid gap-3"
            style={{ gridTemplateColumns: `repeat(${group.columnsPerRow}, minmax(0, 1fr))` }}
          >
            {group.images.map((image, index) => {
              const src = imageSrc(image.file);
              return (
                <div className="relative" key={image.id}>
                  <button
                    aria-label={`Open reference image ${index + 1}`}
                    className={squareButton}
                    onClick={() => onOpenImage(image.file)}
                    type="button"
                  >
                    {src ? (
                      <img
                        alt={`Reference image ${index + 1}`}
                        className="h-full w-full object-cover"
                        src={src}
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-xs text-stone-400">
                        Loading…
                      </span>
                    )}
                  </button>
                  <button
                    aria-label={`Remove reference image ${index + 1}`}
                    className="absolute right-1 top-1 rounded-full bg-black/60 px-2 text-xs text-white"
                    onClick={() => onRemoveImage(group.id, image.id)}
                    type="button"
                  >
                    ×
                  </button>
                </div>
              );
            })}

            <button
              aria-label="Add reference image"
              className="flex aspect-square w-full items-center justify-center rounded-xl border-2 border-dashed border-stone-300 text-3xl text-stone-400 hover:border-amber-500 hover:text-amber-600"
              onClick={() => onAddImage(group.id)}
              type="button"
            >
              +
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}
