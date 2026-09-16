import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { migrateMud } from '@game-ai/storage';
import { lockRealm, mutateParty, sendMessage, socialProjection, sharedTask, retireCharacter } from '@game-ai/mud-core';
import { startTestDatabase } from '../support/database.ts';

let db: Awaited<ReturnType<typeof startTestDatabase>>;
before(async()=>{db=await startTestDatabase();await db.store.migrate();await db.store.transaction(migrateMud);});
after(async()=>{await db?.stop();});
async function actor(realm:string){
  const id=randomUUID();
  await db.store.transaction(async tx=>{
    await tx.query("INSERT INTO mud_realms(id,mod_id,mod_version,content_version,worldview_version) VALUES($1,'neutral','1','1','1') ON CONFLICT DO NOTHING",[realm]);
    await tx.query('INSERT INTO fw_scopes(id) VALUES($1)',[id]);
    await tx.query("INSERT INTO mud_characters(scope_id,realm_id,name,room_id) VALUES($1,$2,'actor','start')",[id,realm]);
  });return id;
}
const party=(id:string,input:{action:string;targetScopeId?:string;inviteId?:string},requestId=randomUUID())=>db.store.transaction(tx=>mutateParty(tx,id,{requestId,...input}));
async function pair(a:string,b:string){const invite=await party(a,{action:'invite',targetScopeId:b});await party(b,{action:'accept',inviteId:invite.inviteId});}
async function task(id:string,step:'accept'|'contribute'|'complete'|'claim') {return db.store.transaction(async tx=>{await lockRealm(tx,id);return sharedTask(tx,id,'delivery',step,2);});}

test('MF-04/06: realm chat and invitations cannot cross worlds; changed duplicate payload conflicts',async()=>{
  const a=await actor('chat-a'),b=await actor('chat-a'),c=await actor('chat-b');
  const requestId=randomUUID();
  const input={requestId,channel:'chat',body:'public'};
  await db.store.transaction(tx=>sendMessage(tx,a,input));
  await db.store.transaction(tx=>sendMessage(tx,a,input));
  await assert.rejects(db.store.transaction(tx=>sendMessage(tx,a,{...input,body:'changed'})),/IDEMPOTENCY_CONFLICT/);
  assert.equal((await db.store.transaction(tx=>socialProjection(tx,b))).messages.length,1);
  assert.equal((await db.store.transaction(tx=>socialProjection(tx,c))).messages.length,0);
  await assert.rejects(party(a,{action:'invite',targetScopeId:c}),/INVALID_TARGET/);
  await assert.rejects(db.store.transaction(tx=>sendMessage(tx,a,{requestId:randomUUID(),channel:'tell',body:'secret',targetScopeId:c})),/INVALID_TARGET/);
});
test('MF-08: simultaneous invitations cannot exceed capacity or join two parties',async()=>{
  const members=await Promise.all(Array.from({length:5},()=>actor('capacity')));
  const invitations=await Promise.all(members.slice(1).map(targetScopeId=>party(members[0],{action:'invite',targetScopeId})));
  const results=await Promise.allSettled(invitations.map((i,n)=>party(members[n+1],{action:'accept',inviteId:i.inviteId})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,3);
  assert.equal((await db.store.transaction(tx=>socialProjection(tx,members[0]))).party?.members.length,4);
});
test('MF-09/10: frozen task participants, atomic claims and retirement invalidate rewards',async()=>{
  const a=await actor('task'),b=await actor('task'),c=await actor('task');await pair(a,b);
  await task(a,'accept');await pair(a,c);
  await assert.rejects(task(c,'contribute'),/RULE_REJECTED/);
  await Promise.all([task(a,'contribute'),task(b,'contribute')]);
  await assert.rejects(task(a,'contribute'),/RULE_REJECTED/);
  await task(a,'complete');
  const claims=await Promise.allSettled([task(a,'claim'),task(a,'claim')]);
  assert.equal(claims.filter(r=>r.status==='fulfilled').length,1);
  await db.store.transaction(tx=>retireCharacter(tx,b));
  await assert.rejects(task(b,'claim'),/FORBIDDEN/);
  assert.equal(Number((await db.store.pool.query('SELECT count(*) n FROM mud_rewards')).rows[0].n),1);
});
test('MF-10: injected reward failure rolls back the claim',async()=>{
  const a=await actor('rollback'),b=await actor('rollback');await pair(a,b);await task(a,'accept');await task(a,'contribute');await task(b,'contribute');await task(a,'complete');
  await assert.rejects(db.store.transaction(async tx=>{await lockRealm(tx,a);await sharedTask(tx,a,'delivery','claim',2);throw Error('fault');}),/fault/);
  assert.equal((await task(a,'claim')).awarded,true);
});
