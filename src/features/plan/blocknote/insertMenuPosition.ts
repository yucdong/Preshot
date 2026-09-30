import { autoPlacement, offset, shift, size, type Middleware } from "@floating-ui/react";

/** Both the anchor and floating element use viewport CSS pixels. Constrain the
 * actual scrollable list as well as its floating wrapper (WebView2/CSS zoom). */
export const insertMenuMiddleware: Middleware[] = [
  offset(10),
  autoPlacement({ allowedPlacements: ["bottom-start", "top-start"], boundary: "clippingAncestors", rootBoundary: "viewport", padding: 10 }),
  shift({ padding: 10 }),
  size({ padding: 10, apply({ elements, availableHeight, availableWidth }) {
    const height = Math.max(0, Math.min(480, availableHeight));
    Object.assign(elements.floating.style, { maxHeight: `${height}px`, maxWidth: `${Math.max(0, availableWidth)}px` });
    const list = elements.floating.querySelector<HTMLElement>('[role="listbox"]');
    if (list) Object.assign(list.style, {
      maxHeight: `${height}px`, overflowY: "auto", overscrollBehavior: "contain", minHeight: "0",
      // Native scrollIntoView otherwise rounds a selected item's fractional
      // bottom to the clip edge under zoom/DPI scaling.
      scrollPaddingBlock: "4px", boxSizing: "border-box",
    });
  } }),
];
