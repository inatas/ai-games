import { randomUUID } from 'node:crypto';
import { HarnessError, type Transaction } from '@game-ai/core';

/** Caller holds the realm lock. Rules decide locations, objectives and award values. */
export async function sharedTask(tx: Transaction, scopeId: string, definition: string, step: 'accept'|'contribute'|'complete'|'claim', requiredMembers: number) {
  if (!Number.isInteger(requiredMembers) || requiredMembers < 1) throw new HarnessError('INVALID_INPUT', 400);
  const member=(await tx.query('SELECT m.party_id,c.realm_id FROM mud_members m JOIN mud_characters c ON c.scope_id=m.scope_id WHERE m.scope_id=$1 AND c.active',[scopeId])).rows[0];
  if(!member) throw new HarnessError('RULE_REJECTED',409,'PARTY_REQUIRED');
  if(step==='accept') {
    const members=(await tx.query('SELECT scope_id FROM mud_members WHERE party_id=$1 ORDER BY scope_id',[member.party_id])).rows;
    if(members.length!==requiredMembers) throw new HarnessError('RULE_REJECTED',409,'PARTICIPANT_COUNT_MISMATCH');
    if((await tx.query("SELECT 1 FROM mud_tasks WHERE party_id=$1 AND definition_id=$2 AND status<>'cancelled'",[member.party_id,definition])).rowCount) throw new HarnessError('RULE_REJECTED',409,'TASK_ALREADY_ACCEPTED');
    const id=randomUUID();
    await tx.query("INSERT INTO mud_tasks VALUES($1,$2,$3,$4,'active')",[id,member.realm_id,member.party_id,definition]);
    for(const actor of members) await tx.query('INSERT INTO mud_participants(task_id,scope_id) VALUES($1,$2)',[id,actor.scope_id]);
    return {id,awarded:false};
  }
  const task=(await tx.query(`SELECT t.*,p.eligible,p.contributed FROM mud_tasks t JOIN mud_participants p ON p.task_id=t.id
    WHERE t.party_id=$1 AND t.definition_id=$2 AND p.scope_id=$3 AND p.eligible AND t.status<>'cancelled'`,[member.party_id,definition,scopeId])).rows[0];
  if(!task) throw new HarnessError('RULE_REJECTED',409,'TASK_NOT_OWNED');
  if(step==='contribute') {
    if(task.status!=='active'||task.contributed) throw new HarnessError('RULE_REJECTED',409,'CONTRIBUTION_ALREADY_RECORDED');
    await tx.query('UPDATE mud_participants SET contributed=true WHERE task_id=$1 AND scope_id=$2',[task.id,scopeId]);
  } else if(step==='complete') {
    if(task.status!=='active'||(await tx.query('SELECT 1 FROM mud_participants WHERE task_id=$1 AND (NOT contributed OR NOT eligible)',[task.id])).rowCount) throw new HarnessError('RULE_REJECTED',409,'TASK_NOT_READY');
    await tx.query("UPDATE mud_tasks SET status='completed' WHERE id=$1",[task.id]);
  } else {
    if(task.status!=='completed') throw new HarnessError('RULE_REJECTED',409,'TASK_NOT_READY');
    const inserted=await tx.query("INSERT INTO mud_rewards VALUES($1,$2,'completion') ON CONFLICT DO NOTHING RETURNING task_id",[task.id,scopeId]);
    if(!inserted.rowCount) throw new HarnessError('RULE_REJECTED',409,'REWARD_ALREADY_CLAIMED');
    return {id:task.id,awarded:true};
  }
  return {id:task.id,awarded:false};
}

/** Runs in the membership transaction; errors roll back both systems. */
export async function taskPartyLeft(tx: Transaction, change: import('@game-ai/platform').PartyChange) {
  await tx.query('UPDATE mud_participants SET eligible=false WHERE scope_id=$1 AND task_id IN (SELECT id FROM mud_tasks WHERE party_id=$2)', [change.scopeId, change.partyId]);
  if (change.dissolved) {
    await tx.query("UPDATE mud_tasks SET status='cancelled' WHERE party_id=$1 AND status='active'", [change.partyId]);
    await tx.query('UPDATE mud_participants SET eligible=false WHERE task_id IN (SELECT id FROM mud_tasks WHERE party_id=$1)', [change.partyId]);
  }
}
