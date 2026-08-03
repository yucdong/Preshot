import { describe, expect, it } from "vitest";
import i18n from "./config";

describe("i18n config", () => {
  it("initializes the zh locale", () => {
    expect(i18n.language).toBe("zh");
  });

  it("resolves a known key to Chinese", () => {
    expect(i18n.t("plan.exportPdf")).toBe("导出 PDF");
  });

  it("interpolates named values", () => {
    expect(i18n.t("reference.openImage", { index: 1 })).toBe("打开参考图 1");
  });
});
