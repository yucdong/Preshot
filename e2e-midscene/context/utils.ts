export function generateTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function formatReportFileName(name: string) {
  const withoutControlCharacters = Array.from(name, (character) =>
    character.charCodeAt(0) < 32 ? "-" : character
  ).join("");
  return withoutControlCharacters.replace(/[<>:"/\\|?*]/g, "-");
}
