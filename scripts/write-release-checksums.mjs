#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

async function sha256(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}

async function filesBelow(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  }));
  return nested.flat();
}

export async function writeReleaseChecksums(root, output) {
  const artifacts = (await filesBelow(resolve(root)))
    .filter((path) => path.split(/[\\/]/u).includes('bundle'))
    .filter((path) => !path.endsWith('.d') && !path.endsWith('.o'))
    .sort((left, right) => left.localeCompare(right));
  if (artifacts.length === 0) throw new Error(`no release bundles found below ${root}`);
  const lines = await Promise.all(artifacts.map(async (path) => `${await sha256(path)}  ${path.split(/[\\/]/u).at(-1)}`));
  await writeFile(resolve(output), `${lines.join('\n')}\n`, 'utf8');
}

function argumentsFrom(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith('--') || value === undefined) {
      throw new Error('usage: write-release-checksums.mjs --root PATH --output FILE');
    }
    result[flag.slice(2)] = value;
  }
  if (!result.root || !result.output) {
    throw new Error('usage: write-release-checksums.mjs --root PATH --output FILE');
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { root, output } = argumentsFrom(process.argv.slice(2));
  await writeReleaseChecksums(root, output);
}
