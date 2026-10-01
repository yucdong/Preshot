import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { App } from "../../src/app/App";
import { createPlanDependencies } from "../../src/app/plan/planDependencies";
import { createBlockNotePlanService } from "../../src/domain/plan/blocknote/service";
import { createEmptyProjectPlanV17, type PreshotBlock } from "../../src/domain/plan/canvas/blockDocument";
import { createMidsceneWorkspaceDependencies, MIDSCENE_PROJECT_ROOT } from "../../src/infrastructure/workspace/midsceneWorkspace";
import { browserBlockNoteImageStore, browserBlockNoteMediaStore, browserBlockNotePlanRepository } from "../../src/infrastructure/plan/browserBlockNotePlan";
import i18n from "../../src/shared/i18n/config";
import dayBridge from "../../samples/nanjing-bridge/references/0001.jpg?url";
import nightBridge from "../../samples/nanjing-bridge/references/0007.jpg?url";
import wideBridge from "../../samples/nanjing-bridge/references/0008.jpg?url";
import "../../src/styles.css";

if (import.meta.env.MODE !== "e2e") throw new Error("E2E only");

const parameters = new URLSearchParams(location.search);
const rows = parameters.get("size") === "large" ? 10 : 4;
const inColumns = parameters.has("columns");
const narrowColumns = parameters.get("columns") === "6";
const startsAfterBreak = parameters.has("pageBreak");
const dependencies = createMidsceneWorkspaceDependencies();
await dependencies.service.loadProjects();
const project = await dependencies.service.createProject(MIDSCENE_PROJECT_ROOT, "南京长江大桥 · 图片组跨页验收");
const plan = createEmptyProjectPlanV17(project.name, { makeId: () => crypto.randomUUID() });
const text = (id: string, value: string, type: "paragraph" | "heading" = "paragraph"): PreshotBlock => ({
  id, type, props: type === "heading" ? { level: 2 } : {},
  content: [{ type: "text", text: value, styles: {} }], children: [],
});
const notes = [
  "提前勘察桥下步道，确认拍摄区域通行与安全距离。",
  "日落前四十分钟到场，先拍桥梁纵深和人物环境关系。",
  "模特面向柔和侧光，肩线与桥梁结构形成呼应。",
  "使用中长焦控制透视，避免人物与背景杂物重叠。",
  "透明伞略向后倾，让眼睛保持可见并接住轮廓光。",
  "泡泡机放在上风方向，连续拍摄时保持模特眼神清晰。",
  "逆光场景优先保留天空高光，用反光板补足面部。",
  "桥面与人物分别测光，试拍后检查直方图与肤色。",
  "低机位突出结构线条，同时留意画面边缘的护栏。",
  "蓝调时刻固定白平衡，使路灯与天空形成冷暖对比。",
  "手持快门保持安全速度，必要时提高感光度。",
  "每组动作保留全景、中景、近景，并检查表情与闭眼。",
];
const gallery: PreshotBlock = { id: "pagination-gallery-block", type: "imageGroup", props: { groupId: "pagination-gallery" }, content: undefined, children: [] };
const galleryBlock: PreshotBlock = inColumns ? {
  id: "pagination-columns", type: "columnList", props: {}, content: undefined,
  children: [
    { id: "pagination-column-images", type: "column", props: { width: narrowColumns ? 1 : 3 }, content: undefined, children: [gallery] },
    { id: "pagination-column-notes", type: "column", props: { width: 1 }, content: undefined, children: [text("column-notes", "拍摄顺序：先记录环境，再捕捉人物动作。图片按编号从左到右、从上到下排列。跨页后保持这一顺序。")] },
    ...(narrowColumns ? Array.from({ length: 4 }, (_, index): PreshotBlock => ({
      id: `pagination-narrow-column-${index}`, type: "column", props: { width: 1 }, content: undefined,
      children: [text(`narrow-note-${index}`, `拍摄要点 ${index + 1}：${notes[index]}`)],
    })) : []),
  ],
} : gallery;
plan.document.blocks = [
  text("pagination-title", "南京长江大桥 · 风光人像拍摄要点", "heading"),
  ...notes.map((note, index) => text(`pagination-note-${index}`, `${index + 1}. ${note}`)),
  ...(startsAfterBreak ? [{ id: "authored-page-break", type: "pageBreak", props: {}, content: undefined, children: [] } as PreshotBlock] : []),
  galleryBlock,
  text("pagination-after", "图片组结束：确认全部样片完整呈现，再按照拍摄顺序整理设备。"),
];

// Isolate only the file-I/O boundary. Numbered views of the bundled photographs
// make omissions, repeated images and ordering errors visible in the real PDF.
const sources = await Promise.all([dayBridge, nightBridge, wideBridge].map(async url => {
  const image = new Image(); image.src = url; await image.decode(); return image;
}));
const assets = new Map<string, string>();
const images = Array.from({ length: rows * 3 }, (_, index) => {
  const number = String(index + 1).padStart(2, "0");
  const file = `references/pagination-${number}.jpg`;
  const canvas = document.createElement("canvas");
  canvas.width = 600; canvas.height = 600;
  const context = canvas.getContext("2d")!;
  const source = sources[index % sources.length];
  const side = Math.min(source.naturalWidth, source.naturalHeight);
  context.drawImage(source, (source.naturalWidth - side) / 2, (source.naturalHeight - side) / 2, side, side, 0, 0, 600, 600);
  context.fillStyle = "rgba(20, 25, 35, 0.9)"; context.fillRect(0, 0, 150, 100);
  context.fillStyle = "#ffffff"; context.font = "bold 64px sans-serif"; context.fillText(number, 24, 73);
  assets.set(file, canvas.toDataURL("image/jpeg", 0.82));
  return { id: `pagination-image-${number}`, file, aspectRatio: 1, sourceWidth: 600, sourceHeight: 600,
    frameWidth: 300, frameHeight: 300, fitMode: "cover" as const, crop: { x: 0, y: 0, width: 1, height: 1 } };
});
plan.imageGroups = [{ id: "pagination-gallery", name: "按拍摄顺序排列的桥畔样片", type: "reference", description: "跨页时继续排列，保留每张图片和每一行。", x: 0, width: 1008,
  height: 18 + rows * 300 + (rows - 1) * 7, images }];
await browserBlockNotePlanRepository.saveRawPlan(project.path, plan);
const plans = createPlanDependencies();
plans.service = createBlockNotePlanService({
  repository: browserBlockNotePlanRepository,
  imageStore: { ...browserBlockNoteImageStore, async loadImage(_path, file) {
    const asset = assets.get(file);
    if (!asset) throw new Error(`Missing pagination fixture image: ${file}`);
    return asset;
  } },
  imageCropStore: browserBlockNoteImageStore,
  mediaStore: browserBlockNoteMediaStore,
  createId: () => crypto.randomUUID(), logger: plans.logger,
});
createRoot(document.getElementById("root")!).render(<StrictMode><I18nextProvider i18n={i18n}>
  <App dependencies={dependencies} planDependencies={plans} />
</I18nextProvider></StrictMode>);
