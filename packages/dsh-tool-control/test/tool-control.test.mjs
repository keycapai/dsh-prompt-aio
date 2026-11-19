/**
 * Pure-function tests for dsh-tool-control.
 *
 * The plugin decides which tools the model sees up front. The decision function
 * isToolInPreset is pure over (toolName, presetId, profileYaml), so the whole
 * policy surface is testable without a host: a wrong answer here means the model
 * either loses a tool it needs or pays context for one it does not.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_CONFIG, isToolInPreset } from '../lib/index.js';

test('an absent profile admits every tool', async (t) => {
  await t.test('empty content is a passthrough, not a deny', () => {
    // Reporting 'not in preset' for an unreadable profile would silently strip
    // the tool list; the safe default is to leave the surface alone.
    assert.equal(isToolInPreset('bash', 'default', ''), true);
    assert.equal(isToolInPreset('anything', 'default', ''), true);
  });

  await t.test('a non-string profile is a passthrough', () => {
    for (const bad of [null, undefined, 42, {}]) {
      assert.equal(isToolInPreset('bash', 'default', bad), true);
    }
  });
});

test('an explicit allowlist takes precedence', async (t) => {
  // The profile spells this as a bare `allow:` key (block or inline), not a
  // namespaced toolAllowlist — that is what the parser actually looks for.
  const block = 'allow:\n  - read\n  - write\n';

  await t.test('a listed tool is admitted', () => {
    assert.equal(isToolInPreset('read', 'default', block), true);
    assert.equal(isToolInPreset('write', 'default', block), true);
  });

  await t.test('an unlisted tool is refused', () => {
    assert.equal(isToolInPreset('bash', 'default', block), false);
    assert.equal(isToolInPreset('run_code', 'default', block), false);
  });

  await t.test('the inline form parses the same way', () => {
    const inline = 'allow: [read, write]\n';
    assert.equal(isToolInPreset('read', 'default', inline), true);
    assert.equal(isToolInPreset('bash', 'default', inline), false);
  });

  await t.test('quotes around a name are stripped', () => {
    assert.equal(isToolInPreset('read', 'default', 'allow:\n  - "read"\n'), true);
  });

  await t.test('an empty allow list falls through to the normal rules', () => {
    // An empty list is not "deny everything": the parser returns null, so the
    // later branches still decide. With a bash provider present, bash survives.
    assert.equal(isToolInPreset('bash', 'default', 'allow: []\nname: dsh-tool-bash\n'), true);
    // Without any provider, bash is refused — same as having no allow key at all.
    assert.equal(isToolInPreset('bash', 'default', 'allow: []\n'), false);
  });

  await t.test('a non-empty allow list is a hard whitelist', () => {
    // Even a tool whose provider plugin is enabled is refused when the allow
    // list names something else.
    const yaml = 'allow:\n  - read\nname: dsh-tool-bash\n';
    assert.equal(isToolInPreset('read', 'default', yaml), true);
    assert.equal(isToolInPreset('bash', 'default', yaml), false);
  });
});

test('run_code follows the preset, not the generic rules', async (t) => {
  await t.test('the ptc preset admits run_code', () => {
    assert.equal(isToolInPreset('run_code', 'ptc', 'x: 1\n'), true);
  });

  await t.test('a profile that names dsh-ptc admits run_code', () => {
    assert.equal(isToolInPreset('run_code', 'default', 'name: dsh-ptc\n'), true);
  });

  await t.test('a plain profile refuses run_code', () => {
    assert.equal(isToolInPreset('run_code', 'default', 'name: something-else\n'), false);
  });
});

test('bash requires one of its provider plugins to be enabled', async (t) => {
  await t.test('dsh-tool-bash admits bash', () => {
    assert.equal(isToolInPreset('bash', 'default', 'name: dsh-tool-bash\n'), true);
  });

  await t.test('dsh-terminal-bash also admits bash', () => {
    assert.equal(isToolInPreset('bash', 'default', 'name: dsh-terminal-bash\n'), true);
  });

  await t.test('an unrelated profile refuses bash', () => {
    assert.equal(isToolInPreset('bash', 'default', 'name: dsh-tool-read\n'), false);
  });
});

test('pwsh requires one of its provider plugins', async (t) => {
  await t.test('dsh-tool-pwsh admits pwsh', () => {
    assert.equal(isToolInPreset('pwsh', 'default', 'name: dsh-tool-pwsh\n'), true);
  });

  await t.test('an unrelated profile refuses pwsh', () => {
    assert.equal(isToolInPreset('pwsh', 'default', 'name: dsh-tool-bash\n'), false);
  });
});

test('DEFAULT_CONFIG documents the reduction defaults', () => {
  assert.equal(DEFAULT_CONFIG.enabled, true);
  // The default is "full": the plugin must not shrink the tool surface until the
  // user asks it to. Only tools listed in the bundle patch are reduced.
  assert.equal(DEFAULT_CONFIG.fallbackMode, 'full');
  assert.ok(Array.isArray(DEFAULT_CONFIG.passthrough));
});
