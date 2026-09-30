import { SuggestionMenu as SuggestionMenuExtension } from "@blocknote/core/extensions";
import { useEffect, useState } from "react";
import type { PreshotBlockNoteEditor } from "./preshotBlockNoteSchema";

/** Keep menu measurements in viewport pixels, outside the zoomed canvas. */
export function useInsertMenuPortal(
  editor: PreshotBlockNoteEditor,
  theme: "light" | "dark",
  active: boolean,
) {
  const [portal] = useState(() => document.createElement("div"));

  useEffect(() => {
    document.body.append(portal);
    return () => portal.remove();
  }, [portal]);

  useEffect(() => {
    // Reproduce the theme scope normally inherited from BlockNote's portal.
    portal.setAttribute("class", `bn-root bn-mantine preshot-insert-menu-portal ${theme}`);
    portal.setAttribute("data-color-scheme", theme);
    portal.setAttribute("data-mantine-color-scheme", theme);
    portal.toggleAttribute("hidden", !active);
    // Cached projects stay mounted; their body portals must not stay open or
    // reopen an old menu when the user switches back to the project.
    if (!active) editor.getExtension(SuggestionMenuExtension)?.closeMenu();
  }, [active, editor, portal, theme]);

  useEffect(() => {
    // The menu's reference is a virtual rectangle. BlockNote updates it on
    // editor transactions, but scrolling/zooming can happen without one.
    let frame: number | undefined;
    const update = (event: Event) => {
      if (event.target instanceof Node && portal.contains(event.target)) return;
      const menu = editor.getExtension(SuggestionMenuExtension);
      if (!portal.querySelector('[role="listbox"]') || !menu) return;
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        if (!editor.prosemirrorView.isDestroyed && portal.querySelector('[role="listbox"]')) {
          editor.prosemirrorView.dispatch(editor.prosemirrorView.state.tr.setMeta("addToHistory", false));
        }
      });
    };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, [editor, portal]);

  return portal;
}
