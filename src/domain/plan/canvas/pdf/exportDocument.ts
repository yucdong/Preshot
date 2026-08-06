import { layoutPlan, type LayoutMeasurements, type LayoutResult } from "../engine";
import { effectiveImageAspectRatio } from "../crop";
import {
  componentFrameChromeHeight,
  DEFAULT_PAGE_GEOMETRY,
  EDITABLE_COMPONENT_FRAME_CHROME,
  type PageGeometry,
} from "../geometry";
import { DOCUMENT_TITLE_HEIGHT, type PlanComponent } from "../models";

export type CanvasLayout = LayoutResult;

export const PDF_COMPONENT_FRAME_CHROME = EDITABLE_COMPONENT_FRAME_CHROME;

function documentTitleComponentId(components: PlanComponent[]): string {
  const componentIds = new Set(components.map((component) => component.id));
  let id = "__pdf_document_title__";
  while (componentIds.has(id)) {
    id = `_${id}`;
  }
  return id;
}

function exportComponents(
  components: PlanComponent[],
  titleComponentId: string,
): PlanComponent[] {
  const titleComponent: PlanComponent[] = [{
    id: titleComponentId,
    rowId: `row:${titleComponentId}`,
    name: "",
    type: "plan",
    width: 1,
    html: "",
  }];

  return [
    ...titleComponent,
    ...components.map((component) => {
      if (component.type !== "reference") {
        return component;
      }

      return {
        ...component,
        showCaptions: component.images.some((image) => Boolean(image.caption?.trim())),
        images: component.images.map((image) => ({
          ...image,
          aspectRatio: effectiveImageAspectRatio(image),
        })),
      };
    }),
  ];
}

export function buildCanvasLayout(
  components: PlanComponent[],
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
    DOCUMENT_TITLE_HEIGHT - componentFrameChromeHeight(PDF_COMPONENT_FRAME_CHROME),
  );

  const layout = layoutPlan(exportComponents(components, titleComponentId), geometry, exportMeasurements, {
    frameChrome: PDF_COMPONENT_FRAME_CHROME,
    includeReferenceAddTile: false,
  });
  return {
    ...layout,
    placements: layout.placements.filter(
      (placement) => placement.componentId !== titleComponentId,
    ),
  };
}
