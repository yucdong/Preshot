import { Image, View } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import type { PreshotPdfExportContext } from "../../domain/plan/blocknote/pdfExportPreflight";
import {
  buildPreshotImageGroupPdfRenderModel,
  type PreshotImageGroupPdfBlock,
} from "./imageGroupPdfRenderModel";

function bytesToDataUrl(mime: string, bytes: Readonly<Uint8Array>): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let start = 0; start < bytes.length; start += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(start, start + chunkSize));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

export type PreshotImageGroupPdfBlockMapping = (
  block: PreshotImageGroupPdfBlock,
) => ReactElement | null;

export function createPreshotImageGroupPdfBlockMapping(
  exportContext: PreshotPdfExportContext,
): PreshotImageGroupPdfBlockMapping {
  return (block) => {
    const model = buildPreshotImageGroupPdfRenderModel(block, exportContext);
    if (model.kind === "empty") return null;

    return (
      <View
        key={`imageGroup-${model.blockId}`}
        wrap={false}
        style={{
          position: "relative",
          marginLeft: model.container.x,
          width: model.container.width,
          height: model.flow.height,
        }}
      >
        {model.flow.topPadding > 0
          ? <View style={{ height: model.flow.topPadding }} />
          : null}
        <View
          style={{
            position: "relative",
            top: model.container.y,
            width: model.container.width,
            height: model.container.height,
            overflow: "hidden",
            backgroundColor: model.container.backgroundColor,
            borderColor: model.container.borderColor,
            borderStyle: "solid",
            borderWidth: model.container.borderWidth,
            borderRadius: model.container.borderRadius,
          }}
        >
          {model.images.map((image) => (
            <View
              key={image.imageId}
              style={{
                position: "absolute",
                left: image.x,
                top: image.y,
                width: image.width,
                height: image.height,
                overflow: "hidden",
                backgroundColor: image.backgroundColor,
                borderColor: image.borderColor,
                borderStyle: "solid",
                borderWidth: image.borderWidth,
                borderRadius: image.borderRadius,
              }}
            >
              <Image
                src={bytesToDataUrl(image.asset.mime, image.asset.bytes)}
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: image.width,
                  height: image.height,
                }}
              />
            </View>
          ))}
        </View>
      </View>
    );
  };
}

export function injectPreshotImageGroupPdfBlockMapping<
  OrdinaryMappings extends Readonly<Record<string, unknown>>,
>(
  ordinaryMappings: OrdinaryMappings,
  exportContext: PreshotPdfExportContext,
): OrdinaryMappings & {
  readonly imageGroup: PreshotImageGroupPdfBlockMapping;
} {
  return {
    ...ordinaryMappings,
    imageGroup: createPreshotImageGroupPdfBlockMapping(exportContext),
  };
}
