import { useCallback, useEffect, useState, type MutableRefObject, type Ref } from "react";
import { useTranslation } from "react-i18next";
import type { PlanTextComponent } from "../../../domain/plan/canvas/models";
import { RichTextEditor } from "../RichTextEditor";
import { useNaturalHeight } from "./useNaturalHeight";
import {
  usePlanContentMeasurement,
  type PlanMeasurement,
} from "./usePlanContentMeasurement";

interface PlanTextComponentViewProps {
  component: PlanTextComponent;
  onChangeHtml: (id: string, html: string) => void;
  onMeasure?: (id: string, measurement: PlanMeasurement) => void;
  scale: number;
}

function assignRef<T>(targetRef: Ref<T> | undefined, value: T): void {
  if (typeof targetRef === "function") {
    targetRef(value);
    return;
  }

  if (targetRef) {
    (targetRef as MutableRefObject<T>).current = value;
  }
}

export function PlanTextComponentView({
  component,
  onChangeHtml,
  onMeasure,
  scale,
}: PlanTextComponentViewProps) {
  const { t } = useTranslation();
  const contentScale = component.contentScale ?? 1;
  const [contentHeightPoints, setContentHeightPoints] = useState(0);
  const [blockContent, setBlockContent] = useState<{
    sourceHtml: string;
    blocks: string[];
  } | null>(null);
  const [measurement, setMeasurement] = useState<PlanMeasurement | null>(null);
  const naturalHeightRef = useNaturalHeight({
    id: component.id,
    scale,
    onHeight: (_id, heightPoints) => {
      setContentHeightPoints((current) =>
        Math.abs(current - heightPoints) < 1 ? current : heightPoints,
      );
    },
  });
  const { rootRef: measurementRef } = usePlanContentMeasurement({
    componentId: component.id,
    contentKey: component.html,
    scale,
    contentHeightPoints,
    onMeasure: (id, next) => {
      setMeasurement(next);
      onMeasure?.(id, next);
    },
  });

  useEffect(() => {
    if (
      !onMeasure ||
      !measurement ||
      !blockContent ||
      blockContent.sourceHtml !== component.html ||
      blockContent.blocks.length !== measurement.blockHeightsPoints.length
    ) {
      return;
    }
    onMeasure(component.id, {
      ...measurement,
      sourceHtml: blockContent.sourceHtml,
      blocks: blockContent.blocks.map((html, index) => ({
        html,
        heightPoints: measurement.blockHeightsPoints[index],
      })),
    });
  }, [blockContent, component.html, component.id, measurement, onMeasure]);
  const setRootRef = useCallback(
    (node: HTMLDivElement | null) => {
      assignRef(naturalHeightRef, node);
      assignRef(measurementRef, node);
    },
    [measurementRef, naturalHeightRef],
  );

  return (
    <div className="h-full overflow-hidden">
      <div
        data-testid="plan-text-scale"
        style={{
          width: `${100 / contentScale}%`,
          zoom: contentScale,
        }}
      >
        <RichTextEditor
          ariaLabel={t("plan.photographyPlan")}
          html={component.html}
          onBlockHtmlChange={(sourceHtml, blocks) => {
            setBlockContent({ sourceHtml, blocks });
          }}
          onChange={(html) => onChangeHtml(component.id, html)}
          rootRef={setRootRef}
        />
      </div>
    </div>
  );
}
