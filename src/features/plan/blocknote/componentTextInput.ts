import type { KeyboardEvent, SyntheticEvent } from "react";

const keepNative = (event: SyntheticEvent) => event.stopPropagation();

// These controls live inside atomic BlockNote nodes. Keep their native editing
// events out of block selection/clipboard handling without cancelling defaults.
export const componentTextInputEvents = {
  onPointerDownCapture: keepNative,
  onMouseDownCapture: keepNative,
  onCopyCapture: keepNative,
  onCutCapture: keepNative,
  onPasteCapture: keepNative,
  onKeyDownCapture: (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && ["a", "c", "x", "v", "z", "y"].includes(event.key.toLowerCase())) {
      event.stopPropagation();
    }
  },
};
