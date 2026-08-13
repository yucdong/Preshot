import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

interface PaginationPluginState {
  decorations: DecorationSet;
}

interface PaginationLayout {
  decorations: DecorationSet;
}

export interface DocumentPaginationOptions {
  pageHeight: number;
  pageMargin: number;
  titleHeight: number;
  pageGap: number;
  scale: number;
}

const paginationPluginKey = new PluginKey<PaginationPluginState>("documentPagination");

export function createDocumentPaginationExtension() {
  return Extension.create({
    name: "documentPagination",
    addProseMirrorPlugins() {
      return [new Plugin<PaginationPluginState>({
        key: paginationPluginKey,
        state: {
          init: () => ({ decorations: DecorationSet.empty }),
          apply(transaction, previous) {
            const layout = transaction.getMeta(paginationPluginKey) as PaginationLayout | undefined;
            if (layout) return { decorations: layout.decorations };
            if (!transaction.docChanged) return previous;
            return { decorations: previous.decorations.map(transaction.mapping, transaction.doc) };
          },
        },
        props: {
          decorations(state) {
            return paginationPluginKey.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
      })];
    },
  });
}

function setDecorations(editor: Editor, decorations: DecorationSet): void {
  editor.view.dispatch(editor.state.tr.setMeta(paginationPluginKey, { decorations }));
}

function spacerDecoration(position: number, height: number): Decoration {
  return Decoration.widget(position, () => {
    const spacer = document.createElement("div");
    spacer.className = "preshot-document-page-spacer";
    spacer.contentEditable = "false";
    spacer.style.height = `${height}px`;
    return spacer;
  }, { side: -1 });
}

interface NaturalBlockMetric {
  top: number;
  height: number;
}

interface NaturalMetricCache {
  nodeTypes: string[];
  metrics: NaturalBlockMetric[];
}

const naturalMetricCache = new WeakMap<Editor, NaturalMetricCache>();

function naturalBlockMetrics(
  editorDom: HTMLElement,
  scale: number,
  initialOffset: number,
): NaturalBlockMetric[] {
  const editorRect = editorDom.getBoundingClientRect();
  const metrics: NaturalBlockMetric[] = [];
  let previousAdjustment = 0;
  for (const child of Array.from(editorDom.children) as HTMLElement[]) {
    const rect = child.getBoundingClientRect();
    if (child.classList.contains("preshot-document-page-spacer")) {
      previousAdjustment += rect.height / scale;
      continue;
    }
    const fitScale = Math.max(0.05, Number(child.dataset.preshotPageFit ?? "1") || 1);
    const visualHeight = rect.height / scale;
    const naturalHeight = visualHeight / fitScale;
    metrics.push({
      top: initialOffset + (rect.top - editorRect.top) / scale - previousAdjustment,
      height: naturalHeight,
    });
    previousAdjustment -= naturalHeight * (1 - fitScale);
  }
  return metrics;
}

function stableNaturalBlockMetrics(
  editor: Editor,
  measuredMetrics: NaturalBlockMetric[],
): NaturalBlockMetric[] {
  const nodeTypes: string[] = [];
  editor.state.doc.forEach((node) => nodeTypes.push(node.type.name));
  const cached = naturalMetricCache.get(editor);
  const sameStructure = cached?.metrics.length === measuredMetrics.length &&
    cached.nodeTypes.every((nodeType, index) => nodeType === nodeTypes[index]);
  if (!cached || !sameStructure) {
    naturalMetricCache.set(editor, { nodeTypes, metrics: measuredMetrics });
    return measuredMetrics;
  }

  let heightAdjustment = 0;
  const metrics = measuredMetrics.map((metric, index) => {
    const previous = cached.metrics[index];
    const stableMetric = {
      top: previous.top + heightAdjustment,
      height: metric.height,
    };
    heightAdjustment += metric.height - previous.height;
    return stableMetric;
  });
  naturalMetricCache.set(editor, { nodeTypes, metrics });
  return metrics;
}

export function paginateDocument(
  editor: Editor,
  options: DocumentPaginationOptions,
  onComplete: (pageCount: number) => void,
): () => void {
  let cancelled = false;
  const timer = window.setTimeout(() => {
    if (cancelled || editor.isDestroyed) return;
    const safeScale = Number.isFinite(options.scale) && options.scale > 0 ? options.scale : 1;
    const pageHeight = options.pageHeight;
    const pageMargin = options.pageMargin;
    const pageGap = options.pageGap / safeScale;
    const contentHeight = Math.max(1, pageHeight - pageMargin * 2);
    const pageStride = pageHeight + pageGap;
    const metrics = stableNaturalBlockMetrics(
      editor,
      naturalBlockMetrics(
        editor.view.dom,
        safeScale,
        pageMargin + options.titleHeight,
      ),
    );
    const decorations: Decoration[] = [];
    let cumulativeAdjustment = 0;
    let maximumBottom = pageMargin + options.titleHeight;
    let childIndex = 0;

    editor.state.doc.forEach((node, offset) => {
      const metric = metrics[childIndex];
      childIndex += 1;
      if (!metric) return;
      const naturalHeight = Math.max(1, metric.height);
      const fitScale = Math.min(1, contentHeight / naturalHeight);
      const visualHeight = naturalHeight * fitScale;
      let blockTop = metric.top + cumulativeAdjustment;
      let pageIndex = Math.max(0, Math.floor(blockTop / pageStride));
      let contentStart = pageIndex * pageStride + pageMargin;
      let contentEnd = pageIndex * pageStride + pageHeight - pageMargin;
      let spacer = 0;

      if (blockTop < contentStart) {
        spacer += contentStart - blockTop;
        blockTop = contentStart;
      }
      if (blockTop + visualHeight > contentEnd + 0.5) {
        pageIndex += 1;
        contentStart = pageIndex * pageStride + pageMargin;
        contentEnd = pageIndex * pageStride + pageHeight - pageMargin;
        spacer += contentStart - blockTop;
        blockTop = contentStart;
      }

      if (spacer > 0.5) decorations.push(spacerDecoration(offset, spacer));
      if (fitScale < 0.999) {
        decorations.push(Decoration.node(offset, offset + node.nodeSize, {
          class: "preshot-document-page-fitted",
          "data-preshot-page-fit": String(fitScale),
          style: `transform:scale(${fitScale});transform-origin:left top;width:${100 / fitScale}%;margin-bottom:${-naturalHeight * (1 - fitScale)}px`,
        }));
      }
      cumulativeAdjustment += spacer - naturalHeight * (1 - fitScale);
      maximumBottom = Math.max(maximumBottom, blockTop + visualHeight);
    });

    if (cancelled || editor.isDestroyed) return;
    setDecorations(editor, DecorationSet.create(editor.state.doc, decorations));
    const pageCount = Math.max(1, Math.ceil((maximumBottom + pageMargin) / pageStride));
    onComplete(pageCount);
  }, 0);
  return () => {
    cancelled = true;
    window.clearTimeout(timer);
  };
}
