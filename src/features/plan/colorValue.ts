export interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

function validChannel(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 255;
}

export function validRgb(value: RgbColor): RgbColor | null {
  return validChannel(value.red) && validChannel(value.green) && validChannel(value.blue)
    ? value
    : null;
}

export function hexFromRgb(value: RgbColor): string | null {
  const rgb = validRgb(value);
  if (!rgb) return null;
  return `#${[rgb.red, rgb.green, rgb.blue]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

export function rgbFromHex(value: string): RgbColor | null {
  const normalized = value.trim().replace(/^#/, "");
  const expanded = normalized.length === 3
    ? normalized.split("").map((character) => character.repeat(2)).join("")
    : normalized;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return null;
  return {
    red: Number.parseInt(expanded.slice(0, 2), 16),
    green: Number.parseInt(expanded.slice(2, 4), 16),
    blue: Number.parseInt(expanded.slice(4, 6), 16),
  };
}