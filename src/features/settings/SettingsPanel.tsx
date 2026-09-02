import { useEffect, useRef } from "react";
import {
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../app/theme/ThemeContext";
import type { AgentErrorCode } from "../../domain/agent";
import type {
  AgentReasoningEffort,
  AgentReasoningSummary,
} from "../../domain/agent/models";
import type { Theme } from "../../domain/settings/models";
import { useAgentModelSettings } from "../agent/useAgentModelSettings";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

const inputClassName =
  "w-full rounded-lg border border-app-border bg-app-bg px-3 py-2 text-sm text-app-ink transition-colors placeholder:text-app-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional disabled:cursor-not-allowed disabled:opacity-60";

function errorCopy(code: AgentErrorCode | undefined): string {
  switch (code) {
    case "model_not_configured":
      return "代理地址无效。请检查地址后重试。";
    case "proxy_unreachable":
      return "无法连接模型代理。请确认代理已启动且地址可访问。";
    case "invalid_model_list":
      return "代理返回了无效的模型列表。";
    case "model_unavailable":
      return "所选模型未通过 Responses、流式输出和工具往返验证。";
    case "timeout":
      return "连接测试超时，请重试。";
    case "cancelled":
      return "测试已取消，需要重新测试。";
    case "refused":
    case "safety_blocked":
      return "模型拒绝了能力验证请求，请选择其他模型。";
    case "store_failed":
      return "模型设置无法保存，请检查本机设置文件。";
    default:
      return "模型设置操作失败，请重试。";
  }
}

function capabilityLabel(value: "verified" | "unsupported" | "unknown") {
  if (value === "verified") return "已验证";
  if (value === "unsupported") return "不支持";
  return "未验证";
}

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { controller, snapshot } = useAgentModelSettings();
  const dialogRef = useRef<HTMLDivElement>(null);
  const proxyInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      )];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (
      open &&
      snapshot.error?.code === "model_not_configured" &&
      snapshot.error.phase === "settings"
    ) {
      proxyInputRef.current?.focus();
    }
  }, [open, snapshot.error]);

  if (!open) return null;

  const handleBackdropClick = (event: React.MouseEvent) => {
    if (event.target === event.currentTarget) onClose();
  };
  const themeOptions: Array<{ value: Theme; label: string }> = [
    { value: "light", label: t("settings.themeLight") },
    { value: "dark", label: t("settings.themeDark") },
    { value: "system", label: t("settings.themeSystem") },
  ];
  const testing = snapshot.status === "testing";
  const capabilities = snapshot.capabilities;
  const hasConfiguration =
    snapshot.settings.modelId !== null ||
    snapshot.displayUrlDraft !== "http://localhost:4141";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
      onClick={handleBackdropClick}
    >
      <div
        ref={dialogRef}
        aria-label={t("settings.title")}
        aria-modal="true"
        className="max-h-[min(760px,calc(100vh-32px))] w-full max-w-2xl overflow-y-auto rounded-xl border border-app-border bg-app-panel-strong p-5 text-app-ink shadow-[var(--app-shadow)] focus:outline-none"
        role="dialog"
        tabIndex={-1}
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">{t("settings.title")}</h2>
          <button
            aria-label={t("settings.close")}
            className="rounded-lg p-2 text-app-muted transition-colors hover:bg-app-primary-soft hover:text-app-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-6">
          <section aria-labelledby="appearance-settings-heading">
            <h3
              className="mb-2 text-sm font-semibold text-app-ink"
              id="appearance-settings-heading"
            >
              {t("settings.appearance")}
            </h3>
            <label className="mb-2 block text-sm font-medium text-app-muted">
              {t("settings.theme")}
            </label>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-app-bg p-1">
              {themeOptions.map((option) => (
                <button
                  key={option.value}
                  aria-pressed={theme === option.value}
                  className={`rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional ${
                    theme === option.value
                      ? "bg-app-primary text-app-on-primary shadow-sm"
                      : "text-app-muted hover:bg-app-panel-strong hover:text-app-ink"
                  }`}
                  onClick={() => setTheme(option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </section>

          <section
            aria-labelledby="assistant-settings-heading"
            className="border-t border-app-border pt-5"
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3
                  className="text-sm font-semibold text-app-ink"
                  id="assistant-settings-heading"
                >
                  {t("settings.agent.title")}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-app-muted">
                  {t("settings.agent.description")}
                </p>
              </div>
              {snapshot.status === "ready" ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 aria-hidden className="h-3.5 w-3.5" />
                  {t("settings.agent.connected")}
                </span>
              ) : snapshot.status === "requires_retest" ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                  <RefreshCw aria-hidden className="h-3.5 w-3.5" />
                  {t("settings.agent.requiresRetest")}
                </span>
              ) : null}
            </div>

            <div className="space-y-4">
              <div>
                <label
                  className="mb-1.5 block text-sm font-medium"
                  htmlFor="agent-proxy-url"
                >
                  {t("settings.agent.proxyUrl")}
                </label>
                <input
                  ref={proxyInputRef}
                  aria-describedby={
                    snapshot.error?.code === "model_not_configured"
                      ? "agent-proxy-help agent-settings-error"
                      : "agent-proxy-help"
                  }
                  aria-invalid={
                    snapshot.error?.code === "model_not_configured"
                      ? "true"
                      : undefined
                  }
                  className={inputClassName}
                  disabled={testing}
                  id="agent-proxy-url"
                  inputMode="url"
                  onBlur={() => void controller.commitDisplayUrl()}
                  onChange={(event) =>
                    controller.editDisplayUrl(event.currentTarget.value)}
                  spellCheck={false}
                  type="url"
                  value={snapshot.displayUrlDraft}
                />
                <p
                  className="mt-1.5 text-xs leading-relaxed text-app-muted"
                  id="agent-proxy-help"
                >
                  {t("settings.agent.proxyHelp")}
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    className="mb-1.5 block text-sm font-medium"
                    htmlFor="agent-model"
                  >
                    {t("settings.agent.model")}
                  </label>
                  <select
                    className={inputClassName}
                    disabled={testing || snapshot.models.length === 0}
                    id="agent-model"
                    onChange={(event) =>
                      void controller.selectModel(event.currentTarget.value)}
                    value={snapshot.settings.modelId ?? ""}
                  >
                    <option value="">
                      {snapshot.models.length === 0
                        ? t("settings.agent.discoverFirst")
                        : t("settings.agent.selectModel")}
                    </option>
                    {snapshot.models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.displayName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    className="mb-1.5 block text-sm font-medium"
                    htmlFor="agent-wire-api"
                  >
                    {t("settings.agent.apiMode")}
                  </label>
                  <input
                    className={inputClassName}
                    id="agent-wire-api"
                    readOnly
                    value="Responses API"
                  />
                </div>
              </div>

              {snapshot.error ? (
                <div
                  id="agent-settings-error"
                  aria-live="assertive"
                  className="flex gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs leading-relaxed text-red-700 dark:text-red-300"
                  role="alert"
                >
                  <CircleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{errorCopy(snapshot.error.code)}</span>
                </div>
              ) : null}

              <div className="rounded-lg border border-app-border bg-app-bg p-3">
                <p className="text-xs leading-relaxed text-app-muted">
                  {t("settings.agent.probeDisclosure")}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-app-primary px-4 py-2 text-sm font-semibold text-app-on-primary transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={snapshot.status === "loading"}
                    onClick={() => {
                      if (testing) controller.cancelProbe();
                      else void controller.testConnection();
                    }}
                    type="button"
                  >
                    {testing ? (
                      <>
                        <X aria-hidden className="h-4 w-4" />
                        {t("settings.agent.cancelTest")}
                      </>
                    ) : (
                      <>
                        <RefreshCw aria-hidden className="h-4 w-4" />
                        {snapshot.status === "ready"
                          ? t("settings.agent.retest")
                          : t("settings.agent.testConnection")}
                      </>
                    )}
                  </button>
                  {snapshot.status === "ready" &&
                  capabilities?.imageInput !== "verified" ? (
                    <button
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-app-border bg-app-panel-strong px-4 py-2 text-sm font-semibold text-app-ink transition-colors hover:bg-app-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
                      onClick={() => void controller.verifyVision()}
                      type="button"
                    >
                      {t("settings.agent.verifyVision")}
                    </button>
                  ) : null}
                </div>
              </div>

              {capabilities ? (
                <div aria-label={t("settings.agent.capabilities")} className="space-y-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {([
                      ["Responses API", capabilities.responsesApi],
                      [t("settings.agent.streaming"), capabilities.streaming],
                      [t("settings.agent.customTools"), capabilities.customTools],
                      [t("settings.agent.imageInput"), capabilities.imageInput],
                    ] as const).map(([label, value]) => (
                      <div
                        key={label}
                        className="flex items-center justify-between rounded-lg border border-app-border px-3 py-2 text-xs"
                      >
                        <span className="text-app-muted">{label}</span>
                        <strong className="text-app-ink">
                          {capabilityLabel(value)}
                        </strong>
                      </div>
                    ))}
                  </div>
                  {capabilities.contextWindowTokens !== null ? (
                    <p className="text-xs text-app-muted">
                      {t("settings.agent.contextLimit", {
                        count: capabilities.contextWindowTokens,
                      })}
                    </p>
                  ) : null}
                  {snapshot.usage ? (
                    <p className="text-xs text-app-muted">
                      {t("settings.agent.probeUsage", {
                        count:
                          snapshot.usage.inputTokens +
                          snapshot.usage.outputTokens +
                          snapshot.usage.reasoningTokens,
                      })}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {capabilities?.reasoningEffort ||
              capabilities?.reasoningSummary ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {capabilities.reasoningEffort ? (
                    <div>
                      <label
                        className="mb-1.5 block text-sm font-medium"
                        htmlFor="agent-reasoning-effort"
                      >
                        {t("settings.agent.reasoningEffort")}
                      </label>
                      <select
                        className={inputClassName}
                        id="agent-reasoning-effort"
                        onChange={(event) =>
                          void controller.setReasoningEffort(
                            (event.currentTarget.value || null) as
                              AgentReasoningEffort | null,
                          )}
                        value={snapshot.settings.reasoningEffort ?? ""}
                      >
                        <option value="">{t("settings.agent.reasoningDefault")}</option>
                        <option value="low">{t("settings.agent.reasoningLow")}</option>
                        <option value="medium">{t("settings.agent.reasoningMedium")}</option>
                        <option value="high">{t("settings.agent.reasoningHigh")}</option>
                        <option value="xhigh">{t("settings.agent.reasoningXHigh")}</option>
                      </select>
                    </div>
                  ) : null}
                  {capabilities.reasoningSummary ? (
                    <div>
                      <label
                        className="mb-1.5 block text-sm font-medium"
                        htmlFor="agent-reasoning-summary"
                      >
                        {t("settings.agent.reasoningSummary")}
                      </label>
                      <select
                        className={inputClassName}
                        id="agent-reasoning-summary"
                        onChange={(event) =>
                          void controller.setReasoningSummary(
                            event.currentTarget.value as AgentReasoningSummary,
                          )}
                        value={snapshot.settings.reasoningSummary}
                      >
                        <option value="none">{t("settings.agent.summaryNone")}</option>
                        <option value="concise">{t("settings.agent.summaryConcise")}</option>
                        <option value="detailed">{t("settings.agent.summaryDetailed")}</option>
                      </select>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {hasConfiguration ? (
                <button
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:text-red-300"
                  disabled={testing}
                  onClick={() => void controller.removeConfiguration()}
                  type="button"
                >
                  <Trash2 aria-hidden className="h-4 w-4" />
                  {t("settings.agent.remove")}
                </button>
              ) : null}
              {testing ? (
                <p
                  aria-live="polite"
                  className="inline-flex items-center gap-2 text-xs text-app-muted"
                  role="status"
                >
                  <LoaderCircle
                    aria-hidden
                    className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  />
                  {snapshot.operation === "vision"
                    ? t("settings.agent.testingVision")
                    : t("settings.agent.testingConnection")}
                </p>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
