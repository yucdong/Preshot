import { describe, expect, it } from "vitest";
import type { ProjectPlan } from "./models";
import { nextComponentName, renameComponent, setPlanTitle } from "./naming";

const plan: ProjectPlan = {
  schemaVersion: 6,
  title: "Editorial",
  components: [
    { id: "p1", name: "文案1", type: "plan", width: 0.5, contentScale: 1, html: "" },
    {
      id: "r1",
      name: "图片组1",
      type: "reference",
      width: 0.4,
      contentScale: 1,
      description: "",
      showDescription: true,
      showCaptions: true,
      imageHeight: 135,
      images: [{ id: "i1", file: "references/0001.png", aspectRatio: 2 }],
    },
  ],
};

describe("canvas naming", () => {
  it("chooses the next localized name for a component type", () => {
    expect(nextComponentName(plan, "plan")).toBe("文案2");
    expect(nextComponentName(plan, "reference")).toBe("图片组2");
  });

  it("reuses the smallest free positive suffix for generated names", () => {
    const namesWithGaps: ProjectPlan = {
      ...plan,
      components: [
        { ...plan.components[0], name: "文案1" },
        { ...plan.components[0], id: "p3", name: "文案3" },
        { ...plan.components[1], name: "图片组1" },
        { ...plan.components[1], id: "r3", name: "图片组3" },
      ],
    };

    expect(nextComponentName(namesWithGaps, "plan")).toBe("文案2");
    expect(nextComponentName(namesWithGaps, "reference")).toBe("图片组2");
  });

  it("rejects empty and duplicate component names after trimming", () => {
    expect(renameComponent(plan, "p1", "   ")).toEqual({ ok: false, reason: "empty" });
    expect(renameComponent(plan, "p1", " 图片组1 ")).toEqual({
      ok: false,
      reason: "duplicate",
    });
  });

  it("updates a component name and document title using trimmed values", () => {
    expect(renameComponent(plan, "p1", " 拍摄文案 ")).toEqual({
      ok: true,
      plan: {
        ...plan,
        components: [{ ...plan.components[0], name: "拍摄文案" }, plan.components[1]],
      },
    });
    expect(setPlanTitle(plan, "  夏日编辑  ")).toEqual({
      ok: true,
      plan: { ...plan, title: "夏日编辑" },
    });
    expect(setPlanTitle(plan, " ")).toEqual({ ok: false, reason: "empty" });
  });
});
