import type { NativeProjectCopy, PendingProjectCopy, ProjectCopyRequest, ProjectCopyStatus } from "../../domain/workspace/projectCopy";
import type { InspectedProject } from "../../domain/workspace/models";

export function createNativeProjectCopy(
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>,
  inspect: (value: unknown) => InspectedProject,
): NativeProjectCopy {
  function status(value: unknown): ProjectCopyStatus {
    const v = value as Partial<ProjectCopyStatus> | null;
    if (!v || typeof v.operationId !== "string" || !["copying", "finishing", "completed", "failed", "cancelled"].includes(v.phase ?? "") ||
      typeof v.copiedBytes !== "number" || !Number.isFinite(v.copiedBytes) || v.copiedBytes < 0 ||
      typeof v.totalBytes !== "number" || !Number.isFinite(v.totalBytes) || v.totalBytes < 0 ||
      !(v.error === null || typeof v.error === "string") || v.phase === "completed" && !v.project) throw new Error("Invalid project copy response");
    return { operationId: v.operationId, phase: v.phase!, copiedBytes: v.copiedBytes, totalBytes: v.totalBytes,
      error: v.error, project: v.project ? inspect(v.project) : null };
  }
  async function getStatus(operationId: string) {
    const value = await invoke("project_copy_status", { operationId });
    if (value === null) return null;
    const result = status(value);
    if (result.operationId !== operationId) throw new Error("Project copy response belongs to another operation");
    return result;
  }
  return {
    async suggestProjectCopy(source, baseName) {
      const value = await invoke("suggest_project_copy", { sourcePath: source.path, sourceProjectId: source.projectId, baseName });
      if (!Array.isArray(value) || value.length !== 2 || value.some(v => typeof v !== "string" || !v)) throw new Error("Invalid copy destination response");
      return { parentPath: value[0] as string, name: value[1] as string };
    },
    async copyProject(input) {
      try {
        const result = status(await invoke("copy_project", { input }));
        if (result.operationId !== input.operationId) throw new Error("Project copy response belongs to another operation");
        return result;
      } catch (error) {
        // Never allocate a second operation when the publication response was lost.
        const recovered = await getStatus(input.operationId).catch(() => null);
        if (recovered?.phase === "completed" || recovered?.phase === "cancelled") return recovered;
        throw error;
      }
    },
    projectCopyStatus: getStatus,
    async cancelProjectCopy(operationId) { await invoke("cancel_project_copy", { operationId }); },
    async acknowledgeProjectCopy(operationId) { await invoke("acknowledge_project_copy", { operationId }); },
    async pendingProjectCopies(): Promise<PendingProjectCopy[]> {
      const values = await invoke("pending_project_copies");
      if (!Array.isArray(values)) throw new Error("Invalid pending copy response");
      return values.map(v => {
        const request = v?.request as ProjectCopyRequest | undefined;
        if (!request || [request.operationId, request.sourcePath, request.sourceProjectId, request.parentPath, request.name].some(s => typeof s !== "string" || !s)) throw new Error("Invalid pending copy request");
        const result = status(v.status);
        if (result.operationId !== request.operationId) throw new Error("Mismatched pending copy operation");
        return { request, status: result };
      });
    },
  };
}
