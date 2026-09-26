// Verify an actual packaged native executable with a caller-selected public runtime.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [binaryArgument, runtimeArgument] = process.argv.slice(2);
if (!binaryArgument || !runtimeArgument) throw Error('Usage: node scripts/verify-local-package.mjs PACKAGED_BINARY MERE_RUN');
const binary = realpathSync(binaryArgument);
const runtime = realpathSync(runtimeArgument);
const appData = mkdtempSync(join(tmpdir(), 'graph-studio-local-proof-'));
const offline = process.env.GRAPH_STUDIO_OFFLINE === '1';
if (offline && process.platform !== 'darwin') throw Error('GRAPH_STUDIO_OFFLINE currently requires macOS sandbox-exec');
const command = offline ? '/usr/bin/sandbox-exec' : binary;
const args = offline ? ['-p', '(version 1)(allow default)(deny network*)', binary, '--verify-local-package', runtime, appData]
  : ['--verify-local-package', runtime, appData];
const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120000 });
if (result.status !== 0) throw Error(result.stderr || String(result.error ?? 'Packaged verification failed'));
const proof = JSON.parse(result.stdout);
if (proof.verified !== true || proof.inspection?.executor !== 'local' || proof.inspection?.state !== 'finished') throw Error('Packaged local run did not finish');
const manifest = JSON.parse(readFileSync(join(proof.run_directory, 'run.json'), 'utf8'));
if (manifest.state !== 'finished' || !Array.isArray(manifest.nodes) || manifest.nodes.length !== 3) throw Error('Expected three completed nodes');
const output = manifest.outputs.find((item) => item.name === 'message');
if (!output || JSON.parse(readFileSync(join(proof.run_directory, output.path), 'utf8')) !== proof.message) throw Error('Packaged output content did not match');
const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
if (output.sha256 !== digest(join(proof.run_directory, output.path))) throw Error('Output does not match the runtime manifest digest');
console.log(JSON.stringify({ contract_version: 'mere.run/graph-studio-local-proof.v1',
  verified: true, network_policy: offline ? 'denied' : 'unrestricted', binary, binary_sha256: digest(binary), runtime, runtime_sha256: digest(runtime),
  app_data: appData, run_directory: proof.run_directory, run_id: proof.run_id,
  message: proof.message, output_sha256: digest(join(proof.run_directory, output.path)), manifest_sha256: digest(join(proof.run_directory, 'run.json')) }, null, 2));
