import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { App } from "./app/App";
import { ErrorBoundary } from "./app/ErrorBoundary";
import i18n from "./shared/i18n/config";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Unable to start Preshot: missing root element");
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <I18nextProvider i18n={i18n}>
        <App />
      </I18nextProvider>
    </ErrorBoundary>
  </StrictMode>,
);
