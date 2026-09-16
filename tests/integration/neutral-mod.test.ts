import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { migrateMud } from '@game-ai/storage';
import { HarnessError } from '@game-ai/core';
import { lockRealm, ModRegistry, type ModHost } from '@game-ai/mud-core';
import { ScriptedModel } from '@game-ai/model';
import { buildApp } from '../../apps/server/src/app.ts';
import { startTestDatabase } from '../support/database.ts';

test('MF-02/07/14: neutral MOD runs through the same HTTP host and session presence is revocable',async()=>{
  const db=await startTestDatabase();
  const registry=new ModRegistry();
  registry.register({id:'station',version:'1',contractVersion:1,contentVersion:'1',worldviewVersion:'1',configSchema:{type:'object'},config:{},rooms:[{id:'lab'}],exits:[],npcs:[],actions:['inspect'],startRoomId:'lab'});
  const host:ModHost={
    id:'station',prefix:'station',worldviewPath:'tests/support/neutral-world.md',worldId:'station',worldVersion:'1',actions:['inspect'],fields:[],
    async migrate(){await db.store.transaction(async tx=>{await migrateMud(tx);await tx.query("INSERT INTO mud_realms(id,mod_id,mod_version,content_version,worldview_version) VALUES('station','station','1','1','1')");await tx.query('CREATE TABLE station_charge(scope_id uuid PRIMARY KEY REFERENCES fw_scopes(id),charge integer NOT NULL)');});},
    async initialize(tx,id){await tx.query("INSERT INTO mud_characters(scope_id,realm_id,name,room_id) VALUES($1,'station','Researcher','lab')",[id]);await tx.query('INSERT INTO station_charge VALUES($1,2)',[id]);},
    bindings:()=>[{
      id:'station.inspect',version:'1',mode:'assessment',inputSchema:{type:'object',required:['note'],additionalProperties:false,properties:{note:{type:'string'}}},outputSchema:{type:'object',required:['result'],additionalProperties:false,properties:{result:{const:'observed'}}},
      lockResources:lockRealm,
      async prepare(input,id){return db.store.transaction(async tx=>{await lockRealm(tx,id);const row=(await tx.query('SELECT charge FROM station_charge WHERE scope_id=$1',[id])).rows[0];return {gameVersion:String(row.charge),facts:{charge:row.charge,room:'lab'},instructions:'Return observed.',subjectIds:[],tags:[],requiredMemoryIds:[]};});},
      validate:()=>({ok:true}),
      async apply(tx,proposal,context){const result=await tx.query('UPDATE station_charge SET charge=charge+7 WHERE scope_id=$1 AND charge=$2 RETURNING charge',[context.scopeId,Number(context.gameVersion)]);if(!result.rowCount)throw new HarnessError('STATE_CONFLICT');return {result:{charge:result.rows[0].charge},memoryChanges:[]};},
    }],
    async snapshot(tx,id){const row=(await tx.query('SELECT charge FROM station_charge WHERE scope_id=$1',[id])).rows[0];return {title:'Station',characterName:'Researcher',attributes:[{label:'Charge',value:row.charge}],training:[{action:'inspect',label:'Inspect'}],inventory:[],quests:[],map:{regionId:'station',name:'Station',currentRoomId:'lab',radius:2,nodes:[{roomId:'lab',name:'Lab',kind:'indoor',layout:{x:0,y:0},discovery:'visited',isCurrent:true}],edges:[]},scene:{roomId:'lab',name:'Lab',templateId:'indoor',description:'Instruments hum.',objects:[]}};},
  };
  const model=new ScriptedModel(()=>'{"result":"observed"}');
  const built=await buildApp(db.store,model,'mock',host);
  try{
    const login=await built.app.inject({method:'POST',url:'/api/auth/login',headers:{origin:'http://localhost'},payload:{username:'neutral_user',password:'test-password'}});assert.equal(login.statusCode,200,login.body);
    const cookie=String(login.headers['set-cookie']).split(';')[0];const headers={cookie,origin:'http://localhost'};
    const before=await built.app.inject({url:'/api/mud/current',headers});assert.equal(before.json().attributes[0].value,2);
    assert.deepEqual(before.json().realm,{id:'station',modId:'station',modVersion:'1',contentVersion:'1',worldviewVersion:'1',revision:0});
    assert.equal((await db.store.pool.query('SELECT * FROM mud_presence')).rowCount,0,'Reading does not imply online presence');
    await built.app.inject({method:'POST',url:'/api/mud/presence',headers,payload:{}});
    assert.equal((await db.store.pool.query('SELECT * FROM mud_presence')).rowCount,1);
    const requestId=randomUUID();
    const action=await built.app.inject({method:'POST',url:'/api/mud/actions',headers,payload:{requestId,expectedMemoryVersion:0,action:'inspect',note:''}});assert.equal(action.statusCode,202,action.body);await built.harness.drain();
    const after=(await built.app.inject({url:'/api/mud/current',headers})).json();assert.equal(after.attributes[0].value,9);
    assert.match(model.calls[0].messages.map(m=>m.content).join('\n'),/research station/);
    assert.ok(!JSON.stringify(after).includes('青松'));
    const secondLogin=await built.app.inject({method:'POST',url:'/api/auth/login',headers:{origin:'http://localhost'},payload:{username:'neutral_user',password:'test-password'}});
    assert.equal(secondLogin.statusCode,200);
    const secondHeaders={cookie:String(secondLogin.headers['set-cookie']).split(';')[0],origin:'http://localhost'};
    await built.app.inject({method:'POST',url:'/api/mud/presence',headers:secondHeaders,payload:{}});
    assert.equal((await db.store.pool.query('SELECT * FROM mud_presence')).rowCount,2);
    await built.app.inject({method:'POST',url:'/api/auth/logout',headers});
    assert.equal((await db.store.pool.query('SELECT * FROM mud_presence')).rowCount,1,'One session remains online');
    await db.store.pool.query('UPDATE mud_presence SET expires_at=0');
    assert.equal((await db.store.pool.query('SELECT * FROM mud_presence WHERE expires_at>$1',[Date.now()])).rowCount,0);
    await built.app.inject({method:'POST',url:'/api/auth/logout',headers:secondHeaders});
    assert.equal((await db.store.pool.query('SELECT * FROM mud_presence')).rowCount,0);
  }finally{await built.app.close();await db.stop();}
});

test('MF-03: a MOD missing a registered action fails before creating realm tables', async () => {
  const db = await startTestDatabase();
  try {
    const invalidHost: ModHost = {
      id:'broken',prefix:'broken',worldviewPath:'tests/support/neutral-world.md',worldId:'broken',worldVersion:'1',
      actions:['missing'],fields:[],
      async migrate(){await db.store.transaction(migrateMud);},
      async initialize(){},bindings:()=>[],
      async snapshot(){throw new Error('not reached');},
    };
    await assert.rejects(buildApp(db.store,new ScriptedModel(()=>''),'mock',invalidHost), /MOD_BINDINGS_INVALID/);
    const realmTable=(await db.store.pool.query("SELECT to_regclass('mud_realms') AS name")).rows[0].name;
    assert.equal(realmTable,null);
  } finally { await db.stop(); }
});
