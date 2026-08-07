const WIDE_NAME_CHARACTER =
  /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe6f\uff01-\uff60\uffe0-\uffe6]/u;

export function estimateNameInputWidthEm(value: string): number {
  const textWidth = [...value].reduce((width, character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    if (/\p{Mark}/u.test(character)) {
      return width;
    }
    if (WIDE_NAME_CHARACTER.test(character) || codePoint >= 0x1f000) {
      return width + 1;
    }
    if (/\s/u.test(character)) {
      return width + 0.35;
    }
    return width + 0.62;
  }, 0);

  return Math.max(4, Math.ceil((textWidth + 1) * 10) / 10);
}
