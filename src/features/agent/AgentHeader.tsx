import {
  CircleHelp,
  History,
  MessageSquarePlus,
  MoreHorizontal,
  Settings2,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AgentSessionMetadata } from "../../domain/agent";
import { sessionStatusLabel } from "./agentUi";

interface AgentHeaderProps {
  readonly session: AgentSessionMetadata | null;
  readonly busy: boolean;
  readonly historyOpen: boolean;
  readonly onNewConversation: () => void;
  readonly onToggleHistory: () => void;
  readonly onOpenSettings: () => void;
  readonly onOpenHelp: () => void;
  readonly onDeleteConversation: () => void;
}

const iconButton =
  "grid h-8 w-8 shrink-0 place-items-center rounded-md text-app-muted transition-colors hover:bg-app-primary-soft hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional disabled:opacity-40";

export function AgentHeader({
  session,
  busy,
  historyOpen,
  onNewConversation,
  onToggleHistory,
  onOpenSettings,
  onOpenHelp,
  onDeleteConversation,
}: AgentHeaderProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [menuOpen]);

  const invoke = (action: () => void) => {
    setMenuOpen(false);
    action();
  };

  return (
    <header className="relative shrink-0 border-b border-app-border bg-app-panel px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="shrink-0 text-sm font-bold text-app-ink">
              {t("agent.title")}
            </h2>
            <span aria-hidden className="h-3 w-px bg-app-border" />
            <strong
              className="min-w-0 truncate text-[11px] font-semibold text-app-ink"
              title={session?.title}
            >
              {session?.title ?? t("agent.status.noSession")}
            </strong>
          </div>
          <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-app-muted">
            <span
              aria-hidden
              className={`h-1.5 w-1.5 rounded-full ${
                session?.state === "running" ||
                  session?.state === "waiting_permission" ||
                  session?.state === "waiting_user_input"
                  ? "bg-app-functional"
                  : session?.state === "error"
                  ? "bg-app-danger"
                  : "bg-app-muted"
              }`}
            />
            {sessionStatusLabel(t, session?.state ?? null)}
          </p>
        </div>
        <button
          aria-label={t("agent.newConversation")}
          className={iconButton}
          disabled={busy}
          onClick={onNewConversation}
          type="button"
        >
          <MessageSquarePlus aria-hidden className="h-4 w-4" />
        </button>
        <button
          aria-label={t("agent.history")}
          aria-pressed={historyOpen}
          className={`${iconButton} ${
            historyOpen ? "bg-app-functional-soft text-app-functional" : ""
          }`}
          disabled={busy}
          onClick={onToggleHistory}
          type="button"
        >
          <History aria-hidden className="h-4 w-4" />
        </button>
        <button
          ref={menuButtonRef}
          data-model-settings-trigger="agent"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label={t("agent.more")}
          className={iconButton}
          onClick={() => setMenuOpen((current) => !current)}
          type="button"
        >
          <MoreHorizontal aria-hidden className="h-4 w-4" />
        </button>
      </div>
      {menuOpen ? (
        <div
          className="absolute right-2 top-[52px] z-30 w-48 rounded-lg border border-app-border bg-app-panel-strong p-1.5 shadow-[var(--app-shadow)]"
          role="menu"
        >
          <button
            className="flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs text-app-ink hover:bg-app-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
            onClick={() => invoke(onOpenSettings)}
            role="menuitem"
            type="button"
          >
            <Settings2 aria-hidden className="h-4 w-4" />
            {t("agent.openModelSettings")}
          </button>
          <button
            className="flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs text-app-ink hover:bg-app-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
            onClick={() => invoke(onOpenHelp)}
            role="menuitem"
            type="button"
          >
            <CircleHelp aria-hidden className="h-4 w-4" />
            {t("agent.help")}
          </button>
          <div aria-hidden className="my-1 h-px bg-app-border" />
          <button
            className="flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs text-app-danger hover:bg-app-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-danger disabled:opacity-40"
            disabled={!session || busy}
            onClick={() => invoke(onDeleteConversation)}
            role="menuitem"
            type="button"
          >
            <Trash2 aria-hidden className="h-4 w-4" />
            {t("agent.deleteConversation")}
          </button>
        </div>
      ) : null}
    </header>
  );
}
