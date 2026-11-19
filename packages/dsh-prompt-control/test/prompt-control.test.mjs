/**
 * Pure-function tests for dsh-prompt-control.
 *
 * The plugin edits the system prompt, so the functions that classify a section,
 * hash it, or substitute variables decide what the user sees in the settings
 * card. All three are pure and are tested directly here.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { classifySection, hashPrompt, interpolateVariables } from '../lib/index.js';

test('hashPrompt is a stable short fingerprint', async (t) => {
  await t.test('the same text always hashes the same', () => {
    assert.equal(hashPrompt('hello'), hashPrompt('hello'));
  });

  await t.test('different text hashes differently', () => {
    assert.notEqual(hashPrompt('hello'), hashPrompt('hello '));
  });

  await t.test('the digest is 12 hex characters', () => {
    assert.match(hashPrompt('anything'), /^[0-9a-f]{12}$/);
  });

  await t.test('null and undefined collapse to the empty-string hash', () => {
    // A missing section must not throw while the card is rendering.
    assert.equal(hashPrompt(null), hashPrompt(''));
    assert.equal(hashPrompt(undefined), hashPrompt(''));
  });

  await t.test('non-strings are stringified, not rejected', () => {
    assert.equal(hashPrompt(42), hashPrompt('42'));
  });
});

test('classifySection maps known prefixes to categories', async (t) => {
  const cases = [
    ['tool:read', 'tools'],
    ['mcp:server', 'tools'],
    ['plan:mode', 'policy'],
    ['team:agent', 'policy'],
    ['file:policy', 'policy'],
    ['harness:source', 'environment'],
    ['deployment:info', 'identity'],
    ['web:app', 'environment'],
    ['app:desktop', 'environment'],
    ['deliverable:doc', 'delivery'],
    ['structured:out', 'delivery'],
  ];

  for (const [key, expected] of cases) {
    await t.test(key + ' belongs to ' + expected, () => {
      const info = classifySection(key);
      assert.equal(info.category, expected);
    });
  }
});

test('classifySection always answers, even for an unknown key', async (t) => {
  await t.test('an unrecognised key still yields a full record', () => {
    const info = classifySection('totally:made-up');
    assert.equal(typeof info.category, 'string');
    assert.equal(typeof info.categoryLabel, 'string');
    assert.equal(typeof info.source, 'string');
    assert.equal(typeof info.description, 'string');
    assert.equal(typeof info.defaultOrder, 'number');
  });

  await t.test('an empty key does not throw', () => {
    const info = classifySection('');
    assert.equal(typeof info.category, 'string');
  });
});

test('interpolateVariables substitutes only known lower-snake slots', async (t) => {
  await t.test('a known slot is replaced', () => {
    assert.equal(interpolateVariables('hi {{name}}', { name: 'Ada' }), 'hi Ada');
  });

  await t.test('an unknown slot is left verbatim', () => {
    assert.equal(interpolateVariables('hi {{nobody}}', {}), 'hi {{nobody}}');
  });

  await t.test('every occurrence is replaced', () => {
    assert.equal(interpolateVariables('{{a}}-{{a}}', { a: 'x' }), 'x-x');
  });

  await t.test('non-snake or uppercase names are not touched', () => {
    // The pattern is deliberately strict so that ordinary prose braces survive.
    assert.equal(interpolateVariables('{{NotAKey}}', { NotAKey: 'x' }), '{{NotAKey}}');
    assert.equal(interpolateVariables('{{a-b}}', { 'a-b': 'x' }), '{{a-b}}');
  });

  await t.test('a non-string body yields an empty string', () => {
    for (const bad of [null, undefined, 42, {}]) {
      assert.equal(interpolateVariables(bad, { a: 'x' }), '');
    }
  });

  await t.test('a value of undefined leaves the slot in place', () => {
    assert.equal(interpolateVariables('{{a}}', { a: undefined }), '{{a}}');
  });

  await t.test('numbers and booleans are stringified', () => {
    assert.equal(interpolateVariables('{{n}}/{{b}}', { n: 7, b: false }), '7/false');
  });
});
