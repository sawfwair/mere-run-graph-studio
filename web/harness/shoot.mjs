// Screenshot the editor shell in a matrix of states. Self-contained: boots the
// harness Vite server, drives a headless browser, writes PNGs, tears down.
//
//   pnpm harness:shoot                 # default state matrix
//   pnpm harness:shoot left=1 both=left=1,right=1   # custom "name=query" shots
//
// Browser: uses Playwright's managed Chromium (run `npx playwright install
// chromium` once). Override with HARNESS_BROWSER=/path/to/chrome. Output dir
// defaults to web/harness/shots (gitignored); override with HARNESS_OUT.

import { createServer as createViteServer } from 'vite';
import { chromium } from 'playwright';
import { createServer as createNetServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.HARNESS_OUT ?? resolve(here, 'shots');
mkdirSync(outDir, { recursive: true });

const DEFAULT_SHOTS = [
  { name: 'shell-default', query: '', viewport: { width: 1600, height: 1000 } },
  { name: 'shell-left-collapsed', query: 'left=1', viewport: { width: 1600, height: 1000 } },
  { name: 'shell-both-collapsed', query: 'left=1&right=1', viewport: { width: 1600, height: 1000 } },
  { name: 'shell-pro', query: 'mode=pro', viewport: { width: 1600, height: 1000 } },
  { name: 'shell-mobile', query: '', viewport: { width: 390, height: 844 } },
  { name: 'shell-mobile-pro', query: 'mode=pro', viewport: { width: 390, height: 844 } },
];
const shots = process.argv.slice(2).length
  ? process.argv.slice(2).map((arg) => {
    const i = arg.indexOf('=');
    return { name: arg.slice(0, i), query: arg.slice(i + 1), viewport: { width: 1600, height: 1000 } };
  })
  : DEFAULT_SHOTS;

/** @returns {Promise<number>} */
function availablePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const probeAddress = probe.address();
      if (!probeAddress || typeof probeAddress === 'string') {
        probe.close();
        reject(new Error('Could not reserve a local harness port'));
        return;
      }
      probe.close(() => resolvePort(probeAddress.port));
    });
  });
}

const requestedPort = await availablePort();
const server = await createViteServer({
  configFile: resolve(here, 'vite.config.ts'),
  server: { host: '127.0.0.1', port: requestedPort, strictPort: true },
});
await server.listen();
const address = server.httpServer?.address();
const port = typeof address === 'object' && address ? address.port : (server.config.server.port ?? 1433);
const base = `http://127.0.0.1:${port}`;

let browser;
try {
  const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const executablePath = process.env.HARNESS_BROWSER || (existsSync(systemChrome) ? systemChrome : undefined);
  browser = await chromium.launch({ executablePath });
} catch (error) {
  console.error('\nCould not launch a browser. Run `npx playwright install chromium` once,');
  console.error('or set HARNESS_BROWSER=/path/to/chrome. Original error:\n', error instanceof Error ? error.message : String(error));
  await server.close();
  process.exit(1);
}

const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
/** @type {string[]} */
const browserErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') browserErrors.push(message.text());
});
page.on('pageerror', (error) => browserErrors.push(error.message));

async function verifyInspectorCanvasInteraction() {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('.app-shell', { timeout: 15000 });

  const firstNode = page.locator('.react-flow__node-workflow').first();
  await firstNode.click();
  await page.locator('.react-flow__node-workflow.selected').first().waitFor();
  await page.locator('.inspector-heading').filter({ hasText: 'Generate image' }).waitFor();

  const prompt = page.locator('.inspector-body .field').filter({ hasText: 'Prompt' }).locator('input, textarea').first();
  await prompt.fill('Inspector interaction check');
  if (await prompt.inputValue() !== 'Inspector interaction check') {
    throw new Error('Inspector prompt edit did not update the controlled graph value');
  }

  await page.getByRole('button', { name: 'Collapse inspector' }).click();
  await page.locator('.inspector-rail').waitFor();
  await page.getByRole('button', { name: 'Expand inspector' }).click();
  await page.locator('.inspector-panel').waitFor();
  console.log('✓ canvas selection and inspector edit/collapse interaction');
}

await verifyInspectorCanvasInteraction();

for (const { name, query, viewport } of shots) {
  await page.setViewportSize(viewport);
  await page.goto(`${base}/${query ? `?${query}` : ''}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.app-shell', { timeout: 15000 });
  await page.waitForTimeout(700); // let entrance motion settle
  const layout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  if (layout.documentWidth > layout.viewportWidth + 1) {
    throw new Error(`${name} overflows horizontally: ${layout.documentWidth}px document in ${layout.viewportWidth}px viewport`);
  }
  await page.screenshot({ path: resolve(outDir, `${name}.png`) });
  console.log(`✓ ${name}.png`);
}

if (browserErrors.length) throw new Error(`Browser errors:\n${browserErrors.join('\n')}`);

await browser.close();
await server.close();
console.log(`\nWrote ${shots.length} shot(s) to ${outDir}`);
