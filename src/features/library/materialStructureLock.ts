import type { PreshotBlockNoteEditor } from "../plan/blocknote/preshotBlockNoteSchema";

export function lockMaterialContentEditor(editor: PreshotBlockNoteEditor): () => void {
  // BlockNote's onBeforeChange is a ProseMirror filterTransaction. Every
  // editable field lives in the sidecar; no document-changing transaction is
  // legitimate, including keyboard, paste, drop, history and editor API calls.
  return editor.onBeforeChange(({ tr }) => !tr.docChanged);
}
