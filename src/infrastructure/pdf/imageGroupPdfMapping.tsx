import { Image, View } from "@react-pdf/renderer";
import { Fragment, type ReactElement, type ReactNode } from "react";
import type { PreshotPdfExportContext } from "../../domain/plan/blocknote/pdfExportPreflight";
import {
  buildPreshotImageGroupPdfRenderModel,
  type PreshotImageGroupPdfBlock,
  type PreshotImageGroupPdfFragmentModel,
} from "./imageGroupPdfRenderModel";
import { freshPagePresenceAhead } from "./reactPdfPagination";

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
    breakBefore?: boolean;
  },
): ReactElement<{ children?: ReactNode }> {
  return (
    <View
      key={options.key}
      wrap={false}
      break={options.breakBefore}
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
          borderWidth: fragment.container.borderWidth,
          borderRadius: fragment.container.borderRadius,
        }}
      >
        {fragment.images.map((image) => (
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
}

export function createPreshotImageGroupPdfBlockMapping(
  exportContext: PreshotPdfExportContext,
): PreshotImageGroupPdfBlockMapping {
  return (block) => {
    const model = buildPreshotImageGroupPdfRenderModel(block, exportContext);
    if (model.kind === "empty") return null;

    if (model.pagination.mode === "row-fragments") {
      const wrapper = (
        <View
          key={`imageGroup-${model.blockId}`}
          wrap
          style={{
            position: "relative",
            marginLeft: model.container.x,
            width: model.container.width,
          }}
        >
          {model.pagination.fragments.map((fragment) =>
            renderFragment(fragment, {
              key: `imageGroup-${model.blockId}-fragment-${fragment.index}`,
              breakBefore: fragment.index > 0,
            })
          )}
        </View>
      );
      const presenceAhead = freshPagePresenceAhead(
        exportContext,
        model.blockId,
      );
      return presenceAhead === undefined
        ? wrapper
        : (
            <Fragment key={`imageGroup-${model.blockId}-fresh-page`}>
              <View minPresenceAhead={presenceAhead} />
              {wrapper}
            </Fragment>
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
