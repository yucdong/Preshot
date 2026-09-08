import {
  MaterialContentSaveError,
  type MaterialContentUpdate,
  type MaterialDetail,
  type MaterialEditSession,
  type MaterialMetadata,
  type MaterialPayload,
} from "../../domain/library/models";
import type { MaterialContentEditorRepository } from "../../domain/library/ports";
import { validateMaterialMetadata, validateMaterialPayload } from "../../domain/library";

type Retirement = "discarded" | "retained";

export class MaterialEditLease {
  readonly repository: MaterialContentEditorRepository;
  private pending = new Set<Promise<unknown>>();
  private saving: Promise<MaterialDetail> | null = null;
  private attempt: MaterialContentUpdate | null = null;
  private retirement: Promise<Retirement> | null = null;
  private retired = false;
  private uncertain = false;
  private saved: MaterialDetail | null = null;
  private cancelCaptures!: () => void;
  private captureCancellation = new Promise<void>((resolve) => { this.cancelCaptures = resolve; });

  constructor(
    private readonly native: MaterialContentEditorRepository,
    readonly session: MaterialEditSession,
  ) {
    const scoped = <T>(sessionId: string, operation: () => Promise<T>) =>
      sessionId === session.sessionId
        ? this.track(operation)
        : Promise.reject(new Error("不能操作其他素材的草稿"));
    this.repository = {
      beginCreate: async () => { throw new Error("单素材画布不能创建其他素材"); },
      beginEdit: async () => { throw new Error("单素材画布不能打开其他素材"); },
      loadEditImage: (id, image) => scoped(id, () => native.loadEditImage(id, image)),
      importEditImages: (id) => scoped(id, () => native.importEditImages(id)),
      captureEditImage: (id, cancellation) => scoped(id, () => this.retired
        ? Promise.resolve(null)
        : native.captureEditImage(id, Promise.race([cancellation, this.captureCancellation]))),
      cropEditImage: (id, image, bounds) => scoped(id, () => native.cropEditImage(id, image, bounds)),
      commitEdit: async () => { throw new Error("请使用画布外的“保存素材”操作"); },
      discardEdit: async () => { throw new Error("请使用画布外的“取消”操作"); },
    };
  }

  get isUncertain() { return this.uncertain; }
  get isRetired() { return this.retired; }
  get savedMaterial() { return this.saved; }

  private track<T>(operation: () => Promise<T>): Promise<T> {
    if (this.retired) return Promise.reject(new Error("素材编辑已结束"));
    const promise = Promise.resolve().then(operation);
    this.pending.add(promise);
    void promise.then(
      () => this.pending.delete(promise),
      () => this.pending.delete(promise),
    );
    return promise;
  }

  async save(payload: MaterialPayload, metadata?: MaterialMetadata): Promise<MaterialDetail> {
    if (this.saved) return this.saved;
    if (this.retired) throw new MaterialContentSaveError("素材编辑已结束", "rejected");
    if (this.saving) return this.saving;
    if (this.attempt) throw new Error("请先重试确认上一次保存结果");
    if (this.session.isNew && !metadata) {
      throw new MaterialContentSaveError("创建素材必须填写素材信息", "rejected");
    }
    const validated = validateMaterialPayload(payload);
    if (validated.kind !== this.session.material.kind) {
      throw new MaterialContentSaveError("不能更换素材类型", "rejected");
    }
    this.attempt = {
      operationId: crypto.randomUUID(), sessionId: this.session.sessionId,
      payload: structuredClone(validated),
      ...(metadata ? { metadataUpdate: {
        expectedVersion: this.session.material.metadataVersion,
        metadata: structuredClone(validateMaterialMetadata(metadata)),
      } } : {}),
    };
    return this.persistAttempt();
  }

  async retrySave(): Promise<MaterialDetail> {
    if (this.saved) return this.saved;
    if (this.saving) return this.saving;
    if (!this.attempt) throw new Error("没有需要确认的素材保存");
    return this.persistAttempt();
  }

  private persistAttempt(): Promise<MaterialDetail> {
    const input = this.attempt!;
    this.saving = (async () => {
      try {
        const result = await this.track(() => this.native.commitEdit(input));
        if (result.id !== this.session.material.id || result.kind !== input.payload.kind ||
            result.revision !== this.session.material.revision + 1) {
          throw new Error("素材保存回执与当前草稿不一致");
        }
        if (input.metadataUpdate) {
          const expected = input.metadataUpdate.metadata;
          if (result.metadataVersion !== input.metadataUpdate.expectedVersion + 1 ||
              result.name !== expected.name || result.description !== expected.description ||
              result.favorite !== expected.favorite || JSON.stringify(result.tags) !== JSON.stringify(expected.tags)) {
            throw new Error("素材信息保存回执与当前草稿不一致");
          }
        }
        this.saved = result;
        this.uncertain = false;
        this.attempt = null;
        return result;
      } catch (error) {
        this.uncertain = !(error instanceof MaterialContentSaveError && error.outcome === "rejected");
        if (!this.uncertain) this.attempt = null;
        throw error;
      } finally {
        this.saving = null;
      }
    })();
    return this.saving;
  }

  retire(): Promise<Retirement> {
    if (this.retirement) return this.retirement;
    this.retired = true;
    this.cancelCaptures();
    this.retirement = (async () => {
      await Promise.allSettled([...this.pending, ...(this.saving ? [this.saving] : [])]);
      // An unconfirmed save may already be durable. Preserve its exact retry sources.
      if (this.uncertain) return "retained";
      await this.native.discardEdit(this.session.sessionId);
      return "discarded";
    })();
    void this.retirement.catch(() => { this.retirement = null; });
    return this.retirement;
  }
}
