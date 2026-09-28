import { useTranslation } from "react-i18next";
import i18n from "./config";

/** Translate application-owned copy, never document text, names, paths or user input. */
export function ui(source: string, values?: Record<string, unknown>): string {
  return i18n.t(source, { ...values, ns: "ui", keySeparator: false, nsSeparator: false, defaultValue: source });
}

/** Subscribe a mounted view without replacing its editor, draft or undo history. */
export function useUiLanguage(): "zh" | "en" {
  const { i18n: instance } = useTranslation("ui");
  return instance.resolvedLanguage === "en" ? "en" : "zh";
}

export function uiLocale(): string {
  return i18n.resolvedLanguage === "en" ? "en-US" : "zh-CN";
}
