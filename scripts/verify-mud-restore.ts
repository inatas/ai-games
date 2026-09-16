import assert from 'node:assert/strict';
import pg from 'pg';
import { PostgresStore } from '@game-ai/storage';
import { migrateGame } from '../mods/qingxi/src/game.ts';
import { world } from '../mods/qingxi/src/world.ts';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !/^ai_mud_restore_[a-z0-9_]+$/.test(new URL(connectionString).pathname.slice(1))) {
  throw new Error('This script requires an explicitly named isolated ai_mud_restore_ database');
}

const pool = new pg.Pool({ connectionString });
const store = new PostgresStore(pool);
const preservedTables = ['fw_scopes', 'fw_users', 'fw_sessions', 'fw_requests', 'fw_memory',
  'wuxia_characters', 'wuxia_social_messages', 'wuxia_social_writes'] as const;

async function count(table: string) {
  // The names come from the fixed local allowlist, never from the connection string.
  return Number((await pool.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
}

try {
  const existing = [] as string[];
  for (const table of preservedTables) {
    if ((await pool.query('SELECT to_regclass($1) AS name', [table])).rows[0].name) existing.push(table);
  }
  const before = Object.fromEntries(await Promise.all(existing.map(async table => [table, await count(table)])));
  await store.migrate();
  await migrateGame(store);
  await migrateGame(store);
  const after = Object.fromEntries(await Promise.all(existing.map(async table => [table, await count(table)])));
  assert.deepEqual(after, before, 'Historical rows changed during migration');
  assert.equal(await count('mud_characters'), before.wuxia_characters);
  assert.equal(await count('mud_npcs'), world.npcs.length);
  assert.equal(await count('mud_realms'), 1);
  assert.equal(await count('mud_writes'), before.wuxia_social_writes ?? 0);
  console.log(JSON.stringify({ result: 'restore-and-repeat-migration-pass', preserved: before,
    realms: await count('mud_realms'), characters: await count('mud_characters'), npcs: await count('mud_npcs') }));
} finally {
  await pool.end();
}
