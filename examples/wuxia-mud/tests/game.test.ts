import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';

import {randomUUID} from 'node:crypto';
import {PostgresStore} from '@game-ai/storage';
import {ScriptedModel} from '@game-ai/model';
import {startTestDatabase} from '../../../tests/support/database.ts';
import {buildApp} from '../../../apps/server/src/app.ts';
let db:Awaited<ReturnType<typeof startTestDatabase>>;let store:PostgresStore;let built:Awaited<ReturnType<typeof buildApp>>;
let override:string|null=null;
const model=new ScriptedModel(r=>override??JSON.stringify({choice:(r.outputSchema as any).properties.choice.enum.includes('GUIDANCE')?'GUIDANCE':'ACCEPT'}));
before(async()=>{db=await startTestDatabase();store=db.store;built=await buildApp(store,model);});
after(async()=>{await built?.app.close();await db?.stop();});
async function game(){const r=await built.app.inject({method:'POST',url:'/api/auth/login',headers:{origin:'http://localhost:80'},payload:{username:'u_'+randomUUID().replaceAll('-','').slice(0,20),password:'demo-test-password'}});assert.equal(r.statusCode,200,r.body);return {id:r.json().currentScopeId as string,token:String(r.headers['set-cookie']).split(';')[0]};}
async function read(g:{id:string;token:string}){return (await built.app.inject({url:`/api/wuxia/games/${g.id}`,headers:{cookie:g.token,origin:'http://localhost:80'}})).json();}
async function act(g:{id:string;token:string},action:string,version:number,id=randomUUID()){
 const r=await built.app.inject({method:'POST',url:`/api/wuxia/games/${g.id}/actions`,headers:{cookie:g.token,origin:'http://localhost:80'},payload:{requestId:id,expectedMemoryVersion:version,action,note:''}});
 assert.ok([200,202].includes(r.statusCode),r.body);await built.harness.drain();return built.harness.get(g.id,id);
}
test('D-01/02/05/07/11/14/19: full path with persistent provenance and only two model calls',async()=>{
 const g=await game();const start=model.calls.length;
 assert.equal((await read(g)).state.silver,20);
 for(const [i,a]of ['good_deed','good_deed','apprenticeship','challenge','encounter'].entries())assert.equal((await act(g,a,i)).status,'committed');
 const result=await read(g);assert.deepEqual(result.state,{silver:19,virtue:2,skill:3,master:'青松道人',encounterDone:true,hostVersion:5});assert.equal(result.memoryVersion,5);assert.equal(result.events.length,5);assert.equal(result.openItems.length,1);assert.equal(result.openItems[0].status,'closed');assert.equal(model.calls.length-start,2);
 assert.ok(model.calls.at(-1)!.messages.some(m=>m.content.includes(result.openItems[0].id)));
});
test('D-03/04/06/09/10/15: business rejections versus successful game losses',async()=>{
 const g=await game();const start=model.calls.length;
 const denied=await act(g,'apprenticeship',0);assert.equal(denied.error?.detail,'LOW_VIRTUE');assert.equal(model.calls.length,start);
 const loss=await act(g,'challenge',0);assert.equal(loss.status,'committed');assert.equal((await read(g)).memoryVersion,1);
 await store.pool.query('UPDATE wuxia_characters SET silver=1 WHERE scope_id=$1',[g.id]);assert.equal((await act(g,'good_deed',1)).error?.detail,'INSUFFICIENT_SILVER');
 await store.pool.query('UPDATE wuxia_characters SET silver=2 WHERE scope_id=$1',[g.id]);await act(g,'good_deed',1);assert.equal((await read(g)).state.silver,0);
 const once=await game();await act(once,'encounter',0);assert.equal((await act(once,'encounter',1)).error?.detail,'ENCOUNTER_COMPLETED');
});
test('D-18 and F-30: idempotency precedes game eligibility, cross-session access denied',async()=>{
 const g=await game();const id=randomUUID();const first=await act(g,'encounter',0,id);assert.deepEqual(await act(g,'encounter',0,id),first);assert.equal((await read(g)).events.length,1);
 const forbidden=await built.app.inject({url:`/api/wuxia/games/${g.id}`,headers:{cookie:'harness_session=wrong'}});assert.equal(forbidden.statusCode,401);
 const malformed=await built.app.inject({method:'POST',url:`/api/wuxia/games/${g.id}/actions`,headers:{cookie:g.token,origin:'http://localhost:80'},payload:{action:'execute-sql'}});assert.equal(malformed.statusCode,400);
});
test('D-08/09/12/17: defer, already apprenticed, gift and invalid model award',async()=>{
 try{
   const g=await game();await store.pool.query('UPDATE wuxia_characters SET virtue=2 WHERE scope_id=$1',[g.id]);override='{"choice":"DEFER"}';
   assert.equal((await act(g,'apprenticeship',0)).status,'committed');assert.equal((await read(g)).state.master,null);assert.equal((await read(g)).memoryVersion,1);
   override='{"choice":"ACCEPT"}';await act(g,'apprenticeship',1);assert.equal((await act(g,'apprenticeship',2)).error?.detail,'ALREADY_APPRENTICED');
   const gift=await game();override='{"choice":"GIFT"}';await act(gift,'encounter',0);assert.equal((await read(gift)).state.silver,24);
   const cheat=await game();override='{"choice":"GIFT","silver":999}';assert.equal((await act(cheat,'encounter',0)).error?.code,'MODEL_INVALID_OUTPUT');assert.equal((await read(cheat)).state.silver,20);assert.equal((await read(cheat)).state.encounterDone,false);
 }finally{override=null;}
});



