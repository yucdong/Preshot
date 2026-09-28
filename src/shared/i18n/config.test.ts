import { describe, expect, it } from "vitest";
import i18n from "./config";
import { ui } from "./ui";

describe("i18n config", () => {
  it("switches both catalogs and preserves interpolation values literally", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("plan.exportPdf")).toBe("Export PDF");
    expect(ui("选择素材：{{v0}}", { v0: "素材库 <script>" })).toBe("Select material: 素材库 <script>");
    expect(ui("{{count}} 张图片", { count: 1 })).toBe("1 image");
    expect(ui("{{count}} 张图片", { count: 2 })).toBe("2 images");
    expect(ui("未登记的诊断")).toBe("未登记的诊断");
    await i18n.changeLanguage("zh");
    expect(ui("选择素材：{{v0}}", { v0: "English name" })).toBe("选择素材：English name");
    expect(ui("{{count}} 张图片", { count: 1 })).toBe("1 张图片");
  });
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
