import { expect, test } from "@playwright/test";

test("switches between light and dark themes via settings panel", async ({ page }) => {
  await page.goto("/");

  const settingsButton = page.locator("header").getByRole("button", { name: "设置" });
  await expect(settingsButton).toHaveCount(1);
  await settingsButton.click();

  // Wait for the settings dialog to be visible
  const settingsDialog = page.getByRole("dialog", { name: /设置/ });
  await expect(settingsDialog).toBeVisible();

  // Click dark theme button (深色)
  const darkThemeButton = settingsDialog.getByRole("button", { name: /深色/, pressed: false });
  await expect(darkThemeButton).toBeVisible();
  await darkThemeButton.click();

  // Settings in the outer header update the document element, not canvas-local chrome.
  const htmlElement = page.locator("html");
  await expect(htmlElement).toHaveClass(/dark/);

  // Verify dark theme is visually active (the button should show pressed state)
  await expect(settingsDialog.getByRole("button", { name: /深色/, pressed: true })).toBeVisible();

  // Click light theme button (浅色)
  const lightThemeButton = settingsDialog.getByRole("button", { name: /浅色/, pressed: false });
  await expect(lightThemeButton).toBeVisible();
  await lightThemeButton.click();

  // Assert dark class is removed from the document
  await expect(htmlElement).not.toHaveClass(/dark/);

  // Verify light theme is visually active
  await expect(settingsDialog.getByRole("button", { name: /浅色/, pressed: true })).toBeVisible();

  // Close the settings panel (click backdrop or Escape)
  await page.keyboard.press("Escape");
  await expect(settingsDialog).not.toBeVisible();
});

test("switches to system theme", async ({ page }) => {
  await page.goto("/");

  const settingsButton = page.locator("header").getByRole("button", { name: "设置" });
  await settingsButton.click();

  const settingsDialog = page.getByRole("dialog", { name: /设置/ });
  await expect(settingsDialog).toBeVisible();

  // Click system theme button (跟随系统) - don't check pressed state since it might already be active
  const systemThemeButton = settingsDialog.getByRole("button", { name: /跟随系统/ });
  await expect(systemThemeButton).toBeVisible();
  await systemThemeButton.click();

  // Verify system theme is visually active
  await expect(settingsDialog.getByRole("button", { name: /跟随系统/, pressed: true })).toBeVisible();

  // Close settings panel
  await page.keyboard.press("Escape");
  await expect(settingsDialog).not.toBeVisible();
});
