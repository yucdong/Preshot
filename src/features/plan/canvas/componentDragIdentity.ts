export function logicalComponentIdFromDnd(
  data: { componentId?: unknown } | null | undefined,
  fallbackId: string | null,
): string | null {
  if (typeof data?.componentId === "string" && data.componentId.length > 0) {
    return data.componentId;
  }

  if (typeof fallbackId === "string") {
    const fragmentSeparator = fallbackId.indexOf("::");
    if (fragmentSeparator > 0) {
      return fallbackId.slice(0, fragmentSeparator);
    }
  }

  return fallbackId;
}
