import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

test('boots the shell and answers a typed ping through the preload bridge', async () => {
  const home = mkdtempSync(join(tmpdir(), 'studio-e2e-'));
  const env: Record<string, string> = { STUDIO_HEADLESS: '1', STUDIO_HOME: home };
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !(key in env)) env[key] = value;
  }

  const app = await electron.launch({ args: ['.'], env });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: '漫剧工作室' })).toBeVisible();
    await expect(page.getByTestId('version')).toHaveText('0.0.1');
    expect(await page.evaluate(() => Object.keys(window.studio))).toEqual(['ping']);

    await page.getByRole('button', { name: 'Ping' }).click();
    await expect(page.getByTestId('reply')).toContainText('hello');
    await expect(page.getByTestId('reply')).toContainText('@');

    await expect.poll(() => existsSync(join(home, 'studio.db'))).toBe(true);
    await expect
      .poll(() => app.evaluate(({ app: electronApp }) => electronApp.getPath('userData')))
      .toBe(home);
  } finally {
    await app.close();
    rmSync(home, { recursive: true, force: true });
  }
});
