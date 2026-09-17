import type { Transaction } from '@game-ai/core';
import type { SocialPolicy } from '@game-ai/platform';

async function neighbors(tx: Transaction, scopeId: string) {
  return (await tx.query(`SELECT c.scope_id,c.name FROM mud_characters c JOIN mud_characters actor ON actor.scope_id=$1
    WHERE actor.active AND c.active AND c.realm_id=actor.realm_id AND c.room_id=actor.room_id
    AND EXISTS(SELECT 1 FROM mud_presence p JOIN fw_sessions s ON s.token_hash=p.token_hash
      WHERE p.scope_id=c.scope_id AND p.expires_at>$2 AND s.expires_at>$2) ORDER BY c.name`, [scopeId,Date.now()])).rows;
}

/** Optional room policy. Task lifecycle is composed separately. */
export const spatialSocialPolicy: SocialPolicy = {
  nearby: async (tx,id) => (await neighbors(tx,id)).filter(r=>r.scope_id!==id).map(r=>({scopeId:r.scope_id,name:r.name})),
  localRecipients: async (tx,id) => (await neighbors(tx,id)).map(r=>r.scope_id),
  canInvite: async (tx,actorId,targetId) => !!(await tx.query(`SELECT 1 FROM mud_characters a JOIN mud_characters b
    ON a.realm_id=b.realm_id AND a.room_id=b.room_id WHERE a.scope_id=$1 AND b.scope_id=$2 AND a.active AND b.active`, [actorId,targetId])).rowCount,
};
