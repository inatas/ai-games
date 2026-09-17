import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadContent, RuleRegistry } from '../src/index.ts';
import { resolve } from 'node:path';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

test('MP-01/02: strict JSON content, references and registered map conditions', () => {
  const rules = new RuleRegistry();
  rules.register('permit', { type: 'object', additionalProperties: false }, facts => facts.allowed === true ? null : 'LOCKED');
  const content = loadContent(resolve('mods/minimal/content'), rules, ['move']);
  assert.equal(content.map.rooms.length, 2);
  assert.equal(content.npcs.length, 1);
  assert.equal(content.behaviors.length, 0);
  assert.throws(() => loadContent(resolve('mods/minimal/content'), new RuleRegistry(), ['move']), /UNKNOWN_RULE/);
  assert.throws(() => loadContent(resolve('mods/minimal/content'), rules, []), /UNKNOWN_ACTION/);
  const exit = content.map.exits[0];
  assert.equal(rules.denial(exit, { allowed: false }), 'LOCKED');
  assert.equal(rules.denial(exit, { allowed: true }), null);
  assert.throws(() => rules.validate([{ ruleId: 'permit', params: { arbitrary: true } }]), /INVALID_RULE_PARAMS/);
});

test('MP-01: reject unknown fields, escaped paths, invalid topology and duplicate NPCs', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'mud-content-'));
  const rules = new RuleRegistry().register('permit', { type: 'object', additionalProperties: false }, () => null);
  try {
    cpSync(resolve('mods/minimal/content'), resolve(root, 'content'), { recursive: true });
    const dir = resolve(root, 'content');
    const path = resolve(dir, 'manifest.json');
    const original = readFileSync(path, 'utf8');
    writeFileSync(path, JSON.stringify({ ...JSON.parse(original), arbitrary: true }));
    assert.throws(() => loadContent(dir, rules, ['move']), /INVALID_CONTENT/);
    writeFileSync(resolve(root, 'outside.json'), '{}');
    writeFileSync(path, JSON.stringify({ ...JSON.parse(original), map: '../outside.json' }));
    assert.throws(() => loadContent(dir, rules, ['move']), /CONTENT_PATH_ESCAPE/);
    writeFileSync(path, original);
    const npcPath = resolve(dir, 'npcs.json');
    const npcs = JSON.parse(readFileSync(npcPath, 'utf8'));
    writeFileSync(npcPath, JSON.stringify([...npcs, ...npcs]));
    assert.throws(() => loadContent(dir, rules, ['move']), /Invalid NPC/);
    writeFileSync(npcPath, JSON.stringify(npcs));
    const mapPath = resolve(dir, 'map.json');
    const map = JSON.parse(readFileSync(mapPath, 'utf8')); map.exits[0].to = 'missing';
    writeFileSync(mapPath, JSON.stringify(map));
    assert.throws(() => loadContent(dir, rules, ['move']), /Invalid exit/);
  } finally { rmSync(root, { recursive: true }); }
});
