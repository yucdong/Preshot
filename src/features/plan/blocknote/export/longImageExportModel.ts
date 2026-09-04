import type {
  PreshotBlock,
  ProjectPlanV14,
} from "../../../../domain/plan/canvas/blockDocument";
import {
  createLongImageGeometry,
  type LongImageWidth,
} from "../../../../domain/plan/blocknote/longImageExportContract";
import { artifactCollectionGroups } from "../artifactCollections";

const defaultGeometry = createLongImageGeometry(900);

export const LONG_IMAGE_EXPORT_LOGICAL_WIDTH =
  defaultGeometry.editorOuterWidth;
export const LONG_IMAGE_EXPORT_DEFAULT_OUTER_WIDTH = 900;
export const LONG_IMAGE_EXPORT_LOGICAL_HORIZONTAL_PADDING =
  (defaultGeometry.editorOuterWidth - defaultGeometry.editorContentWidth) / 2;

export type LongImageExportOuterWidth = LongImageWidth;

const NATIVE_MEDIA_TYPES = new Set(["audio", "file", "image", "video"]);
const ATOMIC_BLOCK_TYPES = new Set([
  "audio",
  "codeBlock",
  "divider",
  "file",
  "image",
  "imageGroup",
  "shootingLocation",
  "modelCard",
  "clothing",
  "prop",
  "pageBreak",
  "table",
  "video",
]);

export interface LongImageExportRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

export interface LongImageExportBlockBoundary extends LongImageExportRect {
  blockId: string;
  blockType: string;
}

export interface LongImageExportRowBoundary extends LongImageExportRect {
  id: string;
  blockId: string;
  groupId: string;
  rowIndex: number;
  imageIds: readonly string[];
}

export interface LongImageExportMeasurements {
  outerWidth: number;
  contentWidth: number;
  height: number;
  scale: number;
  topLevelBlocks: LongImageExportBlockBoundary[];
  atomicBlocks: LongImageExportBlockBoundary[];
  columnRows: LongImageExportBlockBoundary[];
  imageGroupRows: LongImageExportRowBoundary[];
}

export function longImageExportScale(outerWidth: number): number {
  assertLongImageExportOuterWidth(outerWidth);
  return createLongImageGeometry(outerWidth).scale;
}

export function longImageExportContentWidth(outerWidth: number): number {
  assertLongImageExportOuterWidth(outerWidth);
  return createLongImageGeometry(outerWidth).contentWidth;
}

export function assertLongImageExportOuterWidth(
  outerWidth: number,
): asserts outerWidth is LongImageExportOuterWidth {
  try {
    createLongImageGeometry(outerWidth as LongImageWidth);
  } catch {
    throw new Error(
      `Long-image export width must be 890 or 900 pixels, received ${outerWidth}.`,
    );
  }
}

export function isLocalLongImageAsset(url: string): boolean {
  return /^(?:asset:|blob:|data:)/i.test(url);
}

function visitBlocks(
  blocks: readonly PreshotBlock[],
  visitor: (block: PreshotBlock) => void,
): void {
  blocks.forEach((block) => {
    visitor(block);
    visitBlocks(block.children, visitor);
  });
}

export function validateLongImageExportAssets(
  plan: ProjectPlanV14,
  resolvedAssets: Readonly<Record<string, string>>,
): void {
  const groupsById = new Map(
    [...plan.imageGroups, ...artifactCollectionGroups(plan)].map(
      (group) => [group.id, group],
    ),
  );
  visitBlocks(plan.document.blocks, (block) => {
    if (block.type === "imageGroup") {
      const groupId = block.props.groupId;
      const group = typeof groupId === "string"
        ? groupsById.get(groupId)
        : undefined;
      if (!group) {
        throw new Error(
          `Long-image export cannot resolve image group "${String(groupId)}".`,
        );
      }
      group.images.forEach((image) => {
        const source = resolvedAssets[image.file];
        if (!source || !isLocalLongImageAsset(source)) {
          throw new Error(
            `Long-image export requires local image data for "${image.file}".`,
          );
        }
      });
      return;
    }
    if (
      block.type === "shootingLocation" ||
      block.type === "modelCard" ||
      block.type === "clothing" ||
      block.type === "prop"
    ) {
      const artifactId = String(block.props.artifactId ?? "");
      const artifact = plan.artifacts.find((entry) => entry.id === artifactId);
      if (!artifact) {
        throw new Error(
          `Long-image export cannot resolve artifact "${artifactId}".`,
        );
      }
      artifactCollectionGroups({ artifacts: [artifact] }).forEach((group) => {
        group.images.forEach((image) => {
          const source = resolvedAssets[image.file];
          if (!source || !isLocalLongImageAsset(source)) {
            throw new Error(
              `Long-image export requires local image data for "${image.file}".`,
            );
          }
        });
      });
      return;
    }
    if (!NATIVE_MEDIA_TYPES.has(block.type)) return;
    const url = block.props.url;
    if (typeof url !== "string" || url === "") return;
    const source = resolvedAssets[url] ?? url;
    if (!isLocalLongImageAsset(source)) {
      throw new Error(
        `Long-image export requires a resolved local asset for "${url}".`,
      );
    }
  });
}

export function annotateLongImageExportBlocks(
  root: HTMLElement,
  blocks: readonly PreshotBlock[],
): void {
  const editor = root.querySelector<HTMLElement>(".bn-editor");
  if (editor) {
    editor.tabIndex = -1;
    editor.setAttribute("aria-readonly", "true");
  }
  const blockElements = new Map(
    Array.from(
      root.querySelectorAll<HTMLElement>(
        [
          '[data-node-type="blockOuter"][data-id]',
          '[data-node-type="columnList"][data-id]',
          '[data-node-type="column"][data-id]',
        ].join(","),
      ),
    ).map((element) => [element.dataset.id ?? "", element]),
  );
  const annotate = (block: PreshotBlock, topLevel: boolean) => {
    const element = blockElements.get(block.id);
    if (element) {
      element.dataset.preshotExportBlockType = block.type;
      if (topLevel) {
        element.dataset.preshotExportTopLevelBlock = block.id;
      }
      if (ATOMIC_BLOCK_TYPES.has(block.type)) {
        element.dataset.preshotExportAtomicBlock = block.id;
      }
      if (block.type === "columnList") {
        element.dataset.preshotExportColumnRow = block.id;
      }
      if (NATIVE_MEDIA_TYPES.has(block.type)) {
        const content = element.querySelector<HTMLElement>(
          `[data-content-type="${block.type}"]`,
        );
        if (content) {
          const name = typeof block.props.name === "string" && block.props.name
            ? block.props.name
            : "未命名媒体";
          content.dataset.preshotExportNativeMedia = block.type;
          content.dataset.preshotExportNativeMediaLabel =
            `${block.type.toUpperCase()} · ${name}`;
          content.querySelectorAll<HTMLMediaElement>("audio, video")
            .forEach((media) => {
              media.controls = false;
              media.removeAttribute("controls");
              media.tabIndex = -1;
            });
        }
      }
    }
    block.children.forEach((child) => annotate(child, false));
  };
  blocks.forEach((block) => annotate(block, true));
}

function rounded(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function relativeRect(
  element: HTMLElement,
  surfaceRect: DOMRect,
): LongImageExportRect {
  const rect = element.getBoundingClientRect();
  return {
    top: rounded(rect.top - surfaceRect.top),
    right: rounded(rect.right - surfaceRect.left),
    bottom: rounded(rect.bottom - surfaceRect.top),
    left: rounded(rect.left - surfaceRect.left),
    width: rounded(rect.width),
    height: rounded(rect.height),
  };
}

function blockBoundaries(
  surface: HTMLElement,
  selector: string,
): LongImageExportBlockBoundary[] {
  const surfaceRect = surface.getBoundingClientRect();
  return Array.from(surface.querySelectorAll<HTMLElement>(selector)).map(
    (element) => ({
      blockId:
        element.dataset.preshotExportTopLevelBlock ??
        element.dataset.preshotExportAtomicBlock ??
        element.dataset.preshotExportColumnRow ??
        "",
      blockType: element.dataset.preshotExportBlockType ?? "",
      ...relativeRect(element, surfaceRect),
    }),
  );
}

export function measureLongImageExportSurface(
  surface: HTMLElement,
): LongImageExportMeasurements {
  const outerWidth = Number(surface.dataset.preshotExportOuterWidth);
  assertLongImageExportOuterWidth(outerWidth);
  const surfaceRect = surface.getBoundingClientRect();
  return {
    outerWidth,
    contentWidth: longImageExportContentWidth(outerWidth),
    height: rounded(surfaceRect.height),
    scale: longImageExportScale(outerWidth),
    topLevelBlocks: blockBoundaries(
      surface,
      "[data-preshot-export-top-level-block]",
    ),
    atomicBlocks: blockBoundaries(
      surface,
      "[data-preshot-export-atomic-block]",
    ),
    columnRows: blockBoundaries(
      surface,
      "[data-preshot-export-column-row]",
    ),
    imageGroupRows: Array.from(
      surface.querySelectorAll<HTMLElement>(
        "[data-preshot-export-image-group-row]",
      ),
    ).map((element) => ({
      id: element.dataset.preshotExportImageGroupRow ?? "",
      blockId: element.dataset.preshotExportImageGroupBlockId ?? "",
      groupId: element.dataset.preshotExportImageGroupId ?? "",
      rowIndex: Number(element.dataset.preshotExportImageGroupRowIndex),
      imageIds: Object.freeze(
        (element.dataset.preshotExportImageIds ?? "")
          .split(",")
          .filter(Boolean),
      ),
      ...relativeRect(element, surfaceRect),
    })),
  };
}
