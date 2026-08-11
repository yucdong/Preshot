import { layoutPlan, type LayoutMeasurements, type LayoutResult } from "../engine";
import {
  componentFrameChromeHeight,
  contentSize,
  DEFAULT_PAGE_GEOMETRY,
  EDITABLE_COMPONENT_FRAME_CHROME,
  PLAN_COMPONENT_FRAME_CHROME,
  type PageGeometry,
} from "../geometry";
import {
  DEFAULT_IMAGE_HEIGHT,
  DOCUMENT_TITLE_HEIGHT,
  MIN_WIDTH,
  type PlanComponent,
  type ProjectPlan,
} from "../models";
import type {
  LegacyV6PlanComponent,
  LegacyV6ProjectPlan,
} from "../legacyV6";
import { textTreeHtml } from "../textTree";

export type CanvasLayout = LayoutResult;

export const PDF_COMPONENT_FRAME_CHROME = EDITABLE_COMPONENT_FRAME_CHROME;
export const PDF_PLAN_COMPONENT_FRAME_CHROME = PLAN_COMPONENT_FRAME_CHROME;

function documentTitleComponentId(components: LegacyV6PlanComponent[]): string {
  const componentIds = new Set(components.map((component) => component.id));
  let id = "__pdf_document_title__";
  while (componentIds.has(id)) {
    id = `_${id}`;
  }
  return id;
}

function temporaryExportComponents(
  components: readonly PlanComponent[],
): LegacyV6PlanComponent[] {
  const canvasWidth = contentSize(DEFAULT_PAGE_GEOMETRY).width;
  return components.map((component) => {
    const width = Math.min(1, Math.max(MIN_WIDTH, component.width / canvasWidth));
    if (component.type === "plan") {
      return {
        id: component.id,
        name: component.name,
        type: "plan",
        width,
        layoutX: component.x,
        contentScale: component.contentScale ?? 1,
        html: textTreeHtml(component.textRoot),
      };
    }
    return {
      id: component.id,
      name: component.name,
      type: "reference",
      width,
      layoutX: component.x,
      contentScale: 1,
      description: component.description,
      showDescription: true,
      imageHeight: DEFAULT_IMAGE_HEIGHT,
      images: component.images.map((image) => ({
        id: image.id,
        file: image.file,
        aspectRatio: image.frameWidth / image.frameHeight,
        displayHeight: image.frameHeight,
      })),
    };
  });
}

/**
 * Batch 1 keeps the existing paged PDF renderer operational by translating
 * v7 cards to its former flow input. PDF placement is intentionally temporary;
 * v7 captions are preserved in storage but omitted from this adapter.
 */
export function temporaryPagedExportPlan(plan: ProjectPlan): LegacyV6ProjectPlan {
  return {
    schemaVersion: 6,
    title: plan.title,
    components: temporaryExportComponents(plan.components),
  };
}

function titleSpacer(
  components: LegacyV6PlanComponent[],
  titleComponentId: string,
): LegacyV6PlanComponent[] {
  return [
    {
      id: titleComponentId,
      name: "",
      type: "plan",
      width: 1,
      contentScale: 1,
      html: "",
    },
    ...components,
  ];
}

export function buildCanvasLayout(
  components: LegacyV6PlanComponent[],
  geometry: PageGeometry = DEFAULT_PAGE_GEOMETRY,
  measurements?: LayoutMeasurements,
  _documentTitle = "",
): CanvasLayout {
  const titleComponentId = documentTitleComponentId(components);
  const planHeights = new Map(measurements?.planHeights);
  const exportMeasurements: LayoutMeasurements = {
    planHeights,
    referenceDescriptionHeights: measurements?.referenceDescriptionHeights ?? new Map(),
  };
  planHeights.set(
    titleComponentId,
    DOCUMENT_TITLE_HEIGHT - componentFrameChromeHeight(PDF_PLAN_COMPONENT_FRAME_CHROME),
  );

  const layout = layoutPlan(
    titleSpacer(components, titleComponentId),
    geometry,
    exportMeasurements,
    {
      frameChrome: PDF_COMPONENT_FRAME_CHROME,
      planFrameChrome: PDF_PLAN_COMPONENT_FRAME_CHROME,
      includeReferenceAddTile: false,
      exclusiveRows: true,
    },
  );
  return {
    ...layout,
    placements: layout.placements.filter(
      (placement) => placement.componentId !== titleComponentId,
    ),
  };
}
