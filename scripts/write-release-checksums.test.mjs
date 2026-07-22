import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { writeReleaseChecksums } from './write-release-checksums.mjs';

test('release checksums include only sorted bundle artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mere-graph-studio-release-'));
  const bundle = join(root, 'release', 'bundle');
  await mkdir(bundle, { recursive: true });
  await writeFile(join(bundle, 'z.AppImage'), 'z');
  await writeFile(join(bundle, 'a.deb'), 'a');
  await writeFile(join(root, 'ignored.txt'), 'ignored');
  const output = join(root, 'SHA256SUMS.txt');

  await writeReleaseChecksums(root, output);

  const digest = (value) => createHash('sha256').update(value).digest('hex');
  assert.equal(
    await readFile(output, 'utf8'),
    `${digest('a')}  a.deb\n${digest('z')}  z.AppImage\n`,
  );
});

test('release checksums reject an empty bundle tree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mere-graph-studio-empty-release-'));
  await assert.rejects(
    writeReleaseChecksums(root, join(root, 'SHA256SUMS.txt')),
    /no release bundles found/u,
  );
});
