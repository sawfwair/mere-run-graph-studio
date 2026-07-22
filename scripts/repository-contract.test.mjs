import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { promisify } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const execFileAsync = promisify(execFile);

async function trackedFiles() {
  const { stdout } = await execFileAsync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'utf8',
  });
  return stdout.split('\0').filter(Boolean);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function text(path) {
  return readFile(join(root, path), 'utf8');
}

function tomlVersion(document) {
  const match = document.match(/^version = "([^"]+)"$/mu);
  assert.ok(match, 'Cargo package version is missing');
  return match[1];
}

test('repository has one synchronized desktop version', async () => {
  const packageDocument = JSON.parse(await text('package.json'));
  const tauri = JSON.parse(await text('src-tauri/tauri.conf.json'));
  const compatibility = JSON.parse(await text('contracts/fixtures/graph-v1/graph-compatibility.v1.json'));
  const cargoVersion = tomlVersion(await text('src-tauri/Cargo.toml'));
  const studio = compatibility.components.find((component) => component.id === 'mere-run-graph-studio');

  assert.deepEqual(
    new Set([packageDocument.version, tauri.version, cargoVersion, studio?.minimum_version]),
    new Set(['0.3.0']),
  );
});

test('all checked-in JSON contracts and fixtures decode', async () => {
  const files = (await trackedFiles()).filter((path) => path.startsWith('contracts/') && extname(path) === '.json');
  assert.ok(files.length > 0);
  for (const path of files) JSON.parse(await readFile(join(root, path), 'utf8'));
});

test('the public repository surface is complete and contains no credential artifacts', async () => {
  const files = await trackedFiles();
  const packageDocument = JSON.parse(await text('package.json'));
  assert.equal(packageDocument.private, true);
  assert.equal(packageDocument.license, 'MIT');
  assert.equal(packageDocument.repository?.url, 'git+https://github.com/sawfwair/mere-run-graph-studio.git');
  assert.match(packageDocument.engines?.node ?? '', /20\.19/u);

  for (const path of ['LICENSE', 'BRAND.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md', 'SUPPORT.md']) {
    assert.ok(await exists(join(root, path)), `${path} is required for the public repository`);
  }

  const credentialFiles = files.filter((path) => (
    /(?:^|\/)\.env(?:\.|$)/u.test(path) && !path.endsWith('.env.example')
  ) || /\.(?:key|p12|pem|pfx)$/iu.test(path));
  assert.deepEqual(credentialFiles, []);

  const secretPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
    /AKIA[0-9A-Z]{16}/u,
    /gh[pousr]_[A-Za-z0-9_]{20,}/u,
    /sk-(?:proj|svcacct)-[A-Za-z0-9_-]{20,}/u,
    /xox[baprs]-[A-Za-z0-9-]{10,}/u,
  ];
  const secretFiles = [];
  for (const path of files) {
    const contents = await readFile(join(root, path));
    if (contents.includes(0)) continue;
    if (secretPatterns.some((pattern) => pattern.test(contents.toString('utf8')))) secretFiles.push(path);
  }
  assert.deepEqual(secretFiles, []);

  assert.doesNotMatch(await text('wrangler.toml'), /^account_id\s*=/mu);
});

test('brand assets have canonical sources and release-safe dimensions', async () => {
  const expectedPngDimensions = new Map([
    ['web/public/graph-studio-og.png', [1200, 630]],
    ['web/public/apple-touch-icon.png', [180, 180]],
    ['src-tauri/icons/icon.png', [512, 512]],
    ['src-tauri/icons/32x32.png', [32, 32]],
  ]);
  for (const [path, [width, height]] of expectedPngDimensions) {
    const png = await readFile(join(root, path));
    assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG', `${path} is not a PNG`);
    assert.equal(png.readUInt32BE(16), width, `${path} has the wrong width`);
    assert.equal(png.readUInt32BE(20), height, `${path} has the wrong height`);
  }

  for (const path of [
    'web/public/brand/mark.svg',
    'web/public/brand/lockup.svg',
    'src-tauri/icons/app-icon.svg',
    'scripts/brand/graph-studio-og.html',
    'scripts/render-brand-assets.mjs',
  ]) assert.ok(await exists(join(root, path)), `${path} is a required brand source`);

  const webDocument = await text('web/index.html');
  assert.match(webDocument, /href="\/brand\/mark\.svg"/u);
  assert.match(webDocument, /href="\/apple-touch-icon\.png"/u);
  assert.match(webDocument, /content="https:\/\/studio\.mere\.run\/graph-studio-og\.png"/u);
});

test('automation is least-privilege and third-party actions are immutable', async () => {
  const checkWorkflow = await text('.github/workflows/check.yml');
  const releaseWorkflow = await text('.github/workflows/release.yml');
  assert.match(checkWorkflow, /permissions:\s*\n\s+contents: read/u);
  assert.match(releaseWorkflow, /permissions:\s*\n\s+contents: write/u);

  for (const workflow of [checkWorkflow, releaseWorkflow]) {
    const actionReferences = [...workflow.matchAll(/^\s*- uses: [^@\s]+@([^\s#]+)/gmu)].map((match) => match[1]);
    assert.ok(actionReferences.length > 0);
    for (const reference of actionReferences) assert.match(reference, /^[0-9a-f]{40}$/u);
  }
});

test('local Markdown links resolve inside the repository', async () => {
  const files = (await trackedFiles()).filter((path) => path.endsWith('.md'));
  for (const path of files) {
    const source = await text(path);
    for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
      const target = match[1].split('#', 1)[0];
      if (!target || /^(?:https?:|mailto:)/u.test(target)) continue;
      const resolved = resolve(root, dirname(path), decodeURIComponent(target));
      assert.ok(resolved.startsWith(`${root}/`) || resolved === root, `${path} links outside the repository: ${target}`);
      assert.ok(await exists(resolved), `${path} contains a broken link: ${target}`);
    }
  }
});

test('the retired compatibility host and its toolchain cannot return', async () => {
  const files = await trackedFiles();
  const forbiddenNames = new Set(['pyproject.toml', 'uv.lock']);
  const forbidden = files
    .filter((path) => extname(path) === '.py' || forbiddenNames.has(basename(path)))
    .sort();
  assert.deepEqual(forbidden, []);

  const automation = [
    await text('.github/workflows/check.yml'),
    await text('.github/workflows/release.yml'),
    await text('scripts/check.sh'),
  ].join('\n');
  assert.doesNotMatch(automation, /\b(?:python(?:3)?|uv|ruff|mypy)\b/iu);
  assert.doesNotMatch(await text('web/src/runtime.ts'), /BrowserRuntime/u);
  assert.doesNotMatch(await text('web/vite.config.ts'), /proxy\s*:/u);
});

test('native Studio remains local and unauthenticated by construction', async () => {
  const runtime = await text('web/src/runtime.ts');
  const nativeRuntime = runtime.slice(runtime.indexOf('export class NativeRuntime'));
  assert.doesNotMatch(nativeRuntime, /\b(?:fetch|oauth|auth|token)\b/iu);

  const app = await text('web/src/App.tsx');
  const nativeApp = app.slice(app.indexOf('function NativeApp'), app.indexOf('function CloudApp'));
  assert.doesNotMatch(nativeApp, /\b(?:fetch|oauth|sign.?in|auth|token)\b/iu);

  const cargo = await text('src-tauri/Cargo.toml');
  assert.doesNotMatch(cargo, /\b(?:reqwest|hyper|oauth2)\b/iu);

  const tauri = JSON.parse(await text('src-tauri/tauri.conf.json'));
  assert.equal(tauri.build.frontendDist, '../dist/desktop');
  const connectSources = tauri.app.security.csp.match(/connect-src ([^;]+);/u)?.[1].split(/\s+/u);
  assert.deepEqual(connectSources, ['ipc:', 'http://ipc.localhost']);
  assert.doesNotMatch(tauri.app.security.csp, /https:\/\//u);
  assert.match(await text('web/vite.config.ts'), /outDir: '\.\.\/dist\/desktop'/u);
});

test('external data enters through the named decoder modules', async () => {
  const files = (await trackedFiles()).filter((path) => (
    (path.startsWith('web/src/') || path.startsWith('cloud/'))
    && /\.(?:ts|tsx)$/u.test(path)
    && !/\.test\.(?:ts|tsx)$/u.test(path)
  ));
  for (const path of files) {
    const source = await text(path);
    if (path !== 'web/src/decode.ts') {
      assert.doesNotMatch(source, /JSON\.parse\s*\(/u, `${path} bypasses parseJsonValue`);
    }
    if (path !== 'web/src/runtime.ts') {
      assert.doesNotMatch(source, /\binvoke(?:<[^>]+>)?\s*\(/u, `${path} bypasses invokeDecoded`);
    }
    assert.doesNotMatch(source, /\bas\s+unknown\s+as\b/u, `${path} contains an unchecked double assertion`);
  }
});
