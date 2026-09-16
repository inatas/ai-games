import { HarnessError, type Transaction } from '@game-ai/core';

export async function lockRealm(tx: Transaction, scopeId: string) {
  const actor = (await tx.query('SELECT * FROM mud_characters WHERE scope_id=$1', [scopeId])).rows[0];
  if (!actor?.active) throw new HarnessError('FORBIDDEN', 403);
  const realm = (await tx.query('SELECT * FROM mud_realms WHERE id=$1 FOR UPDATE', [actor.realm_id])).rows[0];
  // Re-read after acquiring the shared lock: reset may have retired the actor.
  if (!(await tx.query('SELECT 1 FROM mud_characters WHERE scope_id=$1 AND active', [scopeId])).rowCount) throw new HarnessError('FORBIDDEN', 403);
  return { actor, realm };
}

export async function leaveParty(tx: Transaction, scopeId: string) {
  const member = (await tx.query('DELETE FROM mud_members WHERE scope_id=$1 RETURNING party_id', [scopeId])).rows[0];
  if (!member) return;
  await tx.query('UPDATE mud_participants SET eligible=false WHERE scope_id=$1 AND task_id IN (SELECT id FROM mud_tasks WHERE party_id=$2)', [scopeId, member.party_id]);
  const remaining = Number((await tx.query('SELECT count(*) n FROM mud_members WHERE party_id=$1', [member.party_id])).rows[0].n);
  if (remaining < 2) {
    await tx.query('DELETE FROM mud_members WHERE party_id=$1', [member.party_id]);
    await tx.query('UPDATE mud_parties SET active=false,revision=revision+1 WHERE id=$1', [member.party_id]);
    await tx.query("UPDATE mud_tasks SET status='cancelled' WHERE party_id=$1 AND status='active'", [member.party_id]);
    await tx.query('UPDATE mud_participants SET eligible=false WHERE task_id IN (SELECT id FROM mud_tasks WHERE party_id=$1)', [member.party_id]);
  }
}

export async function retireCharacter(tx: Transaction, scopeId: string) {
  await lockRealm(tx, scopeId);
  await leaveParty(tx, scopeId);
  await tx.query("UPDATE mud_invites SET status='expired' WHERE sender=$1 OR recipient=$1", [scopeId]);
  await tx.query('DELETE FROM mud_presence WHERE scope_id=$1', [scopeId]);
  await tx.query('UPDATE mud_characters SET active=false WHERE scope_id=$1', [scopeId]);
}

/** Caller supplies a validated destination from the loaded MOD topology. */
export async function updateNpc(tx: Transaction, realmId: string, npcId: string, roomId: string, status: string) {
  await tx.query('SELECT id FROM mud_realms WHERE id=$1 FOR UPDATE',[realmId]);
  const updated=await tx.query('UPDATE mud_npcs SET room_id=$3,status=$4,revision=revision+1 WHERE realm_id=$1 AND npc_id=$2 RETURNING npc_id',[realmId,npcId,roomId,status]);
  if(!updated.rowCount) throw new HarnessError('NOT_FOUND',404);
  await tx.query('UPDATE mud_realms SET revision=revision+1 WHERE id=$1',[realmId]);
}
