import "@blocknote/core/fonts/inter.css";
import { zh } from "@blocknote/core/locales";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { useCreateBlockNote } from "@blocknote/react";
import {
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import type { ProjectPlanV14 } from "../../../../domain/plan/canvas/blockDocument";
import { resolveBlockNoteDocumentAssets } from "../blockNoteDocumentAssets";
import { preshotBlockNoteSchema } from "../preshotBlockNoteSchema";
import { ImageGroupExportContext } from "./ImageGroupExportContext";
import {
  annotateLongImageExportBlocks,
  assertLongImageExportOuterWidth,
  LONG_IMAGE_EXPORT_DEFAULT_OUTER_WIDTH,
  LONG_IMAGE_EXPORT_LOGICAL_HORIZONTAL_PADDING,
  LONG_IMAGE_EXPORT_LOGICAL_WIDTH,
  longImageExportContentWidth,
  longImageExportScale,
  type LongImageExportOuterWidth,
  validateLongImageExportAssets,
} from "./longImageExportModel";

export interface LongImageExportSurfaceProps {
  plan: ProjectPlanV14;
  resolvedAssets: Readonly<Record<string, string>>;
  outerWidth?: LongImageExportOuterWidth;
  theme?: "light" | "dark";
  onSurfaceReady?(surface: HTMLElement): void;
}

export function LongImageExportSurface({
  plan,
  resolvedAssets,
  outerWidth = LONG_IMAGE_EXPORT_DEFAULT_OUTER_WIDTH,
  theme = "light",
  onSurfaceReady,
}: LongImageExportSurfaceProps) {
  assertLongImageExportOuterWidth(outerWidth);
  validateLongImageExportAssets(plan, resolvedAssets);
  const surfaceRef = useRef<HTMLElement>(null);
  const scale = longImageExportScale(outerWidth);
  const editor = useCreateBlockNote({
    schema: preshotBlockNoteSchema,
    dictionary: zh,
    initialContent: resolveBlockNoteDocumentAssets(
      plan.document,
      (url) => resolvedAssets[url] ?? url,
    ),
  });
  const imageGroupController = useMemo(() => ({
    getGroup: (groupId: string) =>
      plan.imageGroups.find((group) => group.id === groupId),
    getImageSrc: (file: string) => resolvedAssets[file],
  }), [plan.imageGroups, resolvedAssets]);

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    annotateLongImageExportBlocks(surface, plan.document.blocks);
    onSurfaceReady?.(surface);
  }, [editor, onSurfaceReady, plan.document.blocks]);

  return (
    <section
      aria-hidden="true"
      className="preshot-long-image-export-surface"
      data-preshot-export-content-width={longImageExportContentWidth(outerWidth)}
      data-preshot-export-outer-width={outerWidth}
      data-preshot-long-image-export-surface=""
      ref={surfaceRef}
      style={{ width: outerWidth }}
    >
      <div
        className="preshot-long-image-export-document"
        data-preshot-export-document=""
        style={{
          boxSizing: "border-box",
          padding: `${LONG_IMAGE_EXPORT_LOGICAL_HORIZONTAL_PADDING}px`,
          width: `${LONG_IMAGE_EXPORT_LOGICAL_WIDTH}px`,
          zoom: scale,
        }}
      >
        <div data-preshot-export-content="">
          <ImageGroupExportContext.Provider value={imageGroupController}>
            <BlockNoteView
              autoFocus={false}
              editable={false}
              editor={editor}
              emojiPicker={false}
              filePanel={false}
              formattingToolbar={false}
              linkToolbar={false}
              sideMenu={false}
              slashMenu={false}
              tableHandles={false}
              theme={theme}
            />
          </ImageGroupExportContext.Provider>
        </div>
      </div>
    </section>
  );
}
