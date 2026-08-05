export function logicalComponentIdFromDnd(
  data: { componentId?: unknown } | null | undefined,
  fallbackId: string | null,
): string | null {
  if (typeof data?.componentId === "string" && data.componentId.length > 0) {
    return data.componentId;
  }

  return fallbackId;
}
