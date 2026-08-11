import type {
  PlanTextComponent,
  PlanTextLeaf,
  PlanTextNode,
  ProjectPlan,
} from "./models";
import type { Rect } from "./geometry";

export const DEFAULT_TEXT_SPLIT_GAP = 10;
export const MIN_TEXT_LEAF_WIDTH = 132;
export const MIN_TEXT_LEAF_HEIGHT = 64;

export function textTreeMinimumWidth(node: PlanTextNode): number {
  if (node.kind === "leaf") return MIN_TEXT_LEAF_WIDTH;
  const first = textTreeMinimumWidth(node.children[0]);
  const second = textTreeMinimumWidth(node.children[1]);
  return node.direction === "columns"
    ? first + node.gap + second
    : Math.max(first, second);
}

function mapTextNode(
  node: PlanTextNode,
  id: string,
  transform: (node: PlanTextNode) => PlanTextNode,
): PlanTextNode {
  if (node.id === id) {
    return transform(node);
  }
  if (node.kind === "leaf") {
    return node;
  }
  const first = mapTextNode(node.children[0], id, transform);
  const second = mapTextNode(node.children[1], id, transform);
  return first === node.children[0] && second === node.children[1]
    ? node
    : { ...node, children: [first, second] };
}

function mapPlanTextComponent(
  plan: ProjectPlan,
  componentId: string,
  transform: (component: PlanTextComponent) => PlanTextComponent,
): ProjectPlan {
  let changed = false;
  const components = plan.components.map((component) => {
    if (component.id !== componentId || component.type !== "plan") return component;
    const next = transform(component);
    changed ||= next !== component;
    return next;
  });
  return changed ? { ...plan, components } : plan;
}

export function textLeaves(node: PlanTextNode): PlanTextLeaf[] {
  return node.kind === "leaf"
    ? [node]
    : [...textLeaves(node.children[0]), ...textLeaves(node.children[1])];
}

export function textNodeById(node: PlanTextNode, id: string): PlanTextNode | null {
  if (node.id === id) return node;
  if (node.kind === "leaf") return null;
  return textNodeById(node.children[0], id) ?? textNodeById(node.children[1], id);
}

export function splitTextLeaf(
  plan: ProjectPlan,
  params: {
    componentId: string;
    leafId: string;
    splitId: string;
    secondLeafId: string;
    direction: "columns" | "rows";
  },
): ProjectPlan {
  return mapPlanTextComponent(plan, params.componentId, (component) => {
    const textRoot = mapTextNode(component.textRoot, params.leafId, (node) =>
      node.kind !== "leaf"
        ? node
        : {
            kind: "split",
            id: params.splitId,
            direction: params.direction,
            gap: DEFAULT_TEXT_SPLIT_GAP,
            children: [
              node,
              { kind: "leaf", id: params.secondLeafId, html: "" },
            ],
          },
    );
    return textRoot === component.textRoot ? component : { ...component, textRoot };
  });
}

export function updateTextLeafHtml(
  plan: ProjectPlan,
  params: { componentId: string; leafId: string; html: string },
): ProjectPlan {
  return mapPlanTextComponent(plan, params.componentId, (component) => {
    const textRoot = mapTextNode(component.textRoot, params.leafId, (node) =>
      node.kind === "leaf" && node.html !== params.html
        ? { ...node, html: params.html }
        : node,
    );
    return textRoot === component.textRoot ? component : { ...component, textRoot };
  });
}

export function switchTextSplitDirection(
  plan: ProjectPlan,
  params: {
    componentId: string;
    splitId: string;
    direction: "columns" | "rows";
  },
): ProjectPlan {
  return mapPlanTextComponent(plan, params.componentId, (component) => {
    const textRoot = mapTextNode(component.textRoot, params.splitId, (node) =>
      node.kind === "split" && node.direction !== params.direction
        ? { ...node, direction: params.direction }
        : node,
    );
    return textRoot === component.textRoot ? component : { ...component, textRoot };
  });
}

export function firstTextLeaf(node: PlanTextNode): PlanTextLeaf {
  return node.kind === "leaf" ? node : firstTextLeaf(node.children[0]);
}

export function textTreeHtml(node: PlanTextNode): string {
  return textLeaves(node)
    .map((leaf) => leaf.html)
    .join("");
}

export function mergeTextTreeContent(
  target: PlanTextNode,
  current: PlanTextNode,
): PlanTextNode {
  const currentLeaves = new Map(textLeaves(current).map((leaf) => [leaf.id, leaf]));
  const merge = (node: PlanTextNode): PlanTextNode => {
    if (node.kind === "leaf") {
      const existing = currentLeaves.get(node.id);
      return existing ? { ...node, html: existing.html } : node;
    }
    return { ...node, children: [merge(node.children[0]), merge(node.children[1])] };
  };
  return merge(target);
}

export interface TextLeafPlacement {
  leaf: PlanTextLeaf;
  rect: Rect;
}

export function layoutTextTree(node: PlanTextNode, rect: Rect): TextLeafPlacement[] {
  if (node.kind === "leaf") return [{ leaf: node, rect }];
  if (node.direction === "columns") {
    const width = Math.max(0, (rect.width - node.gap) / 2);
    return [
      ...layoutTextTree(node.children[0], { ...rect, width }),
      ...layoutTextTree(node.children[1], {
        ...rect,
        x: rect.x + width + node.gap,
        width,
      }),
    ];
  }
  const height = Math.max(0, (rect.height - node.gap) / 2);
  return [
    ...layoutTextTree(node.children[0], {
      ...rect,
      y: rect.y + height + node.gap,
      height,
    }),
    ...layoutTextTree(node.children[1], { ...rect, height }),
  ];
}

function removeLeafFromNode(node: PlanTextNode, leafId: string): PlanTextNode {
  if (node.kind === "leaf") return node;
  if (node.children[0].id === leafId && node.children[0].kind === "leaf") {
    return node.children[1];
  }
  if (node.children[1].id === leafId && node.children[1].kind === "leaf") {
    return node.children[0];
  }
  const first = removeLeafFromNode(node.children[0], leafId);
  const second = removeLeafFromNode(node.children[1], leafId);
  return first === node.children[0] && second === node.children[1]
    ? node
    : { ...node, children: [first, second] };
}

export function removeTextLeaf(
  plan: ProjectPlan,
  params: { componentId: string; leafId: string },
): ProjectPlan {
  return mapPlanTextComponent(plan, params.componentId, (component) => {
    if (component.textRoot.kind === "leaf") return component;
    const textRoot = removeLeafFromNode(component.textRoot, params.leafId);
    return textRoot === component.textRoot ? component : { ...component, textRoot };
  });
}