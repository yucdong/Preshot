import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import { I18nextProvider } from "react-i18next";
import { App } from "../../src/app/App";
import i18n from "../../src/shared/i18n/config";
import { createPlanDependencies } from "../../src/app/plan/planDependencies";
import { createMidsceneWorkspaceDependencies } from "../../src/infrastructure/workspace/midsceneWorkspace";
import type {
  MaterialDetail,
  MaterialInsertRequest,
  MaterialInsertStatus,
  MaterialMetadata,
  MaterialPayload,
} from "../../src/domain/library/models";
import type { MaterialLibraryRepository } from "../../src/domain/library/ports";
import { materialCategory, selectMaterialImages } from "../../src/domain/library";
import { componentImages } from "../../src/domain/library/materialStructure";
import { unavailableMaterialLibrary } from "../../src/infrastructure/library/unavailableMaterialLibrary";
import { createMaterialEditingFixture } from "./materialLibraryEditingHarness";
import { installImageClipboardBoundary } from "./imageClipboardBoundary";
import { installWalkthroughBoundary } from "./walkthroughBoundary";
import "../../src/styles.css";

if (import.meta.env.MODE !== "e2e") throw new Error("This fixture is only available in E2E mode");

// Only the native persistence boundary is replaced. The app, editor, dialogs,
// read-only component preview and thumbnail capture are the production modules.
const planDependencies = createPlanDependencies();
if (new URLSearchParams(location.search).has("clipboard")) installImageClipboardBoundary(planDependencies);
const copiedImages = new Map<string, string>();
const baseService = planDependencies.service;
planDependencies.service = { ...baseService,
  loadMedia: async (project, file) => copiedImages.get(`${project}/${file}`) ?? baseService.loadMedia(project, file),
  loadImage: async (project, file) => copiedImages.get(`${project}/${file}`) ?? baseService.loadImage(project, file),
};
let copySequence = 0;
const workspaceDependencies = createMidsceneWorkspaceDependencies();
const materials = new Map<string, MaterialDetail>();
const previews = new Map<string, string>();
const operations = new Map<string, { input: MaterialInsertRequest; status: MaterialInsertStatus; copies: string[] }>();
const seed: MaterialDetail = {
  id: "9bcd08d4-05e8-4b70-ad27-ac8da95752e4",
  kind: "prop", name: "逆光玻璃杯", description: "暖色桌面静物拍摄",
  tags: ["静物", "玻璃"], favorite: false,
  revision: 1, metadataVersion: 1, createdAt: 1, updatedAt: 1, deletedAt: null,
  imageCount: 0, byteLength: 0, previewState: "pending",
  payload: {
    format: "preshot-material", version: 1, kind: "prop",
    component: { kind: "prop", title: "透明玻璃杯", source: "自备，适合逆光拍摄", gallery: { images: [] } },
  },
  images: [],
};
const requestedKind = new URLSearchParams(location.search).get("materialKind");
let variant: MaterialPayload["component"] | undefined;
if (requestedKind === "imageGroup") variant = { kind: "imageGroup", name: "窗边光线", description: "柔和的午后自然光", images: [] };
if (requestedKind === "modelCard") variant = { kind: "modelCard", modelId: "示例模特", heightCm: 170, weightKg: 55, shoeSize: "38", notes: "自然风格，暖色造型", samples: { images: [] } };
if (requestedKind === "shootingLocation") variant = { kind: "shootingLocation", venueName: "窗边影棚", address: "示例地址", description: "下午自然光", gallery: { images: [] } };
if (requestedKind === "clothing") variant = { kind: "clothing", title: "米色外套", source: "自备造型", mainGallery: { images: [] } };
if (variant) {
  seed.kind = variant.kind;
  seed.name = (variant.kind === "image" || variant.kind === "imageGroup") ? variant.name :
    variant.kind === "modelCard" ? variant.modelId :
      variant.kind === "shootingLocation" ? variant.venueName : variant.title;
  seed.description = "完整组件编辑演示";
  seed.tags = [];
  seed.payload = { format: "preshot-material", version: 1, kind: variant.kind, component: variant };
}
materials.set(seed.id, seed);

function get(id: string): MaterialDetail {
  const value = materials.get(id);
  if (!value) throw new Error("素材不存在");
  return value;
}
function update(id: string, version: number, fields: Partial<MaterialMetadata> & { deletedAt?: number | null }) {
  const previous = get(id);
  if (previous.metadataVersion !== version) throw new Error("素材已变化");
  const next = { ...previous, ...fields, metadataVersion: version + 1, updatedAt: Date.now() };
  materials.set(id, next);
  return structuredClone(next);
}
async function checkPlan(input: MaterialInsertRequest) {
  const result = await planDependencies.service.loadPlan(input.projectPath, input.expectedPlan.title);
  if (result.status === "incompatible" || JSON.stringify(result.plan) !== JSON.stringify(input.expectedPlan)) {
    throw new Error("目标方案已变化");
  }
}
const repository: MaterialLibraryRepository = {
  ...unavailableMaterialLibrary,
  ...createMaterialEditingFixture(materials, previews),
  availability: "test",
  async search(input) {
    const chunks = input.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const items = [...materials.values()].filter((item) =>
      Boolean(item.deletedAt) === Boolean(input.trash) &&
      (!input.kind || materialCategory(item.kind) === input.kind) &&
      (!input.imagesOnly || item.kind === "image" || item.kind === "imageGroup") &&
      (input.exactName === undefined || item.name.normalize("NFC").trim() === input.exactName.normalize("NFC").trim()) &&
      (!input.favorites || item.favorite) &&
      chunks.every((chunk) => JSON.stringify(item).toLowerCase().includes(chunk)))
      .sort((left, right) => input.sort === "name" ? left.name.localeCompare(right.name) :
        right.updatedAt - left.updatedAt || left.id.localeCompare(right.id));
    return { items: structuredClone(items.slice(input.offset, input.offset + input.limit)), total: items.length, indexState: "ready" };
  },
  async get(id) { return structuredClone(get(id)); },
  async save(input) {
    if (input.snapshot.sources.length) throw new Error("此浏览器边界夹具仅支持无图片素材；图片复制由原生测试覆盖");
    const item: MaterialDetail = {
      ...seed, ...input.metadata, id: input.operationId,
      kind: input.snapshot.payload.kind, payload: structuredClone(input.snapshot.payload),
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    materials.set(item.id, item);
    return structuredClone(item);
  },
  async updateMetadata(id, version, metadata) { return update(id, version, metadata); },
  async setDeleted(id, version, deleted) { return update(id, version, { deletedAt: deleted ? Date.now() : null }); },
  async purge(id, version) {
    const item = get(id);
    if (item.metadataVersion !== version) throw new Error("素材已变化，请刷新后重试");
    if (item.deletedAt === null) throw new Error("只能永久删除回收站中的素材");
    materials.delete(id);
    previews.delete(id);
  },
  async loadPreview(id) { return previews.get(id) ?? null; },
  async savePreview(id, _revision, preview) {
    const blob = new Blob([new Uint8Array(preview.bytes)], { type: "image/png" });
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => typeof reader.result === "string"
        ? resolve(reader.result) : reject(new Error("Invalid fixture preview"));
      reader.readAsDataURL(blob);
    });
    previews.set(id, url);
    materials.set(id, { ...get(id), previewState: "ready", previewPartial: preview.isPartial });
  },
  async markPreviewFailed(id) { materials.set(id, { ...get(id), previewState: "failed" }); },
  async prepareInsert(input) {
    await checkPlan(input);
    const item = get(input.materialId);
    if (item.deletedAt || item.revision !== input.revision) throw new Error("素材已变化");
    const payload = selectMaterialImages(item.payload, input.selection);
    const images = [];
    const copies: string[] = [];
    operations.set(input.operationId, { input, status: "prepared", copies });
    for (const image of componentImages(payload.component)) {
      const directory = !input.targetGroupId && (item.kind === "image" || input.selection?.mode === "images") ? "media" : "references";
      const file = `${directory}/${String(++copySequence).padStart(4, "0")}.png`;
      const key = `${input.projectPath}/${file}`;
      copiedImages.set(key, await repository.loadImage(item.id, item.revision, image.localImageId));
      copies.push(key);
      images.push({ localImageId: image.localImageId, file });
    }
    return { operationId: input.operationId, materialId: item.id, revision: item.revision, payload, images,
      ...(input.targetGroupId ? { targetGroupId: input.targetGroupId } : {}),
      ...(input.selection ? { selection: input.selection } : {}) };
  },
  async commitInsert(input) {
    const operation = operations.get(input.operationId);
    if (!operation || operation.status !== "prepared") throw new Error("无效插入操作");
    await checkPlan(operation.input);
    await planDependencies.service.savePlan(input.projectPath, input.nextPlan);
    operation.status = "committed";
  },
  async abortInsert(_path, id) {
    const operation = operations.get(id);
    if (operation?.status === "committed") throw new Error("不能撤销已提交操作");
    if (operation) { operation.copies.forEach((key) => copiedImages.delete(key)); operation.status = "cancelled"; }
  },
  async getInsertStatus(_path, id) {
    const operation = operations.get(id);
    if (!operation) throw new Error("插入操作不存在");
    return operation.status;
  },
};

if (new URLSearchParams(location.search).has("revealOriginal")) {
  repository.revealImageGroup = async (id, revision) => {
    const item = get(id);
    if (item.kind !== "imageGroup" || item.revision !== revision) throw new Error("素材版本已变化");
    window.dispatchEvent(new CustomEvent("fixture-original-revealed", { detail: { id, revision } }));
  };
  repository.contentEditor!.revealEditImageGroup = async (sessionId) => {
    window.dispatchEvent(new CustomEvent("fixture-original-revealed", { detail: { sessionId } }));
  };
  repository.revealImage = async (id, revision, localImageId) => {
    await repository.loadImage(id, revision, localImageId);
    window.dispatchEvent(new CustomEvent("fixture-original-revealed", { detail: { id, revision, localImageId } }));
  };
  repository.contentEditor!.revealEditImage = async (sessionId, localImageId) => {
    await repository.contentEditor!.loadEditImage(sessionId, localImageId);
    window.dispatchEvent(new CustomEvent("fixture-original-revealed", { detail: { sessionId, localImageId } }));
  };
}

if (new URLSearchParams(location.search).has("walkthrough")) {
  materials.clear();
  installWalkthroughBoundary(repository);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <App dependencies={workspaceDependencies} materialLibraryRepository={repository} planDependencies={planDependencies} />
    </I18nextProvider>
  </StrictMode>,
);
