import { HarnessError, type Transaction } from '@game-ai/core';

export interface NpcDefinition {
  id: string;
  name: string;
  description: string;
  /** Spawn default only; runtime position belongs to mud_npcs. */
  initialRoomId?: string;
}

export function validateNpcs(npcs: readonly Pick<NpcDefinition, 'id' | 'initialRoomId'>[], rooms: ReadonlySet<string>) {
  const ids = new Set<string>();
  for (const npc of npcs) {
    if (!npc.id || ids.has(npc.id) || (npc.initialRoomId !== undefined && !rooms.has(npc.initialRoomId))) {
      throw new Error(`Invalid NPC: ${npc.id}`);
    }
    ids.add(npc.id);
  }
}

/** Caller supplies a validated destination from the loaded MOD topology. */
export async function updateNpc(tx: Transaction, realmId: string, npcId: string, roomId: string, status: string) {
  await tx.query('SELECT id FROM mud_realms WHERE id=$1 FOR UPDATE', [realmId]);
  const updated = await tx.query('UPDATE mud_npcs SET room_id=$3,status=$4,revision=revision+1 WHERE realm_id=$1 AND npc_id=$2 RETURNING npc_id', [realmId, npcId, roomId, status]);
  if (!updated.rowCount) throw new HarnessError('NOT_FOUND', 404);
  await tx.query('UPDATE mud_realms SET revision=revision+1 WHERE id=$1', [realmId]);
}
