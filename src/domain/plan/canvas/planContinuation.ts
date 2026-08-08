import {
  componentFrameChromeHeight,
  contentSize,
  DEFAULT_PAGE_GEOMETRY,
  EDITABLE_COMPONENT_FRAME_CHROME,
  type PageGeometry,
} from "./geometry";
import {
  MIN_COMPONENT_HEIGHT,
  type PlanComponent,
  type PlanTextComponent,
  type ProjectPlan,
} from "./models";

const FRAME_VERTICAL_INSET = 24;
const EPSILON = 0.001;

export interface PlanBlockContentMeasurement {
  html: string;
  heightPoints: number;
}

export interface PlanContinuationMeasurement {
  sourceHtml: string;
  heightPoints?: number;
  blocks: readonly PlanBlockContentMeasurement[];
}

export interface PlanContinuationOptions {
  makeId: () => string;
  measurements: ReadonlyMap<string, PlanContinuationMeasurement>;
  geometry?: PageGeometry;
}

function outerHeight(): number {
  return componentFrameChromeHeight(EDITABLE_COMPONENT_FRAME_CHROME) + FRAME_VERTICAL_INSET;
}

function continuationName(baseName: string, suffix: number, occupied: Set<string>): string {
  let candidateSuffix = suffix;
  let candidate = `${baseName} (${candidateSuffix})`;
  while (occupied.has(candidate)) {
    candidateSuffix += 1;
    candidate = `${baseName} (${candidateSuffix})`;
  }
  occupied.add(candidate);
  return candidate;
}

function normalizedBlockHeight(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function normalizeComponent(
  component: PlanTextComponent,
  measurement: PlanContinuationMeasurement,
  maximumHeight: number,
  makeId: () => string,
  occupiedNames: Set<string>,
): PlanTextComponent[] {
  if (measurement.sourceHtml !== component.html || measurement.blocks.length === 0) {
    return [component];
  }

  const blocks = measurement.blocks.map((block) => ({
    ...block,
    heightPoints: normalizedBlockHeight(block.heightPoints),
  }));
  const blockHeight = blocks.reduce((total, block) => total + block.heightPoints, 0);
  const editorOverhead = Math.max(0, (measurement.heightPoints ?? blockHeight) - blockHeight);
  const fixedHeight = outerHeight() + editorOverhead;
  const availableBlockHeight = maximumHeight - fixedHeight;

  const oversized = blocks.find((block) => block.heightPoints > availableBlockHeight + EPSILON);
  if (oversized) {
    throw new RangeError(
      `Plan component ${component.id} has a BlockNote block taller than one printable A4 page`,
    );
  }

  const naturalHeight = Math.max(MIN_COMPONENT_HEIGHT, fixedHeight + blockHeight);
  if (naturalHeight <= maximumHeight + EPSILON) {
    if (Math.abs(component.height - naturalHeight) <= EPSILON) {
      return [component];
    }
    return [{ ...component, height: naturalHeight }];
  }

  const groups: PlanBlockContentMeasurement[][] = [];
  let current: PlanBlockContentMeasurement[] = [];
  let currentHeight = 0;
  for (const block of blocks) {
    if (current.length > 0 && currentHeight + block.heightPoints > availableBlockHeight + EPSILON) {
      groups.push(current);
      current = [];
      currentHeight = 0;
    }
    current.push(block);
    currentHeight += block.heightPoints;
  }
  if (current.length > 0) {
    groups.push(current);
  }

  return groups.map((group, index) => {
    const height = Math.max(
      MIN_COMPONENT_HEIGHT,
      fixedHeight + group.reduce((total, block) => total + block.heightPoints, 0),
    );
    if (index === 0) {
      return { ...component, height, html: group.map((block) => block.html).join("") };
    }
    return {
      ...component,
      id: makeId(),
      name: continuationName(component.name, index + 1, occupiedNames),
      height,
      html: group.map((block) => block.html).join(""),
    };
  });
}

export function normalizePlanContinuations(
  plan: ProjectPlan,
  options: PlanContinuationOptions,
): ProjectPlan {
  const maximumHeight = contentSize(options.geometry ?? DEFAULT_PAGE_GEOMETRY).height;
  const occupiedNames = new Set(plan.components.map((component) => component.name));
  const components: PlanComponent[] = [];
  let changed = false;

  for (const component of plan.components) {
    if (component.type !== "plan") {
      components.push(component);
      continue;
    }
    const measurement = options.measurements.get(component.id);
    if (!measurement) {
      components.push(component);
      continue;
    }
    const normalized = normalizeComponent(
      component,
      measurement,
      maximumHeight,
      options.makeId,
      occupiedNames,
    );
    if (normalized.length !== 1 || normalized[0] !== component) {
      changed = true;
    }
    components.push(...normalized);
  }

  return changed ? { ...plan, components } : plan;
}