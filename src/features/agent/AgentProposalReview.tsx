import {
  CheckCircle2,
  CircleAlert,
  FileDiff,
  LocateFixed,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  AgentPreparedProposal,
  AgentProposalApplyIntentResult,
  AgentProposalPrepareResult,
  AgentProposalUndoIntentResult,
  AgentStoredProposal,
} from "../../domain/agent";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";

interface AgentProposalReviewProps {
  readonly proposals: readonly AgentStoredProposal[];
  readonly prepared: AgentPreparedProposal | null;
  readonly onPrepare: (proposalId: string) => Promise<AgentProposalPrepareResult>;
  readonly onApply: (
    proposalId: string,
    confirmDeletion?: boolean,
  ) => Promise<AgentProposalApplyIntentResult>;
  readonly onDiscard: (proposalId: string) => Promise<void>;
  readonly onAskRevision: (
    proposalId: string,
    feedback: string,
  ) => Promise<void>;
  readonly onUndo: () => Promise<AgentProposalUndoIntentResult>;
  readonly onLocateBlock: (blockId: string) => void;
}

type Feedback =
  | { readonly kind: "invalid" | "stale" | "applied" | "discarded" | "undone" }
  | {
      readonly kind: "conflict";
      readonly blockIds: readonly string[];
    }
  | null;

export function AgentProposalReview({
  proposals,
  prepared,
  onPrepare,
  onApply,
  onDiscard,
  onAskRevision,
  onUndo,
  onLocateBlock,
}: AgentProposalReviewProps) {
  const { t } = useTranslation();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [revisionId, setRevisionId] = useState<string | null>(null);
  const [revisionText, setRevisionText] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    readonly proposalId: string;
    readonly count: number;
  } | null>(null);

  const run = async (proposalId: string, action: () => Promise<void>) => {
    setBusyId(proposalId);
    setFeedback(null);
    try {
      await action();
    } finally {
      setBusyId(null);
    }
  };

  const prepare = (proposalId: string) =>
    run(proposalId, async () => {
      const result = await onPrepare(proposalId);
      if (result.status === "stale") setFeedback({ kind: "stale" });
      if (result.status === "invalid") setFeedback({ kind: "invalid" });
    });

  const apply = (
    proposalId: string,
    confirmDeletion = false,
  ) =>
    run(proposalId, async () => {
      const result = await onApply(proposalId, confirmDeletion);
      if (result.status === "delete_confirmation_required") {
        setDeleteConfirmation({
          proposalId,
          count: result.deleteCount,
        });
      } else if (result.status === "applied") {
        setDeleteConfirmation(null);
        setFeedback({ kind: "applied" });
      } else if (result.status === "stale") {
        setFeedback({ kind: "stale" });
      } else if (result.status === "invalid") {
        setFeedback({ kind: "invalid" });
      }
    });

  const activePreparedId = prepared?.proposal.proposalId ?? null;
  const visible = proposals.filter((proposal) =>
    proposal.status === "staged" ||
    proposal.status === "stale" ||
    proposal.status === "applied" ||
    proposal.status === "undone"
  );

  if (visible.length === 0 && !feedback) return null;

  return (
    <section
      aria-label={t("agent.proposalTitle")}
      className="space-y-2 px-3 pb-3"
    >
      {feedback ? (
        <div
          className={`rounded-lg border p-3 text-[11px] ${
            feedback.kind === "invalid" ||
              feedback.kind === "stale" ||
              feedback.kind === "conflict"
              ? "border-app-danger bg-app-danger-soft text-app-danger"
              : "border-app-functional bg-app-functional-soft text-app-ink"
          }`}
          role="status"
        >
          <div className="flex items-start gap-2">
            {feedback.kind === "invalid" ||
                feedback.kind === "stale" ||
                feedback.kind === "conflict"
              ? <CircleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              : <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-app-functional" />}
            <span>
              {feedback.kind === "invalid"
                ? t("agent.proposalInvalid")
                : feedback.kind === "stale"
                ? t("agent.proposalStale")
                : feedback.kind === "applied"
                ? t("agent.proposalApplied")
                : feedback.kind === "discarded"
                ? t("agent.proposalDiscarded")
                : feedback.kind === "undone"
                ? t("agent.proposalUndone")
                : t("agent.undoConflict")}
            </span>
          </div>
          {feedback.kind === "conflict" ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {feedback.blockIds.map((blockId) => (
                <button
                  className="inline-flex min-h-7 items-center gap-1 rounded-md border border-app-danger px-2 text-[10px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-danger"
                  key={blockId}
                  onClick={() => onLocateBlock(blockId)}
                  type="button"
                >
                  <LocateFixed aria-hidden className="h-3 w-3" />
                  {t("agent.locateBlock")}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {visible.map((proposal) => {
        const isPrepared = activePreparedId === proposal.proposalId;
        const preparedProposal = isPrepared ? prepared : null;
        if (proposal.status === "applied") {
          return (
            <article
              className="rounded-lg border border-app-functional bg-app-functional-soft p-3"
              key={proposal.proposalId}
            >
              <div className="flex items-start gap-2">
                <CheckCircle2
                  aria-hidden
                  className="mt-0.5 h-4 w-4 shrink-0 text-app-functional"
                />
                <div className="min-w-0 flex-1">
                  <strong className="block text-xs text-app-ink">
                    {t("agent.proposalApplied")}
                  </strong>
                  <p className="mt-1 break-words text-[10px] leading-4 text-app-muted">
                    {proposal.summary}
                  </p>
                </div>
              </div>
              <button
                className="mt-2 inline-flex min-h-8 w-full items-center justify-center gap-1.5 rounded-md border border-app-border bg-app-panel-strong px-3 text-[11px] font-semibold text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional disabled:opacity-45"
                disabled={busyId !== null}
                onClick={() =>
                  void run(proposal.proposalId, async () => {
                    const result = await onUndo();
                    if (result.status === "undone") {
                      setFeedback({ kind: "undone" });
                    } else if (result.status === "conflict") {
                      setFeedback({
                        kind: "conflict",
                        blockIds: result.affectedBlockIds,
                      });
                    }
                  })}
                type="button"
              >
                <RotateCcw aria-hidden className="h-3.5 w-3.5" />
                {t("agent.undoApply")}
              </button>
            </article>
          );
        }
        if (proposal.status === "undone") {
          return (
            <div
              className="rounded-md border border-app-border bg-app-panel px-3 py-2 text-[10px] text-app-muted"
              key={proposal.proposalId}
            >
              {t("agent.proposalUndone")} · {proposal.summary}
            </div>
          );
        }
        if (proposal.status === "stale") {
          return (
            <div
              className="rounded-lg border border-app-danger bg-app-danger-soft p-3 text-[11px] text-app-danger"
              key={proposal.proposalId}
            >
              <strong className="block">{t("agent.proposalStale")}</strong>
              <p className="mt-1 text-[10px]">{proposal.summary}</p>
            </div>
          );
        }
        return (
          <article
            className="rounded-lg border border-app-border bg-app-panel-strong p-3"
            key={proposal.proposalId}
          >
            <div className="flex items-start gap-2">
              <FileDiff
                aria-hidden
                className="mt-0.5 h-4 w-4 shrink-0 text-app-functional"
              />
              <div className="min-w-0 flex-1">
                <strong className="block text-xs text-app-ink">
                  {t("agent.proposalTitle")}
                </strong>
                <p className="mt-1 break-words text-[10px] leading-4 text-app-muted">
                  {proposal.summary}
                </p>
                <span className="mt-1 block text-[9px] text-app-muted">
                  {t("agent.proposalOperationCount", {
                    count: proposal.operationCount,
                  })}
                </span>
              </div>
            </div>

            {!preparedProposal ? (
              <button
                className="mt-3 min-h-9 w-full rounded-md bg-app-primary px-3 text-[11px] font-semibold text-app-on-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional disabled:opacity-45"
                disabled={busyId !== null}
                onClick={() => void prepare(proposal.proposalId)}
                type="button"
              >
                {busyId === proposal.proposalId
                  ? t("agent.proposalPreparing")
                  : t("agent.proposalReview")}
              </button>
            ) : (
              <>
                <p className="mt-3 text-[10px] font-semibold text-app-muted">
                  {t("agent.proposalSummary", {
                    add: preparedProposal.diff.counts.add,
                    edit: preparedProposal.diff.counts.edit,
                    remove: preparedProposal.diff.counts.delete,
                  })}
                </p>
                <div className="mt-2 space-y-2">
                  {preparedProposal.diff.items.map((item) => (
                    <article
                      className="rounded-md border border-app-border bg-app-panel p-2.5"
                      key={item.key}
                    >
                      <div className="flex items-center gap-2">
                        <strong
                          className={`text-[10px] ${
                            item.kind === "delete"
                              ? "text-app-danger"
                              : "text-app-ink"
                          }`}
                        >
                          {item.kind === "add"
                            ? t("agent.proposalAdd")
                            : item.kind === "edit"
                            ? t("agent.proposalEdit")
                            : t("agent.proposalDelete")}
                        </strong>
                        <button
                          aria-label={t("agent.locateBlock")}
                          className="ml-auto grid h-7 w-7 place-items-center rounded-md text-app-muted hover:bg-app-primary-soft hover:text-app-functional focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
                          onClick={() => onLocateBlock(item.blockId)}
                          type="button"
                        >
                          <LocateFixed aria-hidden className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {item.before !== null ? (
                        <div className="mt-2">
                          <span className="text-[9px] font-semibold text-app-muted">
                            {t("agent.before")}
                          </span>
                          <p className="mt-1 whitespace-pre-wrap break-words rounded bg-app-danger-soft px-2 py-1.5 text-[10px] leading-4 text-app-ink">
                            {item.before || t("agent.emptyText")}
                          </p>
                        </div>
                      ) : null}
                      {item.after !== null ? (
                        <div className="mt-2">
                          <span className="text-[9px] font-semibold text-app-muted">
                            {t("agent.after")}
                          </span>
                          <p className="mt-1 whitespace-pre-wrap break-words rounded bg-app-functional-soft px-2 py-1.5 text-[10px] leading-4 text-app-ink">
                            {item.after || t("agent.emptyText")}
                          </p>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>

                {revisionId === proposal.proposalId ? (
                  <form
                    className="mt-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const value = revisionText.trim();
                      if (!value) return;
                      void run(proposal.proposalId, async () => {
                        await onAskRevision(proposal.proposalId, value);
                        setRevisionId(null);
                        setRevisionText("");
                      });
                    }}
                  >
                    <label
                      className="mb-1 block text-[10px] font-semibold text-app-ink"
                      htmlFor={`revision-${proposal.proposalId}`}
                    >
                      {t("agent.revisionLabel")}
                    </label>
                    <textarea
                      className="min-h-20 w-full resize-y rounded-md border border-app-border bg-app-panel-strong px-2 py-1.5 text-xs text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
                      id={`revision-${proposal.proposalId}`}
                      maxLength={4000}
                      onChange={(event) => setRevisionText(event.target.value)}
                      value={revisionText}
                    />
                    <button
                      className="mt-2 min-h-8 w-full rounded-md border border-app-functional px-3 text-[11px] font-semibold text-app-functional focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional disabled:opacity-45"
                      disabled={!revisionText.trim() || busyId !== null}
                      type="submit"
                    >
                      {t("agent.sendRevision")}
                    </button>
                  </form>
                ) : null}

                <div className="agent-proposal-actions mt-3 grid gap-2">
                  <button
                    className="agent-proposal-primary min-h-9 rounded-md bg-app-primary px-3 text-[11px] font-semibold text-app-on-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional disabled:opacity-45"
                    disabled={busyId !== null}
                    onClick={() => void apply(proposal.proposalId)}
                    type="button"
                  >
                    {busyId === proposal.proposalId
                      ? t("agent.applyingChanges")
                      : t("agent.applyChanges")}
                  </button>
                  <button
                    className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-app-border px-2 text-[10px] font-semibold text-app-muted hover:bg-app-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
                    onClick={() => {
                      setRevisionId(proposal.proposalId);
                      setRevisionText("");
                    }}
                    type="button"
                  >
                    <FileDiff aria-hidden className="h-3.5 w-3.5" />
                    {t("agent.askRevisions")}
                  </button>
                  <button
                    className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-app-danger px-2 text-[10px] font-semibold text-app-danger hover:bg-app-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-danger"
                    onClick={() =>
                      void run(proposal.proposalId, async () => {
                        await onDiscard(proposal.proposalId);
                        setFeedback({ kind: "discarded" });
                      })}
                    type="button"
                  >
                    <XCircle aria-hidden className="h-3.5 w-3.5" />
                    {t("agent.discardProposal")}
                  </button>
                </div>
              </>
            )}
          </article>
        );
      })}

      <ConfirmDialog
        cancelLabel={t("common.cancel")}
        confirmLabel={t("agent.applyChanges")}
        confirmDisabled={busyId !== null}
        onCancel={() => setDeleteConfirmation(null)}
        onConfirm={() => {
          if (deleteConfirmation) {
            void apply(deleteConfirmation.proposalId, true);
          }
        }}
        open={deleteConfirmation !== null}
        title={t("agent.deleteConfirm", {
          count: deleteConfirmation?.count ?? 0,
        })}
      />
    </section>
  );
}
