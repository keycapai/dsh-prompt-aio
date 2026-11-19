/**
 * Pure-function tests for dsh-skill-control.
 *
 * The plugin's job is to shrink the skill catalog without losing the ability to
 * find a skill. The functions that decide "how much of this skill do we show"
 * are pure, so they are tested directly — no Cordis context, no host.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_CONFIG,
  estimateTokens,
  getConfigSnapshot,
  isSkillPinned,
  normalizeSkillModes,
  skillModeOf,
} from '../lib/index.js';

test('normalizeSkillModes keeps only known modes', async (t) => {
  await t.test('drops an unknown mode string', () => {
    assert.deepEqual(normalizeSkillModes({ a: 'nonsense' }), {});
  });

  await t.test('keeps a known mode', () => {
    const out = normalizeSkillModes({ a: 'name' });
    assert.deepEqual(out, { a: 'name' });
  });

  await t.test('rejects non-objects without throwing', () => {
    for (const value of [null, undefined, 42, 'x', []]) {
      assert.deepEqual(normalizeSkillModes(value), {});
    }
  });

  await t.test('skips empty and non-string keys', () => {
    const out = normalizeSkillModes({ '': 'name' });
    assert.deepEqual(out, {});
  });
});

test('skillModeOf resolves explicit, then fallback', async (t) => {
  await t.test('explicit mode wins over fallback', () => {
    assert.equal(skillModeOf('a', { skillModes: { a: 'name' }, fallbackMode: 'stub' }), 'name');
  });

  await t.test('an unlisted skill uses the fallback', () => {
    // The legal modes are full / name / hidden / disabled — there is no "stub"
    // for skills (that is a tool-control mode). Asserting the real vocabulary
    // keeps this test honest.
    assert.equal(skillModeOf('other', { skillModes: { a: 'name' }, fallbackMode: 'hidden' }), 'hidden');
  });

  await t.test('an invalid fallback is reported and replaced, not obeyed', () => {
    assert.equal(skillModeOf('other', { fallbackMode: 'stub' }), DEFAULT_CONFIG.fallbackMode);
  });

  await t.test('the documented default fallback is full', () => {
    assert.equal(DEFAULT_CONFIG.fallbackMode, 'full');
    assert.equal(skillModeOf('anything'), 'full');
  });

  await t.test('no config at all yields the documented default', () => {
    assert.equal(skillModeOf('x'), DEFAULT_CONFIG.fallbackMode);
    assert.equal(skillModeOf('x', {}), DEFAULT_CONFIG.fallbackMode);
  });

  await t.test('an empty or non-string name yields the fallback, never throws', () => {
    for (const bad of ['', null, undefined, 42]) {
      assert.equal(skillModeOf(bad, { fallbackMode: 'name' }), 'name');
    }
  });

  await t.test('an invalid fallback is normalized to the default', () => {
    assert.equal(skillModeOf('x', { fallbackMode: 'garbage' }), DEFAULT_CONFIG.fallbackMode);
  });
});

test('isSkillPinned reports only explicit entries', async (t) => {
  await t.test('an explicit entry is pinned', () => {
    assert.equal(isSkillPinned('a', { skillModes: { a: 'name' } }), true);
  });

  await t.test('an unlisted skill is not pinned', () => {
    assert.equal(isSkillPinned('b', { skillModes: { a: 'name' } }), false);
  });

  await t.test('hostile input is not pinned and does not throw', () => {
    for (const bad of ['', null, 42]) {
      assert.equal(isSkillPinned(bad, { skillModes: { a: 'name' } }), false);
    }
    assert.equal(isSkillPinned('a', null), false);
  });
});

test('estimateTokens counts wide characters as whole tokens', async (t) => {
  await t.test('empty text is zero', () => {
    assert.equal(estimateTokens(''), 0);
    assert.equal(estimateTokens(null), 0);
    assert.equal(estimateTokens(undefined), 0);
  });

  await t.test('ascii costs a quarter token per character', () => {
    assert.equal(estimateTokens('abcd'), 1);
    assert.equal(estimateTokens('abcdefgh'), 2);
  });

  await t.test('a wide character costs one whole token', () => {
    assert.equal(estimateTokens('中文'), 2);
  });

  await t.test('the result is rounded up, never down', () => {
    // 1 wide (1) + 1 narrow (0.25) = 1.25 -> 2
    assert.equal(estimateTokens('中a'), 2);
  });
});

test('getConfigSnapshot normalizes a hostile config', async (t) => {
  await t.test('empty input yields every default', () => {
    const snap = getConfigSnapshot({});
    assert.equal(snap.enabled, true);
    assert.equal(snap.fallbackMode, DEFAULT_CONFIG.fallbackMode);
    assert.equal(snap.catalogDescriptionMaxLength, DEFAULT_CONFIG.catalogDescriptionMaxLength);
    assert.deepEqual(snap.skillModes, {});
  });

  await t.test('null and non-objects do not throw', () => {
    for (const value of [null, undefined, 42, 'x']) {
      const snap = getConfigSnapshot(value);
      assert.equal(snap.fallbackMode, DEFAULT_CONFIG.fallbackMode);
    }
  });

  await t.test('an explicit false disables', () => {
    assert.equal(getConfigSnapshot({ enabled: false }).enabled, false);
  });

  await t.test('a non-numeric description limit falls back', () => {
    assert.equal(
      getConfigSnapshot({ catalogDescriptionMaxLength: 'wide' }).catalogDescriptionMaxLength,
      DEFAULT_CONFIG.catalogDescriptionMaxLength,
    );
    assert.equal(
      getConfigSnapshot({ catalogDescriptionMaxLength: -1 }).catalogDescriptionMaxLength,
      DEFAULT_CONFIG.catalogDescriptionMaxLength,
    );
  });

  await t.test('zero is a real limit, not a missing value', () => {
    assert.equal(getConfigSnapshot({ catalogDescriptionMaxLength: 0 }).catalogDescriptionMaxLength, 0);
  });
});
