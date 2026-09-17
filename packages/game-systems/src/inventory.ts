import { HarnessError, type Transaction } from '@game-ai/core';

export async function itemQuantity(tx: Transaction, scopeId: string, itemId: string): Promise<number> {
  return Number((await tx.query('SELECT quantity FROM game_inventory WHERE scope_id=$1 AND item_id=$2', [scopeId,itemId])).rows[0]?.quantity ?? 0);
}

/** Caller authorizes the scope and holds its realm/scope locks. Replay is owned
 * by the action coordinator; consume in the same transaction as the effect. */
export async function changeItemQuantity(tx: Transaction, scopeId: string, itemId: string, delta: number, maxStack: number) {
  if (!itemId || !Number.isInteger(delta) || delta === 0 || !Number.isInteger(maxStack) || maxStack < 1 || maxStack > 2147483647) throw new HarnessError('INVALID_INPUT');
  if (!(await tx.query('SELECT scope_id FROM mud_characters WHERE scope_id=$1 AND active FOR UPDATE', [scopeId])).rowCount) throw new HarnessError('FORBIDDEN',403);
  const next = await itemQuantity(tx,scopeId,itemId) + delta;
  if (next < 0) throw new HarnessError('ITEM_REQUIRED',409);
  if (next > maxStack) throw new HarnessError('STACK_LIMIT',409);
  await tx.query('INSERT INTO game_inventory(scope_id,item_id,quantity) VALUES($1,$2,$3) ON CONFLICT(scope_id,item_id) DO UPDATE SET quantity=EXCLUDED.quantity', [scopeId,itemId,next]);
  return next;
}
