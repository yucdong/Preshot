import { useCallback, useEffect, useRef, useState } from "react";
import type { PlanLoadProgress } from "../../features/plan/blocknote/planLoadProgress";

interface ProjectLoadingAttempt {
  id: number;
  path: string;
  name: string;
  activated: boolean;
  percent: number;
  error: string | null;
}

export function useProjectLoading() {
  const [attempt, setAttempt] = useState<ProjectLoadingAttempt | null>(null);
  const current = useRef<ProjectLoadingAttempt | null>(null);
  const sequence = useRef(0);
  useEffect(() => () => { current.current = null; }, []);
  const publish = useCallback((next: ProjectLoadingAttempt | null) => {
    current.current = next;
    setAttempt(next);
  }, []);
  const begin = useCallback((path: string, name: string) => {
    const next: ProjectLoadingAttempt = {
      id: ++sequence.current, path, name, activated: false, percent: 0, error: null,
    };
    publish(next);
    return next.id;
  }, [publish]);
  const activate = useCallback((id: number, name: string, path?: string) => {
    const previous = current.current;
    if (previous?.id !== id || previous.error) return false;
    publish({ ...previous, name, path: path ?? previous.path, activated: true, percent: 12 });
    return true;
  }, [publish]);
  const report = useCallback((id: number, path: string, progress: PlanLoadProgress) => {
    const previous = current.current;
    if (previous?.id !== id || previous.path !== path || previous.error) return;
    if (progress.status === "failed") {
      publish({ ...previous, error: progress.message });
    } else if (previous.activated) {
      const percent = progress.status === "ready" ? 100 : Math.min(97, progress.percent);
      publish({ ...previous, percent: Math.max(previous.percent, percent) });
    }
  }, [publish]);
  const finish = useCallback((id: number) => {
    const previous = current.current;
    if (previous?.id === id && previous.percent === 100 && !previous.error) publish(null);
  }, [publish]);
  const cancel = useCallback(() => {
    publish(null);
  }, [publish]);
  const isPending = useCallback(() => current.current !== null && current.current.error === null, []);
  return { attempt, begin, activate, report, finish, cancel, isPending };
}
