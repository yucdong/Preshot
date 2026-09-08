import {
  insertMaterialIntoPlan,
  instantiateMaterial,
} from "../../../domain/library";
import type {
  MaterialInsertRequest,
  PreparedMaterialInsert,
} from "../../../domain/library/models";
import type { MaterialLibraryRepository } from "../../../domain/library/ports";
import type { ProjectPlanV15 } from "../../../domain/plan/canvas/blockDocument";

export class MaterialInsertionRecoveryError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "MaterialInsertionRecoveryError";
  }
}

interface InsertionContext {
  repository: MaterialLibraryRepository;
  input: MaterialInsertRequest;
  afterBlockId: string | null;
  makeId(): string;
  isCurrent(): boolean;
  preparePublication?(plan: ProjectPlanV15): Promise<void>;
  publish(plan: ProjectPlanV15, insertedBlockId: string): void;
}

export async function insertLibraryMaterial({
  repository,
  input,
  afterBlockId,
  makeId,
  isCurrent,
  preparePublication,
  publish,
}: InsertionContext): Promise<void> {
  const requireCurrent = () => {
    if (!isCurrent()) throw new Error("目标项目或方案已变化，请重新选择素材插入位置。");
  };
  const abortPrepared = async (cause: unknown) => {
    try {
      await repository.abortInsert(input.projectPath, input.operationId);
    } catch (cleanupError) {
      throw new MaterialInsertionRecoveryError(
        "素材插入未完成，临时文件需要恢复处理。请重新打开目标项目，勿重复插入。",
        new AggregateError([cause, cleanupError]),
      );
    }
  };

  requireCurrent();
  let prepared: PreparedMaterialInsert;
  try {
    prepared = await repository.prepareInsert(input);
  } catch (error) {
    await abortPrepared(error);
    throw error;
  }
  let nextPlan: ProjectPlanV15;
  let blockId: string;
  try {
    requireCurrent();
    if (
      prepared.operationId !== input.operationId ||
      prepared.materialId !== input.materialId ||
      prepared.revision !== input.revision
    ) throw new Error("素材插入准备结果与请求不一致");
    const instance = instantiateMaterial(prepared.payload, prepared.images, makeId);
    nextPlan = insertMaterialIntoPlan(input.expectedPlan, instance, afterBlockId);
    blockId = instance.block.id;
    await preparePublication?.(nextPlan);
    requireCurrent();
  } catch (error) {
    await abortPrepared(error);
    throw error;
  }

  try {
    await repository.commitInsert({
      operationId: input.operationId,
      projectId: input.projectId,
      projectPath: input.projectPath,
      expectedPlan: input.expectedPlan,
      nextPlan,
    });
  } catch (commitError) {
    let status;
    try {
      status = await repository.getInsertStatus(input.projectPath, input.operationId);
    } catch (statusError) {
      throw new MaterialInsertionRecoveryError(
        "无法确认素材是否已写入项目。请重新打开目标项目进行恢复，勿重复插入。",
        new AggregateError([commitError, statusError]),
      );
    }
    if (status === "conflict") {
      throw new MaterialInsertionRecoveryError(
        "素材插入与项目当前内容冲突，已保留恢复记录。请重新打开目标项目处理。",
        commitError,
      );
    }
    if (status === "prepared") {
      await abortPrepared(commitError);
      throw commitError;
    }
    if (status === "cancelled") throw commitError;
  }
  try {
    publish(nextPlan, blockId);
  } catch (error) {
    throw new MaterialInsertionRecoveryError(
      "素材已写入项目，但编辑器未能刷新。请重新打开项目；不要再次插入。",
      error,
    );
  }
}
