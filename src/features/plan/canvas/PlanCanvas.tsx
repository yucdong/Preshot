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
import { contentSize, DEFAULT_PAGE_GEOMETRY } from "../../../domain/plan/canvas/geometry";
import { moveComponent, moveImage, type MoveImageParams } from "../../../domain/plan/canvas/plan";
import { componentDropTarget } from "../../../domain/plan/canvas/dropTarget";
import { imageDropTarget, imageInsertAfterFromRects } from "./imageDropTarget";
import type { PlanComponent } from "../../../domain/plan/canvas/models";
import { CanvasPage } from "./CanvasPage";
import { ComponentFrame } from "./ComponentFrame";
import { PlanTextComponentView } from "./PlanTextComponentView";
import { ReferenceComponentView } from "./ReferenceComponentView";
import { insertAfterFromRects } from "./canvasDropGeometry";

export interface PlanCanvasProps {
  components: PlanComponent[];
  scale: number;
  imageSrc: (file: string) => string | undefined;
  onRemoveComponent: (id: string) => void;
  onChangeHtml: (id: string, html: string) => void;
  onSetTitle: (id: string, title: string) => void;
  onSetDescription: (id: string, description: string) => void;
  onSetColumns: (id: string, columns: number) => void;
  onAddImage: (id: string) => void;
  onRemoveImage: (componentId: string, imageId: string) => void;
  onOpenImage: (file: string) => void;
  onMoveComponent?: (id: string, toIndex: number) => void;
  onMoveImage?: (params: MoveImageParams) => void;
  onResize?: (id: string, params: { width?: number; height?: number }) => void;
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
  onSetColumns,
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
  const [_activeId, setActiveId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PlanComponent[] | null>(null);
  const lastParamsRef = useRef<{ id: string; toIndex: number } | null>(null);
  const lastImageParamsRef = useRef<MoveImageParams | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const view = preview ?? components;

  const paramsFor = (event: DragOverEvent | DragEndEvent): { id: string; toIndex: number } | null => {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    const activeRect = event.active.rect.current.translated;
    const overRect = event.over?.rect ?? null;
    const insertAfter =
      activeRect != null && overRect != null ? insertAfterFromRects(activeRect, overRect) : false;
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
      setActiveId(String(event.active.id));
      lastParamsRef.current = null;
      setPreview(components);
    } else if (data?.type === "image") {
      setActiveId(String(event.active.id));
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
      setPreview(moveComponent({ schemaVersion: 3, components }, params).components);
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
      setPreview(moveImage({ schemaVersion: 2, components }, params).components);
    }
  };

  const onDragEnd = (event: DragEndEvent) => {
    const data = event.active.data.current;
    if (data?.type === "component") {
      const params = paramsFor(event) ?? lastParamsRef.current;
      setActiveId(null);
      setPreview(null);
      lastParamsRef.current = null;
      if (params && onMoveComponent) {
        onMoveComponent(params.id, params.toIndex);
      }
    } else if (data?.type === "image") {
      const params = paramsForImage(event) ?? lastImageParamsRef.current;
      setActiveId(null);
      setPreview(null);
      lastImageParamsRef.current = null;
      if (params && onMoveImage) {
        onMoveImage(params);
      }
    }
  };

  const onDragCancel = () => {
    setActiveId(null);
    setPreview(null);
    lastParamsRef.current = null;
    lastImageParamsRef.current = null;
  };

  const handleResize = (id: string, params: { width?: number; height?: number }) => {
    if (onResize) {
      onResize(id, params);
    }
  };

  // Compute layout from the engine
  const layout = layoutPlan(view, DEFAULT_PAGE_GEOMETRY);

  // Group placements by page
  const placementsByPage: Map<number, typeof layout.placements> = new Map();
  for (const placement of layout.placements) {
    const existing = placementsByPage.get(placement.pageIndex) || [];
    existing.push(placement);
    placementsByPage.set(placement.pageIndex, existing);
  }

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
      <div className="flex flex-col gap-4" data-testid="plan-canvas">
        {Array.from({ length: layout.pageCount }, (_unused, pageIndex) => {
          const placements = placementsByPage.get(pageIndex) || [];
          return (
            <CanvasPage key={pageIndex} scale={scale}>
              {placements.map((placement) => {
                const component = componentMap.get(placement.componentId);
                if (!component) {
                  return null;
                }

                return (
                  <ComponentFrame
                    id={component.id}
                    key={component.id}
                    onRemove={onRemoveComponent}
                    rect={placement.rect}
                    scale={scale}
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
                        onSetColumns={onSetColumns}
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
            </CanvasPage>
          );
        })}
      </div>
    </DndContext>
  );
}
