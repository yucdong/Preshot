import { createContext, useContext } from "react";
import type { Language } from "../../domain/settings/models";

export const LanguageContext = createContext<{
  language: Language;
  setLanguage(language: Language): void;
  saveError: boolean;
}>({ language: "zh", setLanguage: () => undefined, saveError: false });

export function useLanguagePreferences() {
  return useContext(LanguageContext);
}
