import { en, zh } from "@blocknote/core/locales";
import i18n from "../../../shared/i18n/config";

export function editorDictionary(language = i18n.resolvedLanguage) {
  return language === "en" ? en : zh;
}

/** BlockNote 0.53 fixes the dictionary reference at creation. Read through it
 * without recreating the editor or changing document/history transactions. */
export function createLiveEditorDictionary(): typeof en {
  const dictionary = {} as typeof en;
  for (const key of Object.keys(en) as Array<keyof typeof en>) {
    Object.defineProperty(dictionary, key, {
      enumerable: true,
      get: () => editorDictionary()[key],
    });
  }
  return dictionary;
}

/** The built-in placeholder extension writes CSS only when its view mounts. */
export function editorPlaceholderStyles(language: "zh" | "en"): string {
  const { default: defaultText, emptyDocument, ...blocks } = editorDictionary(language).placeholders;
  const scope = `[data-preshot-editor-language="${language}"] .bn-block-content`;
  const rule = (selector: string, text: string) => `${scope}${selector}:has(.ProseMirror-trailingBreak:only-child)::after { content: ${JSON.stringify(text)} !important; }`;
  return [
    ...Object.entries(blocks).flatMap(([type, text]) => text ? [rule(`[data-content-type="${type}"]`, text)] : []),
    rule("[data-is-only-empty-block]", emptyDocument ?? ""),
    rule("[data-is-empty-and-focused]", defaultText ?? ""),
  ].join("\n");
}
