import { ui } from "../../../../shared/i18n/ui";
import { closeHistory } from "prosemirror-history";
import { Step, StepMap, StepResult } from "prosemirror-transform";
import type { PreshotBlockNoteEditor } from "../preshotBlockNoteSchema";
import type { ExternalImageHistoryEntry } from "../MaterialEditorBridge";
import { IMAGE_CLIPBOARD_HISTORY_CHANGE } from "./imageClipboardDom";

type ImageHistoryDirection = "record" | "undo" | "redo";
type ProseMirrorNode = Parameters<Step["apply"]>[0];
type Transaction = PreshotBlockNoteEditor["prosemirrorView"]["state"]["tr"];

// The closures are memory-only, owned by this editor's bounded history.
// Applying/mapping a speculative transaction must never modify a sidecar.
export class ExternalImageHistoryStep extends Step {
  constructor(readonly entry: ExternalImageHistoryEntry, readonly direction: ImageHistoryDirection) {
    super();
  }

  apply(doc: ProseMirrorNode) {
    return StepResult.ok(doc);
  }

  getMap() {
    return StepMap.empty;
  }

  invert() {
    return new ExternalImageHistoryStep(this.entry, this.direction === "undo" ? "redo" : "undo");
  }

  map() {
    return this;
  }

  toJSON(): never {
    throw new Error(ui("图片粘贴历史仅限当前编辑器使用，不能序列化。"));
  }
}

export function attachExternalImageHistory(editor: PreshotBlockNoteEditor) {
  const accepted = new WeakSet<Transaction>();
  let disposed = false;
  const onTransaction = ({ transaction, appendedTransactions }: {
    transaction: Transaction; appendedTransactions: Transaction[];
  }) => {
    const transactions = [transaction, ...appendedTransactions];
    if (transactions.some((tr) => tr.steps.some((step) => step instanceof ExternalImageHistoryStep)) &&
      transactions.every((tr) => tr.before.eq(tr.doc))) {
      transaction.setMeta("preventUpdate", true);
    }
    const historyChanged = transactions.some((tr) => !accepted.has(tr) && tr.steps.length > 0);
    try {
      for (const tr of transactions) {
        if (accepted.has(tr)) continue;
        accepted.add(tr);
        for (const step of tr.steps) {
          if (!(step instanceof ExternalImageHistoryStep) || step.direction === "record") continue;
          step.entry[step.direction]();
        }
      }
    } finally {
      if (historyChanged) {
        editor.domElement?.dispatchEvent(new Event(IMAGE_CLIPBOARD_HISTORY_CHANGE, { bubbles: true }));
      }
    }
  };
  // Pinned Tiptap emits this only after filterTransaction accepts the transaction
  // and view.updateState commits it, including any accepted appended transactions.
  editor._tiptapEditor.on("transaction", onTransaction);
  return {
    recordExternalHistory(entry: ExternalImageHistoryEntry) {
      if (disposed || editor.prosemirrorView.isDestroyed) throw new Error(ui("当前图片粘贴历史已结束。"));
      const view = editor.prosemirrorView;
      const tr = closeHistory(view.state.tr).step(new ExternalImageHistoryStep(entry, "record"));
      view.dispatch(tr);
      if (!accepted.has(tr)) throw new Error(ui("编辑器拒绝了图片粘贴历史，请重新选择目标后重试。"));
      view.dispatch(closeHistory(view.state.tr));
    },
    dispose() {
      disposed = true;
      editor._tiptapEditor.off("transaction", onTransaction);
    },
  };
}
