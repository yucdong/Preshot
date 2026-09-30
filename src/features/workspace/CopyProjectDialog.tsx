import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ProjectCopyRequest, ProjectCopyStatus } from "../../domain/workspace/projectCopy";
import { ui, useUiLanguage } from "../../shared/i18n/ui";

export interface CopyRunOptions { signal: AbortSignal; onCopying(): void }
interface Props {
  sourceName: string; sourcePath: string; sourceProjectId: string;
  defaultParentPath: string; defaultName: string; recovery?: ProjectCopyRequest;
  returnFocus?: HTMLElement;
  onClose(): void;
  onPickDirectory(path: string): Promise<string | null>;
  onCopy(input: ProjectCopyRequest, options: CopyRunOptions): Promise<void>;
  getStatus(id: string): Promise<ProjectCopyStatus | null>;
  cancelCopy(id: string): Promise<void>;
  acknowledge(id: string): Promise<void>;
}
const focusable = 'button:not(:disabled), input:not(:disabled), [tabindex="0"]';
const button = "rounded-lg border border-app-border px-4 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-primary disabled:opacity-50";
function message(error: unknown) {
  return error instanceof Error ? error.message : typeof error === "object" && error !== null && "message" in error ? String(error.message) : String(error);
}

export function CopyProjectDialog(props: Props) {
  useUiLanguage();
  const [parentPath, setParentPath] = useState(props.defaultParentPath);
  const [name, setName] = useState(props.defaultName);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [phase, setPhase] = useState("saving");
  const [progress, setProgress] = useState<ProjectCopyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frozen, setFrozen] = useState(Boolean(props.recovery));
  const surface = useRef<HTMLDivElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const intent = useRef<ProjectCopyRequest | null>(props.recovery ?? null);
  const running = useRef(false);
  const composing = useRef(false);
  const cancelled = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const callbacks = useRef(props);
  useEffect(() => { callbacks.current = props; });
  useEffect(() => {
    mounted.current = true;
    const origin = callbacks.current.returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    nameInput.current?.focus(); nameInput.current?.select();
    const keepFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !surface.current?.contains(event.target)) (surface.current?.querySelector<HTMLElement>(focusable) ?? surface.current)?.focus();
    };
    document.addEventListener("focusin", keepFocus);
    return () => {
      mounted.current = false; document.removeEventListener("focusin", keepFocus);
      // The shell loses inert in the same commit; restore only after that commit.
      queueMicrotask(() => { if (origin?.isConnected) origin.focus(); });
    };
  }, []);
  const finalPath = parentPath.trim().replace(/[\\/]+$/, "") + (parentPath.includes("\\") ? "\\" : "/") + name.trim();

  async function start() {
    if (running.current || picking || composing.current || !name.trim() || !parentPath.trim()) return;
    running.current = true; cancelled.current = false; abort.current = new AbortController();
    setBusy(true); setError(null); setProgress(null); setPhase("saving");
    const input = intent.current ?? { operationId: crypto.randomUUID(), sourcePath: props.sourcePath, sourceProjectId: props.sourceProjectId, parentPath: parentPath.trim(), name: name.trim() };
    intent.current = input; setFrozen(true);
    let polling = false;
    const timer = window.setInterval(() => {
      if (polling) return;
      polling = true;
      void callbacks.current.getStatus(input.operationId).then(value => {
        if (mounted.current && running.current && value) { setProgress(value); if (!cancelled.current) setPhase(value.phase === "copying" ? "copying" : "finishing"); }
      }).catch(() => { /* The operation result and exact-status retry surface errors. */ }).finally(() => { polling = false; });
    }, 350);
    try {
      await props.onCopy(input, { signal: abort.current.signal, onCopying: () => { if (mounted.current) setPhase("copying"); } });
      if (mounted.current) props.onClose();
    } catch (failure) {
      let known = false;
      const result = await props.getStatus(input.operationId).then(value => { known = true; return value; }).catch(() => null);
      if (mounted.current) {
        const wasCancelled = result?.phase !== "completed" && (cancelled.current || result?.phase === "cancelled");
        setError(wasCancelled ? ui("复制已取消。原项目已完成的保存不会回滚。") : message(failure));
        setFrozen(!known || result !== null && !["failed", "cancelled"].includes(result.phase));
        if (wasCancelled && known && (!result || result.phase === "cancelled")) {
          await props.acknowledge(input.operationId).catch(() => undefined);
          intent.current = null;
        }
      }
    } finally {
      window.clearInterval(timer); running.current = false; abort.current = null;
      if (mounted.current) setBusy(false);
    }
  }
  async function cancel() {
    const input = intent.current;
    if (!running.current || !input || cancelled.current) return;
    cancelled.current = true; abort.current?.abort(); setPhase("cancelling");
    try { await props.cancelCopy(input.operationId); }
    catch (failure) { cancelled.current = false; if (mounted.current) setError(ui("取消请求未确认：{{v0}}", { v0: message(failure) })); }
  }
  function change(changeValue: () => void) {
    const old = intent.current;
    if (old) void props.acknowledge(old.operationId).catch(() => undefined);
    intent.current = null; setError(null); changeValue();
  }
  function close() {
    if (running.current || picking) return;
    if (!frozen && intent.current) void props.acknowledge(intent.current.operationId).catch(() => undefined);
    props.onClose();
  }
  return createPortal(<div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/55 p-6 backdrop-blur-[2px]">
    <div ref={surface} role="dialog" aria-modal="true" aria-labelledby="copy-project-title" tabIndex={-1}
      className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-app-border bg-app-panel-strong p-6 text-app-ink shadow-[var(--app-shadow)]"
      onKeyDown={event => {
        if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); close(); }
        if (event.key === "Tab") {
          const nodes = Array.from(surface.current?.querySelectorAll<HTMLElement>(focusable) ?? []);
          const first = nodes[0], last = nodes.at(-1);
          if (event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
        }
      }}>
      <h2 id="copy-project-title" className="text-xl font-semibold">{ui("复制项目")}</h2>
      <p className="mt-3 text-sm">{ui("源项目")}：{props.sourceName}</p>
      <p className="break-all text-xs text-app-muted">{props.sourcePath}</p>
      <p className="mt-3 text-sm text-app-muted">{ui("将复制项目内容和本地图片、附件。已打开的项目会先保存；网络嵌入图片保留原网址。")}</p>
      <form className="mt-5 space-y-4" onSubmit={event => { event.preventDefault(); void start(); }}
        onCompositionStartCapture={() => { composing.current = true; }}
        onCompositionEndCapture={() => { composing.current = false; }}>
        <div>
          <label htmlFor="copy-project-parent" className="block text-sm">{ui("存放目录")}</label>
          <div className="mt-2 flex gap-2">
            <input id="copy-project-parent" value={parentPath} disabled={busy || picking || frozen} spellCheck={false}
              aria-describedby="copy-project-parent-help" className="min-w-0 flex-1 rounded-lg border border-app-border bg-app-panel px-3 py-2"
              onChange={event => change(() => setParentPath(event.target.value))} />
            <button type="button" className={button} disabled={busy || picking || frozen} onClick={() => {
              setPicking(true);
              void props.onPickDirectory(parentPath).then(path => { if (mounted.current && path !== null) change(() => setParentPath(path)); })
                .catch(failure => { if (mounted.current) setError(message(failure)); }).finally(() => { if (mounted.current) setPicking(false); });
            }}>{ui("选择目录")}</button>
          </div>
          <p id="copy-project-parent-help" className="mt-2 text-xs text-app-muted">{ui("请选择新项目文件夹所在的上级目录。")}</p>
        </div>
        <div>
          <label htmlFor="copy-project-name" className="block text-sm">{ui("新项目名称")}</label>
          <input id="copy-project-name" ref={nameInput} value={name} disabled={busy || picking || frozen}
            className="mt-2 w-full rounded-lg border border-app-border bg-app-panel px-3 py-2" onChange={event => change(() => setName(event.target.value))} />
        </div>
        <p className="break-all text-xs text-app-muted">{ui("最终路径")}：{finalPath}</p>
        {busy && <div role="status" aria-live="polite">
          <p>{phase === "saving" ? ui("正在保存原项目") : phase === "copying" ? ui("正在复制文件") : phase === "cancelling" ? ui("正在取消复制") : ui("正在完成复制")}</p>
          {progress && progress.totalBytes > 0 && <progress className="mt-2 w-full" aria-label={ui("复制文件进度")} max={progress.totalBytes} value={Math.min(progress.copiedBytes, progress.totalBytes)} />}
        </div>}
        {error && <p role="alert" className="break-words text-sm text-app-danger">{error}</p>}
        {!busy && frozen && <p className="text-xs text-app-muted">{ui("将检查上次复制结果并继续完成，不会创建第二份副本。")}</p>}
        <div className="flex justify-end gap-3">
          {busy ? <button type="button" className={button} disabled={phase === "cancelling" || phase === "finishing"} onClick={() => void cancel()}>{ui("取消复制")}</button>
            : <button type="button" className={button} disabled={picking} onClick={close}>{ui("取消")}</button>}
          <button type="submit" className={button + " bg-app-accent text-white"} disabled={busy || picking || !name.trim() || !parentPath.trim()}>{error || props.recovery ? ui("重试复制") : ui("复制项目")}</button>
        </div>
      </form>
    </div>
  </div>, document.body);
}
