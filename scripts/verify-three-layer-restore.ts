import assert from 'node:assert/strict';
import pg from 'pg';
import { PostgresStore } from '@game-ai/storage';
import { migrateGame } from '../mods/qingxi/src/game.ts';

const url=process.env.TEST_DATABASE_URL;
if(!url || !/^ai_mud_restore_[a-z0-9_]+$/.test(new URL(url).pathname.slice(1))) throw Error('Isolated restore database required');
const pool=new pg.Pool({connectionString:url});
const store=new PostgresStore(pool);
const tables=['fw_users','fw_scopes','fw_requests','fw_memory','wuxia_characters','wuxia_inventory','mud_characters','mud_npcs','mud_messages','mud_tasks','mud_rewards'];
async function fingerprints(){
  const result:Record<string,unknown>={};
  for(const table of tables) result[table]=(await pool.query(`SELECT count(*) AS count, md5(COALESCE(string_agg(row_to_json(t)::text, '' ORDER BY row_to_json(t)::text),'')) AS digest FROM ${table} t`)).rows[0];
  return result;
}
try {
  const before=await fingerprints();
  await store.migrate(); await migrateGame(store);
  assert.deepEqual(await fingerprints(),before);
  const inventory=(await pool.query('SELECT * FROM game_inventory ORDER BY scope_id,item_id')).rows;
  const legacy=(await pool.query('SELECT * FROM wuxia_inventory ORDER BY scope_id,item_id')).rows;
  assert.deepEqual(inventory,legacy,'First migration preserves inventory');
  await migrateGame(store);
  assert.deepEqual(await fingerprints(),before);
  assert.deepEqual((await pool.query('SELECT * FROM game_inventory ORDER BY scope_id,item_id')).rows,inventory);
  console.log(JSON.stringify({result:'three-layer-restore-pass',preserved:before,inventoryRows:inventory.length}));
} finally {await pool.end();}
