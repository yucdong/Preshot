import { expect, test } from "@playwright/test";

for (const mode of ["list", "disk"] as const) {
  test(`${mode} project removal confirms its scope and updates open/all projects`, async ({ page }) => {
    await page.goto("/e2e/fixtures/project-loading.html");
    await expect(page.getByRole("group", { name: "方案正文" })).toBeVisible();
    const projectName = "进度条示例";
    const openDialog = async () => {
      await page.getByRole("button", { name: `更多项目操作 ${projectName}` }).click();
      await page.getByRole("menuitem", { name: "删除项目" }).click();
    };
    await openDialog();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(`C:\\Preshot Midscene Runs\\${projectName}`);
    await expect(dialog.getByRole("button", { name: "取消" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "从磁盘删除", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: `更多项目操作 ${projectName}` })).toBeFocused();
    await openDialog();
    await page.screenshot({ path: test.info().outputPath("delete-options.png"), animations: "disabled" });
    if (mode === "disk") {
      await dialog.getByRole("button", { name: "从磁盘删除", exact: true }).click();
      await expect(dialog).toHaveAccessibleName("确认从磁盘删除项目？");
      await expect(dialog).toContainText("此操作无法撤销");
      await page.screenshot({ path: test.info().outputPath("delete-confirmation.png"), animations: "disabled" });
      await dialog.getByRole("button", { name: "确认从磁盘删除", exact: true }).click();
    } else {
      await dialog.getByRole("button", { name: "从列表移除" }).click();
    }
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("region", { name: "所有项目" }).getByRole("button", { name: `打开项目 ${projectName}` })).toHaveCount(0);
    await expect(page.getByRole("button", { name: `关闭项目 ${projectName}` })).toHaveCount(0);
    await expect(page.getByRole("group", { name: "方案正文" })).toBeVisible();
    // The browser fixture simulates the native disk boundary. Actual recursive
    // deletion and link/locked-file safety are exercised by Rust tempdir tests.
    const remainingOnDisk = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("preshot.midscene.projects") ?? "{}"))
      .map((project) => (project as { name: string }).name));
    expect(remainingOnDisk.includes(projectName)).toBe(mode === "list");
    expect(remainingOnDisk).toContain("Preshot 入门示例");
  });
}
