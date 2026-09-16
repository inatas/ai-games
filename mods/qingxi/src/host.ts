import type { PostgresStore } from '@game-ai/storage';
import type { Transaction } from '@game-ai/core';
import { actions, migrateGame, initializeGame, gameBinding, publicState } from './game.ts';
import { readWorldState, worldProjection } from './scene.ts';

export function qingxiHost(store: PostgresStore) {
  return {
    id:'qingxi', prefix:'wuxia', worldviewPath:'mods/qingxi/WORLD.md', worldId:'wuxia', worldVersion:'1',
    actions, fields:['exitId','targetId','topicId','questId','itemId','name','gender','schoolId','skillId','enemyId'],
    migrate:()=>migrateGame(store), initialize:(tx:Transaction,id:string)=>initializeGame(store,tx,id),
    bindings:()=>actions.map(action=>gameBinding(store,action)),
    async snapshot(tx:Transaction,id:string) {
      const s=await readWorldState(tx,id);
      const projection=worldProjection(s);
      if(s.schoolQuest) projection.quests.push({questId:'school',name:'师门任务',status:s.schoolQuest.status,description:s.schoolQuest.status==='ready'?'回师门复命。':`山道恶徒气血 ${s.schoolQuest.enemy_hp}/12`});
      const tasks=(await tx.query(`SELECT t.id,t.status,p.contributed,p.eligible,EXISTS(SELECT 1 FROM mud_rewards r WHERE r.task_id=t.id AND r.scope_id=p.scope_id) claimed
        FROM mud_tasks t JOIN mud_participants p ON p.task_id=t.id WHERE p.scope_id=$1 ORDER BY t.id`,[id])).rows;
      for(const task of tasks) projection.quests.push({questId:task.id,name:'护送药箱',status:task.status,description:!task.eligible?'已退出任务。':task.claimed?'奖励已领取。':task.status==='completed'?'回药铺领取奖励。':task.contributed?'已勘察，等待同伴。':'去林地勘察药路。'});
      return {hostVersion:s.row.host_version,state:publicState(s.row),...projection};
    },
  };
}
