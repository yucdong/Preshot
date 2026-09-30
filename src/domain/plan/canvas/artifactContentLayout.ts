export interface ArtifactContentLayout {
  orientation: "vertical" | "horizontal";
  textFirst: boolean;
  textShare: number;
  minHeight: number;
}

export const DEFAULT_ARTIFACT_CONTENT_LAYOUT: ArtifactContentLayout = {
  orientation: "vertical", textFirst: true, textShare: 0.25, minHeight: 320,
};

export function validateArtifactContentLayout(value: unknown): ArtifactContentLayout {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid card layout");
  const layout = value as Record<string, unknown>;
  if (Object.keys(layout).some(key => !["orientation", "textFirst", "textShare", "minHeight"].includes(key)) ||
    !["vertical", "horizontal"].includes(String(layout.orientation)) || typeof layout.textFirst !== "boolean" ||
    typeof layout.textShare !== "number" || !Number.isFinite(layout.textShare) || layout.textShare < 0.1 || layout.textShare > 0.9 ||
    typeof layout.minHeight !== "number" || !Number.isFinite(layout.minHeight) || layout.minHeight < 160 || layout.minHeight > 4000) {
    throw new Error("Invalid card layout");
  }
  return { ...layout } as unknown as ArtifactContentLayout;
}

export function resolveArtifactContentLayout(layout: ArtifactContentLayout | undefined, width: number): ArtifactContentLayout {
  const resolved = layout ?? DEFAULT_ARTIFACT_CONTENT_LAYOUT;
  return { ...resolved, orientation: width <= 430 ? "vertical" : resolved.orientation };
}
