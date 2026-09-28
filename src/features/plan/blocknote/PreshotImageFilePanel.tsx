import { FilePanelExtension } from "@blocknote/core/extensions";
import { EmbedTab, FilePanel, UploadTab, type FilePanelProps, useBlockNoteEditor } from "@blocknote/react";
import { LoadingOverlay, Tabs } from "@mantine/core";
import { Camera } from "lucide-react";
import { useContext, useState } from "react";
import { closeHistory } from "prosemirror-history";
import type { PreshotBlockNoteEditor } from "./preshotBlockNoteSchema";
import { CaptureBlockImageContext } from "./ImageBlockCaptureContext";

export function PreshotImageFilePanel(props: FilePanelProps) {
  const editor = useBlockNoteEditor() as PreshotBlockNoteEditor;
  const capture = useContext(CaptureBlockImageContext);
  const [loading, setLoading] = useState(false);
  const block = editor.getBlock(props.blockId);
  if (!capture || block?.type !== "image") return <FilePanel {...props} />;
  const dictionary = editor.dictionary.file_panel;
  return (
    <div className="bn-panel preshot-image-file-panel">
      <LoadingOverlay visible={loading} />
      <Tabs defaultValue={editor.uploadFile ? "upload" : "embed"}>
        <div className="preshot-image-file-panel-header">
          <Tabs.List>
            {editor.uploadFile ? <Tabs.Tab value="upload">{dictionary.upload.title}</Tabs.Tab> : null}
            <Tabs.Tab value="embed">{dictionary.embed.title}</Tabs.Tab>
          </Tabs.List>
          <button className="preshot-image-capture-button" disabled={loading} type="button" onClick={() => {
            const originalUrl = block.props.url;
            const isCurrent = () => {
              if (editor.prosemirrorView.isDestroyed) return false;
              const current = editor.getBlock(block.id);
              return current?.type === "image" && current.props.url === originalUrl;
            };
            editor.getExtension(FilePanelExtension)?.closeMenu();
            void capture({
              isCurrent,
              publish(media) {
                if (!isCurrent()) return;
                editor.prosemirrorView.dispatch(closeHistory(editor.prosemirrorView.state.tr));
                editor.updateBlock(block.id, {
                  type: "image", props: { url: media.file, name: media.name, showPreview: true },
                });
                editor.prosemirrorView.dispatch(closeHistory(editor.prosemirrorView.state.tr));
              },
            });
          }}>
            <Camera size={16} aria-hidden="true" />截图
          </button>
        </div>
        {editor.uploadFile ? <Tabs.Panel value="upload"><UploadTab {...props} setLoading={setLoading} /></Tabs.Panel> : null}
        <Tabs.Panel value="embed"><EmbedTab {...props} /></Tabs.Panel>
      </Tabs>
    </div>
  );
}
