import { describe, expect, it } from "vitest";
import { contentSize, DEFAULT_PAGE_GEOMETRY } from "./geometry";
import type { PlanTextComponent, ProjectPlan } from "./models";
import { normalizePlanContinuations } from "./planContinuation";
import { splitTextLeaf } from "./textTree";

const content = contentSize(DEFAULT_PAGE_GEOMETRY);

function component(html: string): PlanTextComponent {
  return {
    id: "plan",
    name: "文案1",
    type: "plan",
    x: 0,
    width: content.width,
    height: 220,
    textRoot: { kind: "leaf", id: "plan:root", html },
  };
}

function plan(html: string): ProjectPlan {
  return { schemaVersion: 10, title: "Demo", components: [component(html)] };
}

describe("normalizePlanContinuations", () => {
  it("splits at rich-text top-level block boundaries into persisted components", () => {
    const blocks = Array.from({ length: 6 }, (_, index) => ({
      html: `<p>Block ${index + 1}</p>`,
      heightPoints: 180,
    }));
    const original = plan(blocks.map((block) => block.html).join(""));
    let id = 1;
    const normalized = normalizePlanContinuations(original, {
      makeId: () => `continuation-${id++}`,
      measurements: new Map([["plan", {
        sourceHtml: original.components[0].type === "plan" && original.components[0].textRoot.kind === "leaf"
          ? original.components[0].textRoot.html
          : "",
        blocks,
      }]]),
    });
    const components = normalized.components as PlanTextComponent[];

    expect(components).toHaveLength(2);
    expect(components.map((entry) => entry.name)).toEqual(["文案1", "文案1 (2)"]);
    expect(components[1].id).toBe("continuation-1");
    expect(components.map((entry) => entry.textRoot.kind === "leaf" ? entry.textRoot.html : "").join("")).toBe(
      blocks.map((block) => block.html).join(""),
    );
    expect(components.every((entry) => entry.height <= content.height)).toBe(true);
  });

  it("grows a fitting text component and ignores stale measurements", () => {
    const original = plan("<p>Current</p>");
    const fitting = normalizePlanContinuations(original, {
      makeId: () => "unused",
      measurements: new Map([["plan", {
        sourceHtml: "<p>Current</p>",
        blocks: [{ html: "<p>Current</p>", heightPoints: 300 }],
      }]]),
    });
    expect(fitting.components[0].height).toBeGreaterThan(220);

    expect(normalizePlanContinuations(fitting, {
      makeId: () => "unused",
      measurements: new Map([["plan", {
        sourceHtml: "<p>Stale</p>",
        blocks: [{ html: "<p>Stale</p>", heightPoints: 700 }],
      }]]),
    })).toBe(fitting);
  });

  it("shrinks to natural text height and grows again when list wrapping increases", () => {
    const html = "<ol><li>Item</li></ol>";
    const oversized = {
      ...plan(html),
      components: [{ ...component(html), height: content.height }],
    };
    const compact = normalizePlanContinuations(oversized, {
      makeId: () => "unused",
      measurements: new Map([["plan", {
        sourceHtml: html,
        heightPoints: 44,
        blocks: [{ html, heightPoints: 32 }],
      }]]),
    });

    expect(compact.components[0].height).toBeLessThan(oversized.components[0].height);

    const wrapped = normalizePlanContinuations(compact, {
      makeId: () => "unused",
      measurements: new Map([["plan", {
        sourceHtml: html,
        heightPoints: 184,
        blocks: [{ html, heightPoints: 172 }],
      }]]),
    });

    expect(wrapped.components[0].height).toBeGreaterThan(compact.components[0].height);
    expect(wrapped.components[0].height).toBeLessThanOrEqual(content.height);
  });

  it("rejects one indivisible block taller than the printable component body", () => {
    const original = plan("<p>Too tall</p>");
    expect(() => normalizePlanContinuations(original, {
      makeId: () => "unused",
      measurements: new Map([["plan", {
        sourceHtml: "<p>Too tall</p>",
        blocks: [{ html: "<p>Too tall</p>", heightPoints: content.height }],
      }]]),
    })).toThrow(/block.*taller/i);
  });

  it("grows a recursive split component to its measured natural content height", () => {
    const split = splitTextLeaf(plan("<p>Left</p>"), {
      componentId: "plan",
      leafId: "plan:root",
      splitId: "split",
      secondLeafId: "right",
      direction: "columns",
    });
    const normalized = normalizePlanContinuations(split, {
      makeId: () => "unused",
      measurements: new Map([["plan", {
        sourceHtml: "",
        heightPoints: 360,
        blocks: [],
      }]]),
    });

    expect(normalized.components[0].height).toBeGreaterThan(360);
  });

  it("adds only compact plan padding to measured content height", () => {
    const original = plan("<p>Compact</p>");
    const normalized = normalizePlanContinuations(original, {
      makeId: () => "unused",
      measurements: new Map([["plan", {
        sourceHtml: "<p>Compact</p>",
        heightPoints: 100,
        blocks: [{ html: "<p>Compact</p>", heightPoints: 100 }],
      }]]),
    });

    expect(normalized.components[0].height).toBe(112);
  });

  it("keeps screen-only editor chrome out of persisted document height", () => {
    const original = plan("<p>Toolbar content</p>");
    const normalized = normalizePlanContinuations(original, {
      makeId: () => "unused",
      measurements: new Map([["plan", {
        sourceHtml: "",
        heightPoints: 100,
        screenHeightPoints: 136,
        blocks: [],
      }]]),
    });

    expect(normalized.components[0].height).toBe(220);
  });
});