import { spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = join(root, 'scripts', 'complexity-baseline.json');
const targetMaximum = 10;

export function radonRank(complexity) {
  if (complexity <= 5) return 'A';
  if (complexity <= 10) return 'B';
  if (complexity <= 20) return 'C';
  if (complexity <= 30) return 'D';
  if (complexity <= 40) return 'E';
  return 'F';
}

export function complexityProfile(entries, threshold = targetMaximum) {
  const profile = {};
  for (const entry of entries) {
    if (entry.complexity <= threshold) continue;
    (profile[entry.filename] ??= []).push(entry.complexity);
  }
  for (const values of Object.values(profile)) values.sort((left, right) => right - left);
  return Object.fromEntries(Object.entries(profile).sort(([left], [right]) => left.localeCompare(right)));
}

export function profileRegressions(current, baseline, threshold = targetMaximum) {
  const failures = [];
  for (const [filename, values] of Object.entries(current)) {
    const allowed = baseline[filename] ?? [];
    for (const [index, complexity] of values.entries()) {
      const ceiling = allowed[index] ?? threshold;
      if (complexity > ceiling) failures.push({ filename, complexity, ceiling });
    }
  }
  return failures;
}

async function sourcePaths() {
  const webRootFiles = (await readdir(join(root, 'web'), { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => `web/${entry.name}`);
  return ['cloud', 'web/src', 'web/harness', ...webRootFiles];
}

function measure(paths) {
  const result = spawnSync(
    'pnpm',
    ['exec', 'oxlint', '--config', '.oxlintrc.complexity.json', '--format', 'json', ...paths],
    { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(result.stderr || `oxlint exited with status ${String(result.status)}`);
  }

  const report = JSON.parse(result.stdout);
  const unrelated = report.diagnostics.filter((diagnostic) => diagnostic.code !== 'eslint(complexity)');
  if (unrelated.length > 0) {
    throw new Error(`unexpected oxlint diagnostic: ${unrelated[0].code} ${unrelated[0].message}`);
  }
  return report.diagnostics
    .map((diagnostic) => {
      const match = diagnostic.message.match(/^(.*?) has a complexity of (\d+)\./u);
      if (!match) throw new Error(`unexpected complexity diagnostic: ${diagnostic.message}`);
      return {
        complexity: Number(match[2]),
        description: match[1],
        filename: diagnostic.filename,
        line: diagnostic.labels[0]?.span.line ?? 1,
      };
    })
    .sort((left, right) => (
      right.complexity - left.complexity
      || left.filename.localeCompare(right.filename)
      || left.line - right.line
    ));
}

function summary(entries) {
  const counts = Object.fromEntries(['A', 'B', 'C', 'D', 'E', 'F'].map((rank) => [rank, 0]));
  for (const entry of entries) counts[radonRank(entry.complexity)] += 1;
  return counts;
}

function printReport(entries, regressions, quiet) {
  if (quiet && regressions.length === 0) {
    console.log(`Complexity: ${entries.length} JS/TS functions measured; baseline ratchet passed.`);
    return;
  }

  const counts = summary(entries);
  const average = entries.reduce((total, entry) => total + entry.complexity, 0) / entries.length;
  const hotspots = entries.filter((entry) => entry.complexity > targetMaximum);
  console.log('JavaScript/TypeScript classic McCabe complexity (Radon bands)');
  console.log(`Functions: ${entries.length}; average: ${average.toFixed(2)} (${radonRank(average)}); A:${counts.A} B:${counts.B} C:${counts.C} D:${counts.D} E:${counts.E} F:${counts.F}`);
  console.log(`Hotspots above 10: ${hotspots.length}; showing ${Math.min(hotspots.length, 20)}`);
  for (const entry of hotspots.slice(0, 20)) {
    console.log(`${radonRank(entry.complexity)} ${String(entry.complexity).padStart(2)}  ${entry.filename}:${String(entry.line)}  ${entry.description}`);
  }
  if (hotspots.length > 20) console.log(`... ${hotspots.length - 20} more; the checked-in baseline contains the full profile.`);
  console.log(regressions.length === 0 ? 'Baseline ratchet: PASS' : 'Baseline ratchet: FAIL');
  for (const failure of regressions) {
    console.error(`${failure.filename}: complexity ${failure.complexity} exceeds its baseline ceiling ${failure.ceiling}`);
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const entries = measure(await sourcePaths());
  const profile = complexityProfile(entries);
  if (args.has('--print-baseline')) {
    console.log(JSON.stringify({
      schemaVersion: 1,
      metric: 'classic McCabe cyclomatic complexity',
      targetMaximum,
      profile,
    }, null, 2));
    return;
  }

  const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
  if (baseline.schemaVersion !== 1 || baseline.targetMaximum !== targetMaximum) {
    throw new Error('complexity baseline schema or target maximum does not match the analyzer');
  }
  const regressions = profileRegressions(profile, baseline.profile);
  printReport(entries, regressions, args.has('--quiet'));
  if (regressions.length > 0) process.exitCode = 1;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
