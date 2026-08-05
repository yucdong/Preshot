import { useRef, useState } from "react";
import {
  closestCorners,
  pointerWithin,
  rectIntersection,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragOverEvent,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { layoutPlan } from "../../../domain/plan/canvas/engine";
import { contentSize, DEFAULT_PAGE_GEOMETRY, SPACING } from "../../../domain/plan/canvas/geometry";
import { moveComponent, moveImage, type MoveImageParams } from "../../../domain/plan/canvas/plan";
import { componentDropTarget } from "../../../domain/plan/canvas/dropTarget";
import { imageDropTarget, imageInsertAfterFromRects } from "./imageDropTarget";
import type { PlanComponent } from "../../../domain/plan/canvas/models";
import { ComponentFrame } from "./ComponentFrame";
import { PagedCanvasSurface, pageTopPx } from "./PagedCanvasSurface";
import { PlanTextComponentView } from "./PlanTextComponentView";
import { ReferenceComponentView } from "./ReferenceComponentView";
import { insertAfterFromRects } from "./canvasDropGeometry";
import { logicalComponentIdFromDnd } from "./componentDragIdentity";

export interface PlanCanvasProps {
  components: PlanComponent[];
  scale: number;
  imageSrc: (file: string) => string | undefined;
  onRemoveComponent: (id: string) => void;
  onChangeHtml: (id: string, html: string) => void;
  onSetTitle: (id: string, title: string) => void;
  onSetDescription: (id: string, description: string) => void;
  onAddImage: (id: string) => void;
  onRemoveImage: (componentId: string, imageId: string) => void;
  onOpenImage: (file: string) => void;
  onMoveComponent?: (id: string, toIndex: number) => void;
  onMoveImage?: (params: MoveImageParams) => void;
  onResize?: (id: string, params: { width: number }) => void;
  onToggleCaptions?: (id: string) => void;
  onSetImageCaption?: (componentId: string, imageId: string, caption: string) => void;
  onSetImageHeight?: (id: string, height: number) => void;
  onAddImages?: (id: string) => void;
}

// Collision detection that branches on active type
const collisionDetection: CollisionDetection = (args) => {
  const activeType = args.active.data.current?.type;
  
  if (activeType === "component") {
    // Target component frames only
    const componentHit = rectIntersection(args).find((collision) => {
      const data = args.droppableContainers.find((c) => c.id === collision.id)?.data.current;
      return data?.type === "component";
    });
    if (componentHit) {
      return [componentHit];
    }
    const pointerCollisions = pointerWithin(args);
    return pointerCollisions.length > 0 ? pointerCollisions : closestCorners(args);
  } else if (activeType === "image") {
    // Target image tiles and imagegroup droppables, NOT component frames
    const imageHit = rectIntersection(args).find((collision) => {
      const data = args.droppableContainers.find((c) => c.id === collision.id)?.data.current;
      return data?.type === "image" || data?.type === "imagegroup";
    });
    if (imageHit) {
      return [imageHit];
    }
    // Fall back to pointer and closest corners for empty groups
    const pointerCollisions = pointerWithin(args);
    return pointerCollisions.length > 0 ? pointerCollisions : closestCorners(args);
  }
  
  // Default fallback
  return rectIntersection(args);
};

export function PlanCanvas({
  components,
  scale,
  imageSrc,
  onRemoveComponent,
  onChangeHtml,
  onSetTitle,
  onSetDescription,
  onAddImage,
  onRemoveImage,
  onOpenImage,
  onMoveComponent,
  onMoveImage,
  onResize,
  onToggleCaptions,
  onSetImageCaption,
  onSetImageHeight,
  onAddImages,
}: PlanCanvasProps) {
  const [preview, setPreview] = useState<PlanComponent[] | null>(null);
  const lastParamsRef = useRef<{ id: string; toIndex: number } | null>(null);
  const lastImageParamsRef = useRef<MoveImageParams | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const view = preview ?? components;
  const layout = layoutPlan(view, DEFAULT_PAGE_GEOMETRY);

  const paramsFor = (event: DragOverEvent | DragEndEvent): { id: string; toIndex: number } | null => {
    const activeId = logicalComponentIdFromDnd(
      event.active.data.current as { componentId?: unknown } | null | undefined,
      String(event.active.id),
    );
    const overId = logicalComponentIdFromDnd(
      (event.over?.data.current as { componentId?: unknown } | null | undefined) ?? null,
      event.over ? String(event.over.id) : null,
    );
    const activeRect = event.active.rect.current.translated;
    const overRect = event.over?.rect ?? null;
    const insertAfter =
      activeRect != null && overRect != null ? insertAfterFromRects(activeRect, overRect) : false;
    if (activeId === null) {
      return null;
    }
    const toIndex = componentDropTarget(components, activeId, overId, insertAfter);
    if (toIndex === null) {
      return null;
    }
    return { id: activeId, toIndex };
  };

  const paramsForImage = (event: DragOverEvent | DragEndEvent): MoveImageParams | null => {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    const at = event.active.rect.current.translated;
    const ov = event.over?.rect ?? null;
    const insertAfter = imageInsertAfterFromRects(
      at ? { left: at.left, width: at.width } : null,
      ov ? { left: ov.left, width: ov.width } : null,
    );
    const target = imageDropTarget(components, activeId, overId, insertAfter);
    if (!target) return null;
    return { ...target, imageId: activeId };
  };

  const onDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current;
    if (data?.type === "component") {
      lastParamsRef.current = null;
      setPreview(components);
    } else if (data?.type === "image") {
      lastImageParamsRef.current = null;
      setPreview(components);
    }
  };

  const onDragOver = (event: DragOverEvent) => {
    const data = event.active.data.current;
    if (data?.type === "component") {
      const params = paramsFor(event);
      if (!params) {
        return;
      }
      const last = lastParamsRef.current;
      if (last && last.id === params.id && last.toIndex === params.toIndex) {
        return;
      }
      lastParamsRef.current = params;
      setPreview(moveComponent({ schemaVersion: 4, components }, params).components);
    } else if (data?.type === "image") {
      const params = paramsForImage(event);
      if (!params) {
        return;
      }
      const last = lastImageParamsRef.current;
      if (last && last.imageId === params.imageId && last.toComponentId === params.toComponentId && last.toIndex === params.toIndex) {
        return;
      }
      lastImageParamsRef.current = params;
      setPreview(moveImage({ schemaVersion: 4, components }, params).components);
    }
  };

  const onDragEnd = (event: DragEndEvent) => {
    const data = event.active.data.current;
    if (data?.type === "component") {
      const params = paramsFor(event) ?? lastParamsRef.current;
      setPreview(null);
      lastParamsRef.current = null;
      if (params && onMoveComponent) {
        onMoveComponent(params.id, params.toIndex);
      }
    } else if (data?.type === "image") {
      const params = paramsForImage(event) ?? lastImageParamsRef.current;
      setPreview(null);
      lastImageParamsRef.current = null;
      if (params && onMoveImage) {
        onMoveImage(params);
      }
    }
  };
  const onDragCancel = () => {
    setPreview(null);
    lastParamsRef.current = null;
    lastImageParamsRef.current = null;
  };

  const handleResize = (id: string, params: { width: number }) => {
    if (onResize) {
      onResize(id, params);
    }
  };

  // Get the component by id
  const componentMap = new Map(view.map((c) => [c.id, c]));

  const contentWidthPoints = contentSize(DEFAULT_PAGE_GEOMETRY).width;

  return (
    <DndContext
      collisionDetection={collisionDetection}
      onDragCancel={onDragCancel}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragStart={onDragStart}
      sensors={sensors}
    >
      <div className="flex justify-center" data-testid="plan-canvas">
        <PagedCanvasSurface pageCount={layout.pageCount} scale={scale}>
          {layout.placements.map((placement) => {
            const component = componentMap.get(placement.componentId);
            if (!component) {
              return null;
            }

            return (
              <ComponentFrame
                id={component.id}
                frameId={placement.fragmentId}
                key={placement.fragmentId}
                onRemove={onRemoveComponent}
                rect={placement.rect}
                scale={scale}
                topPx={pageTopPx(placement.pageIndex, scale) + (SPACING + placement.rect.y) * scale}
                contentWidthPoints={contentWidthPoints}
                component={component}
                onResize={handleResize}
              >
                {component.type === "plan" ? (
                  <PlanTextComponentView component={component} onChangeHtml={onChangeHtml} />
                ) : (
                  <ReferenceComponentView
                    component={component}
                    enableReorder={true}
                    imageSrc={imageSrc}
                    onAddImage={onAddImage}
                    onOpenImage={onOpenImage}
                    onRemoveImage={onRemoveImage}
                    onSetDescription={onSetDescription}
                    onSetTitle={onSetTitle}
                    onToggleCaptions={onToggleCaptions}
                    onSetImageCaption={onSetImageCaption}
                    onSetImageHeight={onSetImageHeight}
                    onAddImages={onAddImages}
                    slots={placement.imageSlots ?? []}
                    scale={scale}
                  />
                )}
              </ComponentFrame>
            );
          })}
        </PagedCanvasSurface>
      </div>
    </DndContext>
  );
}
