import { describe, expect, it } from "vitest";
import { createEmptyProjectPlanV15, migrateProjectPlanV15ToV16, validateProjectPlanV15, type PreshotBlock } from "./blockDocument";

const paragraph = (id: string): PreshotBlock => ({ id, type: "paragraph", props: {}, content: [], children: [] });
const columns = (count: number): PreshotBlock => ({
  id: "row", type: "columnList", props: {}, content: undefined,
  children: Array.from({ length: count }, (_, i) => ({
    id: `column-${i}`, type: "column", props: { width: 1 }, content: undefined,
    children: [paragraph(`text-${i}`)],
  })),
});
const plan = () => createEmptyProjectPlanV15("Columns", { makeId: () => "start" });

describe("multi-column document contract", () => {
  it("migrates a v15 document without changing its content and rejects disguised legacy columns", () => {
    const current = plan();
    const legacy = { ...current, schemaVersion: 15, document: { ...current.document, version: 3 } };
    expect(migrateProjectPlanV15ToV16(legacy)).toEqual(current);
    expect(() => migrateProjectPlanV15ToV16({ ...legacy, document: { ...legacy.document, blocks: [columns(2)] } })).toThrow();
  });
  it("uses a new schema and accepts arbitrary sibling counts", () => {
    for (const count of [2, 3, 4, 12, 32, 80]) {
      const value = plan(); value.document.blocks = [columns(count)];
      expect(value.schemaVersion).toBe(16);
      expect(value.document.version).toBe(4);
      expect(validateProjectPlanV15(value)).toEqual(value);
    }
  });
  it("accepts uniquely owned groups and artifacts directly in columns", () => {
    const value = plan(); const row = columns(2);
    row.children[0].children = [{ id: "group-block", type: "imageGroup", props: { groupId: "gallery" }, content: undefined, children: [] }];
    row.children[1].children = [{ id: "prop-block", type: "prop", props: { artifactId: "prop" }, content: undefined, children: [] }];
    value.document.blocks = [row];
    value.imageGroups = [{ id: "gallery", type: "reference", name: "Photos", description: "", x: 0, width: 1008, height: 320, images: [] }];
    value.artifacts = [{ id: "prop", kind: "prop", revision: 0, title: "Umbrella", source: "", gallery: { id: "prop-gallery", images: [] } }];
    expect(validateProjectPlanV15(value)).toEqual(value);
    row.children[1].children.push({ ...row.children[0].children[0], id: "duplicate" });
    expect(() => validateProjectPlanV15(value)).toThrow(/references image group.*2 times/i);
  });
  it("rejects orphan columns, malformed rows, invalid weights and nested rows", () => {
    const value = plan();
    for (const weight of [0, -1, NaN, Infinity]) {
      const row = columns(2); row.children[0].props.width = weight;
      value.document.blocks = [row]; expect(() => validateProjectPlanV15(value)).toThrow();
    }
    for (const blocks of [[columns(1)], [columns(2).children[0]], [{ ...columns(2), children: [paragraph("a"), paragraph("b")] }]]) {
      value.document.blocks = blocks; expect(() => validateProjectPlanV15(value)).toThrow();
    }
    const row = columns(2); row.children[0].children = [{ ...columns(2), id: "nested" }];
    value.document.blocks = [row]; expect(() => validateProjectPlanV15(value)).toThrow();
  });
});
