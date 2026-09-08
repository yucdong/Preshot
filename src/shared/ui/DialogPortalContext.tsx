import { createContext, useContext } from "react";

export const DialogPortalContext = createContext<() => HTMLElement>(() => document.body);

export function useDialogPortalHost(): HTMLElement {
  return useContext(DialogPortalContext)();
}
