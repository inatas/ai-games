import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { migratePlatform } from '@game-ai/platform';
import { migrateGameSystems } from '@game-ai/game-systems';
import { changeItemQuantity, itemQuantity } from '@game-ai/game-systems';
import { startTestDatabase } from '../support/database.ts';
import { migrateGame, initializeGame } from '../../mods/qingxi/src/game.ts';

test('TL-05: neutral inventory enforces ownership, stack limits and transaction rollback', async () => {
  const db=await startTestDatabase();
  try {
    await db.store.migrate(); await db.store.transaction(async tx => { await migratePlatform(tx); await migrateGameSystems(tx); });
    const a=randomUUID(),b=randomUUID();
    await db.store.transaction(async tx=>{
      await tx.query("INSERT INTO mud_realms(id,mod_id,mod_version,content_version,worldview_version) VALUES('inventory','station','1','1','1')");
      for(const id of [a,b]) {
        await tx.query('INSERT INTO fw_scopes(id) VALUES($1)',[id]);
        await tx.query("INSERT INTO mud_characters(scope_id,realm_id,name) VALUES($1,'inventory','actor')",[id]);
      }
      assert.equal(await changeItemQuantity(tx,a,'battery',2,5),2);
      assert.equal(await itemQuantity(tx,b,'battery'),0);
    });
    await assert.rejects(db.store.transaction(tx=>changeItemQuantity(tx,a,'battery',4,5)),/STACK_LIMIT/);
    await assert.rejects(db.store.transaction(tx=>changeItemQuantity(tx,b,'battery',-1,5)),/ITEM_REQUIRED/);
    await assert.rejects(db.store.transaction(async tx=>{await changeItemQuantity(tx,a,'battery',-1,5);throw Error('effect failed');}),/effect failed/);
    assert.equal(await db.store.transaction(tx=>itemQuantity(tx,a,'battery')),2);
    const results=await Promise.allSettled([1,2].map(()=>db.store.transaction(tx=>changeItemQuantity(tx,a,'battery',-2,5))));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  } finally { await db.stop(); }
});

test('TL-05: current inventory survives initialization and cannot respawn after consumption', async () => {
  const db=await startTestDatabase();
  try {
    await db.store.migrate(); await migrateGame(db.store);
    const obsolete = await db.store.pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name IN ('wuxia_inventory','wuxia_npc_states','wuxia_social_messages','wuxia_social_writes','wuxia_parties','wuxia_party_members','wuxia_party_invites','wuxia_social_receipts','qingxi_migrations')");
    assert.equal(obsolete.rowCount,0);
    assert.equal((await db.store.pool.query("SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='wuxia_characters' AND column_name='access_hash'")).rowCount,0);
    const id=randomUUID();
    await db.store.transaction(async tx=>{
      await tx.query('INSERT INTO fw_scopes(id) VALUES($1)',[id]);
      await initializeGame(db.store,tx,id);
    });
    await db.store.transaction(tx=>changeItemQuantity(tx,id,'medicine',1,1));
    await migrateGame(db.store);
    assert.equal(await db.store.transaction(tx=>itemQuantity(tx,id,'medicine')),1);
    await db.store.transaction(tx=>changeItemQuantity(tx,id,'medicine',-1,1));
    await migrateGame(db.store);
    assert.equal(await db.store.transaction(tx=>itemQuantity(tx,id,'medicine')),0);
  } finally { await db.stop(); }
});
