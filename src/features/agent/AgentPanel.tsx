import {
  CircleAlert,
  CircleHelp,
  LoaderCircle,
  MessageSquarePlus,
  Settings2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  AgentCitation,
  AgentErrorDetails,
  AgentSessionMetadata,
} from "../../domain/agent";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import {
  useAgentController,
  useAgentControllerState,
} from "./AgentContext";
import { AgentComposer } from "./AgentComposer";
import { AgentHeader } from "./AgentHeader";
import { AgentHistory } from "./AgentHistory";
import { AgentProposalReview } from "./AgentProposalReview";
import { AgentTranscript } from "./AgentTranscript";
import {
  errorLabel,
  formatTokenCount,
} from "./agentUi";
import { useAgentModelSettings } from "./useAgentModelSettings";

function AgentSetupState({
  status,
  error,
  onOpenSettings,
}: {
  readonly status: string;
  readonly error: AgentErrorDetails | null;
  readonly onOpenSettings: () => void;
}) {
  const { t } = useTranslation();
  const body = status === "loading"
    ? t("agent.setupLoading")
    : status === "requires_retest"
    ? t("agent.setupRetest")
    : status === "error" && error?.code === "proxy_unreachable"
    ? t("agent.setupOffline")
    : t("agent.setupBody");
  return (
    <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-4">
      <div className="w-full rounded-lg border border-app-border bg-app-panel-strong p-4">
        <div className="flex items-start gap-2.5">
          {status === "loading" ? (
            <LoaderCircle
              aria-hidden
              className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-app-functional"
            />
          ) : (
            <CircleAlert
              aria-hidden
              className="mt-0.5 h-4 w-4 shrink-0 text-app-accent"
            />
          )}
          <div className="min-w-0">
            <strong className="block text-xs text-app-ink">
              {t("agent.setupTitle")}
            </strong>
            <p className="mt-1 text-[11px] leading-5 text-app-muted">
              {body}
            </p>
            {error ? (
              <p className="mt-1 break-words text-[10px] leading-4 text-app-danger">
                {errorLabel(t, error.code)}
              </p>
            ) : null}
          </div>
        </div>
        <button
          data-model-settings-trigger="agent"
          className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-app-primary px-3 text-xs font-semibold text-app-on-primary transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional disabled:opacity-45"
          disabled={status === "loading"}
          onClick={onOpenSettings}
          type="button"
        >
          <Settings2 aria-hidden className="h-4 w-4" />
          {t("agent.openModelSettings")}
        </button>
      </div>
    </div>
  );
}

function AgentEmptyState({ onCreate }: { readonly onCreate: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-5 text-center">
      <div>
        <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-app-functional-soft text-app-functional">
          <MessageSquarePlus aria-hidden className="h-5 w-5" />
        </span>
        <h3 className="mt-3 text-sm font-semibold text-app-ink">
          {t("agent.emptyTitle")}
        </h3>
        <p className="mt-1 text-[11px] leading-5 text-app-muted">
          {t("agent.emptyBody")}
        </p>
        <button
          className="mt-4 min-h-10 rounded-lg bg-app-primary px-4 text-xs font-semibold text-app-on-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
          onClick={onCreate}
          type="button"
        >
          {t("agent.createFirst")}
        </button>
      </div>
    </div>
  );
}

function AgentUsage({
  session,
  events,
}: {
  readonly session: AgentSessionMetadata;
  readonly events: ReturnType<typeof useAgentControllerState>["events"];
}) {
  const { t } = useTranslation();
  const usage = events?.sessionUsage ?? session.usage ?? null;
  const context = events?.context
    ? {
        usedTokens: events.context.usedTokens,
        limitTokens: events.context.limitTokens,
        percentage: events.context.limitTokens
          ? Math.min(
              100,
              Math.round(
                (events.context.usedTokens / events.context.limitTokens) * 100,
              ),
            )
          : null,
      }
    : session.context ?? null;
  if (!usage && !context && !session.modelId && !session.cost) return null;
  return (
    <details className="shrink-0 border-t border-app-border bg-app-panel px-3 py-2 text-[9px] text-app-muted">
      <summary className="cursor-pointer font-semibold text-app-ink">
        {t("agent.usageTitle")}
        {context?.percentage !== null && context?.percentage !== undefined
          ? ` · ${Math.round(context.percentage)}%`
          : ""}
      </summary>
      <div className="mt-2 space-y-1 leading-4 tabular-nums">
        {session.modelId ? (
          <p>{t("agent.model", { model: session.modelId })}</p>
        ) : null}
        {context ? (
          <p>
            {context.limitTokens
              ? t("agent.contextUsage", {
                  used: formatTokenCount(context.usedTokens),
                  limit: formatTokenCount(context.limitTokens),
                  percentage: Math.round(context.percentage ?? 0),
                })
              : t("agent.contextUsageUnknown", {
                  used: formatTokenCount(context.usedTokens),
                })}
          </p>
        ) : null}
        {usage ? (
          <>
            <p>
              {t("agent.tokenUsage", {
                input: formatTokenCount(usage.inputTokens),
                output: formatTokenCount(usage.outputTokens),
                reasoning: formatTokenCount(usage.reasoningTokens),
              })}
            </p>
            <p>{t("agent.requestCount", { count: usage.requestCount })}</p>
          </>
        ) : null}
        {session.cost ? (
          <p>
            {t("agent.cost", {
              amount: session.cost.amount,
              currency: session.cost.currency,
            })}
          </p>
        ) : null}
      </div>
    </details>
  );
}

function AgentErrorCard({
  error,
  recoveryCount,
  hasSession,
  onOpenSettings,
  onResume,
  onCreate,
}: {
  readonly error: AgentErrorDetails;
  readonly recoveryCount: number;
  readonly hasSession: boolean;
  readonly onOpenSettings: () => void;
  readonly onResume: () => void;
  readonly onCreate: () => void;
}) {
  const { t } = useTranslation();
  const settingsError = [
    "model_not_configured",
    "proxy_unreachable",
    "invalid_model_list",
    "model_unavailable",
    "authentication_failed",
  ].includes(error.code);
  const resumable = hasSession && [
    "cli_start_failed",
    "cli_crashed",
    "session_resume_failed",
    "timeout",
    "rate_limited",
    "store_failed",
  ].includes(error.code);
  return (
    <div
      className="mx-3 mt-3 shrink-0 rounded-lg border border-app-danger bg-app-danger-soft p-3"
      role="alert"
    >
      <div className="flex items-start gap-2">
        <CircleAlert
          aria-hidden
          className="mt-0.5 h-4 w-4 shrink-0 text-app-danger"
        />
        <div className="min-w-0">
          <strong className="text-xs text-app-danger">
            {t("agent.errorTitle")}
          </strong>
          <p className="mt-1 text-[11px] leading-4 text-app-ink">
            {errorLabel(t, error.code)}
          </p>
          {recoveryCount > 0 ? (
            <p
              className="mt-1 text-[10px] leading-4 text-app-danger"
              data-testid="agent-proposal-recovery-error"
            >
              {t("agent.proposalRecoveryConflict", {
                count: recoveryCount,
              })}
            </p>
          ) : null}
        </div>
      </div>
      {settingsError || resumable || (!hasSession && error.retryable) ? (
        <button
          className="mt-2 min-h-8 w-full rounded-md border border-app-danger px-3 text-[10px] font-semibold text-app-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-danger"
          onClick={settingsError
            ? onOpenSettings
            : resumable
            ? onResume
            : onCreate}
          type="button"
        >
          {settingsError
            ? t("agent.errorActions.settings")
            : resumable
            ? t("agent.errorActions.resume")
            : t("agent.errorActions.newConversation")}
        </button>
      ) : null}
    </div>
  );
}

export function AgentPanel() {
  const { t } = useTranslation();
  const controller = useAgentController();
  const state = useAgentControllerState();
  const model = useAgentModelSettings();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] =
    useState<AgentSessionMetadata | null>(null);
  const [localError, setLocalError] = useState(false);
  const [citationMessage, setCitationMessage] = useState<string | null>(null);

  const run = (operation: () => Promise<unknown>) => {
    setLocalError(false);
    void operation().catch(() => setLocalError(true));
  };
  const createConversation = () => {
    setHistoryOpen(false);
    run(() => controller.createSession(t("agent.newConversation")));
  };
  const resumeActive = () => {
    if (state.activeSessionId) {
      run(() => controller.resumeSession(state.activeSessionId!));
    }
  };
  const navigate = (citation: AgentCitation) => {
    const result = controller.navigateCitation(citation);
    if (result.status === "navigated") {
      setCitationMessage(null);
      return;
    }
    setCitationMessage(
      result.reason === "project_changed"
        ? t("agent.citationUnavailableProject")
        : result.reason === "source_deleted"
        ? t("agent.citationUnavailableDeleted")
        : t("agent.citationUnavailableNavigation"),
    );
  };

  const suggestions = useMemo(
    () => [
      t("agent.suggestionSchedule"),
      t("agent.suggestionChecklist"),
      t("agent.suggestionRewrite"),
    ],
    [t],
  );
  const modelReady = model.snapshot.canSend;
  const visionVerified =
    model.snapshot.capabilities?.imageInput === "verified";
  const setupVisible = !modelReady;
  const proposalRecoveryBlocked =
    state.proposalRecoveryStatus !== "ready" &&
    state.proposalRecoveryStatus !== "inactive";
  const hasTranscript =
    Boolean(state.activeSession && state.events) &&
    (state.events?.messages.length ?? 0) > 0;

  return (
    <aside
      aria-label={t("agent.title")}
      className="agent-panel relative flex min-h-0 min-w-0 flex-col overflow-x-hidden bg-app-panel"
      data-agent-panel="production"
    >
      <AgentHeader
        busy={state.busy || !modelReady || proposalRecoveryBlocked}
        historyOpen={historyOpen}
        onDeleteConversation={() => {
          if (state.activeSession) setDeleteTarget(state.activeSession);
        }}
        onNewConversation={createConversation}
        onOpenHelp={() => setHelpOpen(true)}
        onOpenSettings={model.openSettings}
        onToggleHistory={() => setHistoryOpen((current) => !current)}
        session={state.activeSession}
      />

      {state.switchProject.status === "waiting" ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-app-functional bg-app-functional-soft px-3 py-2 text-[10px] text-app-ink">
          <span className="min-w-0 flex-1">
            {t("agent.queuedSwitch", {
              project: state.switchProject.targetProjectName,
            })}
          </span>
          <button
            className="shrink-0 rounded-md px-2 py-1 font-semibold text-app-functional hover:bg-app-panel-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
            onClick={() => controller.cancelWaitingProjectSwitch()}
            type="button"
          >
            {t("agent.cancelSwitch")}
          </button>
        </div>
      ) : null}

      {helpOpen ? (
        <section className="mx-3 mt-3 shrink-0 rounded-lg border border-app-functional bg-app-functional-soft p-3">
          <div className="flex items-start gap-2">
            <CircleHelp
              aria-hidden
              className="mt-0.5 h-4 w-4 shrink-0 text-app-functional"
            />
            <div className="min-w-0 flex-1">
              <strong className="text-xs text-app-ink">
                {t("agent.helpTitle")}
              </strong>
              <p className="mt-1 text-[10px] leading-4 text-app-muted">
                {t("agent.helpBody")}
              </p>
            </div>
            <button
              aria-label={t("agent.closeHelp")}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-app-muted hover:bg-app-panel-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
              onClick={() => setHelpOpen(false)}
              type="button"
            >
              <X aria-hidden className="h-3.5 w-3.5" />
            </button>
          </div>
        </section>
      ) : null}

      {localError || citationMessage ? (
        <p
          className="mx-3 mt-2 shrink-0 rounded-md border border-app-danger bg-app-danger-soft px-2.5 py-2 text-[10px] text-app-danger"
          role="alert"
        >
          {citationMessage ?? t("agent.actionFailed")}
        </p>
      ) : null}

      {state.error && !setupVisible ? (
        <AgentErrorCard
          error={state.error}
          recoveryCount={state.proposalRecovery.length}
          hasSession={Boolean(state.activeSession)}
          onCreate={createConversation}
          onOpenSettings={model.openSettings}
          onResume={resumeActive}
        />
      ) : null}

      {state.proposalRecoveryStatus === "recovering" ? (
        <div
          className="m-3 rounded-lg border border-app-functional bg-app-functional-soft p-3 text-[11px] text-app-ink"
          data-testid="agent-proposal-recovering"
          role="status"
        >
          {t("agent.proposalRecovering")}
        </div>
      ) : proposalRecoveryBlocked ? (
        <div className="m-3 rounded-lg border border-app-border bg-app-panel-strong p-3 text-[11px] text-app-muted">
          {t("agent.proposalRecoveryUnavailable")}
        </div>
      ) : historyOpen ? (
        <AgentHistory
          activeSessionId={state.activeSessionId}
          busy={state.busy}
          onDelete={setDeleteTarget}
          onRename={(sessionId, title) =>
            run(() => controller.renameSession(sessionId, title))}
          onResume={(sessionId) => {
            setHistoryOpen(false);
            run(() => controller.resumeSession(sessionId));
          }}
          sessions={state.sessions}
        />
      ) : setupVisible ? (
        <AgentSetupState
          error={model.snapshot.error}
          onOpenSettings={model.openSettings}
          status={model.snapshot.status}
        />
      ) : !state.activeSession || !state.events || !state.project ? (
        <AgentEmptyState onCreate={createConversation} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {!hasTranscript ? (
            <div className="shrink-0 px-4 pt-4 text-center">
              <h3 className="text-xs font-semibold text-app-ink">
                {t("agent.emptyTitle")}
              </h3>
              <p className="mt-1 text-[10px] leading-4 text-app-muted">
                {t("agent.emptyBody")}
              </p>
            </div>
          ) : null}
          <AgentTranscript
            events={state.events}
            following={state.autoScroll.following}
            hasNewContent={state.autoScroll.hasNewContent}
            onCitation={navigate}
            onFollowingChange={(following) =>
              controller.setAutoScrollFollowing(following)}
            onResolveInput={(requestId, value) =>
              run(() => controller.resolveInput(requestId, value))}
            onResolvePermission={(requestId, decision) =>
              run(() => controller.resolvePermission(requestId, decision))}
            projectId={state.project.projectId}
            turnContexts={state.turnContexts}
          />
          <div className="max-h-[55%] shrink-0 overflow-y-auto">
            <AgentProposalReview
              onApply={(proposalId, confirmDeletion) =>
                controller.applyProposal(proposalId, confirmDeletion)}
              onAskRevision={(proposalId, feedback) =>
                controller.askProposalRevision(proposalId, feedback)}
              onDiscard={(proposalId) =>
                controller.discardProposal(proposalId)}
              onLocateBlock={(blockId) =>
                navigate({
                  kind: "block",
                  projectId: state.project!.projectId,
                  blockId,
                })}
              onPrepare={(proposalId) =>
                controller.prepareProposal(proposalId)}
              onUndo={() => controller.undoProposalApply()}
              prepared={state.preparedProposal}
              proposals={state.proposals}
            />
          </div>
        </div>
      )}

      {state.activeSession && !historyOpen ? (
        <AgentUsage events={state.events} session={state.activeSession} />
      ) : null}

      {!historyOpen ? (
        <AgentComposer
          draft={state.draft}
          modelReady={modelReady}
          onRemoveContext={(chipId) => controller.removeContextChip(chipId)}
          onSend={(text, includeAttachment) =>
            controller.send(text, { includeAttachment })}
          onSetAttachmentPinned={(pinned) =>
            controller.setAttachmentPinned(pinned)}
          onStop={() => controller.abort()}
          onWriteDraft={(text) => controller.writeDraft(text)}
          requestContext={state.requestContext}
          session={state.activeSession}
          suggestions={!hasTranscript && state.activeSession
            ? suggestions
            : []}
          visionVerified={visionVerified}
        />
      ) : null}

      <ConfirmDialog
        cancelLabel={t("common.cancel")}
        confirmLabel={t("common.delete")}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          const sessionId = deleteTarget.sessionId;
          setDeleteTarget(null);
          run(() => controller.deleteSession(sessionId));
        }}
        open={deleteTarget !== null}
        title={t("agent.deleteConversationNamed", {
          title: deleteTarget?.title ?? "",
        })}
      />
    </aside>
  );
}
