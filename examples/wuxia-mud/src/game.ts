import { randomUUID } from 'node:crypto';
import type { PostgresStore } from '@game-ai/storage';
import { HarnessError, type Binding, type Json, type MemoryChange, type Transaction } from '@game-ai/core';
import { ScriptedModel } from '@game-ai/model';

export const actions = ['good_deed','encounter','apprenticeship','challenge'] as const;
export type Action = typeof actions[number];
export async function migrateGame(store: PostgresStore) {
  await store.pool.query(`CREATE TABLE IF NOT EXISTS wuxia_characters (
    scope_id uuid PRIMARY KEY REFERENCES fw_scopes(id), silver integer NOT NULL DEFAULT 20 CHECK(silver>=0),
    virtue integer NOT NULL DEFAULT 0 CHECK(virtue>=0), skill integer NOT NULL DEFAULT 1 CHECK(skill>=0),
    master text, encounter_done boolean NOT NULL DEFAULT false, good_deed_item_id text,
    host_version integer NOT NULL DEFAULT 0, access_hash text NOT NULL)`);
}
export function publicState(row: any) {
  return { silver: row.silver, virtue: row.virtue, skill: row.skill, master: row.master, encounterDone: row.encounter_done, hostVersion: row.host_version };
}
export async function initializeGame(store: PostgresStore, tx: Transaction, id: string) {
  const row = (await tx.query("INSERT INTO wuxia_characters(scope_id,access_hash) VALUES($1,'account-managed') RETURNING *", [id])).rows[0];
  await store.applyMemory(tx, id, [{ op: 'replace_fact', key: 'character', payload: publicState(row), sourceVersion: '0' }]);
}
export async function createGame(store: PostgresStore, accessHash: string) {
  const id=randomUUID();
  await store.transaction(async tx => {
    await tx.query('INSERT INTO fw_scopes(id) VALUES($1)',[id]);
    const row=(await tx.query('INSERT INTO wuxia_characters(scope_id,access_hash) VALUES($1,$2) RETURNING *',[id,accessHash])).rows[0];
    await store.applyMemory(tx,id,[{op:'replace_fact',key:'character',payload:publicState(row),sourceVersion:'0'}]);
  });
  return id;
}
function reason(action: Action, row: any) {
  if(action==='good_deed' && row.silver<2) return 'INSUFFICIENT_SILVER';
  if(action==='encounter' && row.encounter_done) return 'ENCOUNTER_COMPLETED';
  if(action==='apprenticeship' && row.master) return 'ALREADY_APPRENTICED';
  if(action==='apprenticeship' && row.virtue<2) return 'LOW_VIRTUE';
  return null;
}
export function gameBinding(store: PostgresStore, action: Action): Binding {
  const ai=action==='encounter'||action==='apprenticeship';
  const choices=action==='encounter'?['GIFT','GUIDANCE']:['ACCEPT','DEFER'];
  return {
    id:`wuxia.${action}`,version:'1',mode:ai?'assessment':'recordMemory',
    inputSchema:{type:'object',additionalProperties:false,required:['note'],properties:{note:{type:'string',maxLength:200}}},
    ...(ai?{outputSchema:{type:'object',additionalProperties:false,required:['choice'],properties:{choice:{type:'string',enum:choices}}}}:{}),
    async prepare(input,scopeId){
      const row=(await store.pool.query('SELECT * FROM wuxia_characters WHERE scope_id=$1',[scopeId])).rows[0];
      if(!row)throw new HarnessError('NOT_FOUND',404);
      const denied=reason(action,row);if(denied)throw new HarnessError('RULE_REJECTED',409,denied);
      const open=row.good_deed_item_id?(await store.pool.query("SELECT id FROM fw_memory WHERE scope_id=$1 AND id=$2 AND status='open'",[scopeId,row.good_deed_item_id])).rows:[];
      return {gameVersion:String(row.host_version),facts:publicState(row),instructions:action==='encounter'
        ?'你是武侠游戏奇遇判定员。参考行善历史与当前事实，只选择GIFT（物资帮助）或GUIDANCE（武学指点）。不得编造数值。'
        :'你扮演青松道人的收徒态度判定。参考行善记录和玩家说明，只选择ACCEPT或DEFER。硬资格由游戏保证。',
        subjectIds:['player'],tags:['good_deed'],requiredMemoryIds:action==='encounter'?open.map(r=>r.id):[]};
    },
    validate(){return {ok:true};},
    async apply(tx,proposal,context){
      const row=(await tx.query('SELECT * FROM wuxia_characters WHERE scope_id=$1 FOR UPDATE',[context.scopeId])).rows[0];
      if(String(row.host_version)!==context.gameVersion)throw new HarnessError('STATE_CONFLICT');
      const denied=reason(action,row);if(denied)throw new HarnessError('RULE_REJECTED',409,denied);
      const before=publicState(row);const choice=(proposal as any)?.choice;let message='';const eventId=randomUUID();const memoryChanges:MemoryChange[]=[];
      if(action==='good_deed'){
        row.silver-=2;row.virtue+=1;message='你以二两银钱接济村民。侠义 +1。';
        if(!row.good_deed_item_id){row.good_deed_item_id=randomUUID();memoryChanges.push({op:'open_item',id:row.good_deed_item_id,payload:'曾帮助村民，后续相遇可参考。',sourceIds:[eventId],subjectIds:['player']});}
      }else if(action==='challenge'){
        if(row.skill>=2){row.silver+=3;message='切磋获胜，获得三两银钱。';}else message='切磋落败。你意识到还需修习武学。';
      }else if(action==='apprenticeship'){
        if(choice==='ACCEPT'){row.master='青松道人';row.skill+=1;message='青松道人收你为徒，传授入门心法。武学 +1。';}else message='青松道人暂缓收徒，邀你继续历练。';
      }else{
        if(choice==='GIFT'){row.silver+=4;message='江湖故人赠你四两银钱，助你远行。';}else{row.skill+=1;message='你得到高人指点。武学 +1。';}
        row.encounter_done=true;
        if(row.good_deed_item_id){const item=await tx.query("SELECT id FROM fw_memory WHERE scope_id=$1 AND id=$2 AND status='open'",[context.scopeId,row.good_deed_item_id]);if(item.rowCount)memoryChanges.push({op:'close_item',id:row.good_deed_item_id});}
      }
      row.host_version+=1;
      await tx.query(`UPDATE wuxia_characters SET silver=$2,virtue=$3,skill=$4,master=$5,encounter_done=$6,good_deed_item_id=$7,host_version=$8 WHERE scope_id=$1`,[context.scopeId,row.silver,row.virtue,row.skill,row.master,row.encounter_done,row.good_deed_item_id,row.host_version]);
      const after=publicState(row);
      memoryChanges.unshift({op:'append_event',id:eventId,payload:{action,message,before,after},subjectIds:['player'],tags:[action]});
      memoryChanges.push({op:'replace_fact',key:'character',payload:after,sourceVersion:String(row.host_version)});
      return {result:{message,state:after,action},memoryChanges};
    },
  };
}
// Explicitly a demo mock. Never used by the framework or by real-provider mode.
export const demoModel=()=>new ScriptedModel(request=>{
  const choices=(request.outputSchema as any).properties.choice.enum;
  return JSON.stringify({choice:choices.includes('GUIDANCE')?'GUIDANCE':'ACCEPT'});
});

