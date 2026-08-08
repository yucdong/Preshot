import { Component, type ErrorInfo, type PropsWithChildren } from "react";
import i18n from "../shared/i18n/config";

interface ErrorBoundaryState {
  failed: boolean;
}

export class ErrorBoundary extends Component<
  PropsWithChildren,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unexpected application render failure", error, info);
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="grid min-h-screen place-items-center bg-app-bg p-8 text-app-ink">
          <section role="alert" className="max-w-md text-center">
            <h1 className="text-2xl font-semibold">
              {i18n.t("errors.boundaryTitle")}
            </h1>
            <p className="mt-3 text-app-muted">
              {i18n.t("errors.boundaryBody")}
            </p>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
