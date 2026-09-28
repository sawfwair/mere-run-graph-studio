#!/usr/bin/env node
// Pin the official Sparkle distribution without committing its binary framework.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') process.exit(0);

const version = '2.9.5';
const archiveSha256 = '015336b601493e05c237964954bff6191370003d94edefe663724c88840d73cc';
const toolSha256 = {
  generate_appcast: '669a5ed0f90ce06fb1de3e36aba35c5da8b98f66928a185fd4029174071be700',
  sign_update: 'bfb52400c3da18bb4c251ac4818c2c2e1e31c2e649a45b31c11109b6e57b34ad',
};
const archiveUrl = `https://github.com/sparkle-project/Sparkle/releases/download/${version}/Sparkle-${version}.tar.xz`;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = join(root, 'src-tauri/.sparkle');
const framework = join(destination, 'Sparkle.framework');
const plist = join(framework, 'Resources/Info.plist');

function command(program, args) {
  return execFileSync(program, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function verifyFramework() {
  if (!existsSync(plist) || !existsSync(join(destination, 'bin/generate_appcast'))) return false;
  if (command('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleShortVersionString', plist]) !== version) return false;
  command('codesign', ['--verify', '--deep', '--strict', framework]);
  for (const [name, expected] of Object.entries(toolSha256)) {
    const path = join(destination, 'bin', name);
    if (!existsSync(path) || createHash('sha256').update(readFileSync(path)).digest('hex') !== expected) return false;
  }
  return true;
}

if (verifyFramework()) {
  console.log(`Sparkle ${version} is ready.`);
  process.exit(0);
}

const staging = mkdtempSync(join(tmpdir(), 'graph-studio-sparkle-'));
try {
  const archive = join(staging, 'Sparkle.tar.xz');
  command('curl', ['--fail', '--location', '--silent', '--show-error', '--retry', '3', archiveUrl, '--output', archive]);
  const actual = createHash('sha256').update(readFileSync(archive)).digest('hex');
  if (actual !== archiveSha256) throw new Error(`Sparkle archive checksum mismatch: ${actual}`);
  const unpacked = join(staging, 'unpacked');
  mkdirSync(unpacked);
  command('tar', ['-xJf', archive, '-C', unpacked, './Sparkle.framework', './bin', './LICENSE']);
  const unpackedPlist = join(unpacked, 'Sparkle.framework/Resources/Info.plist');
  if (command('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleShortVersionString', unpackedPlist]) !== version) {
    throw new Error('Sparkle framework version differs from the pinned archive.');
  }
  command('codesign', ['--verify', '--deep', '--strict', join(unpacked, 'Sparkle.framework')]);
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  command('ditto', [join(unpacked, 'Sparkle.framework'), framework]);
  command('ditto', [join(unpacked, 'bin'), join(destination, 'bin')]);
  command('ditto', [join(unpacked, 'LICENSE'), join(destination, 'LICENSE')]);
  if (!verifyFramework()) throw new Error('Copied Sparkle framework did not verify.');
  console.log(`Prepared pinned Sparkle ${version}.`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
