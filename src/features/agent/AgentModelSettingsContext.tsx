import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from "react";
import type {
  AgentModelSettingsController,
} from "../../domain/agent";
import { AgentModelSettingsContext } from "./useAgentModelSettings";

interface AgentModelSettingsProviderProps extends PropsWithChildren {
  readonly controller: AgentModelSettingsController;
}

export function AgentModelSettingsProvider({
  children,
  controller,
}: AgentModelSettingsProviderProps) {
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const returnTriggerRef = useRef<string | null>(null);

  useEffect(() => {
    void controller.initialize();
    return () => controller.cancelProbe();
  }, [controller]);

  const openSettings = useCallback(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    returnTriggerRef.current =
      returnFocusRef.current?.dataset.modelSettingsTrigger ?? null;
    setSettingsOpen(true);
  }, []);
  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    const returnTarget = returnFocusRef.current;
    const returnTrigger = returnTriggerRef.current;
    returnFocusRef.current = null;
    returnTriggerRef.current = null;
    window.setTimeout(() => {
      if (returnTarget?.isConnected) {
        returnTarget.focus();
        return;
      }
      const selector = returnTrigger
        ? `[data-model-settings-trigger="${returnTrigger}"]`
        : "[data-model-settings-trigger]";
      document.querySelector<HTMLElement>(selector)?.focus();
    }, 0);
  }, []);

  const value = useMemo(() => ({
    controller,
    snapshot,
    settingsOpen,
    openSettings,
    closeSettings,
  }), [
    closeSettings,
    controller,
    openSettings,
    settingsOpen,
    snapshot,
  ]);

  return (
    <AgentModelSettingsContext.Provider value={value}>
      {children}
    </AgentModelSettingsContext.Provider>
  );
}
