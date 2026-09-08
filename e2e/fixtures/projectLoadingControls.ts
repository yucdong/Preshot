export interface ProjectLoadingControls {
  pause(): void;
  resume(): void;
  failNextPlan(): void;
}

declare global {
  interface Window {
    __PRESHOT_PROJECT_LOADING__: ProjectLoadingControls;
  }
}
