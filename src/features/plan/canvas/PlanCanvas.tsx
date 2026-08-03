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
import { moveComponent } from "../../../domain/plan/canvas/plan";
import { componentDropTarget } from "../../../domain/plan/canvas/dropTarget";
import type { PlanComponent, WidthFraction } from "../../../domain/plan/canvas/models";
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
  onResize?: (id: string, params: { widthFraction?: WidthFraction; height?: number }) => void;
  onToggleCaptions?: (id: string) => void;
  onSetImageCaption?: (componentId: string, imageId: string, caption: string) => void;
}

// Target component frames, not image draggables inside reference components
const collisionDetection: CollisionDetection = (args) => {
  const componentHit = rectIntersection(args).find((collision) => {
    const data = args.droppableContainers.find((c) => c.id === collision.id)?.data.current;
    return data?.type === "component";
  });
  if (componentHit) {
    return [componentHit];
  }
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCorners(args);
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
  onResize,
  onToggleCaptions,
}: PlanCanvasProps) {
  const [_activeId, setActiveId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PlanComponent[] | null>(null);
  const lastParamsRef = useRef<{ id: string; toIndex: number } | null>(null);
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

  const onDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current;
    if (data?.type !== "component") {
      return;
    }
    setActiveId(String(event.active.id));
    lastParamsRef.current = null;
    setPreview(components);
  };

  const onDragOver = (event: DragOverEvent) => {
    const data = event.active.data.current;
    if (data?.type !== "component") {
      return;
    }
    const params = paramsFor(event);
    if (!params) {
      return;
    }
    const last = lastParamsRef.current;
    if (last && last.id === params.id && last.toIndex === params.toIndex) {
      return;
    }
    lastParamsRef.current = params;
    setPreview(moveComponent({ schemaVersion: 2, components }, params).components);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const data = event.active.data.current;
    if (data?.type !== "component") {
      return;
    }
    const params = paramsFor(event) ?? lastParamsRef.current;
    setActiveId(null);
    setPreview(null);
    lastParamsRef.current = null;
    if (params && onMoveComponent) {
      onMoveComponent(params.id, params.toIndex);
    }
  };

  const onDragCancel = () => {
    setActiveId(null);
    setPreview(null);
    lastParamsRef.current = null;
  };

  const handleResize = (id: string, params: { widthFraction?: WidthFraction; height?: number }) => {
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
                    widthFraction={component.widthFraction}
                    height={component.height}
                    onResize={handleResize}
                  >
                    {component.type === "plan" ? (
                      <PlanTextComponentView component={component} onChangeHtml={onChangeHtml} />
                    ) : (
                      <ReferenceComponentView
                        component={component}
                        imageSrc={imageSrc}
                        onAddImage={onAddImage}
                        onOpenImage={onOpenImage}
                        onRemoveImage={onRemoveImage}
                        onSetColumns={onSetColumns}
                        onSetDescription={onSetDescription}
                        onSetTitle={onSetTitle}
                        onToggleCaptions={onToggleCaptions}
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
