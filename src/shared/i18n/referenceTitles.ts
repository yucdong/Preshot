export const ZH_REFERENCE_CONTINUED_TITLE_TEMPLATE = "{{title}}（续）";

export function formatReferenceContinuedTitle(title: string): string {
  return ZH_REFERENCE_CONTINUED_TITLE_TEMPLATE.replace("{{title}}", title);
}
