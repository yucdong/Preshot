import type { ProjectOrganization } from "./models";

export const DEFAULT_PROJECT_GROUP_ID = "default";

export function emptyOrganization(): ProjectOrganization {
  return { groups: [{ id: DEFAULT_PROJECT_GROUP_ID, name: "default", collapsed: false }], projectGroupIds: {} };
}

export type ProjectOrganizationCommand =
  | { type: "create"; groupId: string; name: string }
  | { type: "rename"; groupId: string; name: string }
  | { type: "delete"; groupId: string }
  | { type: "collapse"; groupId: string; collapsed: boolean }
  | { type: "move"; projectId: string; groupId: string };

export type OrganizationErrorCode = "empty" | "duplicate" | "protected" | "groupMissing" | "projectMissing" | "invalidId";
export class WorkspaceOrganizationError extends Error {
  constructor(readonly code: OrganizationErrorCode) {
    super(`Project organization: ${code}`);
  }
}

export function normalizedProjectQuery(value: string): string {
  return value.trim().normalize("NFC").toLowerCase();
}

export function projectMatchesQuery(name: string, query: string): boolean {
  return name.normalize("NFC").toLowerCase().includes(normalizedProjectQuery(query));
}

/** Map normalized search offsets back to the unchanged, user-owned name. */
export function matchingNameRanges(name: string, query: string): Array<[number, number]> {
  const needle = normalizedProjectQuery(query);
  if (!needle) return [];
  const offsets: Array<[number, number]> = [];
  let normalized = "";
  for (const { segment, index } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(name)) {
    const value = segment.normalize("NFC").toLowerCase();
    normalized += value;
    for (let i = 0; i < value.length; i += 1) offsets.push([index, index + segment.length]);
  }
  const result: Array<[number, number]> = [];
  let start = normalized.indexOf(needle);
  while (start !== -1) {
    const range: [number, number] = [offsets[start][0], offsets[start + needle.length - 1][1]];
    const previous = result.at(-1);
    // Multiple hits inside one grapheme must not duplicate the displayed name.
    if (previous && range[0] < previous[1]) previous[1] = Math.max(previous[1], range[1]);
    else result.push(range);
    start = normalized.indexOf(needle, start + needle.length);
  }
  return result;
}

export function projectGroupId(organization: ProjectOrganization, projectId: string): string {
  return Object.hasOwn(organization.projectGroupIds, projectId)
    ? organization.projectGroupIds[projectId] : DEFAULT_PROJECT_GROUP_ID;
}

export function validateGroupName(name: string, organization: ProjectOrganization, exceptId?: string): string {
  const trimmed = name.trim();
  const key = normalizedProjectQuery(trimmed);
  if (!key) throw new WorkspaceOrganizationError("empty");
  if (key === "default" || key === "默认分组" || organization.groups.some(group => group.id !== exceptId && normalizedProjectQuery(group.name) === key)) {
    throw new WorkspaceOrganizationError("duplicate");
  }
  return trimmed;
}

export function applyOrganizationCommand(
  current: ProjectOrganization, projectIds: readonly string[], command: ProjectOrganizationCommand,
): ProjectOrganization {
  const next: ProjectOrganization = { groups: current.groups.map(group => ({ ...group })), projectGroupIds: { ...current.projectGroupIds } };
  if (command.type === "create") {
    if (!command.groupId.trim() || next.groups.some(group => group.id === command.groupId)) throw new WorkspaceOrganizationError("invalidId");
    next.groups.push({ id: command.groupId, name: validateGroupName(command.name, next), collapsed: false });
    return next;
  }
  const group = next.groups.find(group => group.id === command.groupId);
  if (!group) throw new WorkspaceOrganizationError("groupMissing");
  if ((command.type === "rename" || command.type === "delete") && group.id === DEFAULT_PROJECT_GROUP_ID) throw new WorkspaceOrganizationError("protected");
  switch (command.type) {
    case "rename": group.name = validateGroupName(command.name, next, group.id); break;
    case "collapse": group.collapsed = command.collapsed; break;
    case "delete":
      next.groups = next.groups.filter(item => item.id !== group.id);
      next.projectGroupIds = Object.fromEntries(Object.entries(next.projectGroupIds).filter(([, id]) => id !== group.id));
      break;
    case "move":
      if (!projectIds.includes(command.projectId)) throw new WorkspaceOrganizationError("projectMissing");
      if (projectGroupId(next, command.projectId) === group.id) return next;
      next.projectGroupIds = Object.fromEntries(Object.entries(next.projectGroupIds).filter(([id]) => id !== command.projectId));
      if (group.id !== DEFAULT_PROJECT_GROUP_ID) Object.defineProperty(next.projectGroupIds, command.projectId, { value: group.id, enumerable: true, configurable: true, writable: true });
      group.collapsed = false;
      break;
  }
  return next;
}
