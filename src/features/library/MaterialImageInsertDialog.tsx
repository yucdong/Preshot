import { useEffect, useMemo, useState } from "react";
import type { MaterialDetail, MaterialImageSelection, PortableImage } from "../../domain/library/models";
import type { MaterialLibraryRepository } from "../../domain/library/ports";
import { LibraryDialog } from "./LibraryDialog";

async function thumbnail(url: string): Promise<string> {
  if (url.length > 24 * 1024 * 1024) throw new Error("图片数据无效");
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
  if (!match) throw new Error("图片数据无效");
  const encoded = atob(match[2]);
  if (encoded.length > 16 * 1024 * 1024) throw new Error("图片数据过大");
  const bytes = new Uint8Array(encoded.length);
  for (let index = 0; index < bytes.length; index++) bytes[index] = encoded.charCodeAt(index);
  // Decode locally; data-URL fetches are disallowed by the desktop CSP.
  const bitmap = await createImageBitmap(new Blob([bytes], { type: match[1] }));
  try {
    const scale = Math.min(1, 240 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法生成图片预览");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally { bitmap.close(); }
}

export function MaterialImageInsertDialog({ material, repository, busy, error, unavailableImageIds = [], intoCurrentGroup = false, onClose, onInsert }: {
  material: MaterialDetail;
  repository: MaterialLibraryRepository;
  busy: boolean;
  error: string;
  intoCurrentGroup?: boolean;
  unavailableImageIds?: readonly string[];
  onClose(): void;
  onInsert(selection: MaterialImageSelection): void;
}) {
  const images = useMemo<PortableImage[]>(() => material.payload.component.kind === "imageGroup"
    ? material.payload.component.images : [], [material.payload]);
  const [selected, setSelected] = useState(() => new Set(images.map((image) => image.localImageId)));
  const [mode, setMode] = useState<MaterialImageSelection["mode"]>("imageGroup");
  const [previews, setPreviews] = useState<Record<string, string | null>>({});
  const [retry, setRetry] = useState(0);
  const selectedUnavailable = unavailableImageIds.some((id) => selected.has(id));
  useEffect(() => {
    let current = true;
    let next = 0;
    const load = async () => {
      while (current && next < images.length) {
        const id = images[next++].localImageId;
        let preview: string | null = null;
        try { preview = await thumbnail(await repository.loadImage(material.id, material.revision, id)); }
        catch { /* Keep the tile selectable so the user can retry a transient preview failure. */ }
        if (current) setPreviews((values) => ({ ...values, [id]: preview }));
      }
    };
    // Retain only small thumbnails, never an entire group's original data URLs.
    void Promise.all([load(), load()]);
    return () => { current = false; };
  }, [repository, material.id, material.revision, images, retry]);
  return <LibraryDialog title="插入图片组素材" subtitle={`「${material.name}」· 按素材中的原顺序插入`}
    className="ml-image-insert-dialog" busy={busy} onClose={onClose}>
    <div className="ml-image-insert-body">
      {!intoCurrentGroup && <fieldset disabled={busy} className="ml-image-insert-mode">
        <legend>插入形式</legend>
        <label><input type="radio" name="image-insert-mode" value="imageGroup" checked={mode === "imageGroup"}
          onChange={() => setMode("imageGroup")} />图片组</label>
        <label><input type="radio" name="image-insert-mode" value="images" checked={mode === "images"}
          onChange={() => setMode("images")} />独立图片</label>
      </fieldset>}
      <p className="ml-muted">{intoCurrentGroup ? "所选图片追加到当前图片组，保留当前组名和已有图片。" : mode === "imageGroup" ? "所选图片放入一个新图片组，保留组名和描述。" : "每张所选图片单独占一个图片块。"}</p>
      <div className="ml-actions">
        <button type="button" disabled={busy} onClick={() => setSelected(new Set(images.map((image) => image.localImageId)))}>全选</button>
        <button type="button" disabled={busy} onClick={() => setSelected(new Set())}>取消全选</button>
        <span role="status">已选 {selected.size} / {images.length} 张</span>
      </div>
      <div className="ml-image-insert-grid" role="group" aria-label="选择要插入的图片">
        {images.map((image, index) => <label key={image.localImageId} className="ml-image-insert-tile" data-selected={selected.has(image.localImageId)}>
          <input type="checkbox" checked={selected.has(image.localImageId)} disabled={busy}
            aria-label={`选择第 ${index + 1} 张图片${image.caption ? `：${image.caption}` : ""}`}
            onChange={() => setSelected((values) => {
              const next = new Set(values);
              if (next.has(image.localImageId)) next.delete(image.localImageId); else next.add(image.localImageId);
              return next;
            })} />
          {previews[image.localImageId] ? <img src={previews[image.localImageId]!} alt={image.caption || `图片 ${index + 1}`} />
            : <span className="ml-image-insert-placeholder">{previews[image.localImageId] === null ? "预览不可用" : "正在加载…"}</span>}
          <span>{index + 1}. {image.caption || "图片"}</span>
          {unavailableImageIds.includes(image.localImageId) && <span className="ml-error">原图不可用，请取消选择</span>}
        </label>)}
      </div>
      {Object.values(previews).some((value) => value === null) && <button type="button" disabled={busy} onClick={() => setRetry((value) => value + 1)}>重试图片预览</button>}
      {error && <p className="ml-error" role="alert">{error}</p>}
    </div>
    <footer className="ml-footer"><span>{selectedUnavailable ? "请取消选择不可用的图片" : selected.size ? `将插入 ${selected.size} 张图片` : "请至少选择一张图片"}</span>
      <div className="ml-actions"><button type="button" disabled={busy} onClick={onClose}>取消</button>
        <button type="button" className="ml-primary" disabled={busy || selected.size === 0 || selectedUnavailable} onClick={() => onInsert({
          mode: intoCurrentGroup ? "imageGroup" : mode, imageIds: images.filter((image) => selected.has(image.localImageId)).map((image) => image.localImageId),
        })}>{busy ? "正在插入…" : "确认插入"}</button>
      </div>
    </footer>
  </LibraryDialog>;
}
