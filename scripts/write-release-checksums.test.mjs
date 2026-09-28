import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { writeReleaseChecksums } from './write-release-checksums.mjs';

test('release checksums include only sorted distributable files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mere-graph-studio-release-'));
  const bundle = join(root, 'release', 'bundle');
  await mkdir(bundle, { recursive: true });
  await writeFile(join(bundle, 'z.AppImage'), 'z');
  await writeFile(join(bundle, 'a.deb'), 'a');
  await writeFile(join(bundle, 'studio.app.tar.gz'), 'archive');
  const app = join(bundle, 'macos', 'Mere Graph Studio.app');
  await mkdir(join(app, 'Contents', 'Frameworks'), { recursive: true });
  await writeFile(join(app, 'Contents', 'Frameworks', 'internal.zip'), 'internal');
  await symlink(join(app, 'Contents'), join(bundle, 'macos', 'Current'));
  await writeFile(join(bundle, 'build.d'), 'dependency');
  await writeFile(join(root, 'ignored.txt'), 'ignored');
  const output = join(root, 'SHA256SUMS.txt');

  await writeReleaseChecksums(root, output);

  const digest = (value) => createHash('sha256').update(value).digest('hex');
  assert.equal(
    await readFile(output, 'utf8'),
    `${digest('a')}  a.deb\n${digest('archive')}  studio.app.tar.gz\n${digest('z')}  z.AppImage\n`,
  );
});

test('release checksums reject an empty bundle tree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mere-graph-studio-empty-release-'));
  await assert.rejects(
    writeReleaseChecksums(root, join(root, 'SHA256SUMS.txt')),
    /no release bundles found/u,
  );
});
