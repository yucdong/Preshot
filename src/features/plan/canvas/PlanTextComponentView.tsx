import { useCallback, useState } from "react";
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

export function PlanTextComponentView({
  component,
  onChangeHtml,
  onMeasure,
  scale,
}: PlanTextComponentViewProps) {
  const { t } = useTranslation();
  const [contentHeightPoints, setContentHeightPoints] = useState(0);
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
    scale,
    contentHeightPoints,
    onMeasure: onMeasure ?? (() => undefined),
  });
  const setRootRef = useCallback(
    (node: HTMLDivElement | null) => {
      (naturalHeightRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      (measurementRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
    },
    [measurementRef, naturalHeightRef],
  );

  return (
    <RichTextEditor
      ariaLabel={t("plan.photographyPlan")}
      html={component.html}
      onChange={(html) => onChangeHtml(component.id, html)}
      rootRef={setRootRef}
    />
  );
}
