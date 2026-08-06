import { useRef, useState } from "react";
import {
  closestCorners,
  pointerWithin,
  rectIntersection,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragOverEvent,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { layoutPlan, type ComponentFragmentPlacement, type LayoutMeasurements } from "../../../domain/plan/canvas/engine";
import {
  contentSize,
  DEFAULT_PAGE_GEOMETRY,
  EDITABLE_COMPONENT_FRAME_CHROME,
  SPACING,
} from "../../../domain/plan/canvas/geometry";
import { moveImage, type MoveImageParams } from "../../../domain/plan/canvas/plan";
import { componentDropTarget } from "../../../domain/plan/canvas/dropTarget";
import {
  moveComponentInRows,
  type ComponentMoveTarget,
} from "../../../domain/plan/canvas/rows";
import type {
  CropRect,
  PlanComponent,
  ReferenceComponent,
  ReferenceImage,
} from "../../../domain/plan/canvas/models";
import type {
  RenameComponentResult,
  SetPlanTitleResult,
} from "../../../domain/plan/canvas/naming";
import { effectiveImageAspectRatio } from "../../../domain/plan/canvas/crop";
import { ComponentFrame } from "./ComponentFrame";
import { CanvasTitle } from "./CanvasTitle";
import { PagedCanvasSurface } from "./PagedCanvasSurface";
import { PAGE_SCREEN_GAP, pageTopPx } from "./pagedCanvasMetrics";
import { PlanTextComponentView } from "./PlanTextComponentView";
import { ReferenceComponentView } from "./ReferenceComponentView";
import { insertAfterFromRects } from "./canvasDropGeometry";
import { logicalComponentIdFromDnd } from "./componentDragIdentity";
import { DragOverlayPreview } from "./DragOverlayPreview";
import {
  DRAG_ACTIVATION_CONSTRAINT,
} from "./dragMotion";
import { buildDisplayPlacements, pageCountForDisplayedPlacements } from "./dragPreviewState";
import { imageDropTarget, imageInsertAfterFromRects } from "./imageDropTarget";
import type { PlanMeasurement } from "./usePlanContentMeasurement";
import { RowDropZone } from "./RowDropZone";

export interface PlanCanvasProps {
  components: PlanComponent[];
  title: string;
  scale: number;
  measurements: LayoutMeasurements;
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
  onResize?: (id: string, params: { width: number }) => void;
  onToggleCaptions?: (id: string) => void;
  onSetImageCaption?: (componentId: string, imageId: string, caption: string) => void;
  onSetImageHeight?: (id: string, height: number) => void;
  onAddImages?: (id: string) => void;
  onSetImageCrop?: (componentId: string, imageId: string, crop: CropRect) => void;
  onResetImageCrop?: (componentId: string, imageId: string) => void;
  onMeasurePlan: (id: string, measurement: PlanMeasurement) => void;
  onMeasureReferenceDescription: (id: string, heightPoints: number) => void;
}

type ActiveDrag =
  | { type: "component"; id: string; componentId: string }
  | { type: "image"; id: string; componentId: string };

interface ComponentDragParams {
  id: string;
  target: ComponentMoveTarget;
}

function sameComponentDragParams(
  left: ComponentDragParams,
  right: ComponentDragParams,
): boolean {
  if (
    left.id !== right.id ||
    left.target.kind !== right.target.kind ||
    left.target.rowId !== right.target.rowId
  ) {
    return false;
  }
  if (left.target.kind === "new-row" && right.target.kind === "new-row") {
    return left.target.toRowIndex === right.target.toRowIndex;
  }
  if (left.target.kind === "row" && right.target.kind === "row") {
    return left.target.toIndex === right.target.toIndex;
  }
  return false;
}

const CANVAS_LAYOUT_OPTIONS = {
  frameChrome: EDITABLE_COMPONENT_FRAME_CHROME,
  includeDocumentTitle: true,
};

const collisionDetection: CollisionDetection = (args) => {
  const activeType = args.active.data.current?.type;
  const typeFor = (id: string | number) =>
    args.droppableContainers.find((container) => container.id === id)?.data.current?.type;
  const pointerCollisions = pointerWithin(args);

  if (activeType === "component" || activeType === "image") {
    const pointerInsideCanvas = pointerCollisions.some(
      (collision) => typeFor(collision.id) === "canvas",
    );
    if (!pointerInsideCanvas) {
      return [];
    }

    const isValidTarget = (id: string | number) => {
      const type = typeFor(id);
      return activeType === "component"
        ? type === "component" || type === "row-gap"
        : type === "image" || type === "imagegroup";
    };
    const pointerHit = pointerCollisions.find((collision) =>
      isValidTarget(collision.id),
    );
    if (pointerHit) {
      return [pointerHit];
    }
    const intersectionHit = rectIntersection(args).find((collision) =>
      isValidTarget(collision.id),
    );
    if (intersectionHit) {
      return [intersectionHit];
    }
    const closestHit = closestCorners(args).find((collision) =>
      isValidTarget(collision.id),
    );
    return closestHit ? [closestHit] : [];
  }

  return rectIntersection(args);
};

function referenceComponentById(components: PlanComponent[], componentId: string): ReferenceComponent | null {
  const component = components.find((entry) => entry.id === componentId);
  return component?.type === "reference" ? component : null;
}

function componentsWithEffectiveImageAspectRatios(
  components: PlanComponent[],
): PlanComponent[] {
  return components.map((component) =>
    component.type === "reference"
      ? {
          ...component,
          images: component.images.map((image) => ({
            ...image,
            aspectRatio: effectiveImageAspectRatio(image),
          })),
        }
      : component,
  );
}

function findImageOrigin(
  components: PlanComponent[],
  placements: ComponentFragmentPlacement[],
  activeDrag: ActiveDrag | null,
): {
  component: ReferenceComponent;
  image: ReferenceImage;
  imageIndex: number;
  placement: ComponentFragmentPlacement;
} | null {
  if (activeDrag?.type !== "image") {
    return null;
  }

  const component = referenceComponentById(components, activeDrag.componentId);
  const imageIndex = component?.images.findIndex((image) => image.id === activeDrag.id) ?? -1;
  const image = imageIndex >= 0 && component ? component.images[imageIndex] : null;
  const placement = placements.find(
    (entry) => entry.componentId === activeDrag.componentId && entry.imageSlots?.some((slot) => slot.id === activeDrag.id),
  );

  if (!component || !image || imageIndex < 0 || !placement) {
    return null;
  }

  return { component, image, imageIndex, placement };
}

export function PlanCanvas({
  components,
  title,
  scale,
  measurements,
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
  onResize,
  onToggleCaptions,
  onSetImageCaption,
  onSetImageHeight,
  onAddImages,
  onSetImageCrop,
  onResetImageCrop,
  onMeasurePlan,
  onMeasureReferenceDescription,
}: PlanCanvasProps) {
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  const [preview, setPreview] = useState<PlanComponent[] | null>(null);
  const lastParamsRef = useRef<ComponentDragParams | null>(null);
  const lastImageParamsRef = useRef<MoveImageParams | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: DRAG_ACTIVATION_CONSTRAINT }));

  const layoutGeometry = {
    ...DEFAULT_PAGE_GEOMETRY,
    pageGap: Number.isFinite(scale) && scale > 0 ? PAGE_SCREEN_GAP / scale : 0,
  };
  const baseLayout = layoutPlan(
    componentsWithEffectiveImageAspectRatios(components),
    layoutGeometry,
    measurements,
    CANVAS_LAYOUT_OPTIONS,
  );
  const previewComponents = preview ?? components;
  const previewLayout = layoutPlan(
    componentsWithEffectiveImageAspectRatios(previewComponents),
    layoutGeometry,
    measurements,
    CANVAS_LAYOUT_OPTIONS,
  );
  const componentMap = new Map(components.map((component) => [component.id, component]));
  const previewComponentMap = new Map(previewComponents.map((component) => [component.id, component]));

  const imageOrigin = findImageOrigin(components, baseLayout.placements, activeDrag);
  const componentDragId = activeDrag?.type === "component" ? activeDrag.componentId : null;
  const displayPlacements = buildDisplayPlacements({
    activeDrag,
    basePlacements: baseLayout.placements,
    previewPlacements: previewLayout.placements,
    imageOriginPlacement: imageOrigin?.placement ?? null,
  });

  const paramsFor = (event: DragOverEvent | DragEndEvent): ComponentDragParams | null => {
    const activeId = logicalComponentIdFromDnd(
      event.active.data.current as { componentId?: unknown } | null | undefined,
      String(event.active.id),
    );
    const overData = event.over?.data.current as {
      type?: unknown;
      componentId?: unknown;
      beforeRowId?: unknown;
    } | null | undefined;
    const activeRect = event.active.rect.current.translated;
    const overRect = event.over?.rect ?? null;
    const insertAfter =
      activeRect != null && overRect != null ? insertAfterFromRects(activeRect, overRect) : false;
    if (activeId === null) {
      return null;
    }

    const over =
      overData?.type === "row-gap" && typeof overData.beforeRowId === "string"
        ? { type: "row-gap" as const, id: overData.beforeRowId, insertAfter }
        : overData?.type === "component"
          ? (() => {
              const componentId = logicalComponentIdFromDnd(
                overData,
                event.over ? String(event.over.id) : null,
              );
              return componentId
                ? { type: "component" as const, id: componentId, insertAfter }
                : null;
            })()
          : null;
    const drop = componentDropTarget(components, activeId, over);
    if (drop.kind === "invalid") {
      return null;
    }
    if (drop.kind === "row") {
      return {
        id: activeId,
        target: { kind: "row", rowId: drop.rowId, toIndex: drop.toIndex },
      };
    }

    const previous = lastParamsRef.current;
    if (
      previous?.id === activeId &&
      previous.target.kind === "new-row" &&
      previous.target.toRowIndex === drop.toRowIndex
    ) {
      return previous;
    }
    return {
      id: activeId,
      target: {
        kind: "new-row",
        rowId: `row-${crypto.randomUUID()}`,
        toRowIndex: drop.toRowIndex,
      },
    };
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
    if (!target) {
      return null;
    }
    return { ...target, imageId: activeId };
  };

  const onDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as { type?: string; componentId?: string } | undefined;
    if (data?.type === "component") {
      const componentId = logicalComponentIdFromDnd(data, String(event.active.id));
      if (!componentId) {
        return;
      }
      setActiveDrag({ type: "component", id: componentId, componentId });
      lastParamsRef.current = null;
      setPreview(components);
    } else if (data?.type === "image" && typeof data.componentId === "string") {
      setActiveDrag({ type: "image", id: String(event.active.id), componentId: data.componentId });
      lastImageParamsRef.current = null;
      setPreview(components);
    }
  };

  const onDragOver = (event: DragOverEvent) => {
    const data = event.active.data.current;
    if (data?.type === "component") {
      const params = paramsFor(event);
      if (!params) {
        lastParamsRef.current = null;
        setPreview(null);
        return;
      }
      const last = lastParamsRef.current;
      if (last && sameComponentDragParams(last, params)) {
        return;
      }
      lastParamsRef.current = params;
      setPreview(moveComponentInRows(
        { schemaVersion: 5, title: "", components },
        params,
      ).components);
    } else if (data?.type === "image") {
      const params = paramsForImage(event);
      if (!params) {
        lastImageParamsRef.current = null;
        setPreview(null);
        return;
      }
      const last = lastImageParamsRef.current;
      if (last && last.imageId === params.imageId && last.toComponentId === params.toComponentId && last.toIndex === params.toIndex) {
        return;
      }
      lastImageParamsRef.current = params;
      setPreview(moveImage({ schemaVersion: 5, title: "", components }, params).components);
    }
  };

  const resetPreview = () => {
    setActiveDrag(null);
    setPreview(null);
    lastParamsRef.current = null;
    lastImageParamsRef.current = null;
  };

  const onDragEnd = (event: DragEndEvent) => {
    const data = event.active.data.current;
    if (data?.type === "component") {
      const params = event.over ? paramsFor(event) : null;
      resetPreview();
      if (params && onMoveComponent) {
        onMoveComponent(params.id, params.target);
      }
    } else if (data?.type === "image") {
      const params = event.over ? paramsForImage(event) : null;
      resetPreview();
      if (params && onMoveImage) {
        onMoveImage(params);
      }
    } else {
      resetPreview();
    }
  };

  const handleResize = (id: string, params: { width: number }) => {
    if (onResize) {
      onResize(id, params);
    }
  };

  const contentWidthPoints = contentSize(DEFAULT_PAGE_GEOMETRY).width;
  const displayedPageCount = pageCountForDisplayedPlacements(displayPlacements, previewLayout.pageCount);
  const overlayComponent =
    activeDrag == null
      ? null
      : componentMap.get(activeDrag.componentId) ?? previewComponentMap.get(activeDrag.componentId) ?? null;

  return (
    <DndContext
      collisionDetection={collisionDetection}
      onDragCancel={resetPreview}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragStart={onDragStart}
      sensors={sensors}
    >
      <div className="flex justify-center" data-testid="plan-canvas">
        <PagedCanvasSurface pageCount={displayedPageCount} scale={scale}>
          <div
            className="absolute"
            data-testid="canvas-document-title"
            style={{
              left: `${SPACING * scale}px`,
              top: `${SPACING * scale}px`,
              width: `${contentSize(DEFAULT_PAGE_GEOMETRY).width * scale}px`,
            }}
          >
            <CanvasTitle onCommit={onCommitTitle} title={title} />
          </div>
          {components.reduce<Array<{ rowId: string; componentId: string }>>(
            (rows, component) => {
              if (rows.at(-1)?.rowId !== component.rowId) {
                rows.push({ rowId: component.rowId, componentId: component.id });
              }
              return rows;
            },
            [],
          ).slice(1).map(({ rowId, componentId }) => {
            const placement = baseLayout.placements.find(
              (entry) => entry.componentId === componentId,
            );
            if (!placement) {
              return null;
            }
            return (
              <RowDropZone
                beforeRowId={rowId}
                key={`row-gap:${rowId}`}
                topPx={
                  pageTopPx(placement.pageIndex, scale) +
                  (SPACING + placement.rect.y - SPACING) * scale
                }
              />
            );
          })}
          <SortableContext items={components.map((component) => component.id)} strategy={verticalListSortingStrategy}>
            {displayPlacements.map((placement) => {
              const useBaseComponent = componentDragId === placement.componentId;
              const component = (useBaseComponent ? componentMap : previewComponentMap).get(placement.componentId);
              if (!component) {
                return null;
              }

              const imagePlaceholder =
                imageOrigin != null && imageOrigin.placement.fragmentId === placement.fragmentId
                  ? {
                      image: imageOrigin.image,
                      index: imageOrigin.imageIndex,
                      slot: imageOrigin.placement.imageSlots?.find((slot) => slot.id === imageOrigin.image.id),
                    }
                  : null;

              return (
                <ComponentFrame
                  id={component.id}
                  frameId={placement.fragmentId}
                  key={placement.fragmentId}
                  onRemove={onRemoveComponent}
                  rect={placement.rect}
                  scale={scale}
                  sortableId={placement.fragmentIndex === 0 ? component.id : ""}
                  isPlaceholder={componentDragId === component.id}
                  topPx={pageTopPx(placement.pageIndex, scale) + (SPACING + placement.rect.y) * scale}
                  contentWidthPoints={contentWidthPoints}
                  component={component}
                  onRename={onRenameComponent}
                  onResize={handleResize}
                >
                  {component.type === "plan" ? (
                    <PlanTextComponentView
                      component={component}
                      onChangeHtml={onChangeHtml}
                      onMeasure={onMeasurePlan}
                      scale={scale}
                    />
                  ) : (
                    <ReferenceComponentView
                      component={component}
                      enableReorder={true}
                      fragmentId={placement.fragmentId}
                      fragmentIndex={placement.fragmentIndex}
                      fragmentKind={placement.kind}
                      hiddenImageId={activeDrag?.type === "image" ? activeDrag.id : undefined}
                      imageSrc={imageSrc}
                      onAddImage={onAddImage}
                      onOpenImage={onOpenImage}
                      onRemoveImage={onRemoveImage}
                      onSetDescription={onSetDescription}
                      onToggleCaptions={onToggleCaptions}
                      onSetImageCaption={onSetImageCaption}
                      onSetImageHeight={onSetImageHeight}
                      onAddImages={onAddImages}
                      onSetImageCrop={onSetImageCrop}
                      onResetImageCrop={onResetImageCrop}
                      onMeasureDescription={onMeasureReferenceDescription}
                      placeholderImage={imagePlaceholder?.image}
                      placeholderIndex={imagePlaceholder?.index}
                      placeholderSlot={imagePlaceholder?.slot}
                      slots={placement.imageSlots ?? []}
                      scale={scale}
                    />
                  )}
                </ComponentFrame>
              );
            })}
          </SortableContext>
        </PagedCanvasSurface>
      </div>
      <DragOverlay>
        {activeDrag && overlayComponent ? (
          <DragOverlayPreview active={{ type: activeDrag.type, id: activeDrag.id }} component={overlayComponent} imageSrc={imageSrc} />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
