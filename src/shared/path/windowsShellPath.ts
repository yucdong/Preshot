const VERBATIM_PREFIX = "\\\\?\\";
const VERBATIM_UNC_PREFIX = "\\\\?\\UNC\\";

export function normalizeWindowsShellPath(path: string): string {
  if (
    path
      .slice(0, VERBATIM_UNC_PREFIX.length)
      .toUpperCase() === VERBATIM_UNC_PREFIX.toUpperCase()
  ) {
    return `\\\\${path.slice(VERBATIM_UNC_PREFIX.length)}`;
  }

  const verbatimDrivePath = path.slice(VERBATIM_PREFIX.length);
  if (
    path.startsWith(VERBATIM_PREFIX) &&
    /^[A-Za-z]:[\\/]/.test(verbatimDrivePath)
  ) {
    return verbatimDrivePath;
  }

  return path;
}
