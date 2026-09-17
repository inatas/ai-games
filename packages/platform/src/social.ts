import { createHash, randomUUID } from 'node:crypto';
import { HarnessError, type Transaction } from '@game-ai/core';
import { lockRealm, leaveParty, type PartyPolicy } from './realm.ts';

export interface SocialPolicy extends PartyPolicy {
  nearby?(tx: Transaction, scopeId: string): Promise<{scopeId: string; name: string}[]>;
  localRecipients?(tx: Transaction, scopeId: string): Promise<string[]>;
  canInvite?(tx: Transaction, actorId: string, targetId: string): Promise<boolean>;
  maxMembers?: number;
}
async function target(tx: Transaction, id: string | undefined, realmId: string) {
  const row = (await tx.query('SELECT * FROM mud_characters WHERE scope_id=$1 AND realm_id=$2 AND active', [id,realmId])).rows[0];
  if (!row) throw new HarnessError('INVALID_TARGET',409);
  return row;
}
async function once(tx: Transaction, scopeId: string, requestId: string, payload: unknown, run: () => Promise<object>) {
  const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const previous = (await tx.query('SELECT * FROM mud_writes WHERE scope_id=$1 AND request_id=$2',[scopeId,requestId])).rows[0];
  if (previous) {
    if (previous.hash !== hash) throw new HarnessError('IDEMPOTENCY_CONFLICT',409);
    return previous.result;
  }
  const result = await run();
  await tx.query('INSERT INTO mud_writes VALUES($1,$2,$3,$4)',[scopeId,requestId,hash,JSON.stringify(result)]);
  return result;
}
export async function heartbeat(tx: Transaction, scopeId: string, token: string) {
  const hash = createHash('sha256').update(token).digest('hex');
  await tx.query(`INSERT INTO mud_presence(token_hash,scope_id,expires_at)
    SELECT token_hash,$2,$3 FROM fw_sessions WHERE token_hash=$1 AND expires_at>$4
    ON CONFLICT(token_hash) DO UPDATE SET scope_id=EXCLUDED.scope_id,expires_at=EXCLUDED.expires_at`,[hash,scopeId,Date.now()+120000,Date.now()]);
}
export async function socialProjection(tx: Transaction, scopeId: string, policy: SocialPolicy = {}) {
  const actor = (await tx.query('SELECT * FROM mud_characters WHERE scope_id=$1 AND active',[scopeId])).rows[0];
  if (!actor) throw new HarnessError('FORBIDDEN',403);
  const candidates = await policy.nearby?.(tx, scopeId) ?? [];
  const playersHere: {scopeId: string; name: string}[] = [];
  for (const candidate of candidates) {
    const visible = await target(tx, candidate.scopeId, actor.realm_id);
    if (visible.scope_id !== scopeId) playersHere.push({scopeId: visible.scope_id, name: visible.name});
  }
  const messages = (await tx.query(`SELECT m.*,s.name sender_name,r.name recipient_name FROM mud_messages m
    JOIN mud_characters s ON s.scope_id=m.sender LEFT JOIN mud_characters r ON r.scope_id=m.recipient
    WHERE m.realm_id=$1 AND (m.channel='chat' OR EXISTS(SELECT 1 FROM mud_receipts x WHERE x.message_id=m.id AND x.scope_id=$2))
    ORDER BY m.created_at DESC,m.id DESC LIMIT 50`,[actor.realm_id,scopeId])).rows.reverse().map(r=>({id:r.id,channel:r.channel,body:r.body,senderScopeId:r.sender,senderName:r.sender_name,recipientScopeId:r.recipient,recipientName:r.recipient_name}));
  const membership = (await tx.query('SELECT party_id FROM mud_members WHERE scope_id=$1',[scopeId])).rows[0];
  const party = membership ? { id:membership.party_id, members:(await tx.query('SELECT c.scope_id,c.name FROM mud_members m JOIN mud_characters c ON c.scope_id=m.scope_id WHERE m.party_id=$1 ORDER BY c.scope_id',[membership.party_id])).rows.map(r=>({scopeId:r.scope_id,name:r.name})) } : null;
  const invites = (await tx.query("SELECT i.id,i.sender,c.name FROM mud_invites i JOIN mud_characters c ON c.scope_id=i.sender WHERE i.recipient=$1 AND i.realm_id=$2 AND i.status='pending' AND i.expires_at>$3 AND c.active",[scopeId,actor.realm_id,Date.now()])).rows.map(r=>({id:r.id,fromScopeId:r.sender,fromName:r.name}));
  return {playersHere,messages,party,invites};
}
export async function sendMessage(tx: Transaction, scopeId: string, input: {requestId:string;channel:string;body:string;targetScopeId?:string}, policy: SocialPolicy = {}) {
  const {actor} = await lockRealm(tx,scopeId);
  return once(tx,scopeId,input.requestId,{kind:'message',channel:input.channel,body:input.body,target:input.targetScopeId??null},async()=>{
    const body = input.body.trim();
    if (!body || [...body].length>200 || !['say','tell','chat'].includes(input.channel)) throw new HarnessError('INVALID_INPUT');
    if (input.channel!=='tell' && input.targetScopeId) throw new HarnessError('INVALID_INPUT');
    const recipients = new Set<string>([scopeId]);
    if (input.channel==='tell') { const recipient=await target(tx,input.targetScopeId,actor.realm_id); recipients.add(recipient.scope_id); }
    if (input.channel==='say') {
      if (!policy.localRecipients) throw new HarnessError('CHANNEL_UNAVAILABLE', 409);
      for (const id of await policy.localRecipients(tx, scopeId)) {
        const recipient = await target(tx, id, actor.realm_id);
        recipients.add(recipient.scope_id);
      }
    }
    const id=randomUUID();
    await tx.query('INSERT INTO mud_messages VALUES($1,$2,$3,$4,$5,$6,$7)',[id,actor.realm_id,scopeId,input.channel,input.channel==='tell'?input.targetScopeId:null,body,Date.now()]);
    for(const recipient of recipients) await tx.query('INSERT INTO mud_receipts VALUES($1,$2)',[id,recipient]);
    return {id};
  });
}
export async function mutateParty(tx: Transaction, scopeId: string, input: {requestId:string;action:string;targetScopeId?:string;inviteId?:string}, policy: SocialPolicy = {}) {
  const capacity = policy.maxMembers ?? 4;
  if (!Number.isSafeInteger(capacity) || capacity < 2) throw new HarnessError('INVALID_PARTY_CAPACITY');
  const {actor}=await lockRealm(tx,scopeId);
  return once(tx,scopeId,input.requestId,{kind:'party',action:input.action,target:input.targetScopeId??null,invite:input.inviteId??null},async()=>{
    if(input.action==='leave') {
      if(input.targetScopeId||input.inviteId) throw new HarnessError('INVALID_INPUT');
      await leaveParty(tx,scopeId,policy); return {left:true};
    }
    if(input.action==='invite') {
      if(input.inviteId||input.targetScopeId===scopeId) throw new HarnessError('INVALID_INPUT');
      const other=await target(tx,input.targetScopeId,actor.realm_id);
      if(policy.canInvite && !(await policy.canInvite(tx,scopeId,other.scope_id))) throw new HarnessError('TARGET_NOT_PRESENT',409);
      if((await tx.query('SELECT 1 FROM mud_members WHERE scope_id=$1',[other.scope_id])).rowCount) throw new HarnessError('ALREADY_IN_PARTY',409);
      const id=randomUUID();
      await tx.query("UPDATE mud_invites SET status='expired' WHERE sender=$1 AND recipient=$2 AND status='pending'",[scopeId,other.scope_id]);
      await tx.query("INSERT INTO mud_invites VALUES($1,$2,$3,$4,$5,'pending')",[id,actor.realm_id,scopeId,other.scope_id,Date.now()+600000]); return {inviteId:id};
    }
    if(input.action!=='accept'||input.targetScopeId||!input.inviteId) throw new HarnessError('INVALID_INPUT');
    const invite=(await tx.query("SELECT * FROM mud_invites WHERE id=$1 AND recipient=$2 AND realm_id=$3 AND status='pending' AND expires_at>$4",[input.inviteId,scopeId,actor.realm_id,Date.now()])).rows[0];
    if(!invite) throw new HarnessError('INVITE_EXPIRED',409);
    await target(tx,invite.sender,actor.realm_id);
    if((await tx.query('SELECT 1 FROM mud_members WHERE scope_id=$1',[scopeId])).rowCount) throw new HarnessError('ALREADY_IN_PARTY',409);
    let partyId=(await tx.query('SELECT party_id FROM mud_members WHERE scope_id=$1',[invite.sender])).rows[0]?.party_id;
    if(!partyId) {
      partyId=randomUUID(); await tx.query('INSERT INTO mud_parties(id,realm_id) VALUES($1,$2)',[partyId,actor.realm_id]);
      await tx.query('INSERT INTO mud_members VALUES($1,$2)',[invite.sender,partyId]);
    }
    if(Number((await tx.query('SELECT count(*) n FROM mud_members WHERE party_id=$1',[partyId])).rows[0].n)>=capacity) throw new HarnessError('PARTY_FULL',409);
    await tx.query('INSERT INTO mud_members VALUES($1,$2)',[scopeId,partyId]);
    await tx.query("UPDATE mud_invites SET status='accepted' WHERE id=$1",[input.inviteId]);
    return {partyId};
  });
}
