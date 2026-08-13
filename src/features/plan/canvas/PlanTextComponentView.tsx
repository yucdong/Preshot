import { Columns2, Rows2, X } from "lucide-react";
import { useCallback, useEffect, useState, type MutableRefObject, type Ref } from "react";
import { useTranslation } from "react-i18next";
import type {
  PlanTextComponent,
  PlanTextLeaf,
  PlanTextNode,
} from "../../../domain/plan/canvas/models";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { RichTextEditor } from "../RichTextEditor";
import { useNaturalHeight } from "./useNaturalHeight";
import {
  usePlanContentMeasurement,
  type PlanMeasurement,
} from "./usePlanContentMeasurement";

interface PlanTextComponentViewProps {
  component: PlanTextComponent;
  onChangeHtml: (componentId: string, leafId: string, html: string) => void;
  imageSrc?: (file: string) => string | undefined;
  onInsertImage?: () => Promise<{
    file: string;
    dataUrl: string;
    alt?: string;
    width?: number;
    height?: number;
  } | null>;
  onSplitLeaf?: (
    componentId: string,
    leafId: string,
    direction: "columns" | "rows",
  ) => void;
  onRemoveLeaf?: (componentId: string, leafId: string) => void;
  onUndo?: () => void;
  onMeasure?: (id: string, measurement: PlanMeasurement) => void;
  scale: number;
}

function toolbarRows(node: PlanTextNode): number {
  if (node.kind === "leaf") return 1;
  const first = toolbarRows(node.children[0]);
  const second = toolbarRows(node.children[1]);
  return node.direction === "columns" ? Math.max(first, second) : first + second;
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

interface TextLeafEditorProps {
  componentId: string;
  leaf: PlanTextLeaf;
  onChangeHtml: PlanTextComponentViewProps["onChangeHtml"];
  onSplitLeaf?: PlanTextComponentViewProps["onSplitLeaf"];
  onRemoveLeaf?: PlanTextComponentViewProps["onRemoveLeaf"];
  canRemove: boolean;
  onBlockHtmlChange?: (sourceHtml: string, blocks: string[]) => void;
  imageSrc?: PlanTextComponentViewProps["imageSrc"];
  onInsertImage?: PlanTextComponentViewProps["onInsertImage"];
}

function TextLeafEditor({
  componentId,
  leaf,
  onChangeHtml,
  onSplitLeaf,
  onRemoveLeaf,
  canRemove,
  onBlockHtmlChange,
  imageSrc,
  onInsertImage,
}: TextLeafEditorProps) {
  const { t } = useTranslation();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <>
      <section
        className="text-leaf group/leaf relative min-h-0 min-w-0 max-w-full overflow-x-clip overflow-y-visible border border-paper-border bg-white focus-within:border-paper-primary"
        data-text-leaf-id={leaf.id}
      >
        <div className="absolute right-1 top-10 z-40 flex gap-1 opacity-0 transition-opacity group-hover/leaf:opacity-100 group-focus-within/leaf:opacity-100">
          <button
            aria-label="左右拆分当前文案"
            className="grid h-6 w-6 place-items-center rounded border border-paper-border bg-white text-paper-muted shadow-sm hover:border-paper-primary hover:text-paper-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-primary"
            onClick={() => onSplitLeaf?.(componentId, leaf.id, "columns")}
            title="左右拆分"
            type="button"
          >
            <Columns2 aria-hidden className="h-3.5 w-3.5" />
          </button>
          <button
            aria-label="上下拆分当前文案"
            className="grid h-6 w-6 place-items-center rounded border border-paper-border bg-white text-paper-muted shadow-sm hover:border-paper-primary hover:text-paper-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-primary"
            onClick={() => onSplitLeaf?.(componentId, leaf.id, "rows")}
            title="上下拆分"
            type="button"
          >
            <Rows2 aria-hidden className="h-3.5 w-3.5" />
          </button>
          {canRemove ? (
            <button
              aria-label="删除当前子文案"
              className="grid h-5 w-5 place-items-center self-center rounded border border-paper-border bg-white text-paper-danger shadow-sm hover:bg-paper-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-danger"
              onClick={() => setConfirmingDelete(true)}
              title="删除并合并剩余文案"
              type="button"
            >
              <X aria-hidden className="h-3 w-3" />
            </button>
          ) : null}
        </div>
        <RichTextEditor
          ariaLabel={t("canvas.textLeaf")}
          html={leaf.html}
          onBlockHtmlChange={onBlockHtmlChange}
          onChange={(html) => onChangeHtml(componentId, leaf.id, html)}
          onInsertImage={onInsertImage}
          resolveImageSrc={imageSrc}
        />
      </section>
      <ConfirmDialog
        cancelLabel={t("common.cancel")}
        confirmLabel={t("common.delete")}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => {
          setConfirmingDelete(false);
          onRemoveLeaf?.(componentId, leaf.id);
        }}
        open={confirmingDelete}
        title={t("canvas.deleteTextLeafConfirmTitle")}
      />
    </>
  );
}

function TextNodeView({
  node,
  ...props
}: Omit<TextLeafEditorProps, "leaf"> & { node: PlanTextNode }) {
  if (node.kind === "leaf") {
    return <TextLeafEditor {...props} key={node.id} leaf={node} />;
  }
  return (
    <div
      className="grid h-full min-h-0 min-w-0 max-w-full items-stretch overflow-x-clip overflow-y-visible"
      data-text-split-id={node.id}
      style={{
        gap: `${node.gap}px`,
        gridTemplateColumns: node.direction === "columns" ? "minmax(0,1fr) minmax(0,1fr)" : undefined,
        gridTemplateRows: node.direction === "rows" ? "auto auto" : undefined,
      }}
    >
      <TextNodeView {...props} node={node.children[0]} />
      <TextNodeView {...props} node={node.children[1]} />
    </div>
  );
}

export function PlanTextComponentView({
  component,
  onChangeHtml,
  imageSrc,
  onInsertImage,
  onSplitLeaf,
  onRemoveLeaf,
  onUndo,
  onMeasure,
  scale,
}: PlanTextComponentViewProps) {
  const { t } = useTranslation();
  const contentScale = component.contentScale ?? 1;
  const [screenHeightPoints, setScreenHeightPoints] = useState(0);
  const [blockContent, setBlockContent] = useState<{
    sourceHtml: string;
    blocks: string[];
  } | null>(null);
  const [measurement, setMeasurement] = useState<PlanMeasurement | null>(null);
  const [showDeleteUndo, setShowDeleteUndo] = useState(false);
  const naturalHeightRef = useNaturalHeight({
    id: component.id,
    scale,
    contentKey: blockContent
      ? `${blockContent.sourceHtml}:${blockContent.blocks.length}`
      : "pending",
    onHeight: (_id, heightPoints) => {
      setScreenHeightPoints((current) =>
        Math.abs(current - heightPoints) < 1 ? current : heightPoints,
      );
    },
  });
  const toolbarHeightPoints = toolbarRows(component.textRoot) * 36 * contentScale / scale;
  const textHeightPoints = Math.max(0, screenHeightPoints - toolbarHeightPoints);
  const { rootRef: measurementRef } = usePlanContentMeasurement({
    componentId: component.id,
    contentKey: component.textRoot.kind === "leaf" ? component.textRoot.html : component.textRoot.id,
    scale,
    contentHeightPoints: textHeightPoints,
    onMeasure: (id, next) => {
      const withScreenHeight = { ...next, screenHeightPoints };
      setMeasurement(withScreenHeight);
      onMeasure?.(id, withScreenHeight);
    },
  });

  useEffect(() => {
    if (
      !onMeasure ||
      !measurement ||
      !blockContent ||
      component.textRoot.kind !== "leaf" ||
      blockContent.sourceHtml !== component.textRoot.html ||
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
  }, [blockContent, component.id, component.textRoot, measurement, onMeasure]);
  useEffect(() => {
    if (!showDeleteUndo) return;
    const timeout = window.setTimeout(() => setShowDeleteUndo(false), 5_000);
    const hideOnKeyboardUndo = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        setShowDeleteUndo(false);
      }
    };
    window.addEventListener("keydown", hideOnKeyboardUndo);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("keydown", hideOnKeyboardUndo);
    };
  }, [showDeleteUndo]);
  const removeLeaf = useCallback(
    (componentId: string, leafId: string) => {
      onRemoveLeaf?.(componentId, leafId);
      setShowDeleteUndo(true);
    },
    [onRemoveLeaf],
  );
  const setRootRef = useCallback(
    (node: HTMLDivElement | null) => {
      assignRef(naturalHeightRef, node);
      assignRef(measurementRef, node);
    },
    [measurementRef, naturalHeightRef],
  );

  return (
    <>
      <div className="min-w-0 max-w-full overflow-x-clip overflow-y-visible">
      <div
        className="min-w-0"
        data-screen-height-points={screenHeightPoints}
        data-text-height-points={textHeightPoints}
        data-testid="plan-text-scale"
        ref={setRootRef}
        style={{
          width: `${100 / contentScale}%`,
          zoom: contentScale,
        }}
      >
        {component.textRoot.kind === "leaf" ? (
          <TextLeafEditor
            componentId={component.id}
            key={component.textRoot.id}
            leaf={component.textRoot}
            onBlockHtmlChange={(sourceHtml, blocks) => {
              setBlockContent({ sourceHtml, blocks });
            }}
            onChangeHtml={onChangeHtml}
            imageSrc={imageSrc}
            onInsertImage={onInsertImage}
            onSplitLeaf={onSplitLeaf}
            onRemoveLeaf={removeLeaf}
            canRemove={false}
          />
        ) : (
          <TextNodeView
            componentId={component.id}
            node={component.textRoot}
            onChangeHtml={onChangeHtml}
            imageSrc={imageSrc}
            onInsertImage={onInsertImage}
            onSplitLeaf={onSplitLeaf}
            onRemoveLeaf={removeLeaf}
            canRemove
          />
        )}
        </div>
      </div>
      {showDeleteUndo ? (
        <div
          className="fixed bottom-6 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-3 rounded-md bg-[#282c31] px-3 py-2 text-xs text-white shadow-lg"
          role="status"
        >
          <span>{t("canvas.textLeafDeleted")}</span>
          <button
            className="rounded bg-paper-primary-soft px-2 py-1 font-semibold text-paper-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-primary"
            onClick={() => {
              setShowDeleteUndo(false);
              onUndo?.();
            }}
            type="button"
          >
            {t("history.undo")}
          </button>
        </div>
      ) : null}
    </>
  );
}
