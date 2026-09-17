import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { migratePlatform, ModRegistry, sendMessage, socialProjection, mutateParty, postWalletEntry, retireCharacter } from '@game-ai/platform';
import { startTestDatabase } from '../support/database.ts';

test('TL-01/02: mapless platform supports realm chat, parties and rejects unsafe audiences', async () => {
  const db = await startTestDatabase();
  try {
    await db.store.migrate();
    await db.store.transaction(migratePlatform);
    new ModRegistry().register({ id: 'plain', version: '1', contractVersion: 1, contentVersion: '1', worldviewVersion: '1', configSchema: { type: 'object' }, config: {}, actions: ['inspect'] });
    const a = randomUUID(), b = randomUUID(), outsider = randomUUID();
    await db.store.transaction(async tx => {
      await tx.query("INSERT INTO mud_realms(id,mod_id,mod_version,content_version,worldview_version) VALUES('plain','plain','1','1','1'),('other','plain','1','1','1')");
      for (const id of [a,b,outsider]) {
        await tx.query('INSERT INTO fw_scopes(id) VALUES($1)', [id]);
        await tx.query('INSERT INTO mud_characters(scope_id,realm_id,name) VALUES($1,$2,$3)', [id,id === outsider ? 'other' : 'plain',id]);
      }
      assert.equal((await tx.query("SELECT to_regclass('mud_tasks') AS name")).rows[0].name, null);
      await sendMessage(tx,a,{requestId:randomUUID(),channel:'chat',body:'hello'});
      await sendMessage(tx,a,{requestId:randomUUID(),channel:'tell',body:'private',targetScopeId:b});
      assert.equal((await socialProjection(tx,b)).messages.length,2);
      assert.deepEqual((await socialProjection(tx,b)).playersHere,[]);
      const invite = await mutateParty(tx,a,{requestId:randomUUID(),action:'invite',targetScopeId:b});
      await mutateParty(tx,b,{requestId:randomUUID(),action:'accept',inviteId:invite.inviteId});
    });
    await assert.rejects(db.store.transaction(tx=>sendMessage(tx,a,{requestId:randomUUID(),channel:'say',body:'local'})),/CHANNEL_UNAVAILABLE/);
    await assert.rejects(db.store.transaction(tx=>sendMessage(tx,a,{requestId:randomUUID(),channel:'say',body:'leak'}, { localRecipients: async()=>[outsider] })),/INVALID_TARGET/);
    await assert.rejects(db.store.transaction(tx=>mutateParty(tx,b,{requestId:randomUUID(),action:'leave'}, { onPartyLeft: async()=>{throw Error('rollback');} })),/rollback/);
    assert.equal((await db.store.transaction(tx=>socialProjection(tx,b))).party?.members.length,2);
    await db.store.transaction(tx=>mutateParty(tx,b,{requestId:randomUUID(),action:'leave'}));
    assert.equal((await db.store.transaction(tx=>socialProjection(tx,a))).party,null);
  } finally { await db.stop(); }
});

test('TL-04: wallet posting is atomic, scoped, replayable and cannot overdraw', async () => {
  const db = await startTestDatabase();
  try {
    await db.store.migrate(); await db.store.transaction(migratePlatform);
    const id=randomUUID();
    await db.store.transaction(async tx=>{
      await tx.query("INSERT INTO mud_realms(id,mod_id,mod_version,content_version,worldview_version) VALUES('wallet','plain','1','1','1')");
      await tx.query('INSERT INTO fw_scopes(id) VALUES($1)',[id]);
      await tx.query("INSERT INTO mud_characters(scope_id,realm_id,name) VALUES($1,'wallet','actor')",[id]);
    });
    const wallet={kind:'character' as const,ownerId:id,realmId:'wallet',currency:'silver'};
    const entry={requestId:randomUUID(),delta:10,reason:'test reward'};
    assert.equal(await db.store.transaction(tx=>postWalletEntry(tx,wallet,entry)),10);
    assert.equal(await db.store.transaction(tx=>postWalletEntry(tx,wallet,entry)),10);
    await assert.rejects(db.store.transaction(tx=>postWalletEntry(tx,wallet,{...entry,delta:11})),/IDEMPOTENCY_CONFLICT/);
    const results=await Promise.allSettled([1,2].map(()=>db.store.transaction(tx=>postWalletEntry(tx,wallet,{requestId:randomUUID(),delta:-7,reason:'purchase'}))));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    await assert.rejects(db.store.transaction(tx=>postWalletEntry(tx,{...wallet,realmId:'other'},{...entry,requestId:randomUUID()})),/INVALID_WALLET_OWNER/);
    await assert.rejects(db.store.transaction(async tx=>{await postWalletEntry(tx,wallet,{requestId:randomUUID(),delta:5,reason:'rollback'});throw Error('rollback');}),/rollback/);
    assert.equal((await db.store.pool.query('SELECT balance FROM platform_wallets')).rows[0].balance,3);
    const userId=randomUUID();
    await db.store.pool.query("INSERT INTO fw_users(id,username,password_salt,password_hash,current_scope_id) VALUES($1,'wallet_user','test-only','test-only',$2)",[userId,id]);
    const account={kind:'account' as const,ownerId:userId,currency:'points'};
    const credit={requestId:randomUUID(),delta:20,reason:'test credit, not payment'};
    await db.store.transaction(tx=>postWalletEntry(tx,account,credit));
    await db.store.transaction(tx=>retireCharacter(tx,id));
    assert.equal(await db.store.transaction(tx=>postWalletEntry(tx,account,credit)),20,'Account funds survive character retirement');
    await assert.rejects(db.store.transaction(tx=>postWalletEntry(tx,wallet,{...entry,requestId:randomUUID()})),/INVALID_WALLET_OWNER/);
  } finally { await db.stop(); }
});
