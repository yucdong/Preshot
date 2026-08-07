import { useEffect, useRef, useState } from "react";
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
import {
  moveImages,
  type MoveImageParams,
  type MoveImagesParams,
} from "../../../domain/plan/canvas/plan";
import { componentDropTarget } from "../../../domain/plan/canvas/dropTarget";
import {
  moveComponentInRows,
  type ComponentMoveTarget,
} from "../../../domain/plan/canvas/rows";
import { DOCUMENT_TITLE_HEIGHT } from "../../../domain/plan/canvas/models";
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
import { imageInsertAfterFromRects, selectedImageDropTarget } from "./imageDropTarget";
import type { PlanMeasurement } from "./usePlanContentMeasurement";
import { RowDropZone } from "./RowDropZone";
import { rowDropZoneGeometry } from "./rowDropZoneGeometry";
import type { ImageImportProgress } from "../imageImportProgress";

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
  onMoveImages?: (params: MoveImagesParams) => void;
  onResize?: (id: string, params: { width: number }) => void;
  onToggleCaptions?: (id: string) => void;
  onSetImageCaption?: (componentId: string, imageId: string, caption: string) => void;
  onSetImageHeight?: (id: string, height: number) => void;
  onAddImages?: (id: string) => void;
  onSetImageCrop?: (componentId: string, imageId: string, crop: CropRect) => void;
  onResetImageCrop?: (componentId: string, imageId: string) => void;
  onMeasurePlan: (id: string, measurement: PlanMeasurement) => void;
  onMeasureReferenceDescription: (id: string, heightPoints: number) => void;
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

interface ImageCropPreview {
  componentId: string;
  imageId: string;
  crop: CropRect;
}

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

function componentsWithCropPreview(
  components: PlanComponent[],
  preview: ImageCropPreview | null,
): PlanComponent[] {
  if (!preview) {
    return components;
  }

  return components.map((component) =>
    component.type === "reference" && component.id === preview.componentId
      ? {
          ...component,
          images: component.images.map((image) =>
            image.id === preview.imageId ? { ...image, crop: preview.crop } : image,
          ),
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

function logicalRows(components: PlanComponent[]): Array<{
  rowId: string;
  componentIds: string[];
}> {
  return components.reduce<Array<{ rowId: string; componentIds: string[] }>>(
    (rows, component) => {
      const current = rows.at(-1);
      if (current?.rowId === component.rowId) {
        current.componentIds.push(component.id);
      } else {
        rows.push({ rowId: component.rowId, componentIds: [component.id] });
      }
      return rows;
    },
    [],
  );
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
  onMoveImages,
  onResize,
  onToggleCaptions,
  onSetImageCaption,
  onSetImageHeight,
  onAddImages,
  onSetImageCrop,
  onResetImageCrop,
  onMeasurePlan,
  onMeasureReferenceDescription,
  imageImportProgress,
  screenCaptureState,
  onCaptureImage,
  onCancelCapture,
}: PlanCanvasProps) {
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  const [preview, setPreview] = useState<PlanComponent[] | null>(null);
  const [cropPreview, setCropPreview] = useState<ImageCropPreview | null>(null);
  const [selectedImageIds, setSelectedImageIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const selectedImageIdsRef = useRef<ReadonlySet<string>>(new Set());
  const lastParamsRef = useRef<ComponentDragParams | null>(null);
  const lastImageParamsRef = useRef<MoveImagesParams | null>(null);
  const activeImageIdsRef = useRef<string[]>([]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: DRAG_ACTIVATION_CONSTRAINT }));

  const layoutGeometry = {
    ...DEFAULT_PAGE_GEOMETRY,
    pageGap: Number.isFinite(scale) && scale > 0 ? PAGE_SCREEN_GAP / scale : 0,
  };
  const displayedComponents = componentsWithCropPreview(components, cropPreview);
  const previewComponents = componentsWithCropPreview(preview ?? components, cropPreview);
  const baseLayout = layoutPlan(
    componentsWithEffectiveImageAspectRatios(displayedComponents),
    layoutGeometry,
    measurements,
    CANVAS_LAYOUT_OPTIONS,
  );
  const previewLayout = layoutPlan(
    componentsWithEffectiveImageAspectRatios(previewComponents),
    layoutGeometry,
    measurements,
    CANVAS_LAYOUT_OPTIONS,
  );
  const componentMap = new Map(displayedComponents.map((component) => [component.id, component]));
  const previewComponentMap = new Map(previewComponents.map((component) => [component.id, component]));

  const imageOrigin =
    activeDrag?.type === "image" && activeDrag.imageIds.length === 1
      ? findImageOrigin(components, baseLayout.placements, activeDrag)
      : null;
  const componentDragId = activeDrag?.type === "component" ? activeDrag.componentId : null;
  const displayPlacements = buildDisplayPlacements({
    activeDrag,
    basePlacements: baseLayout.placements,
    previewPlacements: previewLayout.placements,
    imageOriginPlacement: imageOrigin?.placement ?? null,
  });
  const componentRows = logicalRows(components);
  const rowDropZones = rowDropZoneGeometry(
    componentRows,
    baseLayout.placements,
    scale,
  );

  const paramsFor = (event: DragOverEvent | DragEndEvent): ComponentDragParams | null => {
    const activeId = logicalComponentIdFromDnd(
      event.active.data.current as { componentId?: unknown } | null | undefined,
      String(event.active.id),
    );
    const overData = event.over?.data.current as {
      type?: unknown;
      componentId?: unknown;
      toRowIndex?: unknown;
    } | null | undefined;
    const activeRect = event.active.rect.current.translated;
    const overRect = event.over?.rect ?? null;
    const insertAfter =
      activeRect != null && overRect != null ? insertAfterFromRects(activeRect, overRect) : false;
    if (activeId === null) {
      return null;
    }

    const over =
      overData?.type === "row-gap" && typeof overData.toRowIndex === "number"
        ? { type: "row-gap" as const, toRowIndex: overData.toRowIndex }
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

  const paramsForImage = (event: DragOverEvent | DragEndEvent): MoveImagesParams | null => {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    const at = event.active.rect.current.translated;
    const ov = event.over?.rect ?? null;
    const insertAfter = imageInsertAfterFromRects(
      at ? { left: at.left, width: at.width } : null,
      ov ? { left: ov.left, width: ov.width } : null,
    );
    return selectedImageDropTarget(
      components,
      activeId,
      new Set(activeImageIdsRef.current.length > 0 ? activeImageIdsRef.current : [activeId]),
      overId,
      insertAfter,
    );
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
      setActiveDrag({
        type: "image",
        id: activeId,
        componentId: data.componentId,
        imageIds,
      });
      activeImageIdsRef.current = imageIds;
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
      if (
        last &&
        last.toComponentId === params.toComponentId &&
        last.toIndex === params.toIndex &&
        last.imageIds.length === params.imageIds.length &&
        last.imageIds.every((imageId, index) => imageId === params.imageIds[index])
      ) {
        return;
      }
      lastImageParamsRef.current = params;
      setPreview(moveImages({ schemaVersion: 5, title: "", components }, params).components);
    }
  };

  const resetPreview = () => {
    setActiveDrag(null);
    activeImageIdsRef.current = [];
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
    } else {
      resetPreview();
    }
  };

  const handleResize = (id: string, params: { width: number }) => {
    if (onResize) {
      onResize(id, params);
    }
  };

  const previewImageCrop = (
    componentId: string,
    imageId: string,
    crop: CropRect,
  ) => {
    setCropPreview((current) =>
      current?.componentId === componentId &&
      current.imageId === imageId &&
      current.crop.x === crop.x &&
      current.crop.y === crop.y &&
      current.crop.width === crop.width &&
      current.crop.height === crop.height
        ? current
        : { componentId, imageId, crop },
    );
  };

  const cancelImageCropPreview = (componentId: string, imageId: string) => {
    setCropPreview((current) =>
      current?.componentId === componentId && current.imageId === imageId
        ? null
        : current,
    );
  };

  const selectImage = (imageId: string, toggle: boolean) => {
    setSelectedImageIds((current) => {
      if (!toggle) {
        const next = current.size === 1 && current.has(imageId)
          ? current
          : new Set([imageId]);
        selectedImageIdsRef.current = next;
        return next;
      }
      const next = new Set(current);
      if (next.has(imageId)) {
        next.delete(imageId);
      } else {
        next.add(imageId);
      }
      selectedImageIdsRef.current = next;
      return next;
    });
  };

  useEffect(() => {
    const availableIds = new Set(
      components.flatMap((component) =>
        component.type === "reference"
          ? component.images.map((image) => image.id)
          : [],
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
              height: `${DOCUMENT_TITLE_HEIGHT * scale}px`,
            }}
          >
            <CanvasTitle onCommit={onCommitTitle} scale={scale} title={title} />
          </div>
          {rowDropZones.map(({ toRowIndex, topPx, heightPx }) => (
            <RowDropZone
              heightPx={heightPx}
              key={`row-gap:${toRowIndex}`}
              toRowIndex={toRowIndex}
              topPx={topPx}
            />
          ))}
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
                      importProgress={
                        imageImportProgress?.componentId === component.id
                          ? imageImportProgress.progress
                          : undefined
                      }
                      onCaptureImage={onCaptureImage}
                      onCancelCapture={onCancelCapture}
                      captureStatus={
                        screenCaptureState?.componentId === component.id
                          ? screenCaptureState.status
                          : undefined
                      }
                      onAddImage={onAddImage}
                      onOpenImage={onOpenImage}
                      onSelectImage={selectImage}
                      selectedImageIds={selectedImageIds}
                      onRemoveImage={onRemoveImage}
                      onSetDescription={onSetDescription}
                      onToggleCaptions={onToggleCaptions}
                      onSetImageCaption={onSetImageCaption}
                      onSetImageHeight={onSetImageHeight}
                      onAddImages={onAddImages}
                      onSetImageCrop={onSetImageCrop}
                      onPreviewImageCrop={previewImageCrop}
                      onCancelImageCropPreview={cancelImageCropPreview}
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
