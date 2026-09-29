const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const opening = /[（(［[｛{《〈「『【“‘]$/u;
const closing = /^[，。！？；：、）)］\]｝}》〉」』】”’…,.!?;:]/u;
const graphemes = new Intl.Segmenter("zh", { granularity: "grapheme" });

/** Textkit otherwise treats an unspaced Chinese sentence as one Latin word.
 * Empty syllables supply zero-width glue, without changing text or adding hyphens.
 * Keep Latin words and punctuation pairs intact; use its normal Latin hyphenator.
 */
export function pdfWordBreaks(word: string, fallback: (word: string) => string[] = value => [value]): string[] {
  if (!cjk.test(word)) return fallback(word);
  const parts: string[] = [];
  let current = "";
  let previous = "";
  for (const { segment } of graphemes.segment(word)) {
    if (current && (cjk.test(previous) || cjk.test(segment)) && !opening.test(previous) && !closing.test(segment)) {
      parts.push(current, "");
      current = "";
    }
    current += segment;
    previous = segment;
  }
  if (current) parts.push(current);
  return parts;
}
