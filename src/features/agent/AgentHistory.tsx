import { Check, Pencil, Play, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AgentSessionMetadata } from "../../domain/agent";
import { formatAgentDateTime, sessionStatusLabel } from "./agentUi";

interface AgentHistoryProps {
  readonly sessions: readonly AgentSessionMetadata[];
  readonly activeSessionId: string | null;
  readonly busy: boolean;
  readonly onResume: (sessionId: string) => void;
  readonly onRename: (sessionId: string, title: string) => void;
  readonly onDelete: (session: AgentSessionMetadata) => void;
}

export function AgentHistory({
  sessions,
  activeSessionId,
  busy,
  onResume,
  onRename,
  onDelete,
}: AgentHistoryProps) {
  const { t } = useTranslation();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId) inputRef.current?.focus();
  }, [renamingId]);

  if (sessions.length === 0) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center p-5 text-center">
        <p className="text-xs leading-5 text-app-muted">
          {t("agent.noHistory")}
        </p>
      </div>
    );
  }

  const beginRename = (session: AgentSessionMetadata) => {
    setRenamingId(session.sessionId);
    setTitle(session.title);
  };
  const commitRename = () => {
    const value = title.trim();
    if (!renamingId || !value) return;
    onRename(renamingId, value);
    setRenamingId(null);
  };

  return (
    <section
      aria-label={t("agent.history")}
      className="min-h-0 flex-1 overflow-y-auto"
    >
      <ul className="divide-y divide-app-border">
        {sessions.map((session) => {
          const active = session.sessionId === activeSessionId;
          const renaming = session.sessionId === renamingId;
          return (
            <li className="px-3 py-3" key={session.sessionId}>
              {renaming ? (
                <form
                  className="flex items-center gap-1.5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    commitRename();
                  }}
                >
                  <label className="sr-only" htmlFor={`rename-${session.sessionId}`}>
                    {t("agent.conversationTitle")}
                  </label>
                  <input
                    ref={inputRef}
                    className="min-w-0 flex-1 rounded-md border border-app-border bg-app-panel-strong px-2 py-1.5 text-xs text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
                    id={`rename-${session.sessionId}`}
                    maxLength={500}
                    onChange={(event) => setTitle(event.target.value)}
                    value={title}
                  />
                  <button
                    aria-label={t("agent.saveName")}
                    className="grid h-8 w-8 place-items-center rounded-md text-app-functional hover:bg-app-functional-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
                    type="submit"
                  >
                    <Check aria-hidden className="h-4 w-4" />
                  </button>
                  <button
                    aria-label={t("common.cancel")}
                    className="grid h-8 w-8 place-items-center rounded-md text-app-muted hover:bg-app-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
                    onClick={() => setRenamingId(null)}
                    type="button"
                  >
                    <X aria-hidden className="h-4 w-4" />
                  </button>
                </form>
              ) : (
                <>
                  <div className="flex min-w-0 items-start gap-2">
                    <button
                      aria-label={t("agent.resumeConversation", {
                        title: session.title,
                      })}
                      className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
                      disabled={active || busy}
                      onClick={() => onResume(session.sessionId)}
                      type="button"
                    >
                      <span className="flex items-center gap-1.5">
                        {active ? (
                          <span
                            aria-hidden
                            className="h-1.5 w-1.5 rounded-full bg-app-functional"
                          />
                        ) : null}
                        <strong className="truncate text-xs text-app-ink">
                          {session.title}
                        </strong>
                      </span>
                      <span className="mt-1 block text-[10px] text-app-muted">
                        {sessionStatusLabel(t, session.state)}
                        {" · "}
                        {formatAgentDateTime(session.updatedAt)}
                      </span>
                      {session.modelId ? (
                        <span className="mt-0.5 block truncate text-[9px] text-app-muted">
                          {session.modelId}
                        </span>
                      ) : null}
                    </button>
                    <div className="flex shrink-0 items-center gap-0.5">
                      {!active ? (
                        <button
                          aria-label={t("agent.resumeConversation", {
                            title: session.title,
                          })}
                          className="grid h-8 w-8 place-items-center rounded-md text-app-muted hover:bg-app-functional-soft hover:text-app-functional focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional disabled:opacity-40"
                          disabled={busy}
                          onClick={() => onResume(session.sessionId)}
                          type="button"
                        >
                          <Play aria-hidden className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      <button
                        aria-label={t("agent.renameConversation")}
                        className="grid h-8 w-8 place-items-center rounded-md text-app-muted hover:bg-app-primary-soft hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
                        onClick={() => beginRename(session)}
                        type="button"
                      >
                        <Pencil aria-hidden className="h-3.5 w-3.5" />
                      </button>
                      <button
                        aria-label={t("agent.deleteConversation")}
                        className="grid h-8 w-8 place-items-center rounded-md text-app-danger hover:bg-app-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-danger disabled:opacity-40"
                        disabled={busy}
                        onClick={() => onDelete(session)}
                        type="button"
                      >
                        <Trash2 aria-hidden className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
