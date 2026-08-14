import { useEffect, useRef, useState } from "react";
import {
  closestCorners,
  pointerWithin,
  rectIntersection,
  DragOverlay,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  contentSize,
  DEFAULT_PAGE_GEOMETRY,
  DOCUMENT_TITLE_HEIGHT,
  COMPONENT_CLOSE_GUTTER,
  PLAN_COMPONENT_VISUAL_INSET,
  snapCardResize,
  type Rect,
  type ResizeEdge,
} from "../../../domain/plan/canvas/geometry";
import type { LayoutMeasurements } from "../../../domain/plan/canvas/engine";
import {
  type MoveImageParams,
  type MoveImagesParams,
} from "../../../domain/plan/canvas/plan";
import { layoutDocumentFlow } from "../../../domain/plan/canvas/documentFlow";
import type {
  PlanComponent,
  ReferenceComponent,
} from "../../../domain/plan/canvas/models";
import {
  MIN_TEXT_LEAF_HEIGHT,
  textTreeMinimumWidth,
} from "../../../domain/plan/canvas/textTree";
import type {
  RenameComponentResult,
  SetPlanTitleResult,
} from "../../../domain/plan/canvas/naming";
import {
  COMPONENT_INSET,
  packReferenceFrames,
  type ReferenceFlowSlot,
} from "../../../domain/plan/canvas/referenceLayout";
import { ComponentFrame } from "./ComponentFrame";
import { CanvasTitle } from "./CanvasTitle";
import { PlanTextComponentView } from "./PlanTextComponentView";
import { ReferenceComponentView } from "./ReferenceComponentView";
import { imageInsertAfterFromRects, selectedImageDropTarget } from "./imageDropTarget";
import type { PlanMeasurement } from "./usePlanContentMeasurement";
import type { ImageImportProgress } from "../imageImportProgress";
import { DRAG_ACTIVATION_CONSTRAINT } from "./dragMotion";
import { DragOverlayPreview } from "./DragOverlayPreview";
import { PagedCanvasSurface } from "./PagedCanvasSurface";
import { pageTopPx } from "./pagedCanvasMetrics";
import { PlanDocumentCanvas } from "./PlanDocumentCanvas";

export interface PlanCanvasProps {
  components: PlanComponent[];
  documentHtml?: string;
  title: string;
  scale: number;
  measurements?: LayoutMeasurements;
  imageSrc: (file: string) => string | undefined;
  onInsertTextImage?: () => Promise<{
    file: string;
    dataUrl: string;
    alt?: string;
    width?: number;
    height?: number;
  } | null>;
  onRemoveComponent: (id: string) => void;
  onChangeHtml: (componentId: string, leafId: string, html: string) => void;
  onChangeDocumentHtml?: (html: string) => void;
  onCreateImageGroup?: (id: string) => void;
  onSplitTextLeaf?: (
    componentId: string,
    leafId: string,
    direction: "columns" | "rows",
  ) => void;
  onRemoveTextLeaf?: (componentId: string, leafId: string) => void;
  onUndo?: () => void;
  onCommitTitle: (title: string) => SetPlanTitleResult;
  onRenameComponent: (id: string, name: string) => RenameComponentResult;
  onSetDescription: (id: string, description: string) => void;
  onAddImage: (id: string) => void;
  onRemoveImage: (componentId: string, imageId: string) => void;
  onOpenImage: (file: string) => void;
  onOpenDocumentImage?: (componentId: string, imageId: string, file: string) => void;
  onReorderComponent?: (id: string, toIndex: number) => void;
  onMoveImage?: (params: MoveImageParams) => void;
  onMoveImages?: (params: MoveImagesParams) => void;
  onResize?: (
    id: string,
    rect: {
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      frameOffsetY?: number;
    },
  ) => void;
  onAddImages?: (id: string) => void;
  onMeasurePlan?: (id: string, measurement: PlanMeasurement) => void;
  onMeasureReferenceDescription?: (id: string, heightPoints: number) => void;
  onSetImageFrame?: (
    componentId: string,
    imageId: string,
    frame: {
      frameWidth: number;
      frameHeight: number;
      frameOffsetX?: number;
      frameOffsetY?: number;
    },
  ) => void;
  onSetImageCrop?: (
    componentId: string,
    imageId: string,
    crop: { x: number; y: number; width: number; height: number },
  ) => void;
  onScaleReferenceImages?: (componentId: string, scale: number) => void;
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

type ActiveDrag = { type: "image"; id: string; componentId: string; imageIds: string[] };

interface ComponentPreview {
  id: string;
  rect: Rect;
  limitedEdge: ResizeEdge | null;
}

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

const collisionDetection: CollisionDetection = collisionForImage;

export function PlanCanvas(props: PlanCanvasProps) {
  if (
    props.documentHtml !== undefined &&
    props.onChangeDocumentHtml &&
    props.onCreateImageGroup
  ) {
    return (
      <PlanDocumentCanvas
        documentHtml={props.documentHtml}
        imageGroups={props.components.filter(
          (component): component is ReferenceComponent => component.type === "reference",
        )}
        imageSrc={props.imageSrc}
        onAddImages={props.onAddImages ?? props.onAddImage}
        onChangeDocumentHtml={props.onChangeDocumentHtml}
        onCreateImageGroup={props.onCreateImageGroup}
        onOpenImage={(componentId, imageId, file) => {
          if (props.onOpenDocumentImage) {
            props.onOpenDocumentImage(componentId, imageId, file);
          } else {
            props.onOpenImage(file);
          }
        }}
        onMoveImage={props.onMoveImage ?? (() => undefined)}
        onRemoveImage={props.onRemoveImage}
        onRemoveImageGroup={props.onRemoveComponent}
        onResizeImageGroup={props.onResize ?? (() => undefined)}
        onSetImageFrame={props.onSetImageFrame ?? (() => undefined)}
        scale={props.scale}
      />
    );
  }
  return <LegacyPlanCanvas {...props} />;
}

function LegacyPlanCanvas({
  components,
  title,
  scale,
  measurements,
  imageSrc,
  onInsertTextImage,
  onRemoveComponent,
  onChangeHtml,
  onSplitTextLeaf,
  onRemoveTextLeaf,
  onUndo,
  onCommitTitle,
  onRenameComponent,
  onSetDescription,
  onAddImage,
  onRemoveImage,
  onOpenImage,
  onReorderComponent,
  onMoveImage,
  onMoveImages,
  onResize,
  onAddImages,
  onMeasurePlan,
  onMeasureReferenceDescription,
  onSetImageFrame,
  onSetImageCrop,
  onScaleReferenceImages,
  imageImportProgress,
  screenCaptureState,
  onCaptureImage,
  onCancelCapture,
}: PlanCanvasProps) {
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  const [selectedImageIds, setSelectedImageIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [componentPreview, setComponentPreview] = useState<ComponentPreview | null>(
    null,
  );
  const selectedImageIdsRef = useRef<ReadonlySet<string>>(new Set());
  const activeImageIdsRef = useRef<string[]>([]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: DRAG_ACTIVATION_CONSTRAINT }),
  );
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;

  const setPreview = (preview: ComponentPreview | null) => {
    setComponentPreview(preview);
  };

  const clearComponentPreview = () => {
    setPreview(null);
  };

  const previewComponentResize = (
    componentId: string,
    rect: Rect,
    edge: ResizeEdge,
  ): Rect => {
    const component = components.find((entry) => entry.id === componentId);
    const minimumWidth = component?.type === "plan"
      ? textTreeMinimumWidth(component.textRoot) + PLAN_COMPONENT_VISUAL_INSET * 2 + COMPONENT_CLOSE_GUTTER
      : undefined;
    const measuredHeight = measurements?.planHeights.get(componentId);
    const minimumHeight = component?.type === "plan"
      ? Math.max(
          MIN_TEXT_LEAF_HEIGHT,
          Number.isFinite(measuredHeight) ? measuredHeight! : 0,
        ) + PLAN_COMPONENT_VISUAL_INSET * 2
      : undefined;
    const limited =
      ((edge === "left" || edge === "right") &&
        minimumWidth !== undefined && rect.width < minimumWidth) ||
      ((edge === "top" || edge === "bottom") &&
        minimumHeight !== undefined && rect.height < minimumHeight);
    const snapped = snapCardResize({
      rect,
      edge,
      candidates: layoutDocumentFlow(components).placements
        .filter((placement) => placement.componentId !== componentId)
        .map((placement) => placement.rect),
      threshold: 6,
      minimumWidth,
      minimumHeight,
    });
    setPreview({
      id: componentId,
      rect: snapped.rect,
      limitedEdge: limited ? edge : null,
    });
    return snapped.rect;
  };

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
    clearComponentPreview();
  };

  const onDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as { type?: string; componentId?: string } | undefined;
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
    activeDrag && activeDrag.imageIds.length === 1
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
  const surfaceComponents =
    componentPreview === null
      ? components.map((component) => {
          if (component.type !== "plan") return component;
          const screenHeight = measurements?.planScreenHeights?.get(component.id);
          return Number.isFinite(screenHeight) && screenHeight! > component.height
            ? { ...component, height: screenHeight! + PLAN_COMPONENT_VISUAL_INSET * 2 }
            : component;
        })
      : components.map((component) =>
          component.id === componentPreview.id
            ? {
                ...component,
                x: componentPreview.rect.x,
                width: componentPreview.rect.width,
                height: componentPreview.rect.height,
              }
            : component,
        );
  const flow = layoutDocumentFlow(surfaceComponents);
  const placementById = new Map(
    flow.placements.map((placement) => [placement.componentId, placement]),
  );
  const activeComponent = activeDrag
    ? components.find((component) => component.id === activeDrag.componentId)
    : undefined;
  const pageMargin = DEFAULT_PAGE_GEOMETRY.margin * safeScale;

  return (
    <DndContext
      collisionDetection={collisionDetection}
      onDragCancel={resetDrag}
      onDragEnd={onDragEnd}
      onDragStart={onDragStart}
      sensors={sensors}
    >
      <div className="flex justify-center" data-testid="plan-canvas">
        <PagedCanvasSurface pageCount={flow.pageCount} scale={safeScale}>
          <div
            className="absolute"
            data-testid="canvas-document-title"
            style={{
              left: `${pageMargin}px`,
              top: `${pageMargin}px`,
              width: `${contentSize(DEFAULT_PAGE_GEOMETRY).width * safeScale}px`,
              height: `${DOCUMENT_TITLE_HEIGHT * safeScale}px`,
            }}
          >
            <CanvasTitle onCommit={onCommitTitle} scale={safeScale} title={title} />
          </div>
          {components.map((component, componentIndex) => {
            const preview =
              componentPreview?.id === component.id ? componentPreview.rect : null;
            const screenHeight = component.type === "plan"
              ? measurements?.planScreenHeights?.get(component.id)
              : undefined;
            const runtimeComponent = Number.isFinite(screenHeight) && screenHeight! > component.height
              ? { ...component, height: screenHeight! + PLAN_COMPONENT_VISUAL_INSET * 2 }
              : component;
            const visibleComponent = preview
              ? {
                  ...runtimeComponent,
                  x: preview.x,
                  width: preview.width,
                  height: preview.height,
                }
              : runtimeComponent;
            const placement = placementById.get(component.id);
            if (!placement) {
              return null;
            }
            const reference =
              visibleComponent.type === "reference" ? visibleComponent : null;
            const slots = reference ? referenceSlots(reference) : [];

            return (
              <div
                className="pointer-events-none absolute z-10"
                key={visibleComponent.id}
                style={{
                  left: `${pageMargin}px`,
                  top: `${pageTopPx(placement.pageIndex, safeScale) + pageMargin}px`,
                  width: `${contentSize(DEFAULT_PAGE_GEOMETRY).width * safeScale}px`,
                  height: `${contentSize(DEFAULT_PAGE_GEOMETRY).height * safeScale}px`,
                }}
              >
              <ComponentFrame
                component={visibleComponent}
                frameId={visibleComponent.id}
                id={visibleComponent.id}
                onRemove={onRemoveComponent}
                onRename={onRenameComponent}
                onResize={(id, rect, edge) => {
                  clearComponentPreview();
                  onResize?.(
                    id,
                    component.type === "plan" && (edge === "left" || edge === "right")
                      ? { x: rect.x, width: rect.width }
                      : rect,
                  );
                }}
                onResizeCancel={clearComponentPreview}
                onResizePreview={previewComponentResize}
                resizeLimitedEdge={
                  componentPreview?.id === component.id
                    ? componentPreview.limitedEdge
                    : null
                }
                rect={placement.rect}
                scale={safeScale}
                sortableId={visibleComponent.id}
                showName={visibleComponent.type !== "plan"}
                allowContentOverflow={visibleComponent.type === "plan"}
                canMoveUp={componentIndex > 0}
                canMoveDown={componentIndex < components.length - 1}
                onMoveUp={() => onReorderComponent?.(component.id, componentIndex - 1)}
                onMoveDown={() => onReorderComponent?.(component.id, componentIndex + 1)}
              >
                {visibleComponent.type === "plan" ? (
                  <PlanTextComponentView
                    component={visibleComponent}
                    imageSrc={imageSrc}
                    onChangeHtml={onChangeHtml}
                    onInsertImage={onInsertTextImage}
                    onMeasure={onMeasurePlan}
                    onSplitLeaf={onSplitTextLeaf}
                    onRemoveLeaf={onRemoveTextLeaf}
                    onUndo={onUndo}
                    scale={safeScale}
                  />
                ) : (
                  <ReferenceComponentView
                    component={visibleComponent}
                    enableReorder
                    hiddenImageId={activeDrag?.id}
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
                    onMeasureDescription={onMeasureReferenceDescription}
                    onSetImageFrame={onSetImageFrame}
                    onSetImageCrop={onSetImageCrop}
                    onScaleImages={onScaleReferenceImages}
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
              </div>
            );
          })}
        </PagedCanvasSurface>
      </div>
      <DragOverlay>
        {activeDrag && activeComponent?.type === "reference" ? (
          <DragOverlayPreview
            activeId={activeDrag.id}
            component={activeComponent}
            imageSrc={imageSrc}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
