import { HarnessError, type Transaction } from '@game-ai/core';

export async function lockRealm(tx: Transaction, scopeId: string) {
  const actor = (await tx.query('SELECT * FROM mud_characters WHERE scope_id=$1', [scopeId])).rows[0];
  if (!actor?.active) throw new HarnessError('FORBIDDEN', 403);
  const realm = (await tx.query('SELECT * FROM mud_realms WHERE id=$1 FOR UPDATE', [actor.realm_id])).rows[0];
  // Re-read after acquiring the shared lock: reset may have retired the actor.
  if (!(await tx.query('SELECT 1 FROM mud_characters WHERE scope_id=$1 AND active', [scopeId])).rowCount) throw new HarnessError('FORBIDDEN', 403);
  return { actor, realm };
}

export interface PartyChange { scopeId: string; partyId: string; dissolved: boolean }
export interface PartyPolicy { onPartyLeft?(tx: Transaction, change: PartyChange): Promise<void> }

export async function leaveParty(tx: Transaction, scopeId: string, policy: PartyPolicy = {}) {
  const member = (await tx.query('DELETE FROM mud_members WHERE scope_id=$1 RETURNING party_id', [scopeId])).rows[0];
  if (!member) return;
  const remaining = Number((await tx.query('SELECT count(*) n FROM mud_members WHERE party_id=$1', [member.party_id])).rows[0].n);
  if (remaining < 2) {
    await tx.query('DELETE FROM mud_members WHERE party_id=$1', [member.party_id]);
    await tx.query('UPDATE mud_parties SET active=false,revision=revision+1 WHERE id=$1', [member.party_id]);
  }
  await policy.onPartyLeft?.(tx, { scopeId, partyId: member.party_id, dissolved: remaining < 2 });
}

export async function retireCharacter(tx: Transaction, scopeId: string, policy: PartyPolicy = {}) {
  await lockRealm(tx, scopeId);
  await leaveParty(tx, scopeId, policy);
  await tx.query("UPDATE mud_invites SET status='expired' WHERE sender=$1 OR recipient=$1", [scopeId]);
  await tx.query('DELETE FROM mud_presence WHERE scope_id=$1', [scopeId]);
  await tx.query('UPDATE mud_characters SET active=false WHERE scope_id=$1', [scopeId]);
}
