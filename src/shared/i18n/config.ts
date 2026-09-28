import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { zh } from "./locales/zh";
import { en } from "./locales/en";
import uiEn from "./locales/ui.en.json";

const uiZh = Object.fromEntries(Object.keys(uiEn).map((key) => [key, key.replace(/_(?:zero|one|two|few|many|other)$/, "")]));

void i18n.use(initReactI18next).init({
  lng: "zh",
  fallbackLng: "zh",
  supportedLngs: ["zh", "en"],
  resources: { zh: { translation: zh, ui: uiZh }, en: { translation: en, ui: uiEn } },
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
