import { describe, expect, it } from "vitest";
import { applyOrganizationCommand, emptyOrganization, matchingNameRanges, projectMatchesQuery, WorkspaceOrganizationError } from "./organization";
import { readWorkspaceMetadata, upgradeWorkspaceMetadata } from "./metadata";

describe("project organization", () => {
  it("migrates legacy registries without changing project records", () => {
    const legacy = { schemaVersion: 1, projects: [] };
    expect(upgradeWorkspaceMetadata(readWorkspaceMetadata(legacy))).toEqual({ schemaVersion: 2, projects: [], ...emptyOrganization() });
    expect(legacy).toEqual({ schemaVersion: 1, projects: [] });
  });

  it("moves projects atomically, opens the destination and returns deleted-group members to default", () => {
    const original = emptyOrganization();
    const created = applyOrganizationCommand(original, [], { type: "create", groupId: "portraits", name: "  人像  " });
    const collapsed = applyOrganizationCommand(created, [], { type: "collapse", groupId: "portraits", collapsed: true });
    const moved = applyOrganizationCommand(collapsed, ["p1", "p2"], { type: "move", projectId: "p1", groupId: "portraits" });
    expect(moved.groups[1]).toEqual({ id: "portraits", name: "人像", collapsed: false });
    expect(moved.projectGroupIds).toEqual({ p1: "portraits" });
    expect(applyOrganizationCommand(moved, ["p1", "p2"], { type: "delete", groupId: "portraits" })).toEqual(original);
    expect(original).toEqual(emptyOrganization());
  });

  it("protects default, rejects duplicate/reserved names and stale targets", () => {
    const base = emptyOrganization();
    for (const name of ["", "  ", "DEFAULT", "默认分组"]) {
      expect(() => applyOrganizationCommand(base, [], { type: "create", groupId: "a", name })).toThrow(WorkspaceOrganizationError);
    }
    const created = applyOrganizationCommand(base, [], { type: "create", groupId: "a", name: "Café" });
    expect(() => applyOrganizationCommand(created, [], { type: "create", groupId: "b", name: "CAFE\u0301" })).toThrow(/duplicate/);
    expect(() => applyOrganizationCommand(base, [], { type: "delete", groupId: "default" })).toThrow(/protected/);
    expect(() => applyOrganizationCommand(base, [], { type: "rename", groupId: "default", name: "new" })).toThrow(/protected/);
    expect(() => applyOrganizationCommand(base, [], { type: "move", projectId: "missing", groupId: "default" })).toThrow(/projectMissing/);
    expect(() => applyOrganizationCommand(base, ["p"], { type: "move", projectId: "p", groupId: "missing" })).toThrow(/groupMissing/);
  });

  it("rejects corrupt v2 organization instead of silently restoring default", () => {
    const base = { schemaVersion: 2, projects: [], ...emptyOrganization() };
    for (const invalid of [
      { ...base, groups: [] }, { ...base, groups: [...base.groups, ...base.groups] },
      { ...base, projectGroupIds: { missing: "default" } },
      { ...base, groups: [{ id: "default", name: "默认分组", collapsed: false }] },
    ]) expect(() => readWorkspaceMetadata(invalid)).toThrow();
    expect(readWorkspaceMetadata(base)).toEqual(base);
  });

  it("matches literal complete substrings and highlights Unicode without rewriting names", () => {
    expect(projectMatchesQuery("南京大桥夜景", " 南京 ")).toBe(true);
    expect(projectMatchesQuery("Portrait NIGHT", "night")).toBe(true);
    expect(projectMatchesQuery("南京大桥", "南京 桥")).toBe(false);
    expect(projectMatchesQuery("南京", ".*")).toBe(false);
    expect(projectMatchesQuery("Cafe\u0301 sunset", "CAFÉ")).toBe(true);
    expect(matchingNameRanges("Cafe\u0301 sunset", "CAFÉ")).toEqual([[0, 5]]);
    expect(matchingNameRanges("南京 · 南京", "南京")).toEqual([[0, 2], [5, 7]]);
    expect(matchingNameRanges("👩‍👩", "👩")).toEqual([[0, 5]]);
    expect(projectMatchesQuery("anything", "  ")).toBe(true);
  });
});
