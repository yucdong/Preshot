import {
  type ComponentPropsWithoutRef,
  forwardRef,
  type ReactNode,
} from "react";
import {
  IMAGE_DRAG_TOKENS,
} from "../imageDragMotion";

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

interface ImageDragVisualProps
  extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
  height: number;
  width: number;
}

export function ImageDragSourcePlaceholder({
  className,
  height,
  style,
  width,
  ...props
}: ImageDragVisualProps) {
  return (
    <div
      {...props}
      aria-hidden="true"
      className={classes("preshot-image-drag-source-placeholder", className)}
      data-image-drag-source-placeholder="true"
      style={{ height, width, ...style }}
    />
  );
}

export function ImageDragTargetInsertion({
  className,
  height,
  style,
  width,
  ...props
}: ImageDragVisualProps) {
  return (
    <div
      {...props}
      aria-hidden="true"
      className={classes("preshot-image-drag-target-insertion", className)}
      data-image-drag-target-insertion="true"
      style={{ height, width, ...style }}
    />
  );
}

export const ImageDragTargetGroup = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<"div"> & {
    active: boolean;
    children?: ReactNode;
  }
>(function ImageDragTargetGroup({
  active,
  children,
  className,
  style,
  ...props
}, ref) {
  return (
    <div
      {...props}
      className={classes(
        "preshot-image-drag-target-group",
        active && "preshot-image-drag-target-group-active",
        className,
      )}
      data-image-drag-target={active ? "true" : "false"}
      ref={ref}
      style={
        active
          ? {
              backgroundColor: IMAGE_DRAG_TOKENS.targetBackgroundColor,
              borderColor: IMAGE_DRAG_TOKENS.targetBorderColor,
              boxShadow: IMAGE_DRAG_TOKENS.targetRing,
              ...style,
            }
          : style
      }
    >
      {children}
    </div>
  );
});

export function EmptyImageGroupDropSlot({
  active = false,
  className,
  style,
  ...props
}: ComponentPropsWithoutRef<"div"> & { active?: boolean }) {
  return (
    <div
      {...props}
      aria-hidden="true"
      className={classes(
        "preshot-image-drag-empty-slot",
        active && "preshot-image-drag-empty-slot-active",
        className,
      )}
      data-image-drag-empty-slot={active ? "active" : "idle"}
      style={style}
    />
  );
}
