export const IMAGE_GROUP_NODE_NAME = "image-group";

export function imageGroupMarker(groupId: string): string {
  return `<figure data-preshot-node="${IMAGE_GROUP_NODE_NAME}" data-preshot-group-id="${encodeURIComponent(groupId)}"></figure>`;
}

export function imageGroupIdsInHtml(html: string): string[] {
  const ids: string[] = [];
  for (const match of html.matchAll(/<figure\b[^>]*>/gi)) {
    const tag = match[0];
    const node = /\bdata-preshot-node\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (node !== IMAGE_GROUP_NODE_NAME) continue;
    const encodedId = /\bdata-preshot-group-id\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!encodedId) {
      throw new Error("Stored canvas document has an image-group marker without a group id");
    }
    try {
      ids.push(decodeURIComponent(encodedId));
    } catch {
      throw new Error(`Stored canvas document has an invalid image-group id "${encodedId}"`);
    }
  }
  return ids;
}

export function removeImageGroupMarker(html: string, groupId: string): string {
  const encodedId = encodeURIComponent(groupId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const marker = new RegExp(
    `<figure\\b(?=[^>]*\\bdata-preshot-node\\s*=\\s*["']${IMAGE_GROUP_NODE_NAME}["'])(?=[^>]*\\bdata-preshot-group-id\\s*=\\s*["']${encodedId}["'])[^>]*>\\s*</figure>`,
    "gi",
  );
  return html.replace(marker, "");
}

export function escapeDocumentText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function htmlFragment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /<\/?[a-z][\s\S]*>/i.test(trimmed)
    ? trimmed
    : `<p>${escapeDocumentText(trimmed)}</p>`;
}