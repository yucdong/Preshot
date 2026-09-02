import {
  Bot,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CircleX,
  LoaderCircle,
  MessageCircleQuestion,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wrench,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type {
  AgentCitation,
  AgentEventState,
  AgentTurnContext,
} from "../../domain/agent";
import {
  errorLabel,
  extractAgentCitations,
  formatAgentTime,
  toolLabel,
} from "./agentUi";

interface AgentTranscriptProps {
  readonly projectId: string;
  readonly events: AgentEventState;
  readonly turnContexts: readonly AgentTurnContext[];
  readonly following: boolean;
  readonly hasNewContent: boolean;
  readonly onFollowingChange: (following: boolean) => void;
  readonly onResolvePermission: (
    requestId: string,
    decision: "allowed" | "denied",
  ) => void;
  readonly onResolveInput: (requestId: string, value: string | null) => void;
  readonly onCitation: (citation: AgentCitation) => void;
}

function statusIcon(status: "running" | "succeeded" | "failed" | "denied") {
  if (status === "running") {
    return <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin" />;
  }
  if (status === "succeeded") {
    return <CheckCircle2 aria-hidden className="h-3.5 w-3.5" />;
  }
  if (status === "denied") {
    return <ShieldCheck aria-hidden className="h-3.5 w-3.5" />;
  }
  return <CircleX aria-hidden className="h-3.5 w-3.5" />;
}

function eventTime(
  events: AgentEventState,
  type: "message",
  id: string,
): string {
  const event = [...events.events].reverse().find((candidate) =>
    (candidate.type === "message_delta" ||
      candidate.type === "message_completed") &&
    candidate.messageId === id
  );
  return event && type === "message" ? formatAgentTime(event.occurredAt) : "";
}

function ContextReceipt({ turn }: { readonly turn: AgentTurnContext }) {
  const { t } = useTranslation();
  const receipt = turn.receipt;
  return (
    <details className="mt-2 rounded-md border border-app-border bg-app-panel px-2.5 py-2 text-[10px] text-app-muted">
      <summary className="cursor-pointer font-semibold text-app-ink">
        {t("agent.contextReceipt")}
      </summary>
      <div className="mt-2 space-y-1 leading-4">
        <p>{t("agent.contextProject", { name: receipt.projectName })}</p>
        <p>
          {t("agent.contextDocument", {
            revision: receipt.documentRevision,
          })}
        </p>
        {receipt.selectedBlockIds.length > 0 ? (
          <p>
            {t("agent.contextBlocks", {
              count: receipt.selectedBlockIds.length,
            })}
          </p>
        ) : null}
        {receipt.cursorBlockId ? <p>{t("agent.contextCursor")}</p> : null}
        {receipt.selectedImage ? (
          <p>
            {t("agent.contextImage", {
              name: receipt.selectedImage.displayName,
            })}
          </p>
        ) : null}
        <p>
          {t("agent.capturedAt", {
            time: formatAgentTime(receipt.capturedAt),
          })}
        </p>
      </div>
    </details>
  );
}

function AssistantMessage({
  content,
  projectId,
  onCitation,
}: {
  readonly content: string;
  readonly projectId: string;
  readonly onCitation: (citation: AgentCitation) => void;
}) {
  const { t } = useTranslation();
  const parsed = useMemo(
    () => extractAgentCitations(content, projectId),
    [content, projectId],
  );
  return (
    <>
      <p className="whitespace-pre-wrap break-words text-[13px] leading-5 text-app-ink">
        {parsed.text}
      </p>
      {parsed.citations.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {parsed.citations.map((entry) => (
            <button
              className="rounded-full border border-app-border bg-app-panel px-2 py-1 text-[10px] font-semibold text-app-functional hover:border-app-functional focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
              key={`${entry.citation.kind}:${entry.index}`}
              onClick={() => onCitation(entry.citation)}
              type="button"
            >
              {t("agent.citation", { index: entry.index })}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}

function InputRequest({
  requestId,
  prompt,
  choices,
  status,
  onResolve,
}: {
  readonly requestId: string;
  readonly prompt: string;
  readonly choices: readonly string[];
  readonly status: "pending" | "submitted" | "cancelled" | "interrupted";
  readonly onResolve: (requestId: string, value: string | null) => void;
}) {
  const { t } = useTranslation();
  const [answer, setAnswer] = useState("");
  if (status !== "pending") {
    const text = status === "submitted"
      ? t("agent.inputSubmitted")
      : status === "cancelled"
      ? t("agent.inputCancelled")
      : t("agent.inputInterrupted");
    return (
      <div className="rounded-md border border-app-border bg-app-panel p-2.5 text-[11px] text-app-muted">
        {text}
      </div>
    );
  }
  return (
    <form
      className="rounded-lg border border-app-functional bg-app-functional-soft p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (answer.trim()) onResolve(requestId, answer.trim());
      }}
    >
      <div className="flex items-start gap-2">
        <MessageCircleQuestion
          aria-hidden
          className="mt-0.5 h-4 w-4 shrink-0 text-app-functional"
        />
        <div className="min-w-0 flex-1">
          <strong className="text-xs text-app-ink">
            {t("agent.inputRequestTitle")}
          </strong>
          <p className="mt-1 break-words text-[11px] leading-4 text-app-muted">
            {prompt}
          </p>
        </div>
      </div>
      {choices.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {choices.map((choice) => (
            <button
              className="rounded-md border border-app-border bg-app-panel-strong px-2 py-1.5 text-[11px] text-app-ink hover:border-app-functional focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
              key={choice}
              onClick={() => setAnswer(choice)}
              type="button"
            >
              {choice}
            </button>
          ))}
        </div>
      ) : null}
      <label className="sr-only" htmlFor={`agent-input-${requestId}`}>
        {t("agent.answerLabel")}
      </label>
      <textarea
        className="mt-2 min-h-16 w-full resize-y rounded-md border border-app-border bg-app-panel-strong px-2 py-1.5 text-xs text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
        id={`agent-input-${requestId}`}
        maxLength={4000}
        onChange={(event) => setAnswer(event.target.value)}
        value={answer}
      />
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        <button
          className="min-h-8 rounded-md px-2.5 text-[11px] font-semibold text-app-muted hover:bg-app-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
          onClick={() => onResolve(requestId, null)}
          type="button"
        >
          {t("agent.cancelAnswer")}
        </button>
        <button
          className="min-h-8 rounded-md bg-app-primary px-3 text-[11px] font-semibold text-app-on-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional disabled:opacity-45"
          disabled={!answer.trim()}
          type="submit"
        >
          {t("agent.submitAnswer")}
        </button>
      </div>
    </form>
  );
}

export function AgentTranscript({
  projectId,
  events,
  turnContexts,
  following,
  hasNewContent,
  onFollowingChange,
  onResolvePermission,
  onResolveInput,
  onCitation,
}: AgentTranscriptProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const userTurnByMessageId = useMemo(() => {
    const result = new Map<string, AgentTurnContext>();
    let index = 0;
    for (const message of events.messages) {
      if (message.role !== "user") continue;
      const turn = turnContexts[index++];
      if (turn) result.set(message.messageId, turn);
    }
    return result;
  }, [events.messages, turnContexts]);

  const streamKey = [
    events.messages.at(-1)?.content.length ?? 0,
    events.reasoning.at(-1)?.summary.length ?? 0,
    events.tools.at(-1)?.progress.length ?? 0,
    events.permissions.length,
    events.inputs.length,
  ].join(":");

  useEffect(() => {
    if (!following || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [following, streamKey]);

  const scrollToLatest = () => {
    onFollowingChange(true);
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        aria-label={t("agent.transcript")}
        aria-live="off"
        className="h-full overflow-y-auto overscroll-contain px-3 py-3"
        onScroll={(event) => {
          const element = event.currentTarget;
          const distance =
            element.scrollHeight - element.scrollTop - element.clientHeight;
          const nextFollowing = distance <= 32;
          if (nextFollowing !== following) onFollowingChange(nextFollowing);
        }}
        role="log"
      >
        <div className="space-y-3">
          {events.messages.map((message) => {
            const user = message.role === "user";
            const turn = userTurnByMessageId.get(message.messageId);
            return (
              <article
                className={`flex gap-2 ${user ? "flex-row-reverse" : ""}`}
                key={message.messageId}
              >
                <span
                  aria-hidden
                  className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${
                    user
                      ? "bg-app-primary text-app-on-primary"
                      : "bg-app-functional-soft text-app-functional"
                  }`}
                >
                  {user
                    ? <UserRound className="h-3.5 w-3.5" />
                    : <Bot className="h-3.5 w-3.5" />}
                </span>
                <div className={`min-w-0 max-w-[calc(100%-2rem)] flex-1 ${
                  user ? "text-right" : ""
                }`}>
                  <div className="mb-1 flex items-center gap-2 text-[9px] text-app-muted">
                    <strong className={user ? "ml-auto" : ""}>
                      {user ? t("agent.userRole") : t("agent.assistantRole")}
                    </strong>
                    <time>{eventTime(events, "message", message.messageId)}</time>
                  </div>
                  <div
                    className={`rounded-lg px-3 py-2 text-left ${
                      user
                        ? "bg-app-primary text-app-on-primary"
                        : "border border-app-border bg-app-panel-strong"
                    }`}
                  >
                    {user ? (
                      <p className="whitespace-pre-wrap break-words text-[13px] leading-5">
                        {message.content}
                      </p>
                    ) : (
                      <AssistantMessage
                        content={message.content}
                        onCitation={onCitation}
                        projectId={projectId}
                      />
                    )}
                    {!message.completed && !user ? (
                      <span className="mt-1 inline-flex items-center gap-1 text-[9px] text-app-muted">
                        <LoaderCircle
                          aria-hidden
                          className="h-3 w-3 animate-spin"
                        />
                        {t("agent.status.running")}
                      </span>
                    ) : null}
                  </div>
                  {turn ? <ContextReceipt turn={turn} /> : null}
                </div>
              </article>
            );
          })}

          {events.reasoning.map((reasoning) => (
            <details
              className="rounded-lg border border-app-border bg-app-panel-strong px-3 py-2"
              key={reasoning.reasoningId}
            >
              <summary className="flex cursor-pointer list-none items-center gap-2 text-[11px] font-semibold text-app-ink">
                <Sparkles aria-hidden className="h-3.5 w-3.5 text-app-functional" />
                <span className="flex-1">{t("agent.reasoning")}</span>
                {!reasoning.completed ? (
                  <span className="font-normal text-app-muted">
                    {t("agent.reasoningStreaming")}
                  </span>
                ) : null}
                <ChevronDown aria-hidden className="h-3.5 w-3.5" />
              </summary>
              <p className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-5 text-app-muted">
                {reasoning.summary}
              </p>
            </details>
          ))}

          {events.tools.map((tool) => (
            <article
              className="rounded-lg border border-app-border bg-app-panel-strong p-3"
              key={tool.toolCallId}
            >
              <div className="flex items-center gap-2 text-[11px]">
                <Wrench aria-hidden className="h-3.5 w-3.5 text-app-functional" />
                <strong className="min-w-0 flex-1 truncate text-app-ink">
                  {toolLabel(t, tool.toolName)}
                </strong>
                <span className="inline-flex items-center gap-1 text-app-muted">
                  {statusIcon(tool.status)}
                  {tool.status === "running"
                    ? t("agent.toolRunning")
                    : tool.status === "succeeded"
                    ? t("agent.toolSucceeded")
                    : tool.status === "denied"
                    ? t("agent.toolDenied")
                    : t("agent.toolFailed")}
                </span>
              </div>
              {tool.summary ? (
                <p className="mt-1.5 break-words text-[10px] leading-4 text-app-muted">
                  {tool.summary}
                </p>
              ) : null}
              {tool.progress ? (
                <div className="mt-2 rounded-md bg-app-panel px-2 py-1.5 text-[10px] text-app-muted">
                  <strong>{t("agent.toolProgress")}：</strong>
                  {tool.progress}
                </div>
              ) : null}
              {tool.output ? (
                <details className="mt-2 text-[10px] text-app-muted">
                  <summary className="cursor-pointer font-semibold text-app-ink">
                    {t("agent.toolResult")}
                  </summary>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-app-panel p-2 font-mono text-[9px] leading-4">
                    {tool.output}
                  </pre>
                </details>
              ) : null}
            </article>
          ))}

          {events.permissions.map((permission) => (
            <article
              className="rounded-lg border border-app-functional bg-app-functional-soft p-3"
              key={permission.requestId}
            >
              <div className="flex items-start gap-2">
                <ShieldCheck
                  aria-hidden
                  className="mt-0.5 h-4 w-4 shrink-0 text-app-functional"
                />
                <div className="min-w-0 flex-1">
                  <strong className="text-xs text-app-ink">
                    {t("agent.permissionTitle")}
                  </strong>
                  <p className="mt-1 text-[11px] font-semibold text-app-ink">
                    {toolLabel(t, permission.toolName)}
                  </p>
                  <p className="mt-1 break-words text-[10px] leading-4 text-app-muted">
                    {permission.summary}
                  </p>
                  <p className="mt-1.5 text-[9px] leading-4 text-app-muted">
                    {t("agent.permissionContextNotice")}
                  </p>
                </div>
              </div>
              {permission.decision === "pending" ? (
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <button
                    className="min-h-8 rounded-md px-3 text-[11px] font-semibold text-app-muted hover:bg-app-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
                    onClick={() =>
                      onResolvePermission(permission.requestId, "denied")}
                    type="button"
                  >
                    {t("agent.deny")}
                  </button>
                  <button
                    className="min-h-8 rounded-md bg-app-primary px-3 text-[11px] font-semibold text-app-on-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
                    onClick={() =>
                      onResolvePermission(permission.requestId, "allowed")}
                    type="button"
                  >
                    {t("agent.allowOnce")}
                  </button>
                </div>
              ) : (
                <p className="mt-2 text-[10px] font-semibold text-app-muted">
                  {permission.decision === "allowed"
                    ? t("agent.permissionAllowed")
                    : permission.decision === "denied"
                    ? t("agent.permissionDenied")
                    : t("agent.permissionInterrupted")}
                </p>
              )}
            </article>
          ))}

          {events.inputs.map((input) => (
            <InputRequest
              choices={input.choices}
              key={input.requestId}
              onResolve={onResolveInput}
              prompt={input.prompt}
              requestId={input.requestId}
              status={input.status}
            />
          ))}

          {events.compaction !== "idle" ? (
            <div className="flex items-center gap-2 rounded-md border border-app-border bg-app-panel px-2.5 py-2 text-[10px] text-app-muted">
              {events.compaction === "running" ? (
                <LoaderCircle
                  aria-hidden
                  className="h-3.5 w-3.5 animate-spin"
                />
              ) : (
                <CheckCircle2 aria-hidden className="h-3.5 w-3.5" />
              )}
              {events.compaction === "running"
                ? t("agent.compactionRunning")
                : t("agent.compactionCompleted")}
            </div>
          ) : null}

          {events.lastError ? (
            <div
              className="flex items-start gap-2 rounded-lg border border-app-danger bg-app-danger-soft p-3 text-[11px] text-app-danger"
              role="alert"
            >
              <CircleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{errorLabel(t, events.lastError.code)}</span>
            </div>
          ) : null}
        </div>
      </div>
      {hasNewContent ? (
        <button
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-app-functional bg-app-panel-strong px-3 py-1.5 text-[11px] font-semibold text-app-functional shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
          onClick={scrollToLatest}
          type="button"
        >
          {t("agent.newResponse")}
        </button>
      ) : null}
    </div>
  );
}
