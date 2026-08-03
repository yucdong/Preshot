import { contentSize, DEFAULT_PAGE_GEOMETRY } from "./geometry";
import {
  clampColumns,
  clampHeight,
  DEFAULT_COLUMNS,
  DEFAULT_PLAN_HEIGHT,
  DEFAULT_REFERENCE_HEIGHT,
  EMPTY_PLAN,
  WIDTH_FRACTIONS,
  type PlanComponent,
  type ProjectPlan,
  type ReferenceImage,
  type WidthFraction,
} from "./models";

const MAX_HEIGHT = contentSize(DEFAULT_PAGE_GEOMETRY).height;

type IdFactory = (prefix: string) => string;

function defaultIdFactory(): IdFactory {
  let counter = 0;
  return (prefix) => `${prefix}-${(counter += 1)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asWidthFraction(value: unknown): WidthFraction {
  return WIDTH_FRACTIONS.includes(value as WidthFraction) ? (value as WidthFraction) : "1";
}

function asHeight(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? clampHeight(value, MAX_HEIGHT) : fallback;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeImages(value: unknown): ReferenceImage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const images: ReferenceImage[] = [];
  for (const raw of value) {
    if (isRecord(raw) && typeof raw.id === "string" && typeof raw.file === "string") {
      const image: ReferenceImage = { id: raw.id, file: raw.file };
      if (typeof raw.caption === "string") {
        image.caption = raw.caption;
      }
      images.push(image);
    }
  }
  return images;
}

function normalizeComponent(raw: unknown, makeId: IdFactory): PlanComponent | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = typeof raw.id === "string" && raw.id ? raw.id : makeId("cmp");
  if (raw.type === "plan") {
    return {
      id,
      type: "plan",
      widthFraction: asWidthFraction(raw.widthFraction),
      height: asHeight(raw.height, DEFAULT_PLAN_HEIGHT),
      html: asString(raw.html),
    };
  }
  if (raw.type === "reference") {
    return {
      id,
      type: "reference",
      widthFraction: asWidthFraction(raw.widthFraction),
      height: asHeight(raw.height, DEFAULT_REFERENCE_HEIGHT),
      title: asString(raw.title),
      description: asString(raw.description),
      columnsPerRow: clampColumns(typeof raw.columnsPerRow === "number" ? raw.columnsPerRow : DEFAULT_COLUMNS),
      showCaptions: raw.showCaptions === true,
      images: normalizeImages(raw.images),
    };
  }
  return null;
}

function migrateV1(raw: Record<string, unknown>, makeId: IdFactory): ProjectPlan {
  const components: PlanComponent[] = [];
  const photographyPlan = asString(raw.photographyPlan);
  if (photographyPlan.trim()) {
    components.push({
      id: makeId("plan"),
      type: "plan",
      widthFraction: "1",
      height: DEFAULT_PLAN_HEIGHT,
      html: photographyPlan,
    });
  }
  if (Array.isArray(raw.referenceGroups)) {
    for (const group of raw.referenceGroups) {
      if (!isRecord(group)) {
        continue;
      }
      components.push({
        id: typeof group.id === "string" && group.id ? group.id : makeId("ref"),
        type: "reference",
        widthFraction: "1",
        height: DEFAULT_REFERENCE_HEIGHT,
        title: asString(group.title),
        description: asString(group.description),
        columnsPerRow: clampColumns(typeof group.columnsPerRow === "number" ? group.columnsPerRow : DEFAULT_COLUMNS),
        showCaptions: false,
        images: normalizeImages(group.images),
      });
    }
  }
  return { schemaVersion: 2, components };
}

export function migratePlan(raw: unknown, makeId: IdFactory = defaultIdFactory()): ProjectPlan {
  if (!isRecord(raw)) {
    return EMPTY_PLAN;
  }
  if (raw.schemaVersion === 2 && Array.isArray(raw.components)) {
    const components = raw.components
      .map((component) => normalizeComponent(component, makeId))
      .filter((component): component is PlanComponent => component !== null);
    return { schemaVersion: 2, components };
  }
  if (typeof raw.photographyPlan === "string" || Array.isArray(raw.referenceGroups)) {
    return migrateV1(raw, makeId);
  }
  return EMPTY_PLAN;
}
