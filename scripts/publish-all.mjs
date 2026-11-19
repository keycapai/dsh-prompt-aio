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

/**
 * `--otp=<code>` forwards a one-time password straight to npm.
 *
 * The interactive prompt (see runInteractive) is the friendly path, but it only
 * works when this script owns a TTY. Passing the code explicitly is the escape
 * hatch for CI shells, editors' task runners, or any wrapper that does not.
 */
const otpArg = process.argv.find((arg) => arg.startsWith('--otp='));
const otp = otpArg === undefined ? undefined : otpArg.slice('--otp='.length);

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * Run a command attached to this terminal.
 *
 * `npm publish` may need to PROMPT — a 2FA one-time password, a login, a
 * confirmation. With a piped stdin npm sees no TTY, cannot ask, and dies with
 * EOTP before the user ever sees a chance to type the code. Handing the child
 * our own stdio is what makes the interactive path work at all.
 */
function runInteractive(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: 'inherit' });
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
    // --provenance asks npm to mint a sigstore attestation from the CI identity.
    // There is no such identity on a laptop, and npm refuses the whole publish
    // with EUSAGE ("provider: null"), so it is added only under GitHub Actions.
    const flags = ['publish', tarball, '--access', 'public'];
    if (process.env.GITHUB_ACTIONS === 'true') flags.push('--provenance');
    if (otp !== undefined && otp.length > 0) flags.push(`--otp=${otp}`);
    runInteractive('npm', flags, dir);
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
