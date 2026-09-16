import { createHash, randomUUID } from 'node:crypto';
import { HarnessError, type Transaction } from '@game-ai/core';

const ONLINE_MS = 120_000;

async function character(tx: Transaction, scopeId: string, lock = false) {
  const row = (await tx.query(`SELECT * FROM wuxia_characters WHERE scope_id=$1${lock ? ' FOR UPDATE' : ''}`, [scopeId])).rows[0];
  if (!row) throw new HarnessError('NOT_FOUND', 404);
  return row;
}

export async function socialProjection(tx: Transaction, scopeId: string) {
  const me = await character(tx, scopeId);
  const now = Date.now();
  const playersHere = (await tx.query(`SELECT c.scope_id,c.player_name FROM wuxia_characters c JOIN fw_users u ON u.current_scope_id=c.scope_id
    WHERE c.current_room_id=$1 AND c.scope_id<>$2 AND c.last_active_at>=$3 ORDER BY c.player_name`, [me.current_room_id, scopeId, now - ONLINE_MS])).rows
    .map(r => ({ scopeId: r.scope_id as string, name: r.player_name as string }));
  const messages = (await tx.query(`SELECT m.id,m.channel,m.body,m.created_at,m.sender_scope_id,s.player_name sender_name,m.recipient_scope_id,r.player_name recipient_name
    FROM wuxia_social_messages m JOIN wuxia_social_receipts x ON x.message_id=m.id JOIN wuxia_characters s ON s.scope_id=m.sender_scope_id
    LEFT JOIN wuxia_characters r ON r.scope_id=m.recipient_scope_id WHERE x.scope_id=$1 ORDER BY m.created_at DESC,m.id DESC LIMIT 50`, [scopeId])).rows.reverse().map(r => ({
      id: r.id as string, channel: r.channel as string, body: r.body as string, createdAt: Number(r.created_at), senderScopeId: r.sender_scope_id as string,
      senderName: r.sender_name as string, recipientScopeId: r.recipient_scope_id as string | null, recipientName: r.recipient_name as string | null,
    }));
  const partyRow = (await tx.query('SELECT party_id FROM wuxia_party_members WHERE scope_id=$1', [scopeId])).rows[0];
  const party = partyRow ? {
    id: partyRow.party_id as string,
    members: (await tx.query('SELECT c.scope_id,c.player_name name FROM wuxia_party_members p JOIN wuxia_characters c ON c.scope_id=p.scope_id WHERE p.party_id=$1 ORDER BY p.joined_at', [partyRow.party_id])).rows.map(r => ({ scopeId: r.scope_id as string, name: r.name as string })),
  } : null;
  const invites = (await tx.query(`SELECT i.id,c.scope_id,c.player_name name FROM wuxia_party_invites i JOIN wuxia_characters c ON c.scope_id=i.inviter_scope_id
    WHERE i.invitee_scope_id=$1 AND i.status='pending' AND i.expires_at>$2 ORDER BY i.created_at`, [scopeId, now])).rows.map(r => ({ id: r.id as string, fromScopeId: r.scope_id as string, fromName: r.name as string }));
  return { playersHere, messages, party, invites };
}

async function once<T>(tx: Transaction, scopeId: string, requestId: string, payload: unknown, run: () => Promise<T>): Promise<T> {
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`wuxia-social:${scopeId}:${requestId}`]);
  const requestHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const old = (await tx.query('SELECT request_hash,response FROM wuxia_social_writes WHERE scope_id=$1 AND request_id=$2', [scopeId, requestId])).rows[0];
  if (old) {
    if (old.request_hash !== requestHash) throw new HarnessError('IDEMPOTENCY_CONFLICT', 409);
    return old.response as T;
  }
  const value = await run();
  await tx.query('INSERT INTO wuxia_social_writes(scope_id,request_id,request_hash,response) VALUES($1,$2,$3,$4)', [scopeId, requestId, requestHash, JSON.stringify(value)]);
  return value;
}

export async function sendMessage(tx: Transaction, scopeId: string, input: { requestId: string; channel: string; body: string; targetScopeId?: string }) {
  return once(tx, scopeId, input.requestId, { channel: input.channel, body: input.body, targetScopeId: input.targetScopeId ?? null }, async () => {
    const me = await character(tx, scopeId, true);
    const body = input.body.trim();
    if (!['say','tell','chat'].includes(input.channel) || !body || [...body].length > 200) throw new HarnessError('INVALID_INPUT', 400);
    let recipients: string[] = [scopeId]; let target: string | null = null;
    if (input.channel === 'tell') {
      if (!input.targetScopeId || input.targetScopeId === scopeId) throw new HarnessError('INVALID_TARGET', 409);
      await character(tx, input.targetScopeId); target = input.targetScopeId; recipients.push(target);
    } else if (input.channel === 'say') {
      recipients.push(...(await tx.query(`SELECT c.scope_id FROM wuxia_characters c JOIN fw_users u ON u.current_scope_id=c.scope_id WHERE c.current_room_id=$1 AND c.scope_id<>$2 AND c.last_active_at>=$3`, [me.current_room_id, scopeId, Date.now() - ONLINE_MS])).rows.map(r => r.scope_id as string));
    } else {
      recipients.push(...(await tx.query('SELECT c.scope_id FROM wuxia_characters c JOIN fw_users u ON u.current_scope_id=c.scope_id WHERE c.scope_id<>$1', [scopeId])).rows.map(r => r.scope_id as string));
    }
    const id = randomUUID();
    await tx.query('INSERT INTO wuxia_social_messages VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [id, scopeId, input.channel, target, input.channel === 'say' ? me.current_room_id : null, body, Date.now(), input.requestId]);
    for (const recipient of new Set(recipients)) await tx.query('INSERT INTO wuxia_social_receipts VALUES($1,$2)', [id, recipient]);
    await tx.query('UPDATE wuxia_characters SET last_active_at=$2 WHERE scope_id=$1', [scopeId, Date.now()]);
    return { id };
  });
}

export async function mutateParty(tx: Transaction, scopeId: string, input: { requestId: string; action: string; targetScopeId?: string; inviteId?: string }) {
  return once(tx, scopeId, input.requestId, { action: input.action, targetScopeId: input.targetScopeId ?? null, inviteId: input.inviteId ?? null }, async () => {
    await character(tx, scopeId); const now = Date.now();
    if (input.action === 'invite') {
      if (!input.targetScopeId || input.targetScopeId === scopeId) throw new HarnessError('INVALID_TARGET', 409);
      await tx.query('SELECT scope_id FROM wuxia_characters WHERE scope_id=ANY($1::uuid[]) ORDER BY scope_id FOR UPDATE', [[scopeId, input.targetScopeId]]);
      const target = await character(tx, input.targetScopeId); const me = await character(tx, scopeId);
      if (target.current_room_id !== me.current_room_id || Number(target.last_active_at) < now - ONLINE_MS) throw new HarnessError('TARGET_NOT_PRESENT', 409);
      const current = (await tx.query('SELECT party_id FROM wuxia_party_members WHERE scope_id=$1', [scopeId])).rows[0];
      if (current && Number((await tx.query('SELECT count(*) n FROM wuxia_party_members WHERE party_id=$1', [current.party_id])).rows[0].n) >= 4) throw new HarnessError('PARTY_FULL', 409);
      if ((await tx.query('SELECT 1 FROM wuxia_party_members WHERE scope_id=$1', [input.targetScopeId])).rowCount) throw new HarnessError('ALREADY_IN_PARTY', 409);
      await tx.query("UPDATE wuxia_party_invites SET status='expired' WHERE inviter_scope_id=$1 AND invitee_scope_id=$2 AND status='pending'", [scopeId, input.targetScopeId]);
      const id = randomUUID(); await tx.query("INSERT INTO wuxia_party_invites VALUES($1,$2,$3,'pending',$4,$5)", [id, scopeId, input.targetScopeId, now + 600_000, now]); return { inviteId: id };
    }
    if (input.action === 'accept') {
      const invite = (await tx.query("SELECT * FROM wuxia_party_invites WHERE id=$1 AND invitee_scope_id=$2 AND status='pending' FOR UPDATE", [input.inviteId, scopeId])).rows[0];
      if (!invite || Number(invite.expires_at) <= now) throw new HarnessError('INVITE_EXPIRED', 409);
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`wuxia-party:${invite.inviter_scope_id}`]);
      await tx.query('SELECT scope_id FROM wuxia_characters WHERE scope_id=ANY($1::uuid[]) ORDER BY scope_id FOR UPDATE', [[scopeId, invite.inviter_scope_id]]);
      if ((await tx.query('SELECT 1 FROM wuxia_party_members WHERE scope_id=$1', [scopeId])).rowCount) throw new HarnessError('ALREADY_IN_PARTY', 409);
      let partyId = (await tx.query('SELECT party_id FROM wuxia_party_members WHERE scope_id=$1', [invite.inviter_scope_id])).rows[0]?.party_id as string | undefined;
      if (!partyId) { partyId = randomUUID(); await tx.query('INSERT INTO wuxia_parties VALUES($1,$2)', [partyId, now]); await tx.query('INSERT INTO wuxia_party_members VALUES($1,$2,$3)', [partyId, invite.inviter_scope_id, now]); }
      await tx.query('SELECT id FROM wuxia_parties WHERE id=$1 FOR UPDATE', [partyId]);
      if (Number((await tx.query('SELECT count(*) n FROM wuxia_party_members WHERE party_id=$1', [partyId])).rows[0].n) >= 4) throw new HarnessError('PARTY_FULL', 409);
      await tx.query('INSERT INTO wuxia_party_members VALUES($1,$2,$3)', [partyId, scopeId, now]); await tx.query("UPDATE wuxia_party_invites SET status='accepted' WHERE id=$1", [input.inviteId]); return { partyId };
    }
    if (input.action === 'leave') {
      await character(tx, scopeId, true);
      const partyId = (await tx.query('DELETE FROM wuxia_party_members WHERE scope_id=$1 RETURNING party_id', [scopeId])).rows[0]?.party_id;
      if (!partyId) throw new HarnessError('NOT_IN_PARTY', 409);
      if (Number((await tx.query('SELECT count(*) n FROM wuxia_party_members WHERE party_id=$1', [partyId])).rows[0].n) <= 1) await tx.query('DELETE FROM wuxia_parties WHERE id=$1', [partyId]);
      return { left: true };
    }
    throw new HarnessError('INVALID_INPUT', 400);
  });
}
