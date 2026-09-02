import {
  FileText,
  Image,
  MapPin,
  Pin,
  PinOff,
  Send,
  Square,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import {
  isAgentTurnActive,
  requestContextChips,
  type AgentDraft,
  type AgentRequestContextDraft,
  type AgentSessionMetadata,
} from "../../domain/agent";

interface AgentComposerProps {
  readonly session: AgentSessionMetadata | null;
  readonly draft: AgentDraft | null;
  readonly requestContext: AgentRequestContextDraft | null;
  readonly modelReady: boolean;
  readonly visionVerified: boolean;
  readonly suggestions: readonly string[];
  readonly onWriteDraft: (text: string) => Promise<void>;
  readonly onSend: (
    text: string,
    includeAttachment: boolean,
  ) => Promise<void>;
  readonly onStop: () => Promise<void>;
  readonly onRemoveContext: (chipId: string) => void;
  readonly onSetAttachmentPinned: (pinned: boolean) => void;
}

function contextLabel(
  kind: ReturnType<typeof requestContextChips>[number]["kind"],
  draft: AgentRequestContextDraft,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  switch (kind) {
    case "project":
      return t("agent.projectContext", {
        name: draft.snapshot.projectName,
      });
    case "document":
      return t("agent.documentContext", {
        revision: draft.snapshot.documentRevision,
      });
    case "selected_blocks":
      return t("agent.selectedBlocksContext", {
        count: draft.snapshot.selectedBlockIds.length,
      });
    case "cursor_block":
      return t("agent.cursorBlockContext");
    case "selected_image":
      return t("agent.selectedImageContext");
  }
}

export function AgentComposer({
  session,
  draft,
  requestContext,
  modelReady,
  visionVerified,
  suggestions,
  onWriteDraft,
  onSend,
  onStop,
  onRemoveContext,
  onSetAttachmentPinned,
}: AgentComposerProps) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [savingFailed, setSavingFailed] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const composingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (sessionIdRef.current === session?.sessionId) return;
    sessionIdRef.current = session?.sessionId ?? null;
    setText(draft?.text ?? "");
    setSavingFailed(false);
    setSendFailed(false);
  }, [draft?.text, session?.sessionId]);

  useEffect(() => {
    if (!session || text === (draft?.text ?? "")) return;
    const handle = window.setTimeout(() => {
      void onWriteDraft(text).then(
        () => setSavingFailed(false),
        () => setSavingFailed(true),
      );
    }, 250);
    return () => window.clearTimeout(handle);
  }, [draft?.text, onWriteDraft, session, text]);

  const running = session ? isAgentTurnActive(session.state) : false;
  const stopping = session?.state === "stopping";
  const canSubmit =
    modelReady &&
    Boolean(session) &&
    !running &&
    !submitting &&
    text.trim().length > 0;
  const chips = requestContext ? requestContextChips(requestContext) : [];
  const attachment = requestContext?.attachment ?? null;

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSubmit) return;
    const submitted = text.trim();
    setSubmitting(true);
    setSendFailed(false);
    try {
      await onSend(submitted, visionVerified);
      setText("");
      await onWriteDraft("");
    } catch {
      setSendFailed(true);
    } finally {
      setSubmitting(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      composingRef.current ||
      event.nativeEvent.isComposing
    ) {
      return;
    }
    event.preventDefault();
    void submit();
  };

  return (
    <form
      className="shrink-0 border-t border-app-border bg-app-panel p-3"
      onSubmit={(event) => void submit(event)}
    >
      {chips.length > 0 ? (
        <div
          aria-label={t("agent.contextTitle")}
          className="mb-2 flex max-h-16 flex-wrap gap-1 overflow-y-auto"
        >
          {chips
            .filter((chip) => chip.kind !== "selected_image")
            .map((chip) => {
              const label = contextLabel(chip.kind, requestContext!, t);
              return (
                <span
                  className="inline-flex min-h-6 max-w-full items-center gap-1 rounded-full border border-app-border bg-app-panel-strong px-2 text-[9px] font-semibold text-app-muted"
                  key={chip.id}
                >
                  {chip.kind === "selected_blocks" ||
                      chip.kind === "cursor_block"
                    ? <MapPin aria-hidden className="h-3 w-3 shrink-0" />
                    : <FileText aria-hidden className="h-3 w-3 shrink-0" />}
                  <span className="truncate">{label}</span>
                  {chip.removable ? (
                    <button
                      aria-label={t("agent.removeContext", { label })}
                      className="-mr-1 grid h-5 w-5 shrink-0 place-items-center rounded-full hover:bg-app-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
                      onClick={() => onRemoveContext(chip.id)}
                      type="button"
                    >
                      <X aria-hidden className="h-3 w-3" />
                    </button>
                  ) : null}
                </span>
              );
            })}
        </div>
      ) : null}

      {attachment ? (
        <div className="mb-2 flex min-w-0 items-center gap-2 rounded-lg border border-app-border bg-app-panel-strong p-2">
          {attachment.thumbnailDataUrl ? (
            <img
              alt=""
              className="h-9 w-9 shrink-0 rounded-md object-cover"
              height={36}
              src={attachment.thumbnailDataUrl}
              width={36}
            />
          ) : (
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-app-primary-soft text-app-muted">
              <Image aria-hidden className="h-4 w-4" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <strong className="block truncate text-[10px] text-app-ink">
              {attachment.displayName}
            </strong>
            <span className="text-[9px] text-app-muted">
              {attachment.pinned
                ? t("agent.imagePinned")
                : t("agent.imageAutomatic")}
            </span>
          </div>
          <button
            aria-label={attachment.pinned
              ? t("agent.unpinImage")
              : t("agent.pinImage")}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-app-muted hover:bg-app-primary-soft hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
            onClick={() => onSetAttachmentPinned(!attachment.pinned)}
            type="button"
          >
            {attachment.pinned
              ? <PinOff aria-hidden className="h-3.5 w-3.5" />
              : <Pin aria-hidden className="h-3.5 w-3.5" />}
          </button>
          <button
            aria-label={t("agent.removeImage")}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-app-danger hover:bg-app-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-danger"
            onClick={() => onRemoveContext(`image:${attachment.imageId}`)}
            type="button"
          >
            <X aria-hidden className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
      {attachment && !visionVerified ? (
        <p className="mb-2 text-[9px] leading-4 text-app-danger">
          {t("agent.imageWillNotSend")}
        </p>
      ) : null}

      {suggestions.length > 0 ? (
        <div className="mb-2 flex max-h-20 flex-wrap gap-1.5 overflow-y-auto">
          {suggestions.slice(0, 3).map((suggestion) => (
            <button
              className="rounded-full border border-app-border bg-app-panel-strong px-2.5 py-1 text-left text-[9px] leading-4 text-app-muted hover:border-app-functional hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
              key={suggestion}
              onClick={() => {
                setText(suggestion);
                textareaRef.current?.focus();
              }}
              type="button"
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}

      <label className="sr-only" htmlFor="assistant-input">
        {t("agent.inputLabel")}
      </label>
      <div className="rounded-lg border border-app-border bg-app-panel-strong p-1.5 focus-within:ring-2 focus-within:ring-app-functional">
        <textarea
          ref={textareaRef}
          className="max-h-36 min-h-[52px] w-full resize-y bg-transparent px-2 py-1 text-[14px] leading-5 text-app-ink outline-none placeholder:text-app-muted disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!modelReady || !session}
          id="assistant-input"
          maxLength={32_000}
          onChange={(event) => setText(event.target.value)}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onKeyDown={onKeyDown}
          placeholder={t("agent.inputPlaceholder")}
          rows={2}
          value={text}
        />
        <div className="flex items-center justify-between gap-2 px-1 pb-0.5">
          <span
            aria-live="polite"
            className="min-w-0 truncate text-[9px] text-app-danger"
          >
            {savingFailed
              ? t("agent.draftSaveFailed")
              : sendFailed
              ? t("agent.actionFailed")
              : ""}
          </span>
          {running ? (
            <button
              className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md bg-app-danger px-3 text-[11px] font-semibold text-app-on-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-danger disabled:opacity-45"
              disabled={stopping}
              onClick={() => void onStop()}
              type="button"
            >
              <Square aria-hidden className="h-3 w-3 fill-current" />
              {stopping ? t("agent.stopping") : t("agent.stop")}
            </button>
          ) : (
            <button
              className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md bg-app-primary px-3 text-[11px] font-semibold text-app-on-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional disabled:opacity-45"
              disabled={!canSubmit}
              type="submit"
            >
              <Send aria-hidden className="h-3.5 w-3.5" />
              {t("agent.send")}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
