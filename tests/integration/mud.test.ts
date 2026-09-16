import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { migrateMud } from '@game-ai/storage';
import { lockRealm, retireCharacter } from '@game-ai/mud-core';
import { startTestDatabase } from '../support/database.ts';

let db: Awaited<ReturnType<typeof startTestDatabase>>;
before(async () => { db = await startTestDatabase(); await db.store.migrate(); await db.store.transaction(migrateMud); });
after(async () => { await db?.stop(); });
test('MF-04/06/15: realm ownership survives retirement without touching other players', async () => {
  const a = randomUUID(), b = randomUUID();
  await db.store.transaction(async tx => {
    await tx.query("INSERT INTO mud_realms(id,mod_id,mod_version,content_version,worldview_version) VALUES('r1','neutral','1','1','1'),('r2','neutral','1','1','1')");
    for (const [id, realm] of [[a,'r1'],[b,'r2']]) {
      await tx.query('INSERT INTO fw_scopes(id) VALUES($1)', [id]);
      await tx.query("INSERT INTO mud_characters(scope_id,realm_id,name,room_id) VALUES($1,$2,'actor','start')", [id,realm]);
    }
    assert.equal((await lockRealm(tx,a)).realm.id,'r1');
    await retireCharacter(tx,a);
    assert.equal((await lockRealm(tx,b)).realm.id,'r2');
  });
  await assert.rejects(db.store.transaction(tx => lockRealm(tx,a)), /FORBIDDEN/);
  await db.store.transaction(migrateMud);
});
