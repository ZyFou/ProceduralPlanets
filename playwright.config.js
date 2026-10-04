import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH
  || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);

export default defineConfig({
  testDir: './test/browser',
  timeout: 120000,
  expect: { timeout: 30000 },
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:7071',
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: { executablePath: chromiumPath,
      args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: { command: 'npm run dev:web -- --host 127.0.0.1', url: 'http://127.0.0.1:7071', reuseExistingServer: !process.env.CI, timeout: 60000 },
});
