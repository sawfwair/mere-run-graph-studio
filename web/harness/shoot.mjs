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
  { name: 'node-examples', query: 'example=1&left=1&right=1', viewport: { width: 1600, height: 1000 } },
  { name: 'node-examples-mobile', query: 'example=1', viewport: { width: 390, height: 844 } },
  { name: 'shell-default', query: '', viewport: { width: 1600, height: 1000 } },
  { name: 'shell-left-collapsed', query: 'left=1', viewport: { width: 1600, height: 1000 } },
  { name: 'shell-both-collapsed', query: 'left=1&right=1', viewport: { width: 1600, height: 1000 } },
  { name: 'shell-pro', query: 'mode=pro', viewport: { width: 1600, height: 1000 } },
  { name: 'shell-mobile', query: '', viewport: { width: 390, height: 844 } },
  { name: 'shell-mobile-pro', query: 'mode=pro', viewport: { width: 390, height: 844 } },
  { name: 'shell-empty', query: 'empty=1', viewport: { width: 1600, height: 1000 } },
  { name: 'shell-mobile-empty', query: 'empty=1', viewport: { width: 390, height: 844 } },
  { name: 'shell-tablet-pro', query: 'mode=pro', viewport: { width: 768, height: 900 } },
  { name: 'shell-app', query: '', view: 'App', viewport: { width: 1600, height: 1000 } },
  { name: 'shell-mobile-app', query: '', view: 'App', viewport: { width: 390, height: 844 } },
  { name: 'shell-mobile-json', query: 'mode=pro', view: 'JSON', viewport: { width: 390, height: 844 } },
];
const shots = process.argv.slice(2).length
  ? process.argv.slice(2).map((arg) => {
    const i = arg.indexOf('=');
    return { name: arg.slice(0, i), query: arg.slice(i + 1), view: undefined, viewport: { width: 1600, height: 1000 } };
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

async function openAdvancedOptions() {
  const toggle = page.getByRole('button', { name: /Advanced options/ });
  if (await toggle.count()) await toggle.click();
}

async function verifyInstalledModelPickers() {
  await openAdvancedOptions();
  const imageModel = page.locator('.inspector-body').getByRole('combobox', { name: 'Model' });
  if (await imageModel.locator('option[value="image-krea2-raw"]').count() !== 1 ||
    await imageModel.locator('option[value="video-ltx23-av-mlx"]').count() !== 0) {
    throw new Error('Image model picker did not use installed image models');
  }
  await page.locator('.react-flow__node-workflow').nth(1).click();
  await page.locator('.inspector-heading').filter({ hasText: 'Generate video' }).waitFor();
  await openAdvancedOptions();
  const videoModel = page.locator('.inspector-body').getByRole('combobox', { name: 'Model' });
  if (await videoModel.locator('option[value="video-ltx23-av-mlx"]').count() !== 1 ||
    await videoModel.locator('option[value="image-krea2-raw"]').count() !== 0) {
    throw new Error('Video model picker did not use installed video models');
  }
  await videoModel.selectOption('video-ltx23-av-mlx');
  if (await videoModel.inputValue() !== 'video-ltx23-av-mlx') throw new Error('Video model picker did not update the graph');
  await page.screenshot({ path: resolve(outDir, 'video-model-picker-desktop.png') });
}

async function captureMobileModelPicker() {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('tab', { name: 'Inspect' }).click();
  await openAdvancedOptions();
  await page.locator('.inspector-body').getByRole('combobox', { name: 'Model' }).waitFor();
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) {
    throw new Error('Video model picker overflows the mobile viewport');
  }
  await page.screenshot({ path: resolve(outDir, 'video-model-picker-mobile.png') });
  await page.setViewportSize({ width: 1600, height: 1000 });
}

async function verifyInspectorCanvasInteraction() {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('.app-shell', { timeout: 15000 });
  if (await page.locator('.library-panel:visible, .library-rail:visible, .inspector-panel:visible, .inspector-rail:visible').count()) {
    throw new Error('Easy canvas should open without persistent side panels');
  }

  const firstNode = page.locator('.react-flow__node-workflow').first();
  await firstNode.click();
  await page.locator('.react-flow__node-workflow.selected').first().waitFor();
  await page.locator('.inspector-heading').filter({ hasText: 'Generate image' }).waitFor();

  const prompt = page.locator('.inspector-body .field').filter({ hasText: 'Prompt' }).locator('input, textarea').first();
  await prompt.fill('Inspector interaction check');
  if (await prompt.inputValue() !== 'Inspector interaction check') {
    throw new Error('Inspector prompt edit did not update the controlled graph value');
  }

  await verifyInstalledModelPickers();

  await page.getByRole('button', { name: 'Collapse inspector' }).click();
  await page.locator('.inspector-rail').waitFor();
  await page.getByRole('button', { name: 'Expand inspector' }).click();
  await page.locator('.inspector-panel').waitFor();
  await captureMobileModelPicker();
  console.log('✓ canvas selection, installed model pickers, and inspector edit/collapse interaction');
}

async function verifyLibraryAndOutline() {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Show panels' }).click();
  await page.locator('.outline-step').first().click();
  await page.locator('.inspector-heading').filter({ hasText: 'Generate image' }).waitFor();
  await page.getByRole('button', { name: 'Back to workflow' }).click();
  await page.locator('.workflow-outline').waitFor();
  await page.locator('.category-filters').getByRole('button', { name: 'Image', exact: true }).click();
  if (await page.locator('.catalog-item').count() !== 2) throw new Error('Image category should show two nodes');
  await page.getByRole('textbox', { name: 'Search nodes' }).fill('no-such-node');
  await page.getByText('No matching nodes. Try another search or category.').waitFor();
  await page.getByRole('textbox', { name: 'Search nodes' }).fill('');
  const before = await page.locator('.react-flow__node-workflow').count();
  await page.locator('.catalog-item').filter({ hasText: 'Upscale image' }).click();
  await page.waitForFunction((count) => document.querySelectorAll('.react-flow__node-workflow').length === count + 1, before);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.waitForFunction((count) => document.querySelectorAll('.react-flow__node-workflow').length === count, before);
  console.log('✓ outline navigation, category/search filtering, add node and undo');
}

async function verifyMobileGraphFraming() {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('.react-flow__node-workflow').first().waitFor();
  const canvas = await page.locator('.graph-canvas-shell').boundingBox();
  const firstNode = await page.locator('.react-flow__node-workflow').first().boundingBox();
  if (!canvas || !firstNode || firstNode.width < 180 || firstNode.x < canvas.x ||
    firstNode.x + firstNode.width > canvas.x + canvas.width || firstNode.y < canvas.y ||
    firstNode.y + Math.min(firstNode.height, 150) > canvas.y + canvas.height) {
    throw new Error('Mobile opening must show the first node at a readable size');
  }
  await page.getByRole('tab', { name: 'Library', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search nodes' }).fill('upscale');
  await page.locator('.mobile-library-view .catalog-item').filter({ hasText: 'Upscale image' }).waitFor();
  await page.getByRole('tab', { name: 'Inspect', exact: true }).click();
  await page.locator('.mobile-inspector-view .outline-step').first().click();
  await page.locator('.mobile-inspector-view .inspector-heading').filter({ hasText: 'Generate image' }).waitFor();
  console.log('✓ mobile graph framing, library search and inspector navigation');
}

async function verifyNodePromptEditing() {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(base, { waitUntil: 'networkidle' });
  const prompt = page.getByRole('textbox', { name: 'Prompt for render', exact: true });
  await prompt.fill('An observatory at sunrise');
  await prompt.press('Backspace');
  if (await page.locator('.react-flow__node-workflow').count() !== 2) throw new Error('Editing a prompt must not delete a node');
  await page.locator('.react-flow__node-workflow').first().locator('.workflow-node-header').click();
  const inspectorPrompt = page.locator('.inspector-body .field').filter({ hasText: 'Prompt' }).locator('input, textarea').first();
  if (await inspectorPrompt.inputValue() !== await prompt.inputValue()) throw new Error('Inline prompt edit must update the inspector');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  if (await prompt.inputValue() !== 'An observatory at sunrise') throw new Error('Undo must restore the deleted character');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  if (await prompt.inputValue() !== 'a red sports car') throw new Error('Undo must restore the original prompt');
  await page.goto(`${base}/?example=1`, { waitUntil: 'networkidle' });
  await page.locator('.canvas-run-preview').waitFor();
  if (await page.getByRole('textbox', { name: 'Prompt for render', exact: true }).count()) throw new Error('Connected prompts must not expose a literal editor');
  await page.getByRole('textbox', { name: 'Value for description', exact: true }).fill('Updated description');
  await page.locator('.output-caption').filter({ hasText: 'Previous run' }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__edge').length === 4);
  console.log('✓ inline prompt editing, undo, connected values, and previous-run labeling');
}

async function verifyLiveCanvas() {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${base}/?live=failed`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  const render = page.locator('.react-flow__node-workflow[data-id="render"]');
  const clip = page.locator('.react-flow__node-workflow[data-id="clip"]');
  await render.getByRole('progressbar', { name: 'Reported inference progress' }).waitFor();
  if (await page.getByRole('tab', { name: 'Canvas', exact: true }).getAttribute('aria-selected') !== 'true') throw Error('Starting a workflow must stay on the canvas');
  await render.locator('.canvas-run-preview img').waitFor();
  await render.getByText('Intermediate preview', { exact: true }).waitFor();
  if (await render.getByRole('button', { name: 'Pin output', exact: true }).count()) throw Error('Intermediate previews must not be pinnable final outputs');
  await page.screenshot({ path: resolve(outDir, 'live-running.png') });
  await render.locator('.canvas-run-preview img').waitFor();
  await clip.locator('.node-execution-phase').filter({ hasText: 'encoding' }).waitFor();
  if (await clip.getByRole('progressbar').count()) throw Error('A phase without numeric progress must not display a percentage');
  await page.screenshot({ path: resolve(outDir, 'live-upstream-output.png') });
  await page.locator('.canvas-run-summary strong').filter({ hasText: 'Failed' }).waitFor();
  if (!await render.locator('.canvas-run-preview img').isVisible()) throw Error('Downstream failure must preserve upstream media');
  await render.getByRole('button', { name: 'Pin output', exact: true }).click();
  await render.locator('.creative-node-settings summary').click();
  await page.getByRole('textbox', { name: 'Prompt for render', exact: true }).fill('A blue car at dusk');
  await render.locator('.output-caption').filter({ hasText: 'Previous run' }).waitFor();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await page.locator('.canvas-run-summary strong').filter({ hasText: 'Failed' }).waitFor();
  await render.getByRole('button', { name: 'Compare outputs', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Compare outputs', exact: true });
  await dialog.locator('img').first().waitFor();
  for (const summary of await dialog.locator('summary').all()) await summary.click();
  await dialog.getByText('a red sports car', { exact: true }).waitFor();
  await dialog.getByText('A blue car at dusk', { exact: true }).waitFor();
  await page.screenshot({ path: resolve(outDir, 'live-comparison.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  if (await dialog.evaluate((element) => element.scrollWidth > element.clientWidth + 1)) throw Error('Mobile comparison must not overflow horizontally');
  await page.screenshot({ path: resolve(outDir, 'live-comparison-mobile.png') });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await render.getByRole('progressbar').waitFor();
  await page.screenshot({ path: resolve(outDir, 'live-running-mobile.png') });
  await page.getByRole('button', { name: 'Cancel run', exact: true }).click();
  await page.locator('.canvas-run-summary strong').filter({ hasText: 'Cancelled' }).waitFor();
  console.log('✓ live progress, early outputs, failure retention, pinned comparison, mobile dialog, and cancellation');
}

async function verifyLiveRecovery() {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${base}/?live=faults`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await page.getByText('Updates disconnected.', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await page.getByRole('progressbar', { name: 'Reported inference progress' }).waitFor();
  await page.getByRole('button', { name: 'Cancel run', exact: true }).click();
  await page.getByText('Cancellation failed.', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Cancel run', exact: true }).click();
  await page.locator('.canvas-run-summary strong').filter({ hasText: 'Cancelled' }).waitFor();
  console.log('✓ disconnected updates reconnect and failed cancellation can be retried');
}

async function verifyCreativeLoop() {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${base}/?live=failed&mode=pro`, { waitUntil: 'networkidle' });
  const render = page.locator('.react-flow__node-workflow[data-id="render"]');
  for (let index = 0; index < 2; index++) {
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await render.getByRole('progressbar').waitFor();
    await page.locator('.canvas-run-summary strong').filter({ hasText: 'Failed' }).waitFor();
    await render.getByRole('button', { name: 'Save to board', exact: true }).click();
  }
  await page.getByRole('tab', { name: /^Board/ }).click();
  await page.locator('.board-card').nth(1).waitFor();
  for (let index = 0; index < 2; index++) await page.locator('.board-card').nth(index).getByRole('button', { name: 'Compare', exact: true }).click();
  await page.locator('.board-grid.comparing').waitFor();
  await page.locator('.board-card img').nth(1).waitFor();
  await page.screenshot({ path: resolve(outDir, 'creative-board.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.locator('.board-view').evaluate((element) => element.scrollWidth > element.clientWidth + 1)) throw Error('Mobile board must not overflow');
  await page.screenshot({ path: resolve(outDir, 'creative-board-mobile.png') });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.locator('.board-card').first().getByRole('button', { name: 'Use as input', exact: true }).click();
  await page.locator('.react-flow__node-graph-input').waitFor();
  await render.locator('.workflow-node-header').click();
  await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input').fill('Hero image');
  await dialog.getByRole('button', { name: 'Save preset', exact: true }).click();
  await page.locator('.library-panel').getByRole('tab', { name: 'Saved', exact: true }).click();
  await page.locator('.saved-preset').first().waitFor();
  await page.screenshot({ path: resolve(outDir, 'creative-presets.png') });
  const before = await page.locator('.react-flow__node-workflow').count();
  await page.locator('.saved-preset').first().getByRole('button', { name: /Hero image.*nodes/ }).click();
  await page.waitForFunction((count) => document.querySelectorAll('.react-flow__node-workflow').length === count + 1, before);
  console.log('✓ persistent board, desktop/mobile comparison, output reuse, and preset insertion');
}

async function verifyAppSharing() {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${base}/?sharing=1`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Save workflow', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('tab', { name: 'App', exact: true }).click();
  await page.getByRole('button', { name: 'Share app', exact: true }).click();
  await page.getByRole('button', { name: 'Publish new version', exact: true }).click();
  await page.locator('.app-version').waitFor();
  await page.screenshot({ path: resolve(outDir, 'creative-app-sharing.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = page.getByRole('dialog');
  if (await dialog.evaluate((element) => element.scrollWidth > element.clientWidth + 1)) throw Error('Mobile sharing dialog must not overflow');
  await page.screenshot({ path: resolve(outDir, 'creative-app-sharing-mobile.png') });
  await page.getByRole('button', { name: 'Revoke', exact: true }).click();
  await page.locator('.app-version').waitFor({ state: 'detached' });
  console.log('✓ app version publication, desktop/mobile sharing, and revocation');
}

async function verifyTemplateDialog() {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${base}/?template=1`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Show panels' }).click();
  await page.locator('.template-list > button').first().click();
  const dialog = page.locator('dialog.wide-dialog[open]');
  await dialog.getByRole('button', { name: 'Create workflow' }).waitFor();
  for (const width of [1600, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(250); // capture after the dialog entrance finishes
    const layout = await dialog.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const field = element.querySelector('.template-form input')?.getBoundingClientRect();
      return { overflow: element.scrollWidth > element.clientWidth + 1,
        left: bounds.left, right: bounds.right, fieldLeft: field?.left, fieldRight: field?.right };
    });
    if (layout.overflow || layout.left < 0 || layout.right > width ||
      layout.fieldLeft === undefined || layout.fieldLeft < layout.left ||
      layout.fieldRight === undefined || layout.fieldRight > layout.right) {
      throw Error(`Template dialog clips its fields at ${width}px: ${JSON.stringify(layout)}`);
    }
    await page.screenshot({ path: resolve(outDir, `template-dialog-${width}.png`) });
  }
  console.log('✓ template dialog fields fit at desktop and mobile widths');
}

async function verifyChoiceControls() {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${base}/?controls=1`, { waitUntil: 'networkidle' });
  await page.locator('.react-flow__node-workflow[data-id="controls"]').click();
  await openAdvancedOptions();
  const inspector = page.locator('.inspector-body');
  const format = inspector.getByRole('combobox', { name: 'Format', exact: true });
  if (await format.locator('option:checked').textContent() !== 'legacy (not available)') {
    throw Error('An imported enum value must remain visible');
  }
  await inspector.getByRole('combobox', { name: 'Quality', exact: true }).selectOption({ label: 'final' });
  await inspector.getByRole('combobox', { name: 'Patch size', exact: true }).selectOption({ label: '8' });
  await inspector.getByRole('combobox', { name: 'FPS', exact: true }).selectOption('24');
  const width = inspector.getByRole('combobox', { name: 'Width', exact: true });
  if (await inspector.getByRole('spinbutton', { name: 'Custom width', exact: true }).inputValue() !== '640') {
    throw Error('An imported custom number must remain editable');
  }
  await width.selectOption('1024');
  await width.selectOption('custom');
  await inspector.getByRole('spinbutton', { name: 'Custom width', exact: true }).fill('832');
  await inspector.getByRole('combobox', { name: 'Backend', exact: true }).selectOption({ label: 'auto' });
  await page.waitForFunction(() => {
    const saved = localStorage.getItem('mere.graph-studio.recovery.v1') ?? '';
    return ['"quality":"final"', '"patch_size":8', '"fps":24', '"width":832', '"backend":"auto"'].every((value) => saved.includes(value));
  });
  await page.screenshot({ path: resolve(outDir, 'choice-controls-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('tab', { name: 'Inspect' }).click();
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw Error('Choice controls overflow on mobile');
  await page.screenshot({ path: resolve(outDir, 'choice-controls-mobile.png') });

  await page.getByRole('tab', { name: 'Canvas', exact: true }).click();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.locator('.react-flow__node-workflow[data-id="choice"] .workflow-node-header').click();
  const selected = inspector.getByRole('combobox', { name: 'Selected', exact: true });
  if (await selected.locator('option:checked').textContent() !== 'legacy (not available)') throw Error('Choice inspector must retain unavailable values');
  await selected.selectOption({ label: 'draft' });
  const inline = page.getByRole('combobox', { name: 'Selected for choice', exact: true });
  if (await inline.locator('option:checked').textContent() !== 'draft') throw Error('Choice inspector and canvas must stay synchronized');

  await page.getByRole('tab', { name: 'App', exact: true }).click();
  const app = page.locator('.app-view');
  await app.getByRole('combobox', { name: 'Format', exact: true }).selectOption({ label: 'webm' });
  await app.getByRole('combobox', { name: 'Patch size', exact: true }).selectOption({ label: '4' });
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(outDir, 'choice-app-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw Error('App choices overflow on mobile');
  await page.screenshot({ path: resolve(outDir, 'choice-app-mobile.png') });

  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${base}/?controls=1&template=1`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Show panels' }).click();
  await page.locator('.template-list > button').first().click();
  const dialog = page.locator('dialog.wide-dialog[open]');
  await dialog.getByRole('combobox', { name: 'quality', exact: true }).selectOption({ label: 'final' });
  await dialog.getByRole('combobox', { name: 'patch_size', exact: true }).selectOption({ label: '8' });
  await dialog.getByRole('button', { name: 'Create workflow', exact: true }).click();
  await page.waitForFunction(() => {
    const saved = localStorage.getItem('mere.graph-studio.recovery.v1') ?? '';
    return saved.includes('"quality":"final"') && saved.includes('"patch_size":8');
  });
  console.log('✓ schema choices, bounded integers, custom number presets, choice-node synchronization, app forms, and template inputs');
}

async function verifyVideoImageConnection() {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${base}/?video-unwired=1`, { waitUntil: 'networkidle' });
  const source = page.locator('.react-flow__node-workflow[data-id="render"] .react-flow__handle[data-handleid="image"]');
  const target = page.locator('.react-flow__node-workflow[data-id="clip"] .react-flow__handle[data-handleid="image"]');
  const endImage = page.locator('.react-flow__node-workflow[data-id="clip"] .react-flow__handle[data-handleid="end_image"]');
  await source.waitFor();
  await target.waitFor();
  await endImage.waitFor();
  if (await page.locator('.react-flow__edge').count()) throw Error('Video image should start disconnected');
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw Error('Image connection handles are not visible');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__edge').length === 1);
  await page.locator('.react-flow__node-workflow[data-id="clip"] .port-row.wired').filter({ hasText: 'Image' }).waitFor();
  await page.screenshot({ path: resolve(outDir, 'video-image-connected.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/?video-connected=1`, { waitUntil: 'networkidle' });
  await page.locator('.react-flow__node-workflow[data-id="clip"] .port-row.wired').filter({ hasText: 'Image' }).waitFor();
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) {
    throw Error('Connected video image overflows the mobile viewport');
  }
  const canvas = await page.locator('.graph-canvas-shell').boundingBox();
  const firstNode = await page.locator('.react-flow__node-workflow').first().boundingBox();
  if (!canvas || !firstNode || firstNode.width < 180 || firstNode.x < canvas.x ||
    firstNode.x + firstNode.width > canvas.x + canvas.width) {
    throw Error('Connected video workflow does not open at a readable size on mobile');
  }
  await page.screenshot({ path: resolve(outDir, 'video-image-connected-mobile.png') });
  console.log('✓ optional video image and end image ports appear, image output connects, and mobile layout fits');
}

await verifyLiveCanvas();
await verifyLiveRecovery();
await verifyCreativeLoop();
await verifyAppSharing();
await verifyTemplateDialog();
await verifyChoiceControls();
await verifyVideoImageConnection();
await verifyNodePromptEditing();
await verifyInspectorCanvasInteraction();
await verifyLibraryAndOutline();
await verifyMobileGraphFraming();

for (const { name, query, width } of [
  { name: 'desktop-setup', query: 'setup=1', width: 1600 },
  { name: 'desktop-setup-mobile', query: 'setup=1', width: 390 },
  { name: 'desktop-setup-missing', query: 'setup=missing', width: 1600 },
  { name: 'desktop-setup-missing-mobile', query: 'setup=missing', width: 390 },
]) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${base}/?${query}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Find tools' }).waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  if (overflow) throw Error(`${name} overflows horizontally`);
  if (query === 'setup=1') {
    await page.getByText('Optional plugins').click();
    await page.getByRole('button', { name: 'Review installation' }).last().click();
    await page.getByText('Install signed image compose bundle').waitFor();
  }
  await page.screenshot({ path: resolve(outDir, `${name}.png`), fullPage: true });
  console.log(`✓ ${name}.png`);
}

for (const { name, query, viewport, view } of shots) {
  await page.setViewportSize(viewport);
  await page.goto(`${base}/${query ? `?${query}` : ''}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.app-shell', { timeout: 15000 });
  if (view) await page.getByRole('tab', { name: view, exact: true }).click();
  await page.waitForTimeout(700); // let entrance motion settle
  const layout = await page.evaluate(() => {
    const workspace = document.querySelector('.workspace');
    if (!workspace) throw new Error('Workspace is missing');
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      workspaceOverflow: workspace.scrollWidth > workspace.clientWidth + 1,
    };
  });
  if (layout.documentWidth > layout.viewportWidth + 1) {
    throw new Error(`${name} overflows horizontally: ${layout.documentWidth}px document in ${layout.viewportWidth}px viewport`);
  }
  if (layout.workspaceOverflow) throw new Error(`${name} workspace content overflows horizontally`);
  await page.screenshot({ path: resolve(outDir, `${name}.png`) });
  console.log(`✓ ${name}.png`);
}

for (const width of [1600, 390]) {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto(`${base}/?landing=1`, { waitUntil: 'networkidle' });
  await page.locator('.cloud-site').waitFor();
  await page.waitForTimeout(700);
  const overflow = await page.locator('.cloud-site').evaluate((site) => site.scrollWidth > site.clientWidth + 1);
  if (overflow) throw new Error(`Landing page overflows at ${width}px`);
  await page.screenshot({ path: resolve(outDir, `landing-${width}.png`), fullPage: true });
  console.log(`✓ landing-${width}.png`);
}

if (browserErrors.length) throw new Error(`Browser errors:\n${browserErrors.join('\n')}`);

await browser.close();
await server.close();
console.log(`\nWrote ${shots.length + 15} shot(s) to ${outDir}`);
