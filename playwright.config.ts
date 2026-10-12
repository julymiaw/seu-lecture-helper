import {defineConfig} from '@playwright/test';
import {existsSync} from 'node:fs';
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: true, reporter: 'list',
  use: {headless: true, launchOptions: existsSync(chrome) ? {executablePath: chrome} : {}},
});
