import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'scripts/brand/graph-studio-og.html');
const output = resolve(root, 'web/public/graph-studio-og.png');

const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath = process.env.BRAND_BROWSER || (existsSync(systemChrome) ? systemChrome : undefined);
const browser = await chromium.launch({ executablePath });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(source).href, { waitUntil: 'load' });
  await page.screenshot({ path: output });
  console.log(`Rendered ${output}`);
} finally {
  await browser.close();
}
