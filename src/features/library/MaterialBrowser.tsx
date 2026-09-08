import { useEffect, useRef, useState, type ReactNode } from "react";
import { Box, Check, Images, LayoutGrid, MapPin, Plus, Search, Shirt, Star, Trash2, UserRound } from "lucide-react";
import type { MaterialDetail, MaterialKind, MaterialSearch } from "../../domain/library/models";
import type { MaterialLibraryRepository } from "../../domain/library/ports";
import type { MaterialBrowserInput } from "./MaterialLibraryContext";
import { LibraryDialog } from "./LibraryDialog";
import { MaterialPreview, MaterialThumbnail } from "./MaterialPreview";
import { formatMaterialBytes, libraryError, materialKindLabels, unavailableMessage, useLibraryLifetime } from "./libraryUi";
import { useMaterialDetail, useMaterialSearch } from "./useMaterialBrowserData";
import { MaterialContentEditor } from "./MaterialContentEditor";
import { MaterialEditLease } from "./materialEditLease";
import { createEmptyMaterialPayload, materialNameExists } from "../../domain/library";

async function retireClosedEditor(lease: MaterialEditLease) {
  try {
    if (await lease.retire() === "retained") {
      console.warn("Material edit draft retained because its save result is unconfirmed.");
    }
  } catch {
    console.error("Unable to clean up a retired material edit draft; its owned files were retained.");
  }
}

type Filter = MaterialKind | "all" | "favorite" | "trash";
export interface MaterialBrowserPreferences {
  query: string;
  filter: Filter;
  sort: MaterialSearch["sort"] | "auto";
  page: number;
  selectedId: string | null;
}
const materialTypes = [
  ["imageGroup", "图片组", Images],
  ["modelCard", "模特", UserRound], ["shootingLocation", "场地", MapPin],
  ["prop", "道具", Box], ["clothing", "服装", Shirt],
] as const;
const filters = [
  ["all", "全部素材", LayoutGrid], ...materialTypes,
  ["favorite", "收藏", Star], ["trash", "回收站", Trash2],
] as const;

export function MaterialBrowser({
  repository, input, initialPreferences, onPreferencesChange, onClose, renderPreview, createPreview,
}: {
  repository: MaterialLibraryRepository;
  input?: MaterialBrowserInput;
  initialPreferences: MaterialBrowserPreferences;
  onPreferencesChange(value: MaterialBrowserPreferences): void;
  onClose(): void;
  renderPreview?: (material: MaterialDetail) => ReactNode;
  createPreview?: (material: MaterialDetail) => Promise<void>;
}) {
  const [preferences, setPreferences] = useState(initialPreferences);
  const [draft, setDraft] = useState(initialPreferences.query);
  const [composing, setComposing] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [operation, setOperation] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [previewFailure, setPreviewFailure] = useState<{ id: string; message: string } | null>(null);
  const [dialog, setDialog] = useState<"create" | "delete" | "purge" | "preview" | null>(null);
  const [editing, setEditing] = useState<MaterialEditLease | null>(null);
  const editingRef = useRef<MaterialEditLease | null>(null);
  const creatingId = useRef<string | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const focusAfterPurge = useRef(false);
  const wasEditing = useRef(false);
  const focusAfterEditing = useRef(false);
  const lock = useRef(false);
  const alive = useLibraryLifetime();
  const unavailable = repository.availability === "unavailable";
  const busy = Boolean(operation);
  const queryPending = composing || draft.trim() !== preferences.query.trim();

  useEffect(() => () => {
    if (editingRef.current) void retireClosedEditor(editingRef.current);
  }, []);
  useEffect(() => {
    if (wasEditing.current && !editing) focusAfterEditing.current = true;
    wasEditing.current = editing !== null;
    if (!editing && !busy && focusAfterEditing.current) {
      searchInput.current?.focus();
      focusAfterEditing.current = false;
    }
  }, [editing, busy]);
  useEffect(() => {
    if (focusAfterPurge.current && !dialog && !busy) {
      focusAfterPurge.current = false;
      searchInput.current?.focus();
    }
  }, [dialog, busy]);
  useEffect(() => { onPreferencesChange(preferences); }, [preferences, onPreferencesChange]);
  useEffect(() => {
    if (composing) return;
    const timer = window.setTimeout(() => setPreferences((value) =>
      value.query === draft ? value : { ...value, query: draft, page: 0 }), 180);
    return () => window.clearTimeout(timer);
  }, [draft, composing]);

  const resultState = useMaterialSearch(repository, {
    query: preferences.query.trim(),
    kind: filters.some(([kind]) => kind === preferences.filter) &&
      !["all", "favorite", "trash"].includes(preferences.filter) ? preferences.filter as MaterialKind : undefined,
    favorites: preferences.filter === "favorite" || undefined,
    trash: preferences.filter === "trash",
    sort: preferences.sort === "auto" ? preferences.query.trim() ? "relevance" : "recent" : preferences.sort,
    offset: preferences.page * 50, limit: 50,
  }, refresh);
  const result = resultState.result;
  const loading = !unavailable && (!result && !resultState.error || queryPending);
  const selected = !loading && !resultState.error ? result?.items.find((item) => item.id === preferences.selectedId) ?? result?.items[0] : undefined;
  const detailState = useMaterialDetail(repository, selected, refresh);
  const detail = detailState.detail;
  const totalPages = Math.max(1, Math.ceil((result?.total ?? 0) / 50));
  const knownMissing = detailState.missing.length > 0;
  const canInsert = !unavailable && !busy && !loading && Boolean(input && detail && detail.deletedAt === null) &&
    !detailState.checking && !detailState.error && !knownMissing;

  const run = async (label: string, action: () => Promise<void>) => {
    if (lock.current || unavailable) return;
    lock.current = true;
    setOperation(label);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (failure) {
      if (alive.current) setError(libraryError(failure, label));
    } finally {
      lock.current = false;
      if (alive.current) setOperation("");
    }
  };
  const clearFilters = () => {
    setDraft("");
    setPreferences((value) => ({ ...value, query: "", filter: "all", page: 0 }));
  };
  const refreshPreview = (id: string) => {
    if (!createPreview) return;
    void run("素材已保存，正在更新预览…", async () => {
      try {
        const latest = await repository.get(id);
        if (!alive.current) return;
        await createPreview(latest);
        if (alive.current) {
          setPreviewFailure(null);
          setRefresh((value) => value + 1);
          setNotice("素材预览已更新。");
        }
      } catch (failure) {
        if (alive.current) setPreviewFailure({
          id, message: libraryError(failure, "素材已保存，但预览更新失败；请重试更新预览"),
        });
      }
    });
  };

  return <>
    <LibraryDialog title="素材库" subtitle="本机 · 跨项目。保存自己的组件，在每一个项目里重新使用。"
      className="ml-browser-dialog" busy={busy} onClose={onClose}>
      <div className="ml-search-row">
        <label className="ml-search">
          <Search size={19} aria-hidden="true" />
          <span className="ml-sr-only">搜索素材名称、标签和全部文字</span>
          <input ref={searchInput} type="search" value={draft} placeholder="搜索名称、标签或素材里的文字…"
            data-library-autofocus="" autoComplete="off" maxLength={128} disabled={busy || unavailable}
            onChange={(event) => setDraft(event.target.value)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={(event) => { setDraft(event.currentTarget.value); setComposing(false); }} />
        </label>
        <label className="ml-sort"><span className="ml-sr-only">排序方式</span>
          <select aria-label="排序方式" value={preferences.sort} disabled={busy || unavailable}
            onChange={(event) => setPreferences((value) => ({
              ...value, sort: event.target.value as MaterialBrowserPreferences["sort"], page: 0,
            }))}>
            <option value="auto">自动排序</option>
            <option value="relevance">相关度优先</option>
            <option value="recent">最近更新</option>
            <option value="name">名称排序</option>
          </select>
        </label>
        <button type="button" className="ml-primary ml-create-button"
          disabled={busy || unavailable || !repository.contentEditor}
          onClick={() => { setError(""); setDialog("create"); }}>
          <Plus size={17} aria-hidden="true" />创建素材
        </button>
      </div>
      <div className="ml-browser-body">
        <nav className="ml-type-rail" aria-label="素材类型筛选">
          {filters.map(([filter, label, Icon]) => <button key={filter} type="button"
            aria-pressed={preferences.filter === filter} disabled={busy || unavailable}
            onClick={() => setPreferences((value) => ({ ...value, filter, page: 0 }))}>
            <Icon size={18} aria-hidden="true" />{label}
          </button>)}
        </nav>
        <section className="ml-results" aria-label="素材搜索结果" aria-busy={loading}>
          {unavailable ? <div className="ml-empty"><LayoutGrid aria-hidden="true" /><h3>桌面素材库尚不可用</h3><p>{unavailableMessage}</p></div> :
            resultState.error ? <div className="ml-empty"><p className="ml-error" role="alert">{resultState.error}</p>
              <button type="button" onClick={() => setRefresh((value) => value + 1)}>重试读取素材库</button></div> :
              <>
                <p className="ml-results-count" role="status">{loading ? "正在搜索素材…" : `找到 ${result?.total ?? 0} 份素材`}</p>
                {result?.indexState === "rebuilding" && <p className="ml-banner" role="status">
                  搜索索引正在重建，全文结果可能不完整。仍可按素材名称和类型浏览。
                  <button type="button" disabled={busy} onClick={() => setRefresh((value) => value + 1)}>刷新索引状态</button>
                </p>}
                {loading ? <div className="ml-grid" aria-hidden="true">{[0, 1, 2, 3].map((key) => <div className="ml-skeleton" key={key} />)}</div> :
                  result?.items.length ? <div className="ml-grid">
                    {result.items.map((item) => <button type="button" className="ml-material-card" key={item.id}
                      aria-label={`选择素材：${item.name}`} aria-pressed={selected?.id === item.id}
                      disabled={busy}
                      onClick={() => {
                        setPreferences((value) => ({ ...value, selectedId: item.id }));
                        setError(""); setNotice("");
                      }}>
                      <MaterialThumbnail material={item} repository={repository} refresh={refresh} />
                      <span className="ml-card-copy">
                        <strong>{item.name}</strong>
                        <span className="ml-card-meta">{materialKindLabels[item.kind]} · {item.imageCount} 张图片
                          {item.favorite && <Star size={14} aria-label="已收藏" />}
                          {selected?.id === item.id && <Check size={16} aria-label="已选择" />}
                        </span>
                        <span className="ml-tags">{item.tags.map((tag) => <span key={tag}>{tag}</span>)}</span>
                      </span>
                    </button>)}
                  </div> : <div className="ml-empty">
                    <LayoutGrid size={30} aria-hidden="true" />
                    <h3>{preferences.filter === "trash" ? "回收站为空" :
                      preferences.query || preferences.filter !== "all" ? "没有找到匹配素材" : "还没有素材"}</h3>
                    <p>{preferences.query || preferences.filter !== "all" ?
                      "试试名称、标签或组件文字，或清除筛选条件。" : "在项目中打开组件的更多菜单，选择“保存到素材库”。"}</p>
                    {preferences.query || preferences.filter !== "all" ?
                      <button type="button" onClick={clearFilters}>清除筛选</button> :
                      <button type="button" onClick={onClose}>返回工作区</button>}
                  </div>}
                {!loading && <nav className="ml-pagination" aria-label="素材分页">
                  <button type="button" disabled={busy || preferences.page === 0}
                    onClick={() => setPreferences((value) => ({ ...value, page: value.page - 1 }))}>上一页</button>
                  <span>第 {preferences.page + 1} / {totalPages} 页 · 每页 50 份</span>
                  <button type="button" disabled={busy || preferences.page + 1 >= totalPages}
                    onClick={() => setPreferences((value) => ({ ...value, page: value.page + 1 }))}>下一页</button>
                </nav>}
              </>}
        </section>
        <aside className="ml-details" aria-label="所选素材详情">
          {detailState.error ? <><p className="ml-error" role="alert">{detailState.error}</p>
            <button type="button" disabled={busy} onClick={() => setRefresh((value) => value + 1)}>重试读取详情</button></> :
            detail ? <>
              <h3>{detail.name}</h3>
              <p className="ml-muted">{materialKindLabels[detail.kind]} · {detail.imageCount} 张图片 · {formatMaterialBytes(detail.byteLength)}</p>
              <div className="ml-actions" role="group" aria-label="素材操作">
                <button type="button" className="ml-primary"
                  disabled={busy || detail.deletedAt !== null || !repository.contentEditor}
                  title={!repository.contentEditor ? "当前环境不支持编辑素材内容" : undefined}
                  onClick={() => void run("正在打开素材编辑画布…", async () => {
                    const editor = repository.contentEditor;
                    if (!editor) throw new Error("当前环境不支持编辑素材内容");
                    const lease = new MaterialEditLease(editor, await editor.beginEdit(detail.id, detail.revision));
                    if (!alive.current) {
                      await retireClosedEditor(lease);
                      return;
                    }
                    editingRef.current = lease;
                    creatingId.current = null;
                    setEditing(lease);
                  })}>编辑素材</button>
                <button type="button" disabled={busy} onClick={() => setDialog("preview")}>预览</button>
              </div>
              {detail.previewPartial && <p className="ml-banner">
                缓存缩略图仅展示组件的一部分，不代表内容缺失。请打开预览查看完整内容。
              </p>}
              <MaterialPreview material={detail} renderPreview={renderPreview} />
              {detailState.checking && <p role="status">正在检查原始图片…</p>}
              {knownMissing && <div className="ml-banner ml-error" role="alert">
                <p>第 {detailState.missing.join("、")} 张原始图片不可用，暂时无法插入。请恢复素材库备份后重试；缩略图不能替代原图。</p>
                <button type="button" disabled={busy} onClick={() => setRefresh((value) => value + 1)}>重新检查图片</button>
              </div>}
              <h4>素材说明</h4><p className="ml-description">{detail.description || "暂无素材说明"}</p>
              <h4>标签</h4><div className="ml-tags">{detail.tags.length ? detail.tags.map((tag) => <span key={tag}>{tag}</span>) : <p className="ml-muted">暂无标签</p>}</div>
              <dl className="ml-detail-data">
                <div><dt>创建时间</dt><dd>{new Date(detail.createdAt).toLocaleString("zh-CN")}</dd></div>
                <div><dt>最近更新</dt><dd>{new Date(detail.updatedAt).toLocaleString("zh-CN")}</dd></div>
              </dl>
              {detail.deletedAt === null ?
                <button type="button" className="ml-danger" disabled={busy} onClick={() => setDialog("delete")}><Trash2 size={16} aria-hidden="true" />删除</button> :
                <div className="ml-actions">
                  <button type="button" disabled={busy} onClick={() => void run("正在恢复素材", async () => {
                    await repository.setDeleted(detail.id, detail.metadataVersion, false);
                    if (alive.current) { setNotice("素材已恢复。"); setRefresh((value) => value + 1); }
                  })}>恢复素材</button>
                  <button type="button" className="ml-danger" disabled={busy}
                    onClick={() => { setError(""); setDialog("purge"); }}>
                    <Trash2 size={16} aria-hidden="true" />永久删除
                  </button>
                </div>}
            </> : <p className="ml-muted" role="status">{selected ? "正在加载素材详情…" : "选择一份素材，查看完整内容。"}</p>}
        </aside>
      </div>
      <footer className="ml-footer">
        <div><p>{input ? `插入位置：${input.targetLabel}` : "管理模式 · 打开项目后可插入独立副本"}</p>
          <p className={error ? "ml-error" : "ml-muted"} role={error ? "alert" : "status"}>
            {operation || error || notice || (selected ? `已选择：${selected.name}` : "选择素材后再操作。")}
          </p>
          {previewFailure && <p className="ml-error" role="alert">{previewFailure.message}</p>}
        </div>
        <div className="ml-actions">
          {previewFailure && <button type="button" disabled={busy}
            onClick={() => refreshPreview(previewFailure.id)}>重试更新预览</button>}
          <button type="button" disabled={busy} onClick={onClose}>取消</button>
          <button type="button" className="ml-primary" disabled={!canInsert}
            onClick={() => {
              if (!canInsert || !detail || !input) return;
              void run("正在复制素材到项目…", async () => {
                await input.onInsert(detail);
                if (alive.current) onClose();
              });
            }}>插入到当前文档</button>
        </div>
      </footer>
    </LibraryDialog>
    {editing && <MaterialContentEditor lease={editing}
      checkDuplicateName={(name, excludeId) => materialNameExists(repository, name, excludeId)}
      onSaved={() => {
        setNotice("素材已更新；已插入项目的独立副本不受影响。");
      }}
      onContinue={async (saved) => {
        const editor = repository.contentEditor;
        if (!editor) throw new Error("当前环境不支持继续编辑素材");
        const next = new MaterialEditLease(editor, await editor.beginEdit(saved.id, saved.revision));
        if (!alive.current || editingRef.current !== editing) {
          await retireClosedEditor(next);
          return null;
        }
        editingRef.current = next;
        setEditing(next);
        return next;
      }}
      onClose={(saved) => {
        if (editingRef.current === editing) editingRef.current = null;
        setEditing(null);
        if (saved && creatingId.current === saved.id) {
          setDraft("");
          setPreferences((value) => ({ ...value, query: "", filter: "all", sort: "recent", page: 0, selectedId: saved.id }));
        }
        creatingId.current = null;
        setRefresh((value) => value + 1);
        if (saved) refreshPreview(saved.id);
      }} />}
    {dialog === "create" && <LibraryDialog title="创建素材" subtitle="选择素材类型，再填写信息、编辑文字和添加图片。"
      className="ml-confirm-dialog" busy={busy} onClose={() => setDialog(null)}>
      <div className="ml-confirm-body">
        <div className="ml-create-kinds">
          {materialTypes.map(([kind, label, Icon], index) => <button type="button" key={kind}
            disabled={busy} data-library-autofocus={index === 0 ? "" : undefined}
            onClick={() => void run("正在准备新素材…", async () => {
              const editor = repository.contentEditor;
              if (!editor) throw new Error("当前环境不支持创建素材");
              const session = await editor.beginCreate(createEmptyMaterialPayload(kind, `未命名${label}`));
              const lease = new MaterialEditLease(editor, session);
              if (!alive.current) {
                await retireClosedEditor(lease);
                return;
              }
              creatingId.current = session.material.id;
              editingRef.current = lease;
              setDialog(null);
              setEditing(lease);
            })}>
            <Icon size={20} aria-hidden="true" />{label}
          </button>)}
        </div>
        {error && <p className="ml-error" role="alert">{error}</p>}
        {operation && <p role="status">{operation}</p>}
      </div>
    </LibraryDialog>}
    {dialog === "preview" && detail && <LibraryDialog title="完整组件预览" subtitle={`${detail.name} · 只读，插入后仍可编辑`}
      className="ml-full-preview-dialog" onClose={() => setDialog(null)}>
      <div className="ml-full-preview-body"><MaterialPreview material={detail} renderPreview={renderPreview} /></div>
    </LibraryDialog>}
    {dialog === "delete" && detail && <LibraryDialog title="删除素材？" busy={busy}
      className="ml-confirm-dialog" onClose={() => setDialog(null)}>
      <div className="ml-confirm-body">
        <p>确定删除“{detail.name}”吗？已插入项目的独立副本不受影响，删除后仍可在回收站恢复。</p>
        {error && <p className="ml-error" role="alert">{error}</p>}
      </div>
      <footer className="ml-footer"><p role="status">{operation}</p><div className="ml-actions">
        <button type="button" data-library-autofocus="" disabled={busy} onClick={() => setDialog(null)}>取消</button>
        <button type="button" className="ml-danger" disabled={busy} onClick={() => void run("正在删除素材", async () => {
          await repository.setDeleted(detail.id, detail.metadataVersion, true);
          if (alive.current) { setDialog(null); setNotice("素材已删除，可在回收站恢复。"); setRefresh((value) => value + 1); }
        })}>确认删除</button>
      </div></footer>
    </LibraryDialog>}
    {dialog === "purge" && detail && <LibraryDialog title="永久删除素材？" busy={busy}
      className="ml-confirm-dialog" onClose={() => setDialog(null)}>
      <div className="ml-confirm-body">
        <p>将永久删除“{detail.name}”及其在素材库中保存的文字和图片。此操作无法恢复。</p>
        <p>已插入项目的独立副本不受影响。</p>
        {error && <p className="ml-error" role="alert">{error}</p>}
      </div>
      <footer className="ml-footer"><p role="status">{operation}</p><div className="ml-actions">
        <button type="button" data-library-autofocus="" disabled={busy} onClick={() => setDialog(null)}>取消</button>
        <button type="button" className="ml-danger" disabled={busy} onClick={() => void run("正在永久删除素材", async () => {
          await repository.purge(detail.id, detail.metadataVersion);
          if (alive.current) {
            focusAfterPurge.current = true;
            setDialog(null);
            setNotice("素材已永久删除。");
            setPreferences((value) => ({
              ...value, selectedId: null,
              page: result?.items.length === 1 ? Math.max(0, value.page - 1) : value.page,
            }));
            setRefresh((value) => value + 1);
          }
        })}>确认永久删除</button>
      </div></footer>
    </LibraryDialog>}
  </>;
}
