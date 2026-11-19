/**
 * Publish the four packages in dependency order.
 *
 * Why a script instead of four `npm publish` lines: the meta package depends on
 * the three control packages, so publishing it first would leave a window where
 * `npm install dsh-prompt-aio` fails. This script encodes the order once.
 *
 * Usage:
 *   node scripts/publish-all.mjs            # dry run: pack and report
 *   node scripts/publish-all.mjs --publish  # actually publish
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

/** Dependencies first. The meta package is last, always. */
const ORDER = [
  'dsh-tool-control',
  'dsh-skill-control',
  'dsh-prompt-control',
  'dsh-prompt-aio',
];

const publish = process.argv.includes('--publish');

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function versionOf(dir) {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;
}

function alreadyPublished(name, version) {
  try {
    const out = run('npm', ['view', `${name}@${version}`, 'version'], ROOT);
    return out === version;
  } catch {
    // A 404 is the expected answer for an unpublished version.
    return false;
  }
}

let failed = false;

for (const name of ORDER) {
  const dir = join(ROOT, 'packages', name);
  if (!existsSync(join(dir, 'package.json'))) {
    console.error(`MISSING package ${name}`);
    failed = true;
    continue;
  }

  const version = versionOf(dir);

  if (alreadyPublished(name, version)) {
    console.log(`${name}@${version}  already on npm, skipping`);
    continue;
  }

  if (!publish) {
    // A dry run still packs: that is the step that catches a bad `files` list.
    const tarball = run('npm', ['pack', '--silent'], dir);
    console.log(`${name}@${version}  would publish  (${tarball})`);
    continue;
  }

  try {
    const tarball = run('npm', ['pack', '--silent'], dir);
    run('npm', ['publish', tarball, '--access', 'public', '--provenance'], dir);
    console.log(`${name}@${version}  published`);
  } catch (error) {
    console.error(`${name}@${version}  FAILED`);
    console.error(String(error.stderr || error.message).trim());
    // Stop immediately: publishing the meta package on top of a missing
    // dependency is worse than stopping halfway.
    failed = true;
    break;
  }
}

if (failed) process.exit(1);
console.log(publish ? 'done' : 'dry run complete (pass --publish to publish)');
