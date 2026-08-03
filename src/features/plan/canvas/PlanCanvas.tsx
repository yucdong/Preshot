import { layoutPlan } from "../../../domain/plan/canvas/engine";
import { DEFAULT_PAGE_GEOMETRY } from "../../../domain/plan/canvas/geometry";
import type { PlanComponent } from "../../../domain/plan/canvas/models";
import { CanvasPage } from "./CanvasPage";
import { ComponentFrame } from "./ComponentFrame";
import { PlanTextComponentView } from "./PlanTextComponentView";
import { ReferenceComponentView } from "./ReferenceComponentView";

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
}

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
}: PlanCanvasProps) {
  // Compute layout from the engine
  const layout = layoutPlan(components, DEFAULT_PAGE_GEOMETRY);

  // Group placements by page
  const placementsByPage: Map<number, typeof layout.placements> = new Map();
  for (const placement of layout.placements) {
    const existing = placementsByPage.get(placement.pageIndex) || [];
    existing.push(placement);
    placementsByPage.set(placement.pageIndex, existing);
  }

  // Get the component by id
  const componentMap = new Map(components.map((c) => [c.id, c]));

  return (
    <div className="flex flex-col gap-4">
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
                    />
                  )}
                </ComponentFrame>
              );
            })}
          </CanvasPage>
        );
      })}
    </div>
  );
}
