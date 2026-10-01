import type { ProjectGroup, WorkspaceMetadata, WorkspaceMetadataV2, WorkspaceProjectRecord } from "./models";
import { emptyOrganization, normalizedProjectQuery } from "./organization";

function malformed(): never { throw new Error("Workspace metadata is malformed"); }
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function exact(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

export function readWorkspaceMetadata(value: unknown): WorkspaceMetadata {
  if (!object(value)) return malformed();
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2) {
    if (typeof value.schemaVersion === "number") throw new Error(`Unsupported workspace schema ${value.schemaVersion}`);
    return malformed();
  }
  if (!exact(value, value.schemaVersion === 1 ? ["schemaVersion", "projects"] : ["schemaVersion", "projects", "groups", "projectGroupIds"]) || !Array.isArray(value.projects)) return malformed();
  const projects = value.projects.map((project): WorkspaceProjectRecord => {
    if (!object(project) || !exact(project, ["projectId", "path", "name", "coverImage", "status", "createdAt", "updatedAt", "lastOpenedAt"]) ||
      ["projectId", "path", "name", "createdAt", "updatedAt", "lastOpenedAt"].some(key => typeof project[key] !== "string") ||
      !(project.coverImage === null || typeof project.coverImage === "string") || !(project.status === "available" || project.status === "unavailable")) return malformed();
    return { ...project } as unknown as WorkspaceProjectRecord;
  });
  if (value.schemaVersion === 1) return { schemaVersion: 1, projects };
  if (!Array.isArray(value.groups) || !value.groups.length || !object(value.projectGroupIds)) return malformed();
  const ids = new Set<string>();
  const names = new Set<string>(["默认分组"]);
  const groups = value.groups.map((group, index): ProjectGroup => {
    if (!object(group) || !exact(group, ["id", "name", "collapsed"]) || typeof group.id !== "string" || !group.id.trim() || typeof group.name !== "string" || !group.name.trim() || group.name !== group.name.trim() || typeof group.collapsed !== "boolean") return malformed();
    if ((index === 0 && (group.id !== "default" || group.name !== "default")) || (index > 0 && group.id === "default")) return malformed();
    const key = normalizedProjectQuery(group.name);
    if (ids.has(group.id) || names.has(key)) return malformed();
    ids.add(group.id); names.add(key);
    return { id: group.id, name: group.name, collapsed: group.collapsed };
  });
  const projectIds = new Set(projects.map(project => project.projectId));
  const mappings = Object.entries(value.projectGroupIds);
  if (mappings.some(([projectId, groupId]) => !projectIds.has(projectId) || typeof groupId !== "string" || groupId === "default" || !ids.has(groupId))) return malformed();
  return { schemaVersion: 2, projects, groups, projectGroupIds: Object.fromEntries(mappings) as Record<string, string> };
}

export function upgradeWorkspaceMetadata(metadata: WorkspaceMetadata): WorkspaceMetadataV2 {
  const copy = readWorkspaceMetadata(metadata);
  return copy.schemaVersion === 2 ? copy : { ...copy, schemaVersion: 2, ...emptyOrganization() };
}
