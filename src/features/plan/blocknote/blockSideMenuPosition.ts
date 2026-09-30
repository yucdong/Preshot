import { offset } from "@floating-ui/react";

// Use the content's top inset instead of BlockNote's type-specific first-line
// centering. Floating UI applies this in canvas coordinates, including zoom.
export const blockSideMenuMiddleware = [offset(({ elements }) => {
  const reference = elements.reference instanceof Element
    ? elements.reference
    : elements.reference.contextElement;
  const content = reference?.matches(".bn-block-content")
    ? reference
    : reference?.querySelector(".bn-block-content");
  const top = content ? Number.parseFloat(getComputedStyle(content).paddingTop) : 0;
  return { crossAxis: Number.isFinite(top) ? top : 0 };
})];
