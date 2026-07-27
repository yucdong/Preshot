import { Component, type ErrorInfo, type PropsWithChildren } from "react";

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
        <main className="grid min-h-screen place-items-center bg-stone-950 p-8 text-stone-100">
          <section role="alert" className="max-w-md text-center">
            <h1 className="text-2xl font-semibold">
              Preshot could not render this view
            </h1>
            <p className="mt-3 text-stone-400">
              Restart the application. If the problem continues, preserve the
              project files and report the error.
            </p>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
