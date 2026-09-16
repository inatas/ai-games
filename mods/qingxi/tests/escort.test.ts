import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ScriptedModel } from '@game-ai/model';
import { startTestDatabase } from '../../../tests/support/database.ts';
import { buildApp } from '../../../apps/server/src/app.ts';

test('QX-03: two players explore, complete and claim shared escort exactly once via generic API',async()=>{
  const db=await startTestDatabase();const built=await buildApp(db.store,new ScriptedModel(()=>'{"choice":"ACCEPT"}'));
  try {
    async function login(){const r=await built.app.inject({method:'POST',url:'/api/auth/login',headers:{origin:'http://localhost'},payload:{username:'e_'+randomUUID().slice(0,8),password:'test-password'}});assert.equal(r.statusCode,200,r.body);return {id:r.json().currentScopeId as string,cookie:String(r.headers['set-cookie']).split(';')[0]};}
    type Session=Awaited<ReturnType<typeof login>>;
    const read=async(g:Session)=>(await built.app.inject({url:'/api/mud/current',headers:{cookie:g.cookie}})).json();
    async function action(g:Session,action:string,extra:Record<string,string>={}){
      const requestId=randomUUID();const r=await built.app.inject({method:'POST',url:'/api/mud/actions',headers:{cookie:g.cookie,origin:'http://localhost'},payload:{requestId,expectedMemoryVersion:(await read(g)).memoryVersion,note:'',action,...extra}});
      assert.ok([200,202].includes(r.statusCode),r.body);await built.harness.drain();return built.harness.get(g.id,requestId);
    }
    async function move(g:Session,to:string){assert.equal((await action(g,'move',{exitId:(await read(g)).map.currentRoomId+':'+to})).status,'committed');}
    async function social(g:Session,payload:object){const r=await built.app.inject({method:'POST',url:'/api/mud/social/party',headers:{cookie:g.cookie,origin:'http://localhost'},payload:{requestId:randomUUID(),...payload}});assert.equal(r.statusCode,200,r.body);return r.json();}
    const a=await login(),b=await login();const invite=await social(a,{action:'invite',targetScopeId:b.id});await social(b,{action:'accept',inviteId:invite.inviteId});
    for(const g of [a,b]){await move(g,'street');await move(g,'herbalist');}
    assert.equal((await action(a,'escort_accept')).status,'committed');
    for(const g of [a,b]){await move(g,'square');await move(g,'trail');await move(g,'forest');assert.equal((await action(g,'escort_contribute')).status,'committed');await move(g,'trail');await move(g,'square');await move(g,'herbalist');}
    assert.equal((await action(a,'escort_complete')).status,'committed');
    for(const g of [a,b]){assert.equal((await action(g,'escort_claim')).status,'committed');assert.equal((await read(g)).state.experience,5);assert.equal((await action(g,'escort_claim')).error?.detail,'REWARD_ALREADY_CLAIMED');}
    const reset=await built.app.inject({method:'POST',url:'/api/game/current/reset',headers:{cookie:a.cookie,origin:'http://localhost'},payload:{requestId:randomUUID(),expectedCurrentScopeId:a.id}});
    assert.equal(reset.statusCode,200,reset.body);assert.equal((await read(b)).party,null);
  } finally {await built.app.close();await db.stop();}
});
