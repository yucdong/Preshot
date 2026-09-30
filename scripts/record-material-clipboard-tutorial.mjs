// Production UI with the existing E2E in-memory clipboard/persistence boundary.
// Never grants browser clipboard permission or calls navigator.clipboard.
import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const work = resolve(process.argv[2] ?? '.preshot-build-cache/material-tutorials-0.0.24');
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const output = join(work, 'C18');
await mkdir(output); // Reject an existing take.
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.setDefaultTimeout(20_000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const button = (name, root = page) => root.getByRole('button', { name, exact: true });
const dialog = name => page.getByRole('dialog', { name, exact: true });
let stop = false;
let recording;
const frames = [], chapters = [];
let start;
const chapter = async (zh, en, targetSeconds) => {
  chapters.push({ seconds: (Date.now() - start) / 1000, zh, en, targetSeconds });
  console.log(zh);
  await page.waitForTimeout(700);
};
try {
  await page.goto(`http://127.0.0.1:${process.env.PRESHOT_E2E_PORT ?? '1426'}/e2e/fixtures/material-library.html?clipboard=1&walkthrough=1`, { timeout: 120_000 });
  await expect(page.getByRole('group', { name: '方案正文', exact: true })).toBeVisible();
  await button('素材库').click();
  await button('创建素材').click();
  await button('图片组', dialog('创建素材')).click();
  let editor = page.locator('.ml-content-editor-dialog');
  await editor.getByRole('textbox', { name: '素材名称', exact: true }).fill('桥畔参考 · 复制来源');
  const [picker] = await Promise.all([
    page.waitForEvent('filechooser'),
    button('添加图片', editor).first().click(),
  ]);
  await picker.setFiles(resolve('docs/demo/photos/bridge-day.jpg'));
  await expect(editor.locator('[data-image-id]')).toHaveCount(1);
  await button('保存素材', editor).click();
  await expect(editor).toBeHidden();
  await button('选择素材：桥畔参考 · 复制来源').click();

  start = Date.now();
  recording = (async () => {
    while (!stop) {
      const file = `frame-${String(frames.length).padStart(5, '0')}.jpg`;
      const seconds = (Date.now() - start) / 1000;
      await page.screenshot({ path: join(output, file), type: 'jpeg', quality: 85 });
      frames.push({ file, seconds });
      await new Promise(done => setTimeout(done, 220));
    }
  })();
  await chapter('右键复制素材图片（隔离测试界面）', 'Copy a picture with the context menu (isolated test UI)', 8);
  await button('编辑素材').click();
  editor = page.locator('.ml-content-editor-dialog');
  await button('选择参考图 1', editor).click({ button: 'right' });
  await expect(editor.getByRole('menuitem', { name: /复制图片/ })).toBeVisible();
  await page.waitForTimeout(1000); // Keep the actual command visible in recorded frames.
  await editor.getByRole('menuitem', { name: /复制图片/ }).click();
  await expect.poll(() => page.evaluate(() => window.__PRESHOT_IMAGE_CLIPBOARD_TEST__?.copied())).toBe(true);
  await page.waitForTimeout(700);
  await button('取消', editor).click();
  await expect(editor).toBeHidden();

  await chapter('新建图片素材，在图片区域右键粘贴', 'Create an image material and paste into its image area', 11);
  await button('创建素材').click();
  await button('图片', dialog('创建素材')).click();
  editor = page.locator('.ml-content-editor-dialog');
  await editor.getByRole('textbox', { name: '素材名称', exact: true }).fill('南京长江大桥 · 粘贴收纳');
  await editor.getByRole('textbox', { name: '素材说明', exact: true }).fill('从复制的图片创建素材。');
  await editor.getByRole('textbox', { name: '标签', exact: true }).fill('南京，桥畔，参考');
  await page.waitForTimeout(700);
  await editor.locator('[data-clipboard-component]').click({ button: 'right', position: { x: 4, y: 4 } });
  await expect(editor.getByRole('menuitem', { name: /粘贴图片/ })).toBeVisible();
  await page.waitForTimeout(1000);
  await editor.getByRole('menuitem', { name: /粘贴图片/ }).click();
  await expect(editor.locator('[data-image-id]')).toHaveCount(1);
  await page.waitForTimeout(700);
  await button('保存素材', editor).click();
  await expect(editor).toBeHidden();
  await button('选择素材：南京长江大桥 · 粘贴收纳').click();

  await chapter('预览中的图片可复制，再粘贴到文档', 'Copy from the read-only preview and paste into a document', 11);
  await button('预览').click();
  const preview = dialog('完整组件预览');
  await button('选择素材图片 1', preview).click({ button: 'right' });
  await expect(preview.getByRole('menuitem', { name: /复制图片/ })).toBeVisible();
  await page.waitForTimeout(1000);
  await preview.getByRole('menuitem', { name: /复制图片/ }).click();
  await page.waitForTimeout(700);
  await button('关闭完整组件预览').click();
  await button('关闭素材库').click();
  const document = page.getByRole('group', { name: '方案正文', exact: true });
  await document.locator('.bn-inline-content').first().click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: /粘贴图片/ })).toBeVisible();
  await page.waitForTimeout(1000);
  await page.getByRole('menuitem', { name: /粘贴图片/ }).click();
  await expect(document.locator('[data-content-type="image"] img')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.__PRESHOT_IMAGE_CLIPBOARD_TEST__?.files().length)).toBe(1);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: join(output, 'last.png') });
} catch (error) {
  errors.push(error.message);
  await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
} finally {
  stop = true;
  await recording;
  await writeFile(join(output, 'recording.json'), JSON.stringify({ phase: 'C18',
    version, environment: 'browser fixture; in-memory clipboard and persistence',
    chapters, frames, duration: (Date.now() - start) / 1000, errors,
    crop: { x: 0, y: 0, width: 1280, height: 800 } }, null, 2));
  await context.close();
  await browser.close();
}
if (errors.length) throw new Error(errors.join('\n'));
