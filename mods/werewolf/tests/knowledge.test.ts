import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWerewolfKnowledge, selectWerewolfKnowledge } from '../src/knowledge.ts';

test('WW-E09/E10: current board loads every public role and term, but one private guide', () => {
  const knowledge = loadWerewolfKnowledge();
  const ids = knowledge.sharedKnowledge.map(entry => entry.id);
  assert.equal(ids[0], 'board:12p-seer-witch-hunter-idiot');
  assert.deepEqual(ids.filter(id => id.startsWith('role:')), [
    'role:hunter', 'role:idiot', 'role:seer', 'role:villager', 'role:witch', 'role:wolf',
  ]);
  assert.ok(ids.includes('term:金水'));
  assert.ok(ids.includes('term:刀口'));
  assert.ok(ids.includes('term:银水'));
  const seer = selectWerewolfKnowledge(knowledge, 'seer');
  const wolf = selectWerewolfKnowledge(knowledge, 'wolf');
  assert.deepEqual(seer.sharedKnowledge, wolf.sharedKnowledge);
  assert.equal(seer.privateKnowledge.id, 'guide:seer');
  assert.equal(wolf.privateKnowledge.id, 'guide:wolf');
  assert.equal(JSON.stringify(seer).includes('guide:wolf'), false);
});

test('WW-E12: missing or blank required knowledge fails before a room starts', () => {
  const root = mkdtempSync(join(tmpdir(), 'werewolf-knowledge-'));
  try {
    assert.throws(() => loadWerewolfKnowledge(root), /KNOWLEDGE_/);
    writeFileSync(join(root, 'ignored.md'), '   ');
    assert.throws(() => loadWerewolfKnowledge(root), /KNOWLEDGE_/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('WW-E12: editing one term changes the frozen room knowledge digest', () => {
  const root = mkdtempSync(join(tmpdir(), 'werewolf-knowledge-version-'));
  try {
    cpSync(fileURLToPath(new URL('../knowledge/', import.meta.url)), root, { recursive: true });
    const before = loadWerewolfKnowledge(root).digest;
    writeFileSync(join(root, 'terms', '金水.md'), '# 金水\n\n修订的人工定义。\n');
    assert.notEqual(loadWerewolfKnowledge(root).digest, before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('WW-WK02/06: all six roles share the public badge-flow convention and only their own guide', () => {
  const knowledge = loadWerewolfKnowledge();
  const publicSeer = knowledge.sharedKnowledge.find(entry => entry.id === 'role:seer')!;
  assert.match(publicSeer.content, /警徽流/);
  assert.match(publicSeer.content, /验人顺序/);
  assert.match(publicSeer.content, /撕掉警徽/);
  for (const role of ['wolf', 'seer', 'witch', 'hunter', 'idiot', 'villager'] as const) {
    const selected = selectWerewolfKnowledge(knowledge, role);
    assert.equal(selected.sharedKnowledge.find(entry => entry.id === 'role:seer'), publicSeer);
    assert.equal(selected.privateKnowledge, knowledge.guides[role]);
    assert.equal(selected.sharedKnowledge.some(entry => entry.id.startsWith('guide:')), false);
  }
});

test('WW-WK03: each role guide and the public seer convention participate in the frozen digest', () => {
  const source = fileURLToPath(new URL('../knowledge/', import.meta.url));
  for (const relative of [
    ...['wolf', 'seer', 'witch', 'hunter', 'idiot', 'villager'].map(role => `guides/${role}.md`),
    'roles/seer.md',
  ]) {
    const root = mkdtempSync(join(tmpdir(), 'werewolf-tactics-version-'));
    try {
      cpSync(source, root, { recursive: true });
      const frozen = loadWerewolfKnowledge(root);
      const before = JSON.stringify(frozen);
      writeFileSync(join(root, relative), '# 人工修订\n\n用于验证知识版本冻结。\n');
      assert.notEqual(loadWerewolfKnowledge(root).digest, frozen.digest, relative);
      assert.equal(JSON.stringify(frozen), before, 'editing a file must not hot-replace a loaded catalog');
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});
