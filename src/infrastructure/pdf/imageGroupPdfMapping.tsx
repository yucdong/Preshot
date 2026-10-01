import { Image, View } from "@react-pdf/renderer";
import type { ReactElement, ReactNode } from "react";
import type { PreshotPdfExportContext } from "../../domain/plan/blocknote/pdfExportPreflight";
import {
  buildPreshotImageGroupPdfRenderModel,
  type PreshotImageGroupPdfBlock,
  type PreshotImageGroupPdfFragmentModel,
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

function renderFragment(
  fragment: PreshotImageGroupPdfFragmentModel,
  options: {
    key: string;
    first?: boolean;
    last?: boolean;
  },
): ReactElement<{ children?: ReactNode }> {
  return (
    <View
      key={options.key}
      wrap={false}
      style={{
        position: "relative",
        width: fragment.container.width,
        height: fragment.flow.height,
      }}
    >
      {fragment.flow.topPadding > 0
        ? <View style={{ height: fragment.flow.topPadding }} />
        : null}
      <View
        style={{
          position: "relative",
          top: fragment.container.y,
          width: fragment.container.width,
          height: fragment.container.height,
          overflow: "hidden",
          backgroundColor: fragment.container.backgroundColor,
          borderColor: fragment.container.borderColor,
          borderStyle: "solid",
          borderLeftWidth: fragment.container.borderWidth,
          borderRightWidth: fragment.container.borderWidth,
          borderTopWidth: options.first === false ? 0 : fragment.container.borderWidth,
          borderBottomWidth: options.last === false ? 0 : fragment.container.borderWidth,
          borderTopLeftRadius: options.first === false ? 0 : fragment.container.borderRadius,
          borderTopRightRadius: options.first === false ? 0 : fragment.container.borderRadius,
          borderBottomLeftRadius: options.last === false ? 0 : fragment.container.borderRadius,
          borderBottomRightRadius: options.last === false ? 0 : fragment.container.borderRadius,
        }}
      >
        {fragment.images.map((image) => (
          <View
            key={image.imageId}
            style={{
              position: "absolute",
              left: image.x,
              // Atomic rows already include their own insets. Compensate the
              // first strip's border so even a sub-point gap in narrow columns
              // leaves the entire image frame inside its clipping surface.
              top: image.y - (options.first === true ? fragment.container.borderWidth : 0),
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
}

export function createPreshotImageGroupPdfBlockMapping(
  exportContext: PreshotPdfExportContext,
): PreshotImageGroupPdfBlockMapping {
  return (block) => {
    const model = buildPreshotImageGroupPdfRenderModel(block, exportContext);
    if (model.kind === "empty") return null;

    if (model.pagination.mode === "row-fragments") {
      return (
        <View
          key={`imageGroup-${model.blockId}`}
          wrap
          style={{
            position: "relative",
            marginLeft: model.container.x,
            // Unlike relative `top`, margins are cleared on continuation by
            // React-PDF. Shift the first page as a whole and restore the flow
            // after the last row, preserving legacy negative group offsets.
            marginTop: model.container.y,
            marginBottom: -model.container.y,
            width: model.container.width,
          }}
        >
          {model.pagination.fragments.map((fragment, index, fragments) =>
            renderFragment(fragment, {
              key: `imageGroup-${model.blockId}-fragment-${fragment.index}`,
              first: index === 0,
              last: index === fragments.length - 1,
            })
          )}
        </View>
      );
    }

    const fragment: PreshotImageGroupPdfFragmentModel = {
      index: 0,
      flow: model.flow,
      container: model.container,
      images: model.images,
    };
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
        {renderFragment(fragment, {
          key: `imageGroup-${model.blockId}-content`,
        }).props.children}
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
