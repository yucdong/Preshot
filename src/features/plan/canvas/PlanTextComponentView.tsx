import { useCallback, useState, type MutableRefObject, type Ref } from "react";
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
    contentKey: component.html,
    scale,
    contentHeightPoints,
    onMeasure: onMeasure ?? (() => undefined),
  });
  const setRootRef = useCallback(
    (node: HTMLDivElement | null) => {
      assignRef(naturalHeightRef, node);
      assignRef(measurementRef, node);
    },
    [measurementRef, naturalHeightRef],
  );

  return (
    <div className="h-full overflow-auto">
      <RichTextEditor
        ariaLabel={t("plan.photographyPlan")}
        html={component.html}
        onChange={(html) => onChangeHtml(component.id, html)}
        rootRef={setRootRef}
      />
    </div>
  );
}
