import { useEffect, useRef, useState } from "react";
import {
  closestCorners,
  pointerWithin,
  rectIntersection,
  DndContext,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  canvasHeight,
  contentSize,
  DEFAULT_PAGE_GEOMETRY,
  DOCUMENT_TITLE_HEIGHT,
} from "../../../domain/plan/canvas/geometry";
import {
  type ComponentMoveTarget,
  type MoveImageParams,
  type MoveImagesParams,
} from "../../../domain/plan/canvas/plan";
import type {
  PlanComponent,
  ReferenceComponent,
} from "../../../domain/plan/canvas/models";
import type {
  RenameComponentResult,
  SetPlanTitleResult,
} from "../../../domain/plan/canvas/naming";
import {
  COMPONENT_INSET,
  packReferenceFrames,
  type ReferenceFlowSlot,
} from "../../../domain/plan/canvas/referenceLayout";
import { logicalComponentIdFromDnd } from "./componentDragIdentity";
import { ComponentFrame } from "./ComponentFrame";
import { CanvasTitle } from "./CanvasTitle";
import { PlanTextComponentView } from "./PlanTextComponentView";
import { ReferenceComponentView } from "./ReferenceComponentView";
import { imageInsertAfterFromRects, selectedImageDropTarget } from "./imageDropTarget";
import type { PlanMeasurement } from "./usePlanContentMeasurement";
import type { ImageImportProgress } from "../imageImportProgress";
import { DRAG_ACTIVATION_CONSTRAINT } from "./dragMotion";

export interface PlanCanvasProps {
  components: PlanComponent[];
  title: string;
  scale: number;
  /** Retained while provider measurement state is shared with the PDF path. */
  measurements?: unknown;
  imageSrc: (file: string) => string | undefined;
  onRemoveComponent: (id: string) => void;
  onChangeHtml: (id: string, html: string) => void;
  onCommitTitle: (title: string) => SetPlanTitleResult;
  onRenameComponent: (id: string, name: string) => RenameComponentResult;
  onSetDescription: (id: string, description: string) => void;
  onAddImage: (id: string) => void;
  onRemoveImage: (componentId: string, imageId: string) => void;
  onOpenImage: (file: string) => void;
  onMoveComponent?: (id: string, target: ComponentMoveTarget) => void;
  onMoveImage?: (params: MoveImageParams) => void;
  onMoveImages?: (params: MoveImagesParams) => void;
  onResize?: (
    id: string,
    rect: { x: number; y: number; width: number; height: number },
  ) => void;
  onAddImages?: (id: string) => void;
  onMeasurePlan?: (id: string, measurement: PlanMeasurement) => void;
  onMeasureReferenceDescription?: (id: string, heightPoints: number) => void;
  onSetImageCaption?: (componentId: string, imageId: string, caption: string) => void;
  imageImportProgress?: {
    componentId: string;
    progress: ImageImportProgress;
  };
  screenCaptureState?: {
    componentId: string;
    status: "waiting" | "importing";
  };
  onCaptureImage?: (componentId: string) => void;
  onCancelCapture?: () => void;
}

type ActiveDrag =
  | { type: "component"; id: string; componentId: string }
  | { type: "image"; id: string; componentId: string; imageIds: string[] };

function referenceComponentById(
  components: PlanComponent[],
  componentId: string,
): ReferenceComponent | null {
  const component = components.find((entry) => entry.id === componentId);
  return component?.type === "reference" ? component : null;
}

function referenceSlots(component: ReferenceComponent): ReferenceFlowSlot[] {
  return packReferenceFrames({
    images: component.images,
    innerWidth: Math.max(0, component.width - COMPONENT_INSET * 2),
  });
}

function collisionForImage(args: Parameters<CollisionDetection>[0]) {
  const typeFor = (id: string | number) =>
    args.droppableContainers.find((container) => container.id === id)?.data.current?.type;
  const valid = (id: string | number) => {
    const type = typeFor(id);
    return type === "image" || type === "imagegroup";
  };
  return (
    pointerWithin(args).find((collision) => valid(collision.id))
    ? [pointerWithin(args).find((collision) => valid(collision.id))!]
    : rectIntersection(args).find((collision) => valid(collision.id))
      ? [rectIntersection(args).find((collision) => valid(collision.id))!]
      : (() => {
          const closest = closestCorners(args).find((collision) => valid(collision.id));
          return closest ? [closest] : [];
        })()
  );
}

const collisionDetection: CollisionDetection = (args) =>
  args.active.data.current?.type === "image" ? collisionForImage(args) : [];

function ContinuousCanvasSurface({
  scale,
  components,
  children,
}: {
  scale: number;
  components: PlanComponent[];
  children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({
    id: "continuous-canvas",
    data: { type: "canvas" },
  });
  const contentWidth = contentSize(DEFAULT_PAGE_GEOMETRY).width;

  return (
    <div
      className="relative"
      data-testid="continuous-canvas-surface"
      ref={setNodeRef}
      style={{
        width: `${contentWidth * scale}px`,
        height: `${canvasHeight(components) * scale}px`,
      }}
    >
      {children}
    </div>
  );
}

export function PlanCanvas({
  components,
  title,
  scale,
  imageSrc,
  onRemoveComponent,
  onChangeHtml,
  onCommitTitle,
  onRenameComponent,
  onSetDescription,
  onAddImage,
  onRemoveImage,
  onOpenImage,
  onMoveComponent,
  onMoveImage,
  onMoveImages,
  onResize,
  onAddImages,
  onMeasurePlan,
  imageImportProgress,
  screenCaptureState,
  onCaptureImage,
  onCancelCapture,
}: PlanCanvasProps) {
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  const [selectedImageIds, setSelectedImageIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const selectedImageIdsRef = useRef<ReadonlySet<string>>(new Set());
  const activeImageIdsRef = useRef<string[]>([]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: DRAG_ACTIVATION_CONSTRAINT }),
  );
  const displayedComponents = components;
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;

  const paramsForImage = (event: DragEndEvent): MoveImagesParams | null => {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    const at = event.active.rect.current.translated;
    const over = event.over?.rect ?? null;
    return selectedImageDropTarget(
      components,
      activeId,
      new Set(activeImageIdsRef.current.length > 0 ? activeImageIdsRef.current : [activeId]),
      overId,
      imageInsertAfterFromRects(
        at ? { left: at.left, width: at.width } : null,
        over ? { left: over.left, width: over.width } : null,
      ),
    );
  };

  const resetDrag = () => {
    setActiveDrag(null);
    activeImageIdsRef.current = [];
  };

  const onDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as { type?: string; componentId?: string } | undefined;
    if (data?.type === "component") {
      const componentId = logicalComponentIdFromDnd(data, String(event.active.id));
      if (componentId) {
        setActiveDrag({ type: "component", id: componentId, componentId });
      }
      return;
    }
    if (data?.type !== "image" || typeof data.componentId !== "string") {
      return;
    }

    const activeId = String(event.active.id);
    const currentSelection = selectedImageIdsRef.current;
    const orderedSelection = components.flatMap((component) =>
      component.type === "reference"
        ? component.images
            .filter((image) => currentSelection.has(image.id))
            .map((image) => image.id)
        : [],
    );
    const imageIds = currentSelection.has(activeId) ? orderedSelection : [activeId];
    if (!currentSelection.has(activeId)) {
      const nextSelection = new Set([activeId]);
      selectedImageIdsRef.current = nextSelection;
      setSelectedImageIds(nextSelection);
    }
    activeImageIdsRef.current = imageIds;
    setActiveDrag({ type: "image", id: activeId, componentId: data.componentId, imageIds });
  };

  const onDragEnd = (event: DragEndEvent) => {
    const data = event.active.data.current as { type?: string; componentId?: string } | undefined;
    if (data?.type === "component") {
      const componentId = logicalComponentIdFromDnd(data, String(event.active.id));
      const component = componentId
        ? components.find((entry) => entry.id === componentId)
        : undefined;
      resetDrag();
      if (component && componentId && onMoveComponent) {
        onMoveComponent(componentId, {
          x: component.x + event.delta.x / safeScale,
          y: component.y + event.delta.y / safeScale,
        });
      }
      return;
    }
    if (data?.type !== "image") {
      resetDrag();
      return;
    }

    const params = event.over ? paramsForImage(event) : null;
    resetDrag();
    if (params && onMoveImages) {
      onMoveImages(params);
    } else if (params?.imageIds.length === 1 && onMoveImage) {
      const imageId = params.imageIds[0];
      const source = components.find(
        (component) =>
          component.type === "reference" &&
          component.images.some((image) => image.id === imageId),
      );
      if (source) {
        onMoveImage({
          fromComponentId: source.id,
          imageId,
          toComponentId: params.toComponentId,
          toIndex: params.toIndex,
        });
      }
    }
  };

  useEffect(() => {
    const availableIds = new Set(
      components.flatMap((component) =>
        component.type === "reference" ? component.images.map((image) => image.id) : [],
      ),
    );
    setSelectedImageIds((current) => {
      const next = new Set([...current].filter((id) => availableIds.has(id)));
      const resolved = next.size === current.size ? current : next;
      selectedImageIdsRef.current = resolved;
      return resolved;
    });
  }, [components]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        const next = new Set<string>();
        selectedImageIdsRef.current = next;
        setSelectedImageIds(next);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const imageOrigin =
    activeDrag?.type === "image" && activeDrag.imageIds.length === 1
      ? (() => {
          const component = referenceComponentById(components, activeDrag.componentId);
          const image = component?.images.find((entry) => entry.id === activeDrag.id);
          const index = component?.images.findIndex((entry) => entry.id === activeDrag.id) ?? -1;
          const slot = component ? referenceSlots(component).find((entry) => entry.id === activeDrag.id) : undefined;
          return component && image && index >= 0 && slot
            ? { component, image, index, slot }
            : null;
        })()
      : null;

  return (
    <DndContext
      collisionDetection={collisionDetection}
      onDragCancel={resetDrag}
      onDragEnd={onDragEnd}
      onDragStart={onDragStart}
      sensors={sensors}
    >
      <div className="flex justify-center" data-testid="plan-canvas">
        <ContinuousCanvasSurface scale={safeScale} components={displayedComponents}>
          <div
            className="absolute"
            data-testid="canvas-document-title"
            style={{
              left: "0px",
              top: "0px",
              width: `${contentSize(DEFAULT_PAGE_GEOMETRY).width * safeScale}px`,
              height: `${DOCUMENT_TITLE_HEIGHT * safeScale}px`,
            }}
          >
            <CanvasTitle onCommit={onCommitTitle} scale={safeScale} title={title} />
          </div>
          {displayedComponents.map((component) => {
            const reference = component.type === "reference" ? component : null;
            const slots = reference ? referenceSlots(reference) : [];
            const useBaseComponent =
              activeDrag?.type === "component" && activeDrag.componentId === component.id;
            const visibleComponent =
              useBaseComponent
                ? components.find((entry) => entry.id === component.id) ?? component
                : component;
            if (!visibleComponent) {
              return null;
            }

            return (
              <ComponentFrame
                component={visibleComponent}
                frameId={visibleComponent.id}
                id={visibleComponent.id}
                key={visibleComponent.id}
                onRemove={onRemoveComponent}
                onRename={onRenameComponent}
                onResize={(id, rect) => onResize?.(id, rect)}
                rect={visibleComponent}
                scale={safeScale}
                sortableId={visibleComponent.id}
              >
                {visibleComponent.type === "plan" ? (
                  <PlanTextComponentView
                    component={visibleComponent}
                    onChangeHtml={onChangeHtml}
                    onMeasure={onMeasurePlan}
                    scale={safeScale}
                  />
                ) : (
                  <ReferenceComponentView
                    component={visibleComponent}
                    enableReorder
                    hiddenImageId={activeDrag?.type === "image" ? activeDrag.id : undefined}
                    imageSrc={imageSrc}
                    importProgress={
                      imageImportProgress?.componentId === visibleComponent.id
                        ? imageImportProgress.progress
                        : undefined
                    }
                    onAddImage={onAddImage}
                    onAddImages={onAddImages}
                    onCancelCapture={onCancelCapture}
                    onCaptureImage={onCaptureImage}
                    onOpenImage={onOpenImage}
                    onRemoveImage={onRemoveImage}
                    onSelectImage={(imageId, toggle) => {
                      setSelectedImageIds((current) => {
                        const next = toggle ? new Set(current) : new Set<string>();
                        if (toggle && next.has(imageId)) {
                          next.delete(imageId);
                        } else {
                          next.add(imageId);
                        }
                        selectedImageIdsRef.current = next;
                        return next;
                      });
                    }}
                    onSetDescription={onSetDescription}
                    placeholderImage={
                      imageOrigin?.component.id === visibleComponent.id
                        ? imageOrigin.image
                        : undefined
                    }
                    placeholderIndex={
                      imageOrigin?.component.id === visibleComponent.id
                        ? imageOrigin.index
                        : undefined
                    }
                    placeholderSlot={
                      imageOrigin?.component.id === visibleComponent.id
                        ? imageOrigin.slot
                        : undefined
                    }
                    scale={safeScale}
                    selectedImageIds={selectedImageIds}
                    slots={slots}
                    captureStatus={
                      screenCaptureState?.componentId === visibleComponent.id
                        ? screenCaptureState.status
                        : undefined
                    }
                  />
                )}
              </ComponentFrame>
            );
          })}
        </ContinuousCanvasSurface>
      </div>
    </DndContext>
  );
}
