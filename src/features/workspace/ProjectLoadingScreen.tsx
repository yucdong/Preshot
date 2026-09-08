import { Check, FileText } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import "./ProjectLoadingScreen.css";

interface ProjectLoadingScreenProps {
  projectName: string;
  progress: number;
  error?: string | null;
  statusText?: string;
  onRetry?: () => void;
  onComplete: () => void;
}

const stages = [
  { label: "准备", message: "正在准备项目…" },
  { label: "方案", message: "正在读取拍摄方案…" },
  { label: "图片", message: "正在加载参考图片…" },
  { label: "画布", message: "正在整理画布…" },
];

export function ProjectLoadingScreen({
  projectName,
  progress,
  error,
  statusText,
  onRetry,
  onComplete,
}: ProjectLoadingScreenProps) {
  const [value, setValue] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const valueRef = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const latest = useRef({ error, onComplete });
  const completedRef = useRef(false);
  const stageId = useId();
  const hasError = Boolean(error);
  const displayed = Math.floor(value);
  const complete = displayed === 100 && !hasError;

  useLayoutEffect(() => {
    latest.current = { error, onComplete };
  }, [error, onComplete]);

  useLayoutEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const from = valueRef.current;
    if (hasError || progress <= from) return;

    const duration = Math.min(650, Math.max(180, (progress - from) * 6.5));
    let started: number | undefined;
    let cancelled = false;
    let frame: number;

    function tick(now: number) {
      if (cancelled || latest.current.error) return;
      started ??= now;
      const fraction = Math.min(1, Math.max(0, now - started) / duration);
      const next = fraction === 1
        ? progress
        : Math.min(progress, from + (progress - from) * (1 - (1 - fraction) ** 3));
      valueRef.current = next;
      setValue(next);
      if (fraction < 1) frame = requestAnimationFrame(tick);
    }

    frame = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [hasError, progress]);

  useEffect(() => {
    if (!complete || completedRef.current) return;

    let cancelled = false;
    let fadeTimer: ReturnType<typeof setTimeout> | undefined;

    function finish() {
      if (cancelled || latest.current.error || completedRef.current) return;
      completedRef.current = true;
      latest.current.onComplete();
    }

    const holdTimer = setTimeout(() => {
      if (cancelled || latest.current.error) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        finish();
        return;
      }
      setLeaving(true);
      fadeTimer = setTimeout(finish, 180);
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(holdTimer);
      clearTimeout(fadeTimer);
    };
  }, [complete]);

  const stageIndex = displayed < 12 ? 0 : displayed < 30 ? 1 : displayed < 84 ? 2 : 3;
  const announcement = hasError
    ? "项目加载未完成"
    : complete ? "已准备就绪" : stages[stageIndex].message;
  const visibleStatus = hasError || complete ? announcement : statusText || announcement;
  const state = hasError ? "error" : complete ? leaving ? "leaving" : "complete" : "loading";

  return (
    <section
      className="project-loading-screen"
      aria-label="项目加载"
      data-testid="project-loading-screen"
      data-state={state}
    >
      <div className="project-loading-screen__card">
        <div className="project-loading-screen__heading">
          <span className="project-loading-screen__icon" aria-hidden="true">
            {complete ? <Check size={23} strokeWidth={2} /> : <FileText size={23} strokeWidth={1.65} />}
          </span>
          <div className="project-loading-screen__identity">
            <p className="project-loading-screen__eyebrow">
              {hasError ? "需要重试" : complete ? "项目已就绪" : "正在切换项目"}
            </p>
            <h1 ref={headingRef} tabIndex={-1} title={projectName} className="project-loading-screen__name">
              {projectName}
            </h1>
          </div>
        </div>

        <div className="project-loading-screen__meta">
          <span
            className="project-loading-screen__stage"
            title={visibleStatus}
            aria-hidden={!statusText || hasError || complete}
          >
            {visibleStatus}
          </span>
          <strong className="project-loading-screen__percentage" aria-hidden="true">
            <span>{displayed}</span><span>%</span>
          </strong>
        </div>
        <span id={stageId} className="project-loading-screen__announcement" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </span>
        <div
          className="project-loading-screen__track"
          role="progressbar"
          aria-label="项目加载进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={displayed}
          aria-describedby={stageId}
        >
          <div
            className="project-loading-screen__fill"
            data-testid="project-loading-fill"
            style={{ transform: `scaleX(${value / 100})` }}
          />
        </div>
        <ol className="project-loading-screen__steps" aria-label="加载阶段">
          {stages.map((stage, index) => {
            const done = complete || index < stageIndex;
            const active = !complete && index === stageIndex;
            return (
              <li
                key={stage.label}
                data-state={done ? "done" : active ? "active" : "pending"}
                aria-current={active ? "step" : undefined}
              >
                <span className="project-loading-screen__step-dot" aria-hidden="true">
                  {done && <Check size={10} strokeWidth={1.6} />}
                </span>
                {stage.label}
              </li>
            );
          })}
        </ol>
        <div className="project-loading-screen__feedback">
          {hasError ? (
            <div className="project-loading-screen__failure">
              <p role="alert" tabIndex={0}>{error}</p>
              {onRetry && <button type="button" onClick={onRetry}>重试加载</button>}
            </div>
          ) : (
            <p className="project-loading-screen__hint">
              {complete ? "即将进入项目" : "加载完成后，将自动进入项目"}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
