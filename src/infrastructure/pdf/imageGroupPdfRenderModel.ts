import type {
  PreshotPdfExportContext,
  PreshotPdfNormalizedCrop,
  PreshotPdfOptimizedAsset,
} from "../../domain/plan/blocknote/pdfExportPreflight";

export type PreshotImageGroupPdfRenderErrorCode =
  | "INVALID_BLOCK"
  | "MISSING_GROUP_CONTEXT"
  | "GROUP_CONTEXT_MISMATCH"
  | "MISSING_OPTIMIZED_ASSET";

export class PreshotImageGroupPdfRenderError extends Error {
  constructor(
    readonly code: PreshotImageGroupPdfRenderErrorCode,
    message: string,
    readonly context: {
      blockId: string;
      groupId: string;
      imageId?: string;
      assetId?: string;
    },
  ) {
    super(message);
    this.name = "PreshotImageGroupPdfRenderError";
  }
}

export interface PreshotImageGroupPdfBlock {
  readonly id: string;
  readonly type: "imageGroup";
  readonly props: {
    readonly groupId: string;
  };
}

export interface PreshotImageGroupPdfContainerModel {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly backgroundColor: string;
  readonly borderColor: string;
  readonly borderWidth: number;
  readonly borderRadius: number;
}

export interface PreshotImageGroupPdfFlowModel {
  readonly topPadding: number;
  readonly height: number;
}

export interface PreshotImageGroupPdfImageModel {
  readonly imageId: string;
  readonly assetId: string;
  readonly source: string;
  readonly crop: PreshotPdfNormalizedCrop;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly backgroundColor: string;
  readonly borderColor: string;
  readonly borderWidth: number;
  readonly borderRadius: number;
  readonly asset: Pick<PreshotPdfOptimizedAsset, "mime" | "bytes">;
}

export type PreshotImageGroupPdfRenderModel =
  | {
      readonly kind: "empty";
      readonly blockId: string;
      readonly groupId: string;
    }
  | {
      readonly kind: "content";
      readonly blockId: string;
      readonly groupId: string;
      readonly keepTogether: true;
      readonly flow: PreshotImageGroupPdfFlowModel;
      readonly container: PreshotImageGroupPdfContainerModel;
      readonly images: readonly PreshotImageGroupPdfImageModel[];
    };

function renderError(
  code: PreshotImageGroupPdfRenderErrorCode,
  message: string,
  context: {
    blockId: string;
    groupId: string;
    imageId?: string;
    assetId?: string;
  },
): never {
  throw new PreshotImageGroupPdfRenderError(code, message, context);
}

export function buildPreshotImageGroupPdfRenderModel(
  block: PreshotImageGroupPdfBlock,
  exportContext: PreshotPdfExportContext,
): PreshotImageGroupPdfRenderModel {
  const blockId = block?.id;
  const groupId = block?.props?.groupId;
  if (
    !blockId ||
    block.type !== "imageGroup" ||
    typeof groupId !== "string" ||
    groupId.length === 0
  ) {
    renderError(
      "INVALID_BLOCK",
      `Cannot render PDF image group: block "${blockId || "<missing>"}" must contain a non-empty groupId.`,
      { blockId: blockId || "<missing>", groupId: groupId || "<missing>" },
    );
  }

  const group = exportContext.groupsByBlockId[blockId];
  if (!group) {
    renderError(
      "MISSING_GROUP_CONTEXT",
      `Cannot render PDF image group: missing preflight image-group context for block "${blockId}", group "${groupId}".`,
      { blockId, groupId },
    );
  }
  if (group.groupId !== groupId) {
    renderError(
      "GROUP_CONTEXT_MISMATCH",
      `Cannot render PDF image group: preflight context for block "${blockId}" resolves group "${group.groupId}", not "${groupId}".`,
      { blockId, groupId },
    );
  }
  if (group.empty || !group.render) {
    return {
      kind: "empty",
      blockId,
      groupId,
    };
  }

  const images = group.slots.map((slot): PreshotImageGroupPdfImageModel => {
    const asset = exportContext.assetsById[slot.assetId];
    if (!asset) {
      renderError(
        "MISSING_OPTIMIZED_ASSET",
        `Cannot render PDF image group: missing optimized asset "${slot.assetId}" for block "${blockId}", group "${groupId}", image "${slot.imageId}".`,
        {
          blockId,
          groupId,
          imageId: slot.imageId,
          assetId: slot.assetId,
        },
      );
    }
    return {
      imageId: slot.imageId,
      assetId: slot.assetId,
      source: slot.source,
      crop: slot.crop,
      x: slot.pdf.x,
      y: slot.pdf.y,
      width: slot.pdf.width,
      height: slot.pdf.height,
      backgroundColor: exportContext.colors.imageFrame,
      borderColor: exportContext.colors.border,
      borderWidth: exportContext.borders.hairline,
      borderRadius: exportContext.borders.radius,
      asset: {
        mime: asset.mime,
        bytes: asset.bytes,
      },
    };
  });

  return {
    kind: "content",
    blockId,
    groupId,
    keepTogether: true,
    flow: {
      topPadding: group.pdf.flowTopPadding,
      height: group.pdf.flowHeight,
    },
    container: {
      x: group.pdf.x,
      y: Math.min(0, group.pdf.offsetY),
      width: group.pdf.width,
      height: group.pdf.displayedHeight,
      backgroundColor: exportContext.colors.softSurface,
      borderColor: exportContext.colors.border,
      borderWidth: exportContext.borders.hairline,
      borderRadius: exportContext.borders.radius,
    },
    images,
  };
}
