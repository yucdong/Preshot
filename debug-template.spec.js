const { test, expect } = require('@playwright/test');

test('debug template', async ({ page }) => {
  await page.goto('http://localhost:5173');
  await expect(page.getByTestId('plan-canvas')).toBeVisible();
  
  const initialFrames = await page.locator('[data-component-frame="true"]').count();
  await page.getByRole('button', { name: '插入组件' }).click();
  await page.getByRole('menuitem', { name: '摄影计划' }).click();
  await expect(page.locator('[data-component-frame="true"]')).toHaveCount(initialFrames + 1);
  
  const newFrame = page.locator('[data-component-frame="true"]').last();
  await page.waitForTimeout(3000); // Wait for async content loading
  
  await page.screenshot({ path: 'debug-template.png', fullPage: true });
  
  const editor = newFrame.locator('[contenteditable="true"]');
  const html = await editor.innerHTML();
  console.log('Editor HTML:', html);
  
  const text = await editor.textContent();
  console.log('Editor text:', text);
});
